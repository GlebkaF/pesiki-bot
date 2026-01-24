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
 * Main entry point: Fetch all players' matches and send stats to Telegram
 */
async function main() {
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
    console.error("Error:", error);
    process.exit(1);
  }
}

main();
