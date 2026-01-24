import { TEST_PLAYER_ID } from "./config.js";
import { fetchRecentMatches } from "./opendota.js";
import { calculateStats, type PlayerStats } from "./stats.js";
import { createBot, sendMessage } from "./bot.js";

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
 * Formats the full stats message
 */
function formatStatsMessage(stats: PlayerStats): string {
  const today = new Date().toLocaleDateString("ru-RU");
  const lines = [
    `📊 <b>Dota Stats for ${today}</b>`,
    "",
    formatPlayerStats(stats),
    "",
    `Total matches today: ${stats.totalMatches}`,
  ];
  return lines.join("\n");
}

/**
 * Tracer Bullet 2: Fetch one player's matches and send stats to Telegram
 */
async function main() {
  console.log(`Fetching matches for player ${TEST_PLAYER_ID}...`);

  try {
    const matches = await fetchRecentMatches(TEST_PLAYER_ID);
    console.log(`Found ${matches.length} recent matches`);

    const stats = calculateStats(TEST_PLAYER_ID, matches);
    const message = formatStatsMessage(stats);

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
