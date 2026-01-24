import { TEST_PLAYER_ID } from "./config.js";
import { fetchRecentMatches } from "./opendota.js";
import { calculateStats } from "./stats.js";

/**
 * Tracer Bullet 1: Fetch one player's matches and print W/L stats to console
 */
async function main() {
  console.log(`Fetching matches for player ${TEST_PLAYER_ID}...`);

  try {
    const matches = await fetchRecentMatches(TEST_PLAYER_ID);
    console.log(`Found ${matches.length} recent matches`);

    const stats = calculateStats(TEST_PLAYER_ID, matches);

    const today = new Date().toLocaleDateString("ru-RU");
    console.log(`\n📊 Dota Stats for ${today}\n`);

    if (stats.totalMatches === 0) {
      console.log(`🎮 Player ${stats.playerId}: did not play today`);
    } else {
      console.log(
        `🎮 Player ${stats.playerId}: ${stats.wins}W / ${stats.losses}L (${stats.winRate}%)`
      );
    }

    console.log(`\nTotal matches today: ${stats.totalMatches}`);
  } catch (error) {
    console.error("Error fetching stats:", error);
    process.exit(1);
  }
}

main();
