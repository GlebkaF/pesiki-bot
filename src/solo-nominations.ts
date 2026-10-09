import type { RecentMatch } from './opendota.js';

export interface SoloStats {
  knownMatches: number;
  matches: number;
  wins: number;
  losses: number;
}

/** "Solo" means none of our tracked players in the match, not necessarily solo queue. */
export function summarizeSoloStats(
  playerId: number,
  matches: RecentMatch[],
  trackedIds: readonly number[],
  loadRoster: (matchId: number) => readonly (number | undefined)[] | undefined,
): SoloStats {
  const result: SoloStats = { knownMatches: 0, matches: 0, wins: 0, losses: 0 };
  const tracked = new Set(trackedIds);
  const seen = new Set<number>();
  for (const match of matches) {
    if (seen.has(match.match_id)) continue;
    seen.add(match.match_id);
    const roster = loadRoster(match.match_id);
    // A hidden/missing account is not evidence that the player queued without us.
    if (!roster || roster.length !== 10 || new Set(roster).size !== 10 ||
        roster.some(id => !Number.isSafeInteger(id) || id! <= 0 || id! > 0xffffffff) ||
        !roster.includes(playerId)) continue;
    result.knownMatches++;
    if (roster.some(id => id !== playerId && tracked.has(id!))) continue;
    result.matches++;
    if ((match.player_slot < 128) === match.radiant_win) result.wins++;
    else result.losses++;
  }
  return result;
}
