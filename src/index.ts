import cron from "node-cron";
import { PLAYER_IDS } from "./config.js";
import { fetchRecentMatches } from "./opendota.js";
import { calculateStats, type PlayerStats } from "./stats.js";
import { createBot, sendMessage, setupCommands, startBot } from "./bot.js";
import { formatStatsMessage, stripHtml } from "./formatter.js";

/**
 * Fetches stats for all configured players
 */
async function fetchAllPlayersStats(): Promise<PlayerStats[]> {
  const statsPromises = PLAYER_IDS.map(async (playerId) => {
    console.log(`Fetching matches for player ${playerId}...`);
    const matches = await fetchRecentMatches(playerId);
    console.log(`  Found ${matches.length} recent matches`);
    return calculateStats(playerId, matches);
  });

  return Promise.all(statsPromises);
}

/**
 * Fetches stats and returns formatted message
 */
async function getFormattedStats(): Promise<string> {
  console.log(`Fetching stats for ${PLAYER_IDS.length} players...`);
  const allStats = await fetchAllPlayersStats();
  return formatStatsMessage(allStats);
}

/**
 * Sends daily stats to Telegram (used by cron job)
 */
async function sendDailyStats(): Promise<void> {
  console.log(`[${new Date().toISOString()}] Sending daily stats...`);

  try {
    const message = await getFormattedStats();

    // Print to console
    console.log("\n" + stripHtml(message) + "\n");

    // Send to Telegram
    console.log("Sending message to Telegram...");
    const bot = createBot();
    await sendMessage(bot, message);
    console.log("Message sent successfully!");
  } catch (error) {
    console.error("Error sending daily stats:", error);
  }
}

/**
 * Main entry point: Set up cron job and bot commands
 * Cron expression: 55 20 * * * = 20:55 UTC = 23:55 MSK
 */
async function main(): Promise<void> {
  console.log("🤖 Pesiki Bot starting...");

  // Create bot instance
  const bot = createBot();

  // Set up /stats command handler
  setupCommands(bot, getFormattedStats);

  // Schedule daily stats at 23:55 MSK (20:55 UTC)
  console.log("📅 Daily stats scheduled for 23:55 MSK (20:55 UTC)");
  cron.schedule("55 20 * * *", () => {
    sendDailyStats();
  });

  // Send stats immediately if RUN_NOW environment variable is set (for testing)
  if (process.env.RUN_NOW === "true") {
    console.log("🚀 RUN_NOW=true detected, sending stats immediately...");
    await sendDailyStats();
  }

  // Start bot to listen for commands
  await startBot(bot);
}

main();
