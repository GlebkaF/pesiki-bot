# Birthday Greetings Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Бот автоматически поздравляет игроков с ДР в 19:00 MSK — душевное AI-поздравление с дота-статистикой за год.

**Architecture:** Новый модуль `src/birthday.ts` содержит всю логику: поиск именинников, сбор OpenDota статистики за 365 дней, генерация поздравления через OpenAI, отправка в чат с mention. Два новых эндпоинта добавляются в `src/opendota.ts` (`fetchWinLoss`, `fetchTopHeroes`). Cron `0 19 * * *` в `src/index.ts` запускает проверку.

**Tech Stack:** TypeScript, grammY, node-cron, OpenAI SDK, OpenDota API

---

### Task 1: Добавить `birthday` в Player и заполнить данные

**Files:**
- Modify: `src/config.ts`

- [ ] **Step 1: Добавить поле `birthday` в интерфейс `Player`**

В `src/config.ts`, добавить поле в интерфейс:

```ts
export interface Player {
  steamId: number;
  dotaName: string;
  telegramId?: number;
  telegramUsername?: string;
  displayName?: string;
  botAttitude?: string;
  birthday?: string;  // "YYYY-MM-DD"
}
```

- [ ] **Step 2: Заполнить даты рождения в массиве `PLAYERS`**

Добавить `birthday` к пяти игрокам:

```ts
{ steamId: 1869377945, dotaName: "zladey", ..., birthday: "1993-11-10" },
{ steamId: 126449680,  dotaName: "Marinad", ..., birthday: "1993-02-06" },
{ steamId: 83930539,   dotaName: "Shootema", ..., birthday: "1997-11-03" },
{ steamId: 178693086,  dotaName: "Curiosity", ..., birthday: "1998-04-12" },
{ steamId: 97643532,   dotaName: "Aoba", ..., birthday: "1997-01-20" },
```

- [ ] **Step 3: Проверить сборку**

Run: `npm run build`
Expected: успешная компиляция без ошибок

- [ ] **Step 4: Коммит**

```bash
git add src/config.ts
git commit -m "feat: add birthday field to Player config"
```

---

### Task 2: Добавить OpenDota эндпоинты `fetchWinLoss` и `fetchTopHeroes`

**Files:**
- Modify: `src/opendota.ts`

- [ ] **Step 1: Добавить интерфейсы и функцию `fetchWinLoss`**

В конец `src/opendota.ts` добавить:

```ts
export interface WinLoss {
  win: number;
  lose: number;
}

/**
 * Fetches win/loss counts from OpenDota API
 * @param accountId - Steam32 account ID
 * @param date - Number of days to look back
 */
export async function fetchWinLoss(
  accountId: number,
  date?: number
): Promise<WinLoss> {
  const cacheKey = `wl:${accountId}:${date ?? "all"}`;
  const cached = getFromCache<WinLoss>(cacheKey);
  if (cached) return cached;

  let url = `${OPENDOTA_API_BASE}/players/${accountId}/wl`;
  if (date !== undefined) {
    url += `?date=${date}`;
  }

  const response = await fetchWithRateLimit(url, `wl for ${accountId}`);
  const data = await response.json();

  setCache(cacheKey, data, CACHE_TTL.TOTALS);
  return data;
}
```

- [ ] **Step 2: Добавить интерфейс и функцию `fetchTopHeroes`**

```ts
export interface PlayerHeroStats {
  hero_id: number;
  games: number;
  win: number;
}

/**
 * Fetches player's hero stats sorted by games played
 * @param accountId - Steam32 account ID
 * @param date - Number of days to look back
 */
export async function fetchTopHeroes(
  accountId: number,
  date?: number
): Promise<PlayerHeroStats[]> {
  const cacheKey = `heroes:${accountId}:${date ?? "all"}`;
  const cached = getFromCache<PlayerHeroStats[]>(cacheKey);
  if (cached) return cached;

  let url = `${OPENDOTA_API_BASE}/players/${accountId}/heroes`;
  if (date !== undefined) {
    url += `?date=${date}`;
  }

  const response = await fetchWithRateLimit(url, `heroes for ${accountId}`);
  const data = await response.json();

  setCache(cacheKey, data, CACHE_TTL.TOTALS);
  return data;
}
```

- [ ] **Step 3: Проверить сборку**

Run: `npm run build`
Expected: успешная компиляция без ошибок

- [ ] **Step 4: Коммит**

```bash
git add src/opendota.ts
git commit -m "feat: add fetchWinLoss and fetchTopHeroes OpenDota endpoints"
```

---

### Task 3: Создать модуль `src/birthday.ts`

**Files:**
- Create: `src/birthday.ts`

- [ ] **Step 1: Создать файл `src/birthday.ts` с полной логикой**

```ts
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
    // birthday format: "YYYY-MM-DD"
    const mmdd = p.birthday.slice(5); // "MM-DD"
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

    // Top 3 heroes by games played (filter out heroes with 0 games)
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

    // Extract averages from totals
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
```

- [ ] **Step 2: Проверить сборку**

Run: `npm run build`
Expected: успешная компиляция без ошибок

- [ ] **Step 3: Коммит**

```bash
git add src/birthday.ts
git commit -m "feat: add birthday greetings module"
```

---

### Task 4: Подключить cron в `src/index.ts`

**Files:**
- Modify: `src/index.ts`

- [ ] **Step 1: Добавить импорт**

В начало `src/index.ts` добавить:

```ts
import { checkAndSendBirthdayGreetings } from "./birthday.js";
```

- [ ] **Step 2: Добавить cron-задачу в функцию `main()`**

После существующего cron (`0 6 * * *`), добавить:

```ts
  // Birthday greetings at 19:00 MSK
  console.log("🎂 Birthday greetings scheduled for 19:00 MSK");
  cron.schedule("0 19 * * *", () => {
    checkAndSendBirthdayGreetings(bot);
  });
```

- [ ] **Step 3: Проверить сборку**

Run: `npm run build`
Expected: успешная компиляция без ошибок

- [ ] **Step 4: Коммит**

```bash
git add src/index.ts
git commit -m "feat: schedule birthday greetings cron at 19:00 MSK"
```

---

### Task 5: Локальный тест на Curiosity (12.04.1998)

**Files:**
- Нет изменений в коде, только ручной запуск

- [ ] **Step 1: Проверить что `checkAndSendBirthdayGreetings` находит сегодняшнего именинника**

Создать временный тестовый скрипт и запустить:

```bash
TELEGRAM_BOT_TOKEN=... TELEGRAM_CHAT_ID=... npx tsx -e "
import { checkAndSendBirthdayGreetings } from './src/birthday.js';
import { createBot } from './src/bot.js';
const bot = await createBot();
await checkAndSendBirthdayGreetings(bot);
console.log('Done');
"
```

Expected: сообщение с поздравлением Curiosity отправлено в чат

- [ ] **Step 2: Проверить формат сообщения в Telegram**

Визуально проверить в чате:
- Есть mention (кликабельная ссылка на пользователя)
- Текст 3-5 предложений, душевный, с дота-данными
- Нет сломанного HTML
