import { Bot, type CommandContext, type Context } from "grammy";
import { config, findPlayerByTelegramId, PLAYERS, type Player } from "./config.js";
import type { StatsPeriod } from "./stats.js";
import { getRoastOfTheDay, formatRoastMessage } from "./roast.js";
import { analyzeLastMatch, analyzeMatch } from "./analyze.js";
import { analyzeLastMatchCopium, analyzeMatchCopium } from "./analyze-copium.js";
import { fetchRecentMatches, fetchPlayerProfile } from "./opendota.js";
import { calculateStats } from "./stats.js";
import { getHeroNames } from "./heroes.js";
import { formatRank } from "./ranks.js";
import { getProMetaByRole } from "./meta.js";

// ============================================================================
// Bot lifecycle
// ============================================================================

/**
 * Creates and returns a configured Telegram bot instance
 */
export function createBot(): Bot {
  if (!config.telegramBotToken) {
    throw new Error("TELEGRAM_BOT_TOKEN is not set in environment variables");
  }
  return new Bot(config.telegramBotToken);
}

/**
 * Sends a message to the configured Telegram chat
 */
export async function sendMessage(bot: Bot, message: string): Promise<void> {
  if (!config.telegramChatId) {
    throw new Error("TELEGRAM_CHAT_ID is not set in environment variables");
  }
  await bot.api.sendMessage(config.telegramChatId, message, {
    parse_mode: "HTML",
    link_preview_options: { is_disabled: true },
  });
}

/**
 * Starts the bot to listen for commands
 */
export async function startBot(bot: Bot): Promise<void> {
  console.log("🤖 Starting bot polling...");
  await bot.start({
    onStart: () => {
      console.log("✅ Bot is now listening for commands");
    },
  });
}

// ============================================================================
// Helpers
// ============================================================================

/**
 * Shows a loading message, runs a task, deletes loading message, returns result.
 * If the task throws, the loading message is still cleaned up.
 */
async function withLoading<T>(
  ctx: CommandContext<Context>,
  loadingText: string,
  fn: () => Promise<T>,
): Promise<T> {
  const loadingMsg = await ctx.reply(loadingText);
  try {
    const result = await fn();
    await ctx.api.deleteMessage(ctx.chat.id, loadingMsg.message_id).catch(() => {});
    return result;
  } catch (error) {
    await ctx.api.deleteMessage(ctx.chat.id, loadingMsg.message_id).catch(() => {});
    throw error;
  }
}

/**
 * Sends an HTML reply with link preview disabled
 */
async function replyHtml(ctx: CommandContext<Context>, message: string): Promise<void> {
  await ctx.reply(message, {
    parse_mode: "HTML",
    link_preview_options: { is_disabled: true },
  });
}

/**
 * Parses a match ID from a command argument string.
 * Supports OpenDota URLs and raw numeric IDs.
 * Returns null if parsing fails.
 */
function parseMatchId(arg: string): number | null {
  // Try OpenDota URL first: https://www.opendota.com/matches/8670945485
  const urlMatch = arg.match(/opendota\.com\/matches\/(\d+)/i);
  if (urlMatch) {
    return parseInt(urlMatch[1], 10);
  }

  // Try raw number
  const parsed = parseInt(arg, 10);
  if (!isNaN(parsed) && parsed > 0) {
    return parsed;
  }

  return null;
}

// ============================================================================
// Command Handlers
// ============================================================================

/**
 * Handles a stats command for a specific period
 */
async function handleStatsCommand(
  ctx: CommandContext<Context>,
  period: StatsPeriod,
  fetchStatsHandler: (period: StatsPeriod) => Promise<string>,
  onCommandReceived?: () => void,
): Promise<void> {
  const periodLabel =
    period === "today"
      ? "daily"
      : period === "yesterday"
        ? "yesterday's"
        : period === "week"
          ? "weekly"
          : "monthly";
  const commandName =
    period === "today"
      ? "stats"
      : period === "yesterday"
        ? "yesterday"
        : period === "week"
          ? "weekly"
          : "monthly";

  console.log(
    `[${new Date().toISOString()}] /${commandName} command received from user ${ctx.from?.id}`,
  );

  onCommandReceived?.();

  try {
    const message = await withLoading(
      ctx,
      `⏳ Fetching ${periodLabel} stats...`,
      () => fetchStatsHandler(period),
    );

    await replyHtml(ctx, message);
    console.log(`[${new Date().toISOString()}] /${commandName} command completed`);
  } catch (error) {
    console.error(`[ERROR] Failed to handle /${commandName} command:`, error);
    await ctx.reply("❌ Error fetching stats. Please try again later.");
  }
}

/**
 * Handles the /roast command
 */
