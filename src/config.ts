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
  { steamId: 93921511,   dotaName: "Unclead",      telegramId: 442863557 },
  { steamId: 167818283,  dotaName: "MOX",          telegramId: 55087818, telegramUsername: "alexkim87" },
  { steamId: 94014640,   dotaName: "СделкаУтка",  telegramId: 455412364, telegramUsername: "loothood" },
  { steamId: 1869377945, dotaName: "zladey",       telegramId: 1152640, telegramUsername: "glebkaF" },
  { steamId: 126449680,  dotaName: "Marinad",      telegramId: 44083057, telegramUsername: "marinerius" },
  { steamId: 92126977,   dotaName: "Stronk doto",  telegramId: 121460076 },
  { steamId: 40087920,   dotaName: "mightyBO",     telegramId: 278234366 },
  { steamId: 178693086,  dotaName: "Curiosity",    telegramId: 572881360 },
  { steamId: 97643532,   dotaName: "Aoba",         telegramId: 416994035 },
  { steamId: 83930539,   dotaName: "Shootema",     telegramId: 439811056 },
  { steamId: 76017871,   dotaName: "vedpo",        telegramId: 44310713 },
  { steamId: 93253585,   dotaName: "BisMark",      telegramId: 300064257 },
  { steamId: 62405887,   dotaName: "che6ka",       telegramId: 186731190 },
  { steamId: 91407576, dotaName: "Why me?", telegramId: null },
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
