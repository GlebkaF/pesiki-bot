import { PLAYER_IDS } from "./config.js";
import { fetchRecentMatches } from "./opendota.js";
import { calculateStats, type PlayerStats } from "./stats.js";
import { createBot, sendMessage } from "./bot.js";

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
 * Formats player stats into a display string
 */
function formatPlayerStats(stats: PlayerStats): string {
  if (stats.totalMatches === 0) {
    return `🎮 Player ${stats.playerId}: did not play today`;
  }
  return `🎮 Player ${stats.playerId}: ${stats.wins}W / ${stats.losses}L (${stats.winRate}%)`;
}

/**
 * Formats the full stats message for all players
 */
function formatStatsMessage(allStats: PlayerStats[]): string {
  const today = new Date().toLocaleDateString("ru-RU");
  const totalMatches = allStats.reduce((sum, s) => sum + s.totalMatches, 0);

  const lines = [
    `📊 <b>Dota Stats for ${today}</b>`,
    "",
    ...allStats.map(formatPlayerStats),
    "",
    `Total matches today: ${totalMatches}`,
  ];
  return lines.join("\n");
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
    console.log("\n" + message.replace(/<[^>]*>/g, "") + "\n");

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
