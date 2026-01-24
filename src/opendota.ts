const OPENDOTA_API_BASE = "https://api.opendota.com/api";

export interface RecentMatch {
  match_id: number;
  player_slot: number;
  radiant_win: boolean;
  start_time: number;
  duration: number;
  hero_id: number;
  kills: number;
  deaths: number;
  assists: number;
}

/**
 * Fetches recent matches for a player from OpenDota API
 * Returns last 20 matches
 */
export async function fetchRecentMatches(
  accountId: number
): Promise<RecentMatch[]> {
  const url = `${OPENDOTA_API_BASE}/players/${accountId}/recentMatches`;

  const response = await fetch(url);

  if (!response.ok) {
    throw new Error(
      `OpenDota API error: ${response.status} ${response.statusText}`
    );
  }

  return response.json();
}
