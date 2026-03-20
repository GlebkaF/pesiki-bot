import { Bot, type CommandContext, type Context } from "grammy";
import { config } from "./config.js";
import type { StatsPeriod } from "./stats.js";
import { analyzeLastMatch, analyzeMatch } from "./analyze.js";
import { analyzeLastMatchCopium, analyzeMatchCopium } from "./analyze-copium.js";

/**
 * Creates and returns a configured Telegram bot instance
 * Uses HTTPS_PROXY for Telegram API when configured
 */
export async function createBot(): Promise<Bot> {
  if (!config.telegramBotToken) {
    throw new Error("TELEGRAM_BOT_TOKEN is not set in environment variables");
  }

  const proxy = process.env.HTTPS_PROXY || process.env.HTTP_PROXY;
  if (proxy) {
    const undici = await import("undici");
    const agent = new undici.ProxyAgent(proxy);
    const proxyFetch = ((url: string | URL | Request, init?: RequestInit) =>
      undici.fetch(String(url), { ...init, dispatcher: agent } as Parameters<typeof undici.fetch>[1])) as unknown as typeof fetch;
    console.log("[PROXY] Telegram API will use proxy");
    return new Bot(config.telegramBotToken, {
      client: {
        fetch: proxyFetch,
      },
    });
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

  // Track command for health monitoring
  if (onCommandReceived) {
    onCommandReceived();
  }

  try {
    // Send "loading" message
    const loadingMsg = await ctx.reply(`⏳ Fetching ${periodLabel} stats...`);

    // Fetch stats
    const message = await fetchStatsHandler(period);

    // Delete loading message and send stats
    await ctx.api.deleteMessage(ctx.chat.id, loadingMsg.message_id);
    await ctx.reply(message, {
      parse_mode: "HTML",
      link_preview_options: { is_disabled: true },
    });

    console.log(
      `[${new Date().toISOString()}] /${commandName} command completed`,
    );
  } catch (error) {
    console.error(`[ERROR] Failed to handle /${commandName} command:`, error);
    await ctx.reply("❌ Error fetching stats. Please try again later.");
  }
}

/**
 * Handles the /analyze command - AI analysis of match
 * Usage: /analyze [match_id] - if no match_id provided, analyzes last match
 */
async function handleAnalyzeCommand(
  ctx: CommandContext<Context>,
  onCommandReceived?: () => void,
): Promise<void> {
  console.log(
    `[${new Date().toISOString()}] /analyze command received from user ${ctx.from?.id}`,
  );

  if (onCommandReceived) {
    onCommandReceived();
  }

  try {
    // Parse match_id from command arguments (supports URL or raw ID)
    const args = ctx.message?.text?.split(/\s+/).slice(1) || [];
    const matchIdArg = args[0];
    
    let analysis: string;
    let loadingText: string;
    
    if (matchIdArg) {
      // Parse match ID from OpenDota URL or raw number
      // Supports: https://www.opendota.com/matches/8670945485, 8670945485
      let matchId: number | null = null;
      
      const urlMatch = matchIdArg.match(/opendota\.com\/matches\/(\d+)/i);
      if (urlMatch) {
        matchId = parseInt(urlMatch[1], 10);
      } else {
        const parsed = parseInt(matchIdArg, 10);
        if (!isNaN(parsed) && parsed > 0) {
          matchId = parsed;
        }
      }
      
      if (!matchId) {
        await ctx.reply(
          "❌ Не удалось распознать матч.\n\n" +
          "Примеры:\n" +
          "• /analyze https://www.opendota.com/matches/8670945485\n" +
          "• /analyze 8670945485"
        );
        return;
      }
      
      loadingText = `🔬 Анализирую матч #${matchId}...`;
      const loadingMsg = await ctx.reply(loadingText);
      
      analysis = await analyzeMatch(matchId);
      
      await ctx.api.deleteMessage(ctx.chat.id, loadingMsg.message_id);
    } else {
      // Analyze last match
      loadingText = "🔬 Анализирую последний матч...";
      const loadingMsg = await ctx.reply(loadingText);
      
      analysis = await analyzeLastMatch();
      
      await ctx.api.deleteMessage(ctx.chat.id, loadingMsg.message_id);
    }

    await ctx.reply(analysis, {
      parse_mode: "HTML",
      link_preview_options: { is_disabled: true },
    });

    console.log(`[${new Date().toISOString()}] /analyze command completed`);
  } catch (error) {
    console.error("[ERROR] Failed to handle /analyze command:", error);
    const msg = error instanceof Error ? error.message : String(error);
    const isConfigError =
      /OPENAI_API_KEY not configured/i.test(msg) ||
      /OPENAI|api\.openai|proxy|ETIMEDOUT|timeout|fetch failed/i.test(msg);
    const reply =
      isConfigError && msg.length < 200
        ? `❌ /analyze не сработал: ${msg}\n\nПроверь на сервере: OPENAI_API_KEY, HTTPS_PROXY (если нужен), логи: docker logs pesiki-bot`
        : "❌ Не удалось проанализировать матч. Попробуй позже. (Детали в логах бота.)";
    await ctx.reply(reply);
  }
}

/**
 * Handles the /copium command - biased AI analysis that defends our stack
 * Usage: /copium [match_id] - if no match_id provided, analyzes last match
 */
async function handleCopiumCommand(
  ctx: CommandContext<Context>,
  onCommandReceived?: () => void,
): Promise<void> {
  console.log(
    `[${new Date().toISOString()}] /copium command received from user ${ctx.from?.id}`,
  );

  if (onCommandReceived) {
    onCommandReceived();
  }

  try {
    // Parse match_id from command arguments (supports URL or raw ID)
    const args = ctx.message?.text?.split(/\s+/).slice(1) || [];
    const matchIdArg = args[0];
    
    let analysis: string;
    let loadingText: string;
    
    if (matchIdArg) {
      // Parse match ID from OpenDota URL or raw number
      let matchId: number | null = null;
      
      const urlMatch = matchIdArg.match(/opendota\.com\/matches\/(\d+)/i);
      if (urlMatch) {
        matchId = parseInt(urlMatch[1], 10);
      } else {
        const parsed = parseInt(matchIdArg, 10);
        if (!isNaN(parsed) && parsed > 0) {
          matchId = parsed;
        }
      }
      
      if (!matchId) {
        await ctx.reply(
          "❌ Не удалось распознать матч.\n\n" +
          "Примеры:\n" +
          "• /copium https://www.opendota.com/matches/8670945485\n" +
          "• /copium 8670945485"
        );
        return;
      }
      
      loadingText = `💊 Анализирую матч #${matchId}...`;
      const loadingMsg = await ctx.reply(loadingText);
      
      analysis = await analyzeMatchCopium(matchId);
      
      await ctx.api.deleteMessage(ctx.chat.id, loadingMsg.message_id);
    } else {
      // Analyze last match
      loadingText = "💊 Анализирую последний матч...";
      const loadingMsg = await ctx.reply(loadingText);
      
      analysis = await analyzeLastMatchCopium();
      
      await ctx.api.deleteMessage(ctx.chat.id, loadingMsg.message_id);
    }

    await ctx.reply(analysis, {
      parse_mode: "HTML",
      link_preview_options: { is_disabled: true },
    });

    console.log(`[${new Date().toISOString()}] /copium command completed`);
  } catch (error) {
    console.error("[ERROR] Failed to handle /copium command:", error);
    const msg = error instanceof Error ? error.message : String(error);
    const isConfigError =
      /OPENAI_API_KEY not configured/i.test(msg) ||
      /OPENAI|api\.openai|proxy|ETIMEDOUT|timeout|fetch failed/i.test(msg);
    const reply =
      isConfigError && msg.length < 200
        ? `❌ /copium не сработал: ${msg}\n\nПроверь на сервере: OPENAI_API_KEY, HTTPS_PROXY (если нужен), логи: docker logs pesiki-bot`
        : "❌ Не удалось проанализировать матч. Попробуй позже. (Детали в логах бота.)";
    await ctx.reply(reply);
  }
}

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
  // Register /stats command (today's stats)
  bot.command("stats", (ctx) =>
    handleStatsCommand(ctx, "today", fetchStatsHandler, onCommandReceived),
  );

  // Register /yesterday command
  bot.command("yesterday", (ctx) =>
    handleStatsCommand(ctx, "yesterday", fetchStatsHandler, onCommandReceived),
  );

  // Register /analyze command
  bot.command("analyze", (ctx) => handleAnalyzeCommand(ctx, onCommandReceived));

  // Register /copium command (biased analysis)
  bot.command("copium", (ctx) => handleCopiumCommand(ctx, onCommandReceived));

  // Set bot commands menu (optional; 404 can occur with invalid token or custom API)
  bot.api
    .setMyCommands([
      { command: "stats", description: "Get today's Dota 2 stats" },
      { command: "yesterday", description: "Get yesterday's Dota 2 stats" },
      { command: "analyze", description: "AI analysis (or /analyze <url>)" },
      { command: "copium", description: "💊 AI-аналитика для стака" },
    ])
    .catch((err) =>
      console.warn("[WARN] setMyCommands failed (menu may not show):", err.message),
    );
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
