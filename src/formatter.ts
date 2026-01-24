import type { PlayerStats } from "./stats.js";

/**
 * Formats the date in DD.MM.YYYY format
 */
function formatDate(date: Date): string {
  const day = String(date.getDate()).padStart(2, "0");
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const year = date.getFullYear();
  return `${day}.${month}.${year}`;
}

/**
 * Gets emoji based on win rate
 */
function getPerformanceEmoji(stats: PlayerStats): string {
  if (stats.totalMatches === 0) return "😴";
  if (stats.winRate >= 75) return "🔥";
  if (stats.winRate >= 50) return "✅";
  if (stats.winRate >= 25) return "😐";
  return "💀";
}

/**
 * Formats a single player's stats line
 */
function formatPlayerLine(stats: PlayerStats): string {
  const emoji = getPerformanceEmoji(stats);

  if (stats.totalMatches === 0) {
    return `${emoji} <b>${stats.playerId}</b>: did not play`;
  }

  return `${emoji} <b>${stats.playerId}</b>: ${stats.wins}W / ${stats.losses}L (${stats.winRate}%)`;
}

/**
 * Sorts players by performance (most matches first, then by win rate)
 */
function sortByPerformance(stats: PlayerStats[]): PlayerStats[] {
  return [...stats].sort((a, b) => {
    // Players who played come first
    if (a.totalMatches === 0 && b.totalMatches > 0) return 1;
    if (a.totalMatches > 0 && b.totalMatches === 0) return -1;

    // Sort by total matches (descending)
    if (b.totalMatches !== a.totalMatches) {
      return b.totalMatches - a.totalMatches;
    }

    // Then by win rate (descending)
    return b.winRate - a.winRate;
  });
}

/**
 * Calculates team totals
 */
function calculateTotals(stats: PlayerStats[]): {
  totalMatches: number;
  totalWins: number;
  totalLosses: number;
  teamWinRate: number;
  playersPlayed: number;
} {
  const totalMatches = stats.reduce((sum, s) => sum + s.totalMatches, 0);
  const totalWins = stats.reduce((sum, s) => sum + s.wins, 0);
  const totalLosses = stats.reduce((sum, s) => sum + s.losses, 0);
  const teamWinRate =
    totalMatches > 0 ? Math.round((totalWins / totalMatches) * 100) : 0;
  const playersPlayed = stats.filter((s) => s.totalMatches > 0).length;

  return { totalMatches, totalWins, totalLosses, teamWinRate, playersPlayed };
}

/**
 * Formats the full stats message for Telegram (HTML format)
 */
export function formatStatsMessage(allStats: PlayerStats[]): string {
  const today = formatDate(new Date());
  const sortedStats = sortByPerformance(allStats);
  const totals = calculateTotals(allStats);

  const lines: string[] = [
    `📊 <b>Dota Stats for ${today}</b>`,
    "",
    ...sortedStats.map(formatPlayerLine),
    "",
    "━━━━━━━━━━━━━━━━━━━━",
    `📈 <b>Team Summary</b>`,
    `🎮 Matches: ${totals.totalMatches}`,
    `✅ Wins: ${totals.totalWins} | ❌ Losses: ${totals.totalLosses}`,
    `📊 Win Rate: ${totals.teamWinRate}%`,
    `👥 Players active: ${totals.playersPlayed}/${allStats.length}`,
  ];

  return lines.join("\n");
}

/**
 * Strips HTML tags for console output
 */
export function stripHtml(message: string): string {
  return message.replace(/<[^>]*>/g, "");
}