async function handleRoastCommand(
  ctx: CommandContext<Context>,
  onCommandReceived?: () => void,
): Promise<void> {
  console.log(
    `[${new Date().toISOString()}] /roast command received from user ${ctx.from?.id}`,
  );

  onCommandReceived?.();

  try {
    const roast = await withLoading(
      ctx,
      "🔥 Ищу кого прожарить...",
      () => getRoastOfTheDay(),
    );

    const message = formatRoastMessage(roast);
    await replyHtml(ctx, message);
    console.log(
      `[${new Date().toISOString()}] /roast command completed - victim: ${roast.playerName}`,
    );
  } catch (error) {
    console.error("[ERROR] Failed to handle /roast command:", error);
    await ctx.reply("❌ Не удалось найти кого прожарить. Попробуй позже.");
  }
}

/**
 * Generic handler for match analysis commands (/analyze and /copium).
 * Extracts match ID parsing, loading flow, and error handling.
 */
async function handleMatchAnalysisCommand(
  ctx: CommandContext<Context>,
  options: {
    commandName: string;
    loadingEmoji: string;
    analyzeFn: (matchId: number) => Promise<string>;
    analyzeLastFn: () => Promise<string>;
  },
  onCommandReceived?: () => void,
): Promise<void> {
  const { commandName, loadingEmoji, analyzeFn, analyzeLastFn } = options;

  console.log(
    `[${new Date().toISOString()}] /${commandName} command received from user ${ctx.from?.id}`,
  );

  onCommandReceived?.();

  try {
    const args = ctx.message?.text?.split(/\s+/).slice(1) || [];
    const matchIdArg = args[0];

    let analysis: string;

    if (matchIdArg) {
      const matchId = parseMatchId(matchIdArg);

      if (!matchId) {
        await ctx.reply(
          "❌ Не удалось распознать матч.\n\n" +
          "Примеры:\n" +
          `• /${commandName} https://www.opendota.com/matches/8670945485\n` +
          `• /${commandName} 8670945485`
        );
        return;
      }

      analysis = await withLoading(
        ctx,
        `${loadingEmoji} Анализирую матч #${matchId}...`,
        () => analyzeFn(matchId),
      );
    } else {
      analysis = await withLoading(
        ctx,
        `${loadingEmoji} Анализирую последний матч...`,
        () => analyzeLastFn(),
      );
    }

    await replyHtml(ctx, analysis);
    console.log(`[${new Date().toISOString()}] /${commandName} command completed`);
  } catch (error) {
    console.error(`[ERROR] Failed to handle /${commandName} command:`, error);
    const msg = error instanceof Error ? error.message : String(error);
    const isConfigError =
      /OPENAI_API_KEY not configured/i.test(msg) ||
      /OPENAI|api\.openai|proxy|ETIMEDOUT|timeout|fetch failed/i.test(msg);
    const reply =
      isConfigError && msg.length < 200
        ? `❌ /${commandName} не сработал: ${msg}\n\nПроверь на сервере: OPENAI_API_KEY, HTTPS_PROXY (если нужен), логи: docker logs pesiki-bot`
        : "❌ Не удалось проанализировать матч. Попробуй позже. (Детали в логах бота.)";
    await ctx.reply(reply);
  }
}

/**
 * Handles the /me command - shows player's personal stats (linked account only)
 */
async function handleMeCommand(
  ctx: CommandContext<Context>,
  onCommandReceived?: () => void,
): Promise<void> {
  const telegramId = ctx.from?.id;
  console.log(
    `[${new Date().toISOString()}] /me command received from user ${telegramId}`,
  );

  onCommandReceived?.();

  if (!telegramId) {
    await ctx.reply("❌ Не удалось определить твой Telegram ID");
    return;
  }

  const player = findPlayerByTelegramId(telegramId);

  if (!player) {
    const playersList = PLAYERS.map(p => `• ${p.dotaName}`).join("\n");
    await ctx.reply(
      `❌ Твой аккаунт не привязан.\n\n` +
      `Твой Telegram ID: <code>${telegramId}</code>\n` +
      `Попроси админа привязать к нужному игроку.\n\n` +
      `Игроки пати:\n${playersList}`,
      { parse_mode: "HTML" }
    );
    return;
  }

  try {
    const stats = await withLoading(
      ctx,
      `🔍 Загружаю статистику для ${player.dotaName}...`,
      async () => {
        const [profile, matches] = await Promise.all([
          fetchPlayerProfile(player.steamId),
          fetchRecentMatches(player.steamId),
        ]);

        const playerName = profile.profile?.personaname || player.dotaName;
        const playerRank = profile.rank_tier ?? null;
        return {
          stats: calculateStats(player.steamId, playerName, matches, "today", undefined, playerRank),
          playerName,
          playerRank,
        };
      },
    );

    // Get hero names
    const heroIds = stats.stats.heroes.map(h => h.heroId);
    const heroNames = await getHeroNames(heroIds);

    // Format hero stats
    const heroStats = stats.stats.heroes.slice(0, 5).map((h, i) => {
      const result = h.isWin ? "✅" : "❌";
      return `${result} ${heroNames[i]}`;
    }).join("\n");

    // Build message
    const dotaUrl = `https://www.opendota.com/players/${player.steamId}`;
    const rankStr = formatRank(stats.playerRank);
    const message = `👤 <b><a href="${dotaUrl}">${stats.playerName}</a></b>${rankStr ? ` ${rankStr}` : ""}

📊 <b>Сегодня:</b>
• Матчей: ${stats.stats.totalMatches}
• Винрейт: ${stats.stats.winRate}% (${stats.stats.wins}W / ${stats.stats.losses}L)
• KDA: ${stats.stats.avgKda ?? "N/A"}
${stats.stats.totalMatches > 0 ? `\n🎮 <b>Последние герои:</b>\n${heroStats}` : ""}

💡 Используй /analyze для AI-разбора последнего матча`;

    await replyHtml(ctx, message);
    console.log(`[${new Date().toISOString()}] /me command completed for ${stats.playerName}`);
  } catch (error) {
    console.error("[ERROR] Failed to handle /me command:", error);
    await ctx.reply("❌ Не удалось загрузить статистику. Попробуй позже.");
  }
}

