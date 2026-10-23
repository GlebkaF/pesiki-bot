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
  /** Устойчивые игровые привычки для контекстного разбора конкретного матча. */
  analysisProfile?: {
    notes: string[];
    usualRoles?: Array<"core" | "support">;
    /** Нужен голосу для согласования, модель не должна угадывать род по нику. */
    grammaticalGender?: "masculine" | "feminine";
  };
  archived?: boolean;   // Excluded from live tracking; retained for historical matches
  birthday?: string;     // "YYYY-MM-DD"
}

/**
 * All tracked players
 * To find your Telegram ID, use @userinfobot or forward a message to @JsonDumpBot
 *
 * dotaName — ник в Dota, люди их меняют. Сверить со всеми актуальными:
 * npx tsx tools/check-nicks.ts
 */
export const ALL_PLAYERS: Player[] = [
  { steamId: 93921511,   dotaName: "Unclead", archived: true,      telegramId: 442863557 },
  { steamId: 167818283,  dotaName: "MOX",          telegramId: 55087818, telegramUsername: "alexkim87" },
  { steamId: 94014640,   dotaName: "Твердости Жана",  telegramId: 455412364, telegramUsername: "loothood" },
  { steamId: 1869377945, dotaName: "zladey",       telegramId: 1152640, telegramUsername: "glebkaF", birthday: "1993-11-10" },
  { steamId: 1331018267, dotaName: "Fortuna33🐘" },
  { steamId: 122049701,  dotaName: ".positive and polite" },
  {
    steamId: 126449680,
    dotaName: "Marinad",
    telegramId: 44083057,
    telegramUsername: "marinerius",
    analysisProfile: {
      usualRoles: ["support"],
      grammaticalGender: "feminine",
      notes: ["Обычно играет на саппортах; выход на кора — необычное событие, которое стоит подсветить."],
    },
    birthday: "1993-02-06",
  },
  { steamId: 92126977,   dotaName: "Stronk doto",  telegramId: 121460076 },
  { steamId: 40087920,   dotaName: "BoaOfDaeth",     telegramId: 278234366 },
  { steamId: 178693086,  dotaName: "Curiosity", archived: true, telegramId: 572881360, birthday: "1998-04-12" },
  { steamId: 97643532,   dotaName: "Aoba",         telegramId: 416994035, birthday: "1997-01-20" },
  { steamId: 83930539,   dotaName: "Shootema",     telegramId: 439811056, birthday: "1997-11-03" },
  { steamId: 76017871,   dotaName: "vedpo", archived: true,        telegramId: 44310713 },
  { steamId: 93253585,   dotaName: "BisMark",      telegramId: 300064257 },
  { steamId: 62405887,   dotaName: "che6ka", archived: true,       telegramId: 186731190 },
  { steamId: 91407576, dotaName: "Why me?", archived: true },
];

export const PLAYERS = ALL_PLAYERS.filter(player => !player.archived);
export const ARCHIVED_PLAYERS = ALL_PLAYERS.filter(player => player.archived);

/**
 * Player Steam IDs to track (for backward compatibility)
 */
export const PLAYER_IDS = PLAYERS.map(p => p.steamId) as readonly number[];

/**
 * Find player by Telegram ID
 */
export function findPlayerByTelegramId(telegramId: number): Player | undefined {
  return ALL_PLAYERS.find(p => p.telegramId === telegramId);
}

/**
 * Find player by Steam ID
 */
export function findPlayerBySteamId(steamId: number): Player | undefined {
  return ALL_PLAYERS.find(p => p.steamId === steamId);
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
