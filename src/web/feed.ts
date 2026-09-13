/**
 * Лента матчей стака: собирает последние игры всех игроков из config.ts,
 * склеивает их по match_id (одна катка = одна строка, даже если играли впятером)
 * и кэширует на диск, чтобы не дёргать OpenDota на каждый запрос страницы.
 */
import { mkdir, readFile, writeFile, rename } from "node:fs/promises";
import path from "node:path";
import { collectApm } from "../apm-collector.js";
import { PLAYERS } from "../config.js";
import { fetchRecentMatches, type RecentMatch } from "../opendota.js";
import { getHeroNames } from "../heroes.js";

const CACHE_PATH = path.join(process.env.DATA_DIR || "data", "feed.json");
const FEED_TTL_MS = 60 * 60 * 1000;
/** Как часто лента освежается сама, без участия посетителей. */
const FEED_SYNC_INTERVAL_MS = 60 * 60 * 1000;
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
async function rebuildFeedInternal(): Promise<FeedMatch[]> {
  const previous = await readFile(CACHE_PATH, "utf8").then(s=>JSON.parse(s) as FeedCache).catch(()=>null);
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

  // Never erase known matches because one or all upstream requests failed.
  for (const old of previous?.matches ?? []) {
    const found = matches.find(m=>m.matchId===old.matchId);
    if (!found) matches.push(old);
    else for (const player of old.ours) if (!found.ours.some(p=>p.steamId===player.steamId)) found.ours.push(player);
  }
  if (!matches.length) throw new Error("Не удалось обновить ленту: нет доступных данных");
  matches.sort((a, b) => b.startTime - a.startTime);

  await mkdir(path.dirname(CACHE_PATH), { recursive: true });
  await writeFile(CACHE_PATH + ".tmp", JSON.stringify({ updatedAt: Date.now(), matches } satisfies FeedCache));
  await rename(CACHE_PATH + ".tmp", CACHE_PATH);
  collectApm(matches);
  console.log(`[FEED] собрано ${matches.length} матчей`);
  return matches;
}

/** Чтобы параллельные запросы не запускали пересборку по второму разу. */
let refreshing: Promise<FeedMatch[]> | null = null;

function refreshInBackground(): void {
  if (refreshing) return;
  refreshing = rebuildFeed()
    .catch((error) => {
      console.warn("[FEED] фоновое обновление не удалось:", (error as Error).message);
      return [] as FeedMatch[];
    })
    .finally(() => {
      refreshing = null;
    }) as Promise<FeedMatch[]>;
}

/**
 * Отдаёт ленту. Сборка занимает около полминуты (14 игроков против рейт-лимита OpenDota),
 * поэтому просроченный кэш возвращаем сразу и обновляем его в фоне: страница не должна ждать.
 */
export async function getFeed(force = false): Promise<{ matches: FeedMatch[]; updatedAt: number }> {
  if (!force) {
    try {
      const cached = JSON.parse(await readFile(CACHE_PATH, "utf8")) as FeedCache;
      if (!cached.matches.length && process.env.FEED_SYNC_DISABLED!=="1") throw new Error("Empty feed cache");
      if (process.env.FEED_SYNC_DISABLED!=="1" && Date.now() - cached.updatedAt >= FEED_TTL_MS) refreshInBackground();
      return cached;
    } catch {
      // кэша нет — придётся собрать прямо сейчас
    }
  }
  if(process.env.FEED_SYNC_DISABLED==="1")return {matches:[],updatedAt:0};
  return { matches: await rebuildFeed(), updatedAt: Date.now() };
}

/**
 * Держит ленту тёплой: собирает сразу при старте и потом сама по таймеру.
 * Посетитель в норме всегда получает готовый кэш и не ждёт OpenDota.
 */
export function startFeedSync(): void {
  refreshInBackground();
  const timer = setInterval(refreshInBackground, FEED_SYNC_INTERVAL_MS);
  timer.unref?.();
  console.log(`[FEED] автосинк раз в ${FEED_SYNC_INTERVAL_MS / 60000} мин`);
}

let rebuildTask: Promise<FeedMatch[]> | undefined;
export function rebuildFeed(): Promise<FeedMatch[]> {
  if (rebuildTask) return rebuildTask;
  rebuildTask = rebuildFeedInternal().finally(()=>{rebuildTask=undefined;});
  return rebuildTask;
}