/**
 * Handles /meta command - top meta heroes by role + AI lineup ideas
 */
async function handleMetaCommand(
  ctx: CommandContext<Context>,
  onCommandReceived?: () => void,
): Promise<void> {
  console.log(
    `[${new Date().toISOString()}] /meta command received from user ${ctx.from?.id}`,
  );

  onCommandReceived?.();

  try {
    const message = await withLoading(
      ctx,
      "📈 Собираю мету и AI-лайнапы...",
      () => getProMetaByRole(),
    );

    await replyHtml(ctx, message);
    console.log(`[${new Date().toISOString()}] /meta command completed`);
  } catch (error) {
    console.error("[ERROR] Failed to handle /meta command:", error);
    await ctx.reply("❌ Не удалось собрать мету. Попробуй позже.");
  }
}

// ============================================================================
// Command Registration
// ============================================================================

/**
 * Sets up bot commands and handlers
 * @param bot - The bot instance
 * @param fetchStatsHandler - Handler function that fetches and returns formatted stats message for a period
 * @param onCommandReceived - Optional callback to track command usage for health monitoring
 */
export function setupCommands(
  bot: Bot,
  fetchStatsHandler: (period: StatsPeriod) => Promise<string>,
  onCommandReceived?: () => void,
): void {
  // Stats commands
  bot.command("stats", (ctx) =>
    handleStatsCommand(ctx, "today", fetchStatsHandler, onCommandReceived),
  );
  bot.command("yesterday", (ctx) =>
    handleStatsCommand(ctx, "yesterday", fetchStatsHandler, onCommandReceived),
  );
  bot.command("weekly", (ctx) =>
    handleStatsCommand(ctx, "week", fetchStatsHandler, onCommandReceived),
  );
  bot.command("monthly", (ctx) =>
    handleStatsCommand(ctx, "month", fetchStatsHandler, onCommandReceived),
  );

  // Match analysis commands (using shared handler)
  bot.command("analyze", (ctx) =>
    handleMatchAnalysisCommand(ctx, {
      commandName: "analyze",
      loadingEmoji: "🔬",
      analyzeFn: analyzeMatch,
      analyzeLastFn: analyzeLastMatch,
    }, onCommandReceived),
  );
  bot.command("copium", (ctx) =>
    handleMatchAnalysisCommand(ctx, {
      commandName: "copium",
      loadingEmoji: "💊",
      analyzeFn: analyzeMatchCopium,
      analyzeLastFn: analyzeLastMatchCopium,
    }, onCommandReceived),
  );

  // Other commands
  bot.command("roast", (ctx) => handleRoastCommand(ctx, onCommandReceived));
  bot.command("me", (ctx) => handleMeCommand(ctx, onCommandReceived));
  bot.command("meta", (ctx) => handleMetaCommand(ctx, onCommandReceived));

  // Set bot commands menu
  bot.api
    .setMyCommands([
      { command: "stats", description: "Get today's Dota 2 stats" },
      { command: "yesterday", description: "Get yesterday's Dota 2 stats" },
      { command: "weekly", description: "Get this week's Dota 2 stats" },
      { command: "monthly", description: "Get this month's Dota 2 stats" },
      { command: "roast", description: "Roast the worst player of the day" },
      { command: "analyze", description: "AI analysis (or /analyze <url>)" },
      { command: "copium", description: "💊 AI-аналитика для стака" },
      { command: "me", description: "Your personal stats" },
      { command: "meta", description: "Топ-4 мета героев + AI лайнапы" },
    ])
    .catch((err) =>
      console.warn("[WARN] setMyCommands failed (menu may not show):", err.message),
    );
}
