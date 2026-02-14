import OpenAI from "openai";
import { getHeroNames } from "./heroes.js";
import { fetchItems } from "./items.js";
import { getAppFetch, getOpenAIFetch } from "./proxy.js";

const OPENDOTA_API_BASE = "https://api.opendota.com/api";
const PROTRACKER_BASE = "https://dota2protracker.com";
const PROTRACKER_API_ENDPOINTS = [
  `${PROTRACKER_BASE}/api/heroes`,
  `${PROTRACKER_BASE}/api/meta`,
  `${PROTRACKER_BASE}/api/v1/heroes`,
];
const PRO_MATCH_SAMPLE_SIZE = 20;
const META_LOOKBACK_DAYS = 7;
const META_CACHE_TTL_MS = 10 * 60 * 1000;
const OPENAI_MODEL = process.env.OPENAI_MODEL || "gpt-5.2";
const TOP_HEROES_PER_ROLE = 4;

type Role = "pos1" | "pos2" | "pos3" | "pos4" | "pos5";

const ROLE_ALIASES: Record<Role, string[]> = {
  pos1: ["pos1", "1", "carry", "safe", "safelane"],
  pos2: ["pos2", "2", "mid", "middle"],
  pos3: ["pos3", "3", "off", "offlane"],
  pos4: ["pos4", "4", "soft", "roam", "support4"],
  pos5: ["pos5", "5", "hard", "hardsupport", "support5"],
};

const ROLE_LABELS: Record<Role, string> = {
  pos1: "🟢 Pos 1 (Carry)",
  pos2: "🟠 Pos 2 (Mid)",
  pos3: "🔵 Pos 3 (Offlane)",
  pos4: "🟣 Pos 4 (Soft Support)",
  pos5: "⚪ Pos 5 (Hard Support)",
};

interface ProMatch {
  match_id: number;
  start_time?: number;
}

interface MatchPlayer {
  hero_id: number;
  net_worth: number;
  isRadiant: boolean;
  win: number;
  item_0: number;
  item_1: number;
  item_2: number;
  item_3: number;
  item_4: number;
  item_5: number;
}

interface MatchDetails {
  players: MatchPlayer[];
}

interface HeroRoleStats {
  heroId: number;
  games: number;
  wins: number;
  itemCounts: Map<number, number>;
}

interface MetaHero {
  role: Role;
  heroId: number;
  heroName: string;
  games: number;
  wins: number;
  winRate: number;
  build: string;
}

interface MetaCacheEntry {
  text: string;
  expiresAt: number;
}

interface MetaSourceInfo {
  provider: "OpenDota" | "Dota2ProTracker API";
  note?: string;
}

let metaCache: MetaCacheEntry | null = null;

async function getFetchForProTracker(): Promise<typeof fetch> {
  const proxyUrl = process.env.PROTRACKER_PROXY_URL;
  if (!proxyUrl) {
    return getAppFetch();
  }

  const undici = await import("undici");
  const agent = new undici.ProxyAgent(proxyUrl);
  const proxiedFetch = (input: RequestInfo | URL, init?: RequestInit) =>
    undici.fetch(String(input), {
      ...init,
      dispatcher: agent,
    } as Parameters<typeof undici.fetch>[1]);

  return proxiedFetch as unknown as typeof fetch;
}

async function fetchProTrackerApiPayload(): Promise<unknown | null> {
  const fetchFn = await getFetchForProTracker();

  for (const endpoint of PROTRACKER_API_ENDPOINTS) {
    try {
      const response = await fetchFn(endpoint, {
        headers: {
          Accept: "application/json,text/plain,*/*",
          "User-Agent": "pesiki-bot/1.0",
        },
      });

      if (!response.ok) continue;

      const contentType = response.headers.get("content-type")?.toLowerCase() ?? "";
      if (!contentType.includes("application/json")) continue;

      return response.json();
    } catch {
      // try next endpoint
    }
  }

  return null;
}

function normalizeRole(rawRole: string): Role | null {
  const role = rawRole.toLowerCase().replace(/[^a-z0-9]/g, "");
  for (const [normalizedRole, aliases] of Object.entries(ROLE_ALIASES) as [Role, string[]][]) {
    if (aliases.some((alias) => role.includes(alias))) {
      return normalizedRole;
    }
  }

  return null;
}

