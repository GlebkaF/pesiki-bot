import OpenAI from "openai";
import { Bot } from "grammy";
import { PLAYERS, type Player, config } from "./config.js";
import { getOpenAIFetch } from "./proxy.js";
import { fetchWinLoss, fetchTopHeroes, fetchPlayerTotals } from "./opendota.js";
import { getHeroName } from "./heroes.js";
import { escapeHtml } from "./telegram-html.js";

const OPENAI_MODEL = process.env.OPENAI_MODEL || "gpt-5.2";

/**
 * Returns players whose birthday is today (comparing MM-DD)
 */
function getTodayBirthdayPlayers(): Player[] {
  const now = new Date();
  const todayMMDD =
    String(now.getMonth() + 1).padStart(2, "0") + "-" +
    String(now.getDate()).padStart(2, "0");

  return PLAYERS.filter((p) => {
    if (!p.birthday) return false;
    const mmdd = p.birthday.slice(5);
    return mmdd === todayMMDD;
  });
}

/**
 * Calculates age from birthday string "YYYY-MM-DD"
 */
function calculateAge(birthday: string): number {
  const birth = new Date(birthday);
  const today = new Date();
  let age = today.getFullYear() - birth.getFullYear();
  const monthDiff = today.getMonth() - birth.getMonth();
  if (monthDiff < 0 || (monthDiff === 0 && today.getDate() < birth.getDate())) {
    age--;
  }
  return age;
}

interface BirthdayStats {
  totalGames: number;
  winRate: number;
  topHeroes: { name: string; games: number; winRate: number }[];
  avgKills: number;
  avgDeaths: number;
  avgAssists: number;
  avgGpm: number;
}

/**
 * Fetches Dota 2 stats for the past 365 days
 */
async function fetchYearStats(steamId: number): Promise<BirthdayStats | null> {
  try {
    const [wl, heroes, totals] = await Promise.all([
      fetchWinLoss(steamId, 365),
      fetchTopHeroes(steamId, 365),
      fetchPlayerTotals(steamId, 365),
    ]);

    const totalGames = wl.win + wl.lose;
    if (totalGames === 0) return null;

    const winRate = Math.round((wl.win / totalGames) * 100);

    const topHeroes = await Promise.all(
      heroes
        .filter((h) => h.games > 0)
        .slice(0, 3)
        .map(async (h) => ({
          name: await getHeroName(h.hero_id),
          games: h.games,
          winRate: Math.round((h.win / h.games) * 100),
        }))
    );

    const getAvg = (field: string): number => {
      const t = totals.find((t) => t.field === field);
      return t && t.n > 0 ? Math.round(t.sum / t.n) : 0;
    };

    return {
      totalGames,
      winRate,
      topHeroes,
      avgKills: getAvg("kills"),
      avgDeaths: getAvg("deaths"),
      avgAssists: getAvg("assists"),
      avgGpm: getAvg("gold_per_min"),
    };
  } catch (error) {
    console.error(`[BIRTHDAY] Failed to fetch year stats for ${steamId}:`, error);
    return null;
  }
}

/**
 * Builds context string for the AI prompt
 */
function buildStatsContext(stats: BirthdayStats): string {
  const heroLines = stats.topHeroes
    .map((h) => `${h.name}: ${h.games} игр, ${h.winRate}% винрейт`)
    .join("\n");

  return `Дота-статистика за последний год:
- Всего матчей: ${stats.totalGames}, винрейт: ${stats.winRate}%
- Средний KDA: ${stats.avgKills}/${stats.avgDeaths}/${stats.avgAssists}
- Средний GPM: ${stats.avgGpm}
- Топ-3 героя:
${heroLines}`;
}

const BIRTHDAY_SYSTEM_PROMPT = `Ты — бот дота-компании. Тебе нужно написать поздравление с днём рождения для игрока.

ПРАВИЛА:
• Поздравление душевное, тёплое, но не слащавое
• Короткое: 3-5 предложений
• Дота-статистика вплетена естественно в текст, не списком
• Без буллетов, без списков — связный текст
• У тебя есть внутреннее отношение к игроку (указано в данных). НЕ озвучивай его — пусть проявляется через тон, выбор слов, интонацию
• Русский язык, можно дота-сленг
• Формат: plain text, без markdown
• Не начинай с "Дорогой" или "Уважаемый"`;

/**
 * Generates birthday greeting via OpenAI
 */
async function generateGreeting(
  player: Player,
  age: number,
  stats: BirthdayStats | null,
): Promise<string> {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    throw new Error("OPENAI_API_KEY not configured");
  }
  const baseURL = process.env.OPENAI_BASE_URL;
  const fetch = await getOpenAIFetch();
  const openai = new OpenAI({ apiKey, baseURL, fetch });
  const isGpt5 = OPENAI_MODEL.startsWith("gpt-5");

  const statsContext = stats ? buildStatsContext(stats) : "Статистика недоступна.";
  const attitudeHint = player.botAttitude
    ? `Твоё отношение к этому игроку: "${player.botAttitude}"`
    : "";

  const userPrompt = `Игрок: ${player.dotaName}
Возраст: ${age} лет
${attitudeHint}

${statsContext}

Напиши поздравление с днём рождения.`;

  console.log(`[BIRTHDAY] Generating greeting for ${player.dotaName} with model ${OPENAI_MODEL}`);

  const response = await openai.chat.completions.create({
    model: OPENAI_MODEL,
    messages: [
      { role: "system", content: BIRTHDAY_SYSTEM_PROMPT },
      { role: "user", content: userPrompt },
    ],
    ...(isGpt5 ? { max_completion_tokens: 500 } : { max_tokens: 500 }),
    ...(isGpt5 ? {} : { temperature: 0.8 }),
  });

  return response.choices[0]?.message?.content || "С днём рождения! 🎂";
}

/**
 * Formats the mention tag for a player
 */
function formatMention(player: Player): string {
  const displayName = player.displayName || player.dotaName;
  if (player.telegramId) {
    return `<a href="tg://user?id=${player.telegramId}">${escapeHtml(displayName)}</a>`;
  }
  return escapeHtml(displayName);
}

/**
 * Main entry point: checks for today's birthdays and sends greetings
 */
export async function checkAndSendBirthdayGreetings(bot: Bot): Promise<void> {
  const birthdayPlayers = getTodayBirthdayPlayers();

  if (birthdayPlayers.length === 0) {
    console.log("[BIRTHDAY] No birthdays today");
    return;
  }

  console.log(
    `[BIRTHDAY] Found ${birthdayPlayers.length} birthday(s): ${birthdayPlayers.map((p) => p.dotaName).join(", ")}`
  );

  for (const player of birthdayPlayers) {
    try {
      const age = calculateAge(player.birthday!);
      const stats = await fetchYearStats(player.steamId);
      const greeting = await generateGreeting(player, age, stats);
      const mention = formatMention(player);

      const message = `🎂 ${mention}\n\n${escapeHtml(greeting)}`;

      await bot.api.sendMessage(config.telegramChatId, message, {
        parse_mode: "HTML",
        link_preview_options: { is_disabled: true },
      });

      console.log(`[BIRTHDAY] Greeting sent for ${player.dotaName}`);
    } catch (error) {
      console.error(`[BIRTHDAY] Failed to send greeting for ${player.dotaName}:`, error);
    }
  }
}
