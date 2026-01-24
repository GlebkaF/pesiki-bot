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

/**
 * Determines if the player won the match
 * Player slots 0-127 are Radiant, 128-255 are Dire
 */
function isWin(match: RecentMatch): boolean {
  const isRadiant = match.player_slot < 128;
  return isRadiant === match.radiant_win;
}

/**
 * Filters matches to only include those from today (local time)
 */
function filterTodayMatches(matches: RecentMatch[]): RecentMatch[] {
  const now = new Date();
  const todayStart = new Date(
    now.getFullYear(),
    now.getMonth(),
    now.getDate()
  ).getTime() / 1000;

  return matches.filter((match) => match.start_time >= todayStart);
}

/**
 * Calculates win/loss statistics for a player's matches
 */
export function calculateStats(
  playerId: number,
  matches: RecentMatch[]
): PlayerStats {
  const todayMatches = filterTodayMatches(matches);

  const wins = todayMatches.filter(isWin).length;
  const losses = todayMatches.length - wins;
  const totalMatches = todayMatches.length;
  const winRate = totalMatches > 0 ? Math.round((wins / totalMatches) * 100) : 0;

  // Collect heroes played with win/loss info
  const heroes: HeroMatch[] = todayMatches.map((match) => ({
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
