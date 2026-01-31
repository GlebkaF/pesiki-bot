import { Bot, type CommandContext, type Context } from "grammy";
import { config } from "./config.js";
import type { StatsPeriod } from "./stats.js";
import { getRoastOfTheDay, formatRoastMessage } from "./roast.js";
import { analyzeLastMatch, analyzeMatch } from "./analyze.js";

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
 * Handles the /roast command
 */
async function handleRoastCommand(
  ctx: CommandContext<Context>,
  onCommandReceived?: () => void,
): Promise<void> {
  console.log(
    `[${new Date().toISOString()}] /roast command received from user ${ctx.from?.id}`,
  );

  if (onCommandReceived) {
    onCommandReceived();
  }

  try {
    // Send "loading" message
    const loadingMsg = await ctx.reply("🔥 Ищу кого прожарить...");

    // Get roast of the day
    const roast = await getRoastOfTheDay();
    const message = formatRoastMessage(roast);

    // Delete loading message and send roast
    await ctx.api.deleteMessage(ctx.chat.id, loadingMsg.message_id);
    await ctx.reply(message, {
      parse_mode: "HTML",
      link_preview_options: { is_disabled: true },
    });

    console.log(
      `[${new Date().toISOString()}] /roast command completed - victim: ${roast.playerName}`,
    );
  } catch (error) {
    console.error("[ERROR] Failed to handle /roast command:", error);
    await ctx.reply("❌ Не удалось найти кого прожарить. Попробуй позже.");
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
    // Parse match_id from command arguments
    const args = ctx.message?.text?.split(/\s+/).slice(1) || [];
    const matchIdArg = args[0];
    
    let analysis: string;
    let loadingText: string;
    
    if (matchIdArg) {
      // Analyze specific match
      const matchId = parseInt(matchIdArg, 10);
      if (isNaN(matchId) || matchId <= 0) {
        await ctx.reply("❌ Неверный ID матча. Используй: /analyze 8670945485");
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
    await ctx.reply("❌ Не удалось проанализировать матч. Попробуй позже.");
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

  // Register /weekly command
  bot.command("weekly", (ctx) =>
    handleStatsCommand(ctx, "week", fetchStatsHandler, onCommandReceived),
  );

  // Register /monthly command
  bot.command("monthly", (ctx) =>
    handleStatsCommand(ctx, "month", fetchStatsHandler, onCommandReceived),
  );

  // Register /roast command
  bot.command("roast", (ctx) => handleRoastCommand(ctx, onCommandReceived));

  // Register /analyze command
  bot.command("analyze", (ctx) => handleAnalyzeCommand(ctx, onCommandReceived));

  // Set bot commands menu
  bot.api.setMyCommands([
    { command: "stats", description: "Get today's Dota 2 stats" },
    { command: "yesterday", description: "Get yesterday's Dota 2 stats" },
    { command: "weekly", description: "Get this week's Dota 2 stats" },
    { command: "monthly", description: "Get this month's Dota 2 stats" },
    { command: "roast", description: "Roast the worst player of the day" },
    { command: "analyze", description: "AI analysis (/analyze or /analyze match_id)" },
  ]);
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
