import "dotenv/config";

/**
 * Player Steam IDs to track
 * All 7 players from the configured list
 */
export const PLAYER_IDS = [
  93921511,
  167818283,
  94014640,
  1869377945,
  126449680,
  92126977,
  40087920,
  178693086,
  97643532,
  83930539,
] as const;

export const config = {
  telegramBotToken: process.env.TELEGRAM_BOT_TOKEN ?? "",
  telegramChatId: process.env.TELEGRAM_CHAT_ID ?? "",
};
