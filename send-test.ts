/**
 * Test script to send a formatted stats message to Telegram
 * Run with: npx tsx send-test.ts [period]
 * Period can be: today, yesterday, week, month (default: today)
 */

import { PLAYER_IDS } from "./src/config.js";
import { fetchRecentMatches, fetchPlayerProfile, fetchPlayerTotals } from "./src/opendota.js";
import { calculateStats, type PlayerStats, type StatsPeriod } from "./src/stats.js";
import { createBot, sendMessage } from "./src/bot.js";
import { formatStatsMessage, stripHtml } from "./src/formatter.js";

/**
 * Fetches player nickname from OpenDota API
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
 * Fetches average APM for a player
 */
async function getPlayerAvgApm(playerId: number): Promise<number | undefined> {
  try {
    const totals = await fetchPlayerTotals(playerId);
    const apmTotal = totals.find((t) => t.field === "actions_per_min");
    
    if (apmTotal && apmTotal.n > 0) {
      return Math.round(apmTotal.sum / apmTotal.n);
    }
    return undefined;
  } catch (error) {
    console.warn(`Failed to fetch APM for player ${playerId}:`, error);
    return undefined;
  }
}

/**
 * Returns number of days to fetch matches for based on period
 */
function getDaysForPeriod(period: StatsPeriod): number | undefined {
  switch (period) {
    case "today":
    case "yesterday":
      return undefined; // Use fast /recentMatches (20 is enough for 1-2 days)
    case "week":
      return 8;
    case "month":
      return 32;
  }
}

/**
 * Fetches stats for all configured players
 */
async function fetchAllPlayersStats(period: StatsPeriod = "today"): Promise<PlayerStats[]> {
  const days = getDaysForPeriod(period);
  
  const statsPromises = PLAYER_IDS.map(async (playerId) => {
    console.log(`Fetching data for player ${playerId}...`);
    
    const [playerName, matches, avgApm] = await Promise.all([
      getPlayerName(playerId),
      fetchRecentMatches(playerId, days),
      getPlayerAvgApm(playerId),
    ]);
    
    console.log(`  Player: ${playerName}, Found ${matches.length} recent matches`);
    return calculateStats(playerId, playerName, matches, period, avgApm);
  });

  return Promise.all(statsPromises);
}

/**
 * Main function
 */
async function main(): Promise<void> {
  // Get period from command line argument (default: today)
  const period = (process.argv[2] || "today") as StatsPeriod;
  const validPeriods = ["today", "yesterday", "week", "month"];
  
  if (!validPeriods.includes(period)) {
    console.error(`❌ Invalid period: ${period}`);
    console.error(`Valid periods: ${validPeriods.join(", ")}`);
    process.exit(1);
  }

  console.log(`🧪 Sending test message to Telegram (${period})...\n`);

  try {
    // Fetch stats
    console.log(`Fetching ${period} stats...`);
    const allStats = await fetchAllPlayersStats(period);
    
    // Format message
    console.log("Formatting message...");
    const message = await formatStatsMessage(allStats, period);

    // Print to console
    console.log("\n=== Message Preview ===");
    console.log(stripHtml(message));
    console.log("======================\n");

    // Send to Telegram
    console.log("Sending to Telegram...");
    const bot = createBot();
    await sendMessage(bot, message);
    console.log("✅ Message sent successfully!");
    
    process.exit(0);
  } catch (error) {
    console.error("❌ Failed to send test message:", error);
    process.exit(1);
  }
}

main();
