import type { RecentMatch } from "./opendota.js";

export interface HeroMatch {
  heroId: number;
  isWin: boolean;
}

export interface PlayerStats {
  playerId: number;
  wins: number;
  losses: number;
  totalMatches: number;
  winRate: number;
  heroes: HeroMatch[];
}

export type StatsPeriod = "today" | "week" | "month";

/**
 * Determines if the player won the match
 * Player slots 0-127 are Radiant, 128-255 are Dire
 */
function isWin(match: RecentMatch): boolean {
  const isRadiant = match.player_slot < 128;
  return isRadiant === match.radiant_win;
}

/**
 * Gets the start timestamp for a given period
 */
function getPeriodStartTimestamp(period: StatsPeriod): number {
  const now = new Date();

  switch (period) {
    case "today": {
      const todayStart = new Date(
        now.getFullYear(),
        now.getMonth(),
        now.getDate()
      );
      return todayStart.getTime() / 1000;
    }
    case "week": {
      // Get the start of the current week (Monday)
      const dayOfWeek = now.getDay();
      const daysToMonday = dayOfWeek === 0 ? 6 : dayOfWeek - 1;
      const weekStart = new Date(
        now.getFullYear(),
        now.getMonth(),
        now.getDate() - daysToMonday
      );
      return weekStart.getTime() / 1000;
    }
    case "month": {
      // Get the start of the current month
      const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);
      return monthStart.getTime() / 1000;
    }
  }
}

/**
 * Filters matches to only include those from the specified period
 */
function filterMatchesByPeriod(
  matches: RecentMatch[],
  period: StatsPeriod
): RecentMatch[] {
  const periodStart = getPeriodStartTimestamp(period);
  return matches.filter((match) => match.start_time >= periodStart);
}

/**
 * Filters matches to only include those from today (local time)
 * @deprecated Use filterMatchesByPeriod with "today" period instead
 */
function filterTodayMatches(matches: RecentMatch[]): RecentMatch[] {
  return filterMatchesByPeriod(matches, "today");
}

/**
 * Calculates win/loss statistics for a player's matches
 */
export function calculateStats(
  playerId: number,
  matches: RecentMatch[],
  period: StatsPeriod = "today"
): PlayerStats {
  const filteredMatches = filterMatchesByPeriod(matches, period);

  const wins = filteredMatches.filter(isWin).length;
  const losses = filteredMatches.length - wins;
  const totalMatches = filteredMatches.length;
  const winRate = totalMatches > 0 ? Math.round((wins / totalMatches) * 100) : 0;

  // Collect heroes played with win/loss info
  const heroes: HeroMatch[] = filteredMatches.map((match) => ({
    heroId: match.hero_id,
    isWin: isWin(match),
  }));

  return {
    playerId,
    wins,
    losses,
    totalMatches,
    winRate,
    heroes,
  };
}
