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
