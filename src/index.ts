import cron from "node-cron";
import { PLAYER_IDS } from "./config.js";
import { fetchRecentMatches } from "./opendota.js";
import { calculateStats, type PlayerStats } from "./stats.js";
import { createBot, sendMessage } from "./bot.js";
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
 * Sends daily stats to Telegram
 */
async function sendDailyStats(): Promise<void> {
  console.log(`[${new Date().toISOString()}] Sending daily stats...`);
  console.log(`Fetching stats for ${PLAYER_IDS.length} players...`);

  try {
    const allStats = await fetchAllPlayersStats();
    const message = formatStatsMessage(allStats);

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
 * Main entry point: Set up cron job for daily stats at 23:55 MSK (UTC+3)
 * Cron expression: 55 20 * * * = 20:55 UTC = 23:55 MSK
 */
function main(): void {
  console.log("🤖 Pesiki Bot starting...");
  console.log("📅 Daily stats scheduled for 23:55 MSK (20:55 UTC)");

  // Schedule daily stats at 23:55 MSK (20:55 UTC)
  // Cron format: minute hour day month weekday
  cron.schedule("55 20 * * *", () => {
    sendDailyStats();
  });

  console.log("✅ Bot is running. Waiting for scheduled tasks...");

  // Send stats immediately if RUN_NOW environment variable is set (for testing)
  if (process.env.RUN_NOW === "true") {
    console.log("🚀 RUN_NOW=true detected, sending stats immediately...");
    sendDailyStats();
  }
}

main();
