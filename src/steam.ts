import { getAppFetch } from "./proxy.js";

const STEAM_API_BASE = "https://api.steampowered.com";

// Dota 2 game ID on Steam
export const DOTA_2_GAME_ID = "570";

// Convert Steam32 ID to Steam64 ID
// Steam64 = Steam32 + 76561197960265728
const STEAM_ID_OFFSET = 76561197960265728n;

/**
 * Steam player summary from GetPlayerSummaries API
 */
export interface SteamPlayer {
  steamid: string;
  personaname: string;
  profileurl: string;
  avatar: string;
  avatarmedium: string;
  avatarfull: string;
  personastate: number; // 0=Offline, 1=Online, 2=Busy, 3=Away, 4=Snooze, 5=Looking to trade, 6=Looking to play
  communityvisibilitystate: number; // 1=Private, 3=Public
  gameid?: string; // Present if player is in-game (e.g., "570" for Dota 2)
  gameextrainfo?: string; // Game name (e.g., "Dota 2")
  lobbysteamid?: string; // Lobby ID if in multiplayer
}

interface GetPlayerSummariesResponse {
  response: {
    players: SteamPlayer[];
  };
}

/**
 * Converts Steam32 account ID to Steam64 ID
 */
export function steam32ToSteam64(steam32Id: number): string {
  return (BigInt(steam32Id) + STEAM_ID_OFFSET).toString();
}

/**
 * Converts Steam64 ID back to Steam32 account ID
 */
export function steam64ToSteam32(steam64Id: string): number {
  return Number(BigInt(steam64Id) - STEAM_ID_OFFSET);
}

/**
 * Fetches player summaries from Steam Web API
 * Can fetch up to 100 players in a single request
 * @param steam32Ids - Array of Steam32 account IDs
 * @param apiKey - Steam Web API key
 * @returns Map of Steam32 ID to player summary
 */
export async function getPlayerSummaries(
  steam32Ids: readonly number[],
  apiKey: string
): Promise<Map<number, SteamPlayer>> {
  if (!apiKey) {
    throw new Error("Steam API key is not configured");
  }

  if (steam32Ids.length === 0) {
    return new Map();
  }

  // Convert to Steam64 IDs
  const steam64Ids = steam32Ids.map(steam32ToSteam64);

  const url = `${STEAM_API_BASE}/ISteamUser/GetPlayerSummaries/v0002/?key=${apiKey}&steamids=${steam64Ids.join(",")}`;

  const fetchFn = await getAppFetch();
  const response = await fetchFn(url);

  if (!response.ok) {
    throw new Error(`Steam API error: ${response.status} ${response.statusText}`);
  }

  const data: GetPlayerSummariesResponse = await response.json();

  // Create map from Steam32 ID to player data
  const result = new Map<number, SteamPlayer>();
  for (const player of data.response.players) {
    const steam32Id = steam64ToSteam32(player.steamid);
    result.set(steam32Id, player);
  }

  return result;
}

/**
 * Checks if a player is currently playing Dota 2
 */
export function isPlayingDota(player: SteamPlayer): boolean {
  return player.gameid === DOTA_2_GAME_ID;
}
