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
  botAttitude?: string;  // How the bot feels about this player (used in AI analysis prompts)
}

/**
 * All tracked players
 * To find your Telegram ID, use @userinfobot or forward a message to @JsonDumpBot
 */
export const PLAYERS: Player[] = [
  { steamId: 93921511,   dotaName: "Unclead",      telegramId: 442863557, botAttitude: "тёплый тон, симпатия, ищет за что похвалить" },
  { steamId: 167818283,  dotaName: "MOX",          telegramId: 55087818, telegramUsername: "alexkim87", botAttitude: "уважение + лёгкие подколы про экономию и жадность" },
  { steamId: 94014640,   dotaName: "СделкаУтка",  telegramId: 455412364, telegramUsername: "loothood", botAttitude: "замечает то, что другие не видят — тихий вклад, незаметная работа" },
  { steamId: 1869377945, dotaName: "zladey",       telegramId: 1152640, telegramUsername: "glebkaF", botAttitude: "дружеский троллинг, подначки про эмоции и тильт" },
  { steamId: 126449680,  dotaName: "Marinad",      telegramId: 44083057, telegramUsername: "marinerius", botAttitude: "подчёркнуто вежливый, аккуратный тон" },
  { steamId: 92126977,   dotaName: "Stronk doto",  telegramId: 121460076, botAttitude: "подмечает вклад, который остальные не ценят" },
  { steamId: 40087920,   dotaName: "mightyBO",     telegramId: 278234366, botAttitude: "признаёт скилл сдержанно, без восторгов" },
  { steamId: 178693086,  dotaName: "Curiosity",    telegramId: 572881360, botAttitude: "кайфует от нестандартных пиков, подкалывает за дерзкие ходы" },
  { steamId: 97643532,   dotaName: "Aoba",         telegramId: 416994035, botAttitude: "покровительственный тон, мягче в критике" },
  { steamId: 83930539,   dotaName: "Shootema",     telegramId: 439811056, botAttitude: "соперничество, придирчивый взгляд, ищет огрехи" },
  { steamId: 76017871,   dotaName: "vedpo",        telegramId: 44310713, botAttitude: "ровный тон, констатация фактов, мало эмоций" },
  { steamId: 93253585,   dotaName: "BisMark",      telegramId: 300064257, botAttitude: "явная симпатия, лидерский тон в его адрес" },
  { steamId: 62405887,   dotaName: "che6ka",       telegramId: 186731190, botAttitude: "подколки про героев, но с уважением к результату" },
  { steamId: 91407576, dotaName: "Why me?", botAttitude: "сочувственный тон, мягче обычного после поражений" },
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

/**
 * Get bot's attitude towards a player by Steam ID
 */
export function getBotAttitude(steamId: number): string | undefined {
  return PLAYERS.find(p => p.steamId === steamId)?.botAttitude;
}

export const config = {
  telegramBotToken: process.env.TELEGRAM_BOT_TOKEN ?? "",
  telegramChatId: process.env.TELEGRAM_CHAT_ID ?? "",
  steamApiKey: process.env.STEAM_API_KEY ?? "",
};
