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

export interface PlayerProfile {
  account_id: number;
  personaname: string | null;
  name: string | null;
  avatar: string;
  avatarfull: string;
}

export interface PlayerData {
  profile: PlayerProfile;
}

export interface PlayerTotal {
  field: string;
  n: number;
  sum: number;
}

/**
 * Fetches player profile from OpenDota API
 * Returns player data including nickname (personaname)
 */
export async function fetchPlayerProfile(
  accountId: number
): Promise<PlayerData> {
  const url = `${OPENDOTA_API_BASE}/players/${accountId}`;

  const response = await fetch(url);

  if (!response.ok) {
    throw new Error(
      `OpenDota API error: ${response.status} ${response.statusText}`
    );
  }

  return response.json();
}

/**
 * Fetches recent matches for a player from OpenDota API
 * Uses /matches endpoint with date filter for period-based queries
 * @param accountId - Steam32 account ID
 * @param days - Number of days to fetch matches for (default: 1 for today)
 */
export async function fetchRecentMatches(
  accountId: number,
  days?: number
): Promise<RecentMatch[]> {
  let url: string;

  if (days !== undefined && days > 1) {
    // Use /matches endpoint for longer periods (supports more than 20 matches)
    url = `${OPENDOTA_API_BASE}/players/${accountId}/matches?date=${days}`;
  } else {
    // Use /recentMatches for today/yesterday (faster, limited to 20)
    url = `${OPENDOTA_API_BASE}/players/${accountId}/recentMatches`;
  }

  const response = await fetch(url);

  if (!response.ok) {
    throw new Error(
      `OpenDota API error: ${response.status} ${response.statusText}`
    );
  }

  return response.json();
}

/**
 * Fetches player totals (aggregated stats) from OpenDota API
 * @param accountId - Steam32 account ID
 * @param date - Optional number of days to filter (e.g., 1 for last day, 7 for last week)
 * @returns Array of totals including actions_per_min for APM calculation
 */
export async function fetchPlayerTotals(
  accountId: number,
  date?: number
): Promise<PlayerTotal[]> {
  let url = `${OPENDOTA_API_BASE}/players/${accountId}/totals`;
  if (date !== undefined) {
    url += `?date=${date}`;
  }

  const response = await fetch(url);

  if (!response.ok) {
    throw new Error(
      `OpenDota API error: ${response.status} ${response.statusText}`
    );
  }

  return response.json();
}
