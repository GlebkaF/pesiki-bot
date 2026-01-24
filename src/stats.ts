import type { RecentMatch } from "./opendota.js";

export interface HeroMatch {
  heroId: number;
  isWin: boolean;
}

export interface PlayerStats {
  playerId: number;
  playerName: string;
  wins: number;
  losses: number;
  totalMatches: number;
  winRate: number;
  heroes: HeroMatch[];
  avgApm?: number;
}

export type StatsPeriod = "today" | "yesterday" | "week" | "month";

/**
 * Determines if the player won the match
 * Player slots 0-127 are Radiant, 128-255 are Dire
 */
function isWin(match: RecentMatch): boolean {
  const isRadiant = match.player_slot < 128;
  return isRadiant === match.radiant_win;
}

/**
 * Day start hour in MSK timezone (6:00 AM)
 * Day is considered to start at 6:00 MSK, not midnight
 */
const DAY_START_HOUR_MSK = 6;
const MSK_OFFSET_HOURS = 3; // UTC+3

/**
 * Gets current MSK time components using UTC methods.
 * By adding MSK offset to UTC time and using getUTC* methods,
 * we correctly get MSK time regardless of server timezone.
 */
function getMskTimeComponents() {
  const now = new Date();
  const mskTime = now.getTime() + MSK_OFFSET_HOURS * 60 * 60 * 1000;
  const mskDate = new Date(mskTime);

  // Use getUTC* methods since we've shifted the time to make UTC act like MSK
  return {
    year: mskDate.getUTCFullYear(),
    month: mskDate.getUTCMonth(),
    date: mskDate.getUTCDate(),
    hours: mskDate.getUTCHours(),
    day: mskDate.getUTCDay(),
  };
}

/**
 * Creates a UTC timestamp (in seconds) for a specific MSK time.
 * Uses Date.UTC to avoid local timezone interference.
 */
function mskToUtcTimestamp(
  year: number,
  month: number,
  date: number,
  hours: number
): number {
  // Create UTC time for the given components, then subtract MSK offset to get actual UTC
  const utcMillis = Date.UTC(year, month, date, hours, 0, 0, 0);
  return (utcMillis - MSK_OFFSET_HOURS * 60 * 60 * 1000) / 1000;
}

/**
 * Gets the start timestamp for a given period
 * For "today", day starts at 6:00 MSK instead of midnight
 */
function getPeriodStartTimestamp(period: StatsPeriod): number {
  const msk = getMskTimeComponents();

  switch (period) {
    case "today": {
      // Day starts at 6:00 MSK
      // If current MSK time is before 6:00, use yesterday's 6:00
      let { year, month, date } = msk;

      if (msk.hours < DAY_START_HOUR_MSK) {
        // Before 6:00 MSK - use previous day's 6:00
        // Handle month/year boundaries by using Date arithmetic
        const prevDay = new Date(Date.UTC(year, month, date - 1));
        year = prevDay.getUTCFullYear();
        month = prevDay.getUTCMonth();
        date = prevDay.getUTCDate();
      }

      return mskToUtcTimestamp(year, month, date, DAY_START_HOUR_MSK);
    }
    case "yesterday": {
      // Yesterday: from 6:00 MSK of the day before "today"
      // If current MSK time is before 6:00, go back 2 days, otherwise 1 day
      const { year, month, date } = msk;
      const daysBack = msk.hours < DAY_START_HOUR_MSK ? 2 : 1;
      const prevDay = new Date(Date.UTC(year, month, date - daysBack));

      return mskToUtcTimestamp(
        prevDay.getUTCFullYear(),
        prevDay.getUTCMonth(),
        prevDay.getUTCDate(),
        DAY_START_HOUR_MSK
      );
    }
    case "week": {
      // Get the start of the current week (Monday at 6:00 MSK)
      const dayOfWeek = msk.day;
      const daysToMonday = dayOfWeek === 0 ? 6 : dayOfWeek - 1;

      // If it's Monday before 6:00, we're still in previous week
      let adjustedDays = daysToMonday;
      if (daysToMonday === 0 && msk.hours < DAY_START_HOUR_MSK) {
        adjustedDays = 7;
      }

      // Calculate Monday's date using Date arithmetic to handle month/year boundaries
      const mondayDate = new Date(
        Date.UTC(msk.year, msk.month, msk.date - adjustedDays)
      );

      return mskToUtcTimestamp(
        mondayDate.getUTCFullYear(),
        mondayDate.getUTCMonth(),
        mondayDate.getUTCDate(),
        DAY_START_HOUR_MSK
      );
    }
    case "month": {
      // Get the start of the current month (1st at 6:00 MSK)
      // If it's 1st before 6:00, use previous month
      let { year, month } = msk;

      if (msk.date === 1 && msk.hours < DAY_START_HOUR_MSK) {
        // Handle year boundary
        const prevMonth = new Date(Date.UTC(year, month - 1, 1));
        year = prevMonth.getUTCFullYear();
        month = prevMonth.getUTCMonth();
      }

      return mskToUtcTimestamp(year, month, 1, DAY_START_HOUR_MSK);
    }
  }
}

/**
 * Gets the end timestamp for a given period (exclusive)
 * Returns null for periods that don't have an upper bound (today, week, month)
 * Returns today's start for "yesterday" period
 */
function getPeriodEndTimestamp(period: StatsPeriod): number | null {
  if (period !== "yesterday") return null;
  return getPeriodStartTimestamp("today");
}

/**
 * Filters matches to only include those from the specified period
 */
function filterMatchesByPeriod(
  matches: RecentMatch[],
  period: StatsPeriod
): RecentMatch[] {
  const periodStart = getPeriodStartTimestamp(period);
  const periodEnd = getPeriodEndTimestamp(period);

  return matches.filter((match) => {
    if (match.start_time < periodStart) return false;
    if (periodEnd !== null && match.start_time >= periodEnd) return false;
    return true;
  });
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
  playerName: string,
  matches: RecentMatch[],
  period: StatsPeriod = "today",
  avgApm?: number
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
    playerName,
    wins,
    losses,
    totalMatches,
    winRate,
    heroes,
    avgApm,
  };
}