function parseNumber(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string") {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) return parsed;
  }
  return null;
}

function parseProTrackerMetaHeroes(payload: unknown): MetaHero[] | null {
  if (!Array.isArray(payload)) return null;

  const result: MetaHero[] = [];
  for (const raw of payload) {
    if (!raw || typeof raw !== "object") continue;

    const record = raw as Record<string, unknown>;
    const heroId = parseNumber(record.hero_id ?? record.heroId ?? record.id);
    const heroName = typeof record.hero_name === "string"
      ? record.hero_name
      : typeof record.heroName === "string"
        ? record.heroName
        : null;

    const rawRole = typeof record.role === "string"
      ? record.role
      : typeof record.position === "string"
        ? record.position
        : typeof record.lane === "string"
          ? record.lane
          : null;

    const role = rawRole ? normalizeRole(rawRole) : null;
    const games = parseNumber(record.games ?? record.matches ?? record.picks);
    const winRateRaw = parseNumber(record.winrate ?? record.winRate ?? record.wr);

    if (!heroName || !role || games === null || winRateRaw === null) continue;

    const winRate = winRateRaw > 1 ? winRateRaw : winRateRaw * 100;
    const wins = Math.round((winRate / 100) * games);

    result.push({
      role,
      heroId: heroId ?? 0,
      heroName,
      games,
      wins,
      winRate,
      build: "Смотри детали билда на Dota2ProTracker",
    });
  }

  return result.length > 0 ? result : null;
}

function groupTopHeroesByRoleFromList(metaHeroes: MetaHero[]): Map<Role, MetaHero[]> {
  const result = new Map<Role, MetaHero[]>();
  (Object.keys(ROLE_LABELS) as Role[]).forEach((role) => {
    const roleHeroes = metaHeroes
      .filter((hero) => hero.role === role)
      .sort((a, b) => {
        if (b.games !== a.games) return b.games - a.games;
        return b.winRate - a.winRate;
      })
      .slice(0, TOP_HEROES_PER_ROLE);

    result.set(role, roleHeroes);
  });

  return result;
}

async function fetchProMatches(limit: number): Promise<ProMatch[]> {
  const fetchFn = await getAppFetch();
  const response = await fetchFn(`${OPENDOTA_API_BASE}/proMatches`);
  if (!response.ok) {
    throw new Error(`OpenDota API error for /proMatches: ${response.status}`);
  }

  const data: ProMatch[] = await response.json();
  return data.slice(0, limit);
}

function filterMatchesByLastWeek(matches: ProMatch[]): ProMatch[] {
  const now = Math.floor(Date.now() / 1000);
  const minStartTime = now - META_LOOKBACK_DAYS * 24 * 60 * 60;

  return matches.filter((match) => {
    if (!match.start_time) return true;
    return match.start_time >= minStartTime;
  });
}

async function fetchMatchDetails(matchId: number): Promise<MatchDetails> {
  const fetchFn = await getAppFetch();
  const response = await fetchFn(`${OPENDOTA_API_BASE}/matches/${matchId}`);
  if (!response.ok) {
    throw new Error(`OpenDota API error for /matches/${matchId}: ${response.status}`);
  }
  return response.json();
}

function getRoleByNetWorthOrder(orderIndex: number): Role {
  if (orderIndex === 0) return "pos1";
  if (orderIndex === 1) return "pos2";
  if (orderIndex === 2) return "pos3";
  if (orderIndex === 3) return "pos4";
  return "pos5";
}

function addPlayerToStats(roleStats: Map<Role, Map<number, HeroRoleStats>>, role: Role, player: MatchPlayer): void {
  const heroMap = roleStats.get(role);
  if (!heroMap) return;

  let hero = heroMap.get(player.hero_id);
  if (!hero) {
    hero = { heroId: player.hero_id, games: 0, wins: 0, itemCounts: new Map<number, number>() };
    heroMap.set(player.hero_id, hero);
  }

  hero.games += 1;
  hero.wins += player.win;

  const items = [player.item_0, player.item_1, player.item_2, player.item_3, player.item_4, player.item_5].filter(
    (itemId) => itemId > 0,
  );

  for (const itemId of items) {
    hero.itemCounts.set(itemId, (hero.itemCounts.get(itemId) ?? 0) + 1);
  }
}

