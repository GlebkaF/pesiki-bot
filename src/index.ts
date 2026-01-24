import cron from "node-cron";
import { PLAYER_IDS } from "./config.js";
import { fetchRecentMatches, fetchPlayerProfile } from "./opendota.js";
import { calculateStats, type PlayerStats, type StatsPeriod } from "./stats.js";
import { createBot, sendMessage, setupCommands, startBot } from "./bot.js";
import { formatStatsMessage, stripHtml } from "./formatter.js";

/**
 * Fetches player nickname from OpenDota API
 * Falls back to player ID if nickname is not available
 */
async function getPlayerName(playerId: number): Promise<string> {
  try {
    const playerData = await fetchPlayerProfile(playerId);
    return playerData.profile?.personaname || String(playerId);
  } catch (error) {
    console.warn(`Failed to fetch profile for player ${playerId}:`, error);
    return String(playerId);
  }
}

/**
 * Fetches stats for all configured players for a given period
 */
async function fetchAllPlayersStats(
  period: StatsPeriod = "today"
): Promise<PlayerStats[]> {
  const statsPromises = PLAYER_IDS.map(async (playerId) => {
    console.log(`Fetching data for player ${playerId}...`);
    
    // Fetch profile and matches in parallel
    const [playerName, matches] = await Promise.all([
      getPlayerName(playerId),
      fetchRecentMatches(playerId),
    ]);
    
    console.log(`  Player: ${playerName}, Found ${matches.length} recent matches`);
    return calculateStats(playerId, playerName, matches, period);
  });

  return Promise.all(statsPromises);
}

/**
 * Fetches stats and returns formatted message for a given period
 */
async function getFormattedStats(period: StatsPeriod = "today"): Promise<string> {
  console.log(`Fetching ${period} stats for ${PLAYER_IDS.length} players...`);
  const allStats = await fetchAllPlayersStats(period);
  console.log("Fetching hero names...");
  return await formatStatsMessage(allStats, period);
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
 * Cron expression: 0 4 * * * = 04:00 UTC = 07:00 MSK
 */
async function main(): Promise<void> {
  console.log("🤖 Pesiki Bot starting...");

  // Create bot instance
  const bot = createBot();

  // Set up /stats command handler
  setupCommands(bot, getFormattedStats);

  // Schedule daily stats at 07:00 MSK (04:00 UTC)
  console.log("📅 Daily stats scheduled for 07:00 MSK (04:00 UTC)");
  cron.schedule("0 4 * * *", () => {
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
