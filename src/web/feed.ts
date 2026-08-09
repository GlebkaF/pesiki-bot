/**
 * Лента матчей стака: собирает последние игры всех игроков из config.ts,
 * склеивает их по match_id (одна катка = одна строка, даже если играли впятером)
 * и кэширует на диск, чтобы не дёргать OpenDota на каждый запрос страницы.
 */
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { PLAYERS } from "../config.js";
import { fetchRecentMatches, type RecentMatch } from "../opendota.js";
import { getHeroNames } from "../heroes.js";

const CACHE_PATH = path.join(process.env.DATA_DIR || "data", "feed.json");
const FEED_TTL_MS = 10 * 60 * 1000;
const MATCHES_PER_PLAYER = 12;

export interface FeedPlayer {
  name: string;
  steamId: number;
  hero: string;
  heroId: number;
  kills: number;
  deaths: number;
  assists: number;
  win: boolean;
  gpm?: number;
  xpm?: number;
  lastHits?: number;
}

export interface FeedMatch {
  matchId: number;
  startTime: number;
  duration: number;
  gameMode?: number;
  lobbyType?: number;
  win: boolean;
  ours: FeedPlayer[];
}

interface FeedCache {
  updatedAt: number;
  matches: FeedMatch[];
}

function isWin(m: RecentMatch): boolean {
  return m.player_slot < 128 === m.radiant_win;
}

/** Собирает ленту заново, опрашивая OpenDota по каждому игроку. */
export async function rebuildFeed(): Promise<FeedMatch[]> {
  const byMatch = new Map<number, { m: RecentMatch; player: (typeof PLAYERS)[number] }[]>();

  for (const player of PLAYERS) {
    try {
      const matches = await fetchRecentMatches(player.steamId);
      for (const m of matches.slice(0, MATCHES_PER_PLAYER)) {
        const list = byMatch.get(m.match_id) ?? [];
        list.push({ m, player });
        byMatch.set(m.match_id, list);
      }
    } catch (error) {
      console.warn(`[FEED] не удалось получить матчи ${player.dotaName}:`, (error as Error).message);
    }
  }

  // Имена героев тянем одним запросом на всю ленту.
  const heroIds = [...new Set([...byMatch.values()].flat().map((x) => x.m.hero_id))];
  const heroNames = await getHeroNames(heroIds);
  const heroById = new Map(heroIds.map((id, i) => [id, heroNames[i]]));

  const matches: FeedMatch[] = [];
  for (const [matchId, entries] of byMatch) {
    const first = entries[0].m;
    matches.push({
      matchId,
      startTime: first.start_time,
      duration: first.duration,
      win: isWin(first),
      ours: entries
        .map(({ m, player }) => ({
          name: player.dotaName,
          steamId: player.steamId,
          hero: heroById.get(m.hero_id) ?? String(m.hero_id),
          heroId: m.hero_id,
          kills: m.kills,
          deaths: m.deaths,
          assists: m.assists,
          win: isWin(m),
        }))
        .sort((a, b) => b.kills + b.assists - (a.kills + a.assists)),
    });
  }

  matches.sort((a, b) => b.startTime - a.startTime);

  await mkdir(path.dirname(CACHE_PATH), { recursive: true });
  await writeFile(CACHE_PATH, JSON.stringify({ updatedAt: Date.now(), matches } satisfies FeedCache));
  console.log(`[FEED] собрано ${matches.length} матчей`);
  return matches;
}

/** Отдаёт ленту из кэша; обновляет, если кэш устарел или его нет. */
export async function getFeed(force = false): Promise<{ matches: FeedMatch[]; updatedAt: number }> {
  if (!force) {
    try {
      const cached = JSON.parse(await readFile(CACHE_PATH, "utf8")) as FeedCache;
      if (Date.now() - cached.updatedAt < FEED_TTL_MS) return cached;
      // Кэш просрочен, но пригодится как запасной вариант, если OpenDota недоступна.
      try {
        return { matches: await rebuildFeed(), updatedAt: Date.now() };
      } catch {
        return cached;
      }
    } catch {
      // кэша нет — собираем с нуля
    }
  }
  return { matches: await rebuildFeed(), updatedAt: Date.now() };
}