function buildRoleStats(matches: MatchDetails[]): Map<Role, Map<number, HeroRoleStats>> {
  const stats = new Map<Role, Map<number, HeroRoleStats>>([
    ["pos1", new Map()],
    ["pos2", new Map()],
    ["pos3", new Map()],
    ["pos4", new Map()],
    ["pos5", new Map()],
  ]);

  for (const match of matches) {
    const radiant = match.players.filter((p) => p.isRadiant).sort((a, b) => (b.net_worth ?? 0) - (a.net_worth ?? 0));
    const dire = match.players.filter((p) => !p.isRadiant).sort((a, b) => (b.net_worth ?? 0) - (a.net_worth ?? 0));

    radiant.forEach((player, i) => addPlayerToStats(stats, getRoleByNetWorthOrder(i), player));
    dire.forEach((player, i) => addPlayerToStats(stats, getRoleByNetWorthOrder(i), player));
  }

  return stats;
}

function formatBuild(itemCounts: Map<number, number>, itemNames: Map<number, string>): string {
  const topItems = Array.from(itemCounts.entries())
    .sort((a, b) => b[1] - a[1])
    .slice(0, 6)
    .map(([itemId]) => itemNames.get(itemId) ?? `Item #${itemId}`);

  return topItems.length > 0 ? topItems.join(" → ") : "Нет данных";
}

function pickTopHeroesByRole(
  roleStats: Map<Role, Map<number, HeroRoleStats>>,
  heroNames: Map<number, string>,
  itemNames: Map<number, string>,
): Map<Role, MetaHero[]> {
  const result = new Map<Role, MetaHero[]>();

  (Object.keys(ROLE_LABELS) as Role[]).forEach((role) => {
    const heroMap = roleStats.get(role);
    if (!heroMap || heroMap.size === 0) {
      result.set(role, []);
      return;
    }

    const heroes = Array.from(heroMap.values())
      .filter((h) => h.games >= 2)
      .sort((a, b) => {
        if (b.games !== a.games) return b.games - a.games;
        return b.wins / b.games - a.wins / a.games;
      })
      .slice(0, TOP_HEROES_PER_ROLE)
      .map((hero) => ({
        role,
        heroId: hero.heroId,
        heroName: heroNames.get(hero.heroId) ?? `Hero #${hero.heroId}`,
        games: hero.games,
        wins: hero.wins,
        winRate: (hero.wins / hero.games) * 100,
        build: formatBuild(hero.itemCounts, itemNames),
      }));

    result.set(role, heroes);
  });

  return result;
}

async function generateAiLineups(topHeroesByRole: Map<Role, MetaHero[]>): Promise<string> {
  if (!process.env.OPENAI_API_KEY) {
    return "🤖 <b>AI-пулы лайнапов</b>\n• OPENAI_API_KEY не задан, поэтому AI-рекомендации временно отключены.";
  }

  const roleInput = (Object.keys(ROLE_LABELS) as Role[])
    .map((role) => {
      const heroes = topHeroesByRole.get(role) ?? [];
      const list = heroes.map((h) => `${h.heroName} (WR ${h.winRate.toFixed(1)}%, ${h.games} игр)`).join(", ");
      return `${role}: ${list || "нет данных"}`;
    })
    .join("\n");

  const prompt = `Ты аналитик Dota 2. Есть метовые герои по ролям за последнюю неделю.

${roleInput}

Собери 2 разных лайнапа (по 5 героев, по одному на роль pos1-pos5) только из этого списка.
Для каждого лайнапа дай:
1) Короткую идею победы (1 строка)
2) Ключевые тайминги (до 3 пунктов)
3) Что жать и на что смотреть в драках (до 4 пунктов, конкретно)

Пиши на русском, максимально практично, без воды.
Форматируй как HTML для Telegram: <b>, <i>, списки через "•".
Ограничение: до 1400 символов.`;

  try {
    const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY, fetch: await getOpenAIFetch() });
    const completion = await client.chat.completions.create({
      model: OPENAI_MODEL,
      temperature: 0.6,
      messages: [
        { role: "system", content: "Ты тренер по Dota 2 и объясняешь просто, конкретно и по делу." },
        { role: "user", content: prompt },
      ],
    });

    const text = completion.choices[0]?.message?.content?.trim();
    if (!text) {
      return "🤖 <b>AI-пулы лайнапов</b>\n• Не удалось получить ответ от OpenAI.";
    }

    return `🤖 <b>AI-пулы лайнапов</b>\n${text}`;
  } catch (error) {
    console.error("[META] Failed to generate AI lineup suggestions:", error);
    return "🤖 <b>AI-пулы лайнапов</b>\n• OpenAI сейчас недоступен, попробуй позже.";
  }
}

