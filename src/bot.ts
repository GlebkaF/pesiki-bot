import { Bot } from "grammy";
import { config } from "./config.js";

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
  });
}

/**
 * Sets up bot commands and handlers
 * @param bot - The bot instance
 * @param fetchStatsHandler - Handler function that fetches and returns formatted stats message
 */
export function setupCommands(
  bot: Bot,
  fetchStatsHandler: () => Promise<string>
): void {
  // Register /stats command
  bot.command("stats", async (ctx) => {
    console.log(
      `[${new Date().toISOString()}] /stats command received from user ${ctx.from?.id}`
    );

    try {
      // Send "loading" message
      const loadingMsg = await ctx.reply("⏳ Fetching stats...");

      // Fetch stats
      const message = await fetchStatsHandler();

      // Delete loading message and send stats
      await ctx.api.deleteMessage(ctx.chat.id, loadingMsg.message_id);
      await ctx.reply(message, { parse_mode: "HTML" });

      console.log(`[${new Date().toISOString()}] /stats command completed`);
    } catch (error) {
      console.error("Error handling /stats command:", error);
      await ctx.reply("❌ Error fetching stats. Please try again later.");
    }
  });

  // Set bot commands menu
  bot.api.setMyCommands([
    { command: "stats", description: "Get today's Dota 2 stats" },
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
