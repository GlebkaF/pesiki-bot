import type { RecentMatch } from "./opendota.js";
import { MSK_OFFSET_HOURS } from "./constants.js";
import { getMskTimeComponents } from "./utils.js";

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
  avgKda?: number;
  rank?: number | null;  // Player's rank tier from OpenDota
  // Aggregated stats for nominations
  totalKills: number;
  totalDeaths: number;
  totalAssists: number;
  totalDurationSeconds: number;
  avgDurationSeconds: number;
  longMatches: number;
  longWins: number;
  nightMatches: number;
  morningMatches: number;
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
const LONG_MATCH_THRESHOLD_SECONDS = 45 * 60;

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
 * Gets MSK hour from match start time (UTC seconds)
 */
function getMskHourFromStartTime(startTimeSeconds: number): number {
  const mskTimestamp = startTimeSeconds + MSK_OFFSET_HOURS * 60 * 60;
  return new Date(mskTimestamp * 1000).getUTCHours();
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
 * Calculates win/loss statistics for a player's matches
 */
export function calculateStats(
  playerId: number,
  playerName: string,
  matches: RecentMatch[],
  period: StatsPeriod = "today",
  avgApm?: number,
  rank?: number | null
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

  // Calculate aggregated stats
  const totalKills = filteredMatches.reduce((sum, m) => sum + m.kills, 0);
  const totalDeaths = filteredMatches.reduce((sum, m) => sum + m.deaths, 0);
  const totalAssists = filteredMatches.reduce((sum, m) => sum + m.assists, 0);
  const totalDurationSeconds = filteredMatches.reduce(
    (sum, m) => sum + m.duration,
    0
  );
  const avgDurationSeconds =
    totalMatches > 0 ? totalDurationSeconds / totalMatches : 0;

  let longMatches = 0;
  let longWins = 0;
  let nightMatches = 0;
  let morningMatches = 0;

  for (const match of filteredMatches) {
    if (match.duration >= LONG_MATCH_THRESHOLD_SECONDS) {
      longMatches++;
      if (isWin(match)) longWins++;
    }

    const mskHour = getMskHourFromStartTime(match.start_time);
    if (mskHour >= 0 && mskHour < 6) {
      nightMatches++;
    } else if (mskHour >= 6 && mskHour < 12) {
      morningMatches++;
    }
  }

  // Calculate average KDA
  let avgKda: number | undefined;
  if (filteredMatches.length > 0) {
    // KDA = (K + A) / D, or (K + A) if D = 0
    const kda =
      totalDeaths > 0
        ? (totalKills + totalAssists) / totalDeaths
        : totalKills + totalAssists;
    avgKda = Math.round(kda * 100) / 100; // Round to 2 decimal places
  }

  return {
    playerId,
    playerName,
    wins,
    losses,
    totalMatches,
    winRate,
    heroes,
    avgApm,
    avgKda,
    rank,
    totalKills,
    totalDeaths,
    totalAssists,
    totalDurationSeconds,
    avgDurationSeconds,
    longMatches,
    longWins,
    nightMatches,
    morningMatches,
  };
}
