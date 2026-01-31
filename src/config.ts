import "dotenv/config";

/**
 * Player mapping between Dota 2 (Steam) and Telegram
 */
export interface Player {
  steamId: number;       // Steam32 Account ID (for OpenDota)
  dotaName: string;      // Current Dota 2 nickname
  telegramId?: number;   // Telegram user ID (optional, fill in later)
  telegramUsername?: string; // Telegram @username (optional)
  displayName?: string;  // Custom display name (optional)
}

/**
 * All tracked players
 * To find your Telegram ID, use @userinfobot or forward a message to @JsonDumpBot
 */
export const PLAYERS: Player[] = [
  { steamId: 93921511,   dotaName: "Unclead",      telegramId: undefined },
  { steamId: 167818283,  dotaName: "MOX",          telegramId: 55087818, telegramUsername: "alexkim87" },
  { steamId: 94014640,   dotaName: "СделкаУтка",  telegramId: 455412364, telegramUsername: "loothood" },
  { steamId: 1869377945, dotaName: "zladey",       telegramId: 1152640, telegramUsername: "glebkaF" },
  { steamId: 126449680,  dotaName: "Marinad",      telegramId: 44083057, telegramUsername: "marinerius" },
  { steamId: 92126977,   dotaName: "Stronk doto",  telegramId: undefined },
  { steamId: 40087920,   dotaName: "mightyBO",     telegramId: undefined },
  { steamId: 178693086,  dotaName: "Curiosity",    telegramId: undefined },
  { steamId: 97643532,   dotaName: "Aoba",         telegramId: undefined },
  { steamId: 83930539,   dotaName: "Shootema",     telegramId: undefined },
  { steamId: 76017871,   dotaName: "vedpo",        telegramId: undefined },
  { steamId: 93253585,   dotaName: "BisMark",      telegramId: undefined },
  { steamId: 62405887,   dotaName: "che6ka",       telegramId: undefined },
];

/**
 * Player Steam IDs to track (for backward compatibility)
 */
export const PLAYER_IDS = PLAYERS.map(p => p.steamId) as readonly number[];

/**
 * Find player by Telegram ID
 */
export function findPlayerByTelegramId(telegramId: number): Player | undefined {
  return PLAYERS.find(p => p.telegramId === telegramId);
}

/**
 * Find player by Steam ID
 */
export function findPlayerBySteamId(steamId: number): Player | undefined {
  return PLAYERS.find(p => p.steamId === steamId);
}

/**
 * Get player display name (custom > dota name)
 */
export function getPlayerDisplayName(player: Player): string {
  return player.displayName || player.dotaName;
}

export const config = {
  telegramBotToken: process.env.TELEGRAM_BOT_TOKEN ?? "",
  telegramChatId: process.env.TELEGRAM_CHAT_ID ?? "",
  steamApiKey: process.env.STEAM_API_KEY ?? "",
};