export async function getProMetaByRole(): Promise<string> {
  if (metaCache && Date.now() < metaCache.expiresAt) {
    return metaCache.text;
  }

  let topHeroesByRole: Map<Role, MetaHero[]> | null = null;
  let sourceInfo: MetaSourceInfo = { provider: "OpenDota" };

  const proTrackerPayload = await fetchProTrackerApiPayload();
  const proTrackerMetaHeroes = parseProTrackerMetaHeroes(proTrackerPayload);
  if (proTrackerMetaHeroes) {
    topHeroesByRole = groupTopHeroesByRoleFromList(proTrackerMetaHeroes);
    sourceInfo = { provider: "Dota2ProTracker API" };
  }

  if (!topHeroesByRole) {
    const proMatchesRaw = await fetchProMatches(PRO_MATCH_SAMPLE_SIZE);
    const proMatches = filterMatchesByLastWeek(proMatchesRaw);
    const matchDetails = await Promise.all(proMatches.map((m) => fetchMatchDetails(m.match_id)));

    const roleStats = buildRoleStats(matchDetails);
    const allHeroIds = new Set<number>();
    for (const heroMap of roleStats.values()) {
      for (const heroId of heroMap.keys()) {
        allHeroIds.add(heroId);
      }
    }

    const heroIdList = Array.from(allHeroIds);
    const heroNamesList = await getHeroNames(heroIdList);
    const heroNames = new Map(heroIdList.map((id, index) => [id, heroNamesList[index]]));

    const items = await fetchItems();
    const itemNames = new Map<number, string>();
    for (const [itemId, item] of items.entries()) {
      itemNames.set(itemId, item.dname);
    }

    topHeroesByRole = pickTopHeroesByRole(roleStats, heroNames, itemNames);
    sourceInfo = {
      provider: "OpenDota",
      note: "Dota2ProTracker API недоступен или вернул неожиданный формат, использую fallback.",
    };
  }

  const aiLineups = await generateAiLineups(topHeroesByRole);

  const lines: string[] = [
    "📈 <b>Meta по ролям (топ-4 героя + билды)</b>",
    `<i>Источник: ${sourceInfo.provider}${sourceInfo.note ? ` (${sourceInfo.note})` : ""}</i>`,
    `<i>Период: последние ${META_LOOKBACK_DAYS} дней</i>`,
    "",
  ];

  (Object.keys(ROLE_LABELS) as Role[]).forEach((role) => {
    const topHeroes = topHeroesByRole.get(role) ?? [];

    lines.push(`<b>${ROLE_LABELS[role]}</b>`);

    if (topHeroes.length === 0) {
      lines.push("• Недостаточно данных", "");
      return;
    }

    topHeroes.forEach((hero, index) => {
      lines.push(
        `${index + 1}. <b>${hero.heroName}</b> — WR: <b>${hero.winRate.toFixed(1)}%</b> (${hero.wins}/${hero.games})`,
        `   Билд: ${hero.build}`,
      );
    });

    lines.push("");
  });

  lines.push(aiLineups);

  const text = lines.filter(Boolean).join("\n").trim();
  metaCache = {
    text,
    expiresAt: Date.now() + META_CACHE_TTL_MS,
  };

  return text;
}
