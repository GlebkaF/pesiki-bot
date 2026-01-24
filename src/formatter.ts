import type { PlayerStats, HeroMatch, StatsPeriod } from "./stats.js";
import { getHeroNames } from "./heroes.js";

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
 * Gets the period title for the stats message
 */
function getPeriodTitle(period: StatsPeriod): string {
  const now = new Date();

  switch (period) {
    case "today":
      return formatDate(now);
    case "yesterday": {
      const yesterday = new Date(now);
      yesterday.setDate(now.getDate() - 1);
      return formatDate(yesterday);
    }
    case "week": {
      // Get Monday of current week
      const dayOfWeek = now.getDay();
      const daysToMonday = dayOfWeek === 0 ? 6 : dayOfWeek - 1;
      const monday = new Date(now);
      monday.setDate(now.getDate() - daysToMonday);
      return `${formatDate(monday)} - ${formatDate(now)} (Week)`;
    }
    case "month": {
      const monthNames = [
        "January", "February", "March", "April", "May", "June",
        "July", "August", "September", "October", "November", "December"
      ];
      return `${monthNames[now.getMonth()]} ${now.getFullYear()}`;
    }
  }
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
 * Formats heroes list with win/loss indicators
 */
function formatHeroesList(heroes: HeroMatch[], heroNames: string[]): string {
  return heroes
    .map((hero, index) => {
      const name = heroNames[index];
      const indicator = hero.isWin ? "✓" : "✗";
      return `${name}(${indicator})`;
    })
    .join(", ");
}

/**
 * Formats a single player's stats line
 */
function formatPlayerLine(
  stats: PlayerStats,
  heroNames: string[]
): string {
  const emoji = getPerformanceEmoji(stats);
  const displayName = stats.playerName;

  if (stats.totalMatches === 0) {
    return `${emoji} <b>${displayName}</b>: did not play`;
  }

  const heroesStr = formatHeroesList(stats.heroes, heroNames);
  return `${emoji} <b>${displayName}</b>: ${stats.wins}W / ${stats.losses}L (${stats.winRate}%)\n    ${heroesStr}`;
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
 * Fetches all hero names needed for the stats
 */
async function fetchAllHeroNames(
  allStats: PlayerStats[]
): Promise<Map<number, string[]>> {
  const heroNamesMap = new Map<number, string[]>();

  for (const stats of allStats) {
    if (stats.heroes.length > 0) {
      const heroIds = stats.heroes.map((h) => h.heroId);
      const names = await getHeroNames(heroIds);
      heroNamesMap.set(stats.playerId, names);
    } else {
      heroNamesMap.set(stats.playerId, []);
    }
  }

  return heroNamesMap;
}

/**
 * Formats the full stats message for Telegram (HTML format)
 */
export async function formatStatsMessage(
  allStats: PlayerStats[],
  period: StatsPeriod = "today"
): Promise<string> {
  const periodTitle = getPeriodTitle(period);
  const sortedStats = sortByPerformance(allStats);
  const totals = calculateTotals(allStats);

  // Fetch hero names for all players
  const heroNamesMap = await fetchAllHeroNames(allStats);

  const playerLines: string[] = [];
  for (const stats of sortedStats) {
    const heroNames = heroNamesMap.get(stats.playerId) ?? [];
    playerLines.push(formatPlayerLine(stats, heroNames));
  }

  const lines: string[] = [
    `📊 <b>Dota Stats for ${periodTitle}</b>`,
    "",
    ...playerLines,
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
