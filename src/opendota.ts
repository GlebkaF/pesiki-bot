import { getApmStore } from "./apm-store.js";
import { HERO_CATALOG } from "./hero-catalog.js";
import { getAppFetch, isOpenDotaLimited } from "./proxy.js";

const OPENDOTA_API_BASE = "https://api.opendota.com/api";

// Rate limiting configuration
// OpenDota бесплатно даёт 60 запросов в минуту. Держим 50 — с запасом, но без
// лишнего простоя: при 2 секундах сборка ленты по 14 игрокам занимала полминуты.
const RATE_LIMIT_DELAY_MS = 1200;
const MAX_RETRIES = 2;
const INITIAL_RETRY_DELAY_MS = 5000; // Start with longer backoff

// Cache TTL configuration (in milliseconds)
const CACHE_TTL = {
  PROFILE: 60 * 60 * 1000,      // 1 hour - profiles rarely change
  TOTALS: 60 * 60 * 1000,       // 1 hour - aggregated stats
  MATCHES: 5 * 60 * 1000,       // 5 minutes - matches update more frequently
};

// Simple in-memory cache
interface CacheEntry<T> {
  data: T;
  expiresAt: number;
}

const cache = new Map<string, CacheEntry<unknown>>();

/**
 * Gets cached data if not expired
 */
function getFromCache<T>(key: string): T | null {
  const entry = cache.get(key);
  if (!entry) return null;
  
  if (Date.now() > entry.expiresAt) {
    cache.delete(key);
    return null;
  }
  
  return entry.data as T;
}

/**
 * Stores data in cache with TTL
 */
function setCache<T>(key: string, data: T, ttlMs: number): void {
  cache.set(key, {
    data,
    expiresAt: Date.now() + ttlMs,
  });
}

// Simple queue-based rate limiter
let lastRequestTime = 0;

/**
 * Delays execution to respect rate limits
 */
async function rateLimitDelay(): Promise<void> {
  const now = Date.now();
  const timeSinceLastRequest = now - lastRequestTime;
  
  if (timeSinceLastRequest < RATE_LIMIT_DELAY_MS) {
    const delayNeeded = RATE_LIMIT_DELAY_MS - timeSinceLastRequest;
    await new Promise(resolve => setTimeout(resolve, delayNeeded));
  }
  
  lastRequestTime = Date.now();
}

const FETCH_TIMEOUT_MS = 60000; // 60s - OpenDota can be slow

/**
 * Fetches from OpenDota API with rate limiting and retry logic
 */
async function fetchWithRateLimit(url: string, context: string): Promise<Response> {
  if (isOpenDotaLimited()) throw new Error("OpenDota cooldown (429)");
  let lastError: Error | null = null;
  
  for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
    await rateLimitDelay();
    
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
    const fetchFn = await getAppFetch();
    let response: Response;
    try {
      response = await fetchFn(url, { signal: controller.signal });
    } catch (err) {
      clearTimeout(timeout);
      lastError = err instanceof Error ? err : new Error(String(err));
      if (attempt < MAX_RETRIES - 1) {
        const retryDelay = INITIAL_RETRY_DELAY_MS * Math.pow(2, attempt);
        console.warn(`Fetch timeout for ${context}, retry ${attempt + 1}/${MAX_RETRIES} in ${retryDelay}ms`);
        await new Promise((r) => setTimeout(r, retryDelay));
        continue;
      }
      throw lastError;
    }
    clearTimeout(timeout);
    
    if (response.ok) {
      return response;
    }
    
    if (response.status === 429) {
      throw new Error(`OpenDota API rate limit (429) for ${context}`);
    }
    
    // Other errors - throw immediately
    throw new Error(
      `OpenDota API error: ${response.status} ${response.statusText}`
    );
  }
  
  // All retries exhausted
  throw lastError || new Error(`Failed to fetch ${context} after ${MAX_RETRIES} retries`);
}

export interface RecentMatch {
  match_id: number;
  player_slot: number;
  radiant_win: boolean;
  start_time: number;
  duration: number;
  hero_id: number;
  kills: number;
  deaths: number;
  assists: number;
}

export interface PlayerProfile {
  account_id: number;
  personaname: string | null;
  name: string | null;
  avatar: string;
  avatarfull: string;
}

export interface PlayerData {
  profile: PlayerProfile;
  rank_tier?: number | null;
}

export interface PlayerTotal {
  field: string;
  n: number;
  sum: number;
}

/**
 * Fetches player profile from OpenDota API
 * Returns player data including nickname (personaname)
 */
export async function fetchPlayerProfile(
  accountId: number
): Promise<PlayerData> {
  const cacheKey = `profile:${accountId}`;
  const cached = getFromCache<PlayerData>(cacheKey);
  if (cached) {
    return cached;
  }

  const url = `${OPENDOTA_API_BASE}/players/${accountId}`;
  const response = await fetchWithRateLimit(url, `player profile ${accountId}`);
  const data = await response.json();
  
  setCache(cacheKey, data, CACHE_TTL.PROFILE);
  return data;
}

/**
 * Fetches recent matches for a player from OpenDota API
 * Uses /matches endpoint with date filter for period-based queries
 * @param accountId - Steam32 account ID
 * @param days - Number of days to fetch matches for (default: 1 for today)
 */
export async function fetchRecentMatches(
  accountId: number,
  days?: number,
  fresh = false,
): Promise<RecentMatch[]> {
  const cacheKey = `matches:${accountId}:${days ?? "recent"}`;
  const cached = getFromCache<RecentMatch[]>(cacheKey);
  if (cached && !fresh) {
    return cached;
  }

  let url: string;

  if (days !== undefined && days > 1) {
    // Use /matches endpoint for longer periods (supports more than 20 matches)
    // significant=0 includes all game modes (turbo, ability draft, etc.)
    url = `${OPENDOTA_API_BASE}/players/${accountId}/matches?date=${days}&significant=0`;
  } else {
    // Use /recentMatches for today/yesterday (faster, limited to 20)
    url = `${OPENDOTA_API_BASE}/players/${accountId}/recentMatches`;
  }

  let data: RecentMatch[];
  try {
    const response = await fetchWithRateLimit(url, `recent matches for ${accountId}`);
    data = await response.json();
  } catch (error) {
    if (cached) return cached;
    const local = savedRecentMatches(accountId);
    if (local.length) return local;
    throw error;
  }
  
  setCache(cacheKey, data, CACHE_TTL.MATCHES);
  return data;
}

/**
 * Fetches player totals (aggregated stats) from OpenDota API
 * @param accountId - Steam32 account ID
 * @param date - Optional number of days to filter (e.g., 1 for last day, 7 for last week)
 * @returns Array of totals including actions_per_min for APM calculation
 */
export async function fetchPlayerTotals(
  accountId: number,
  date?: number
): Promise<PlayerTotal[]> {
  const cacheKey = `totals:${accountId}:${date ?? "all"}`;
  const cached = getFromCache<PlayerTotal[]>(cacheKey);
  if (cached) {
    return cached;
  }

  let url = `${OPENDOTA_API_BASE}/players/${accountId}/totals`;
  if (date !== undefined) {
    url += `?date=${date}`;
  }

  const response = await fetchWithRateLimit(url, `totals for ${accountId}`);
  const data = await response.json();

  setCache(cacheKey, data, CACHE_TTL.TOTALS);
  return data;
}

export interface WinLoss {
  win: number;
  lose: number;
}

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

export interface PlayerHeroStats {
  hero_id: number;
  games: number;
  win: number;
}

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

export interface MatchApiPlayer {
  account_id?: number;
  player_slot: number;
  hero_id: number;
  personaname?: string;
  kills: number;
  deaths: number;
  assists: number;
  last_hits?: number;
  denies?: number;
  gold_per_min?: number;
  xp_per_min?: number;
  net_worth?: number;
  hero_damage?: number;
  tower_damage?: number;
  level?: number;
  item_0?: number; item_1?: number; item_2?: number;
  item_3?: number; item_4?: number; item_5?: number;
}

export interface MatchApi {
  match_id: number;
  duration: number;
  start_time: number;
  radiant_win: boolean;
  radiant_score: number;
  dire_score: number;
  game_mode?: number;
  cluster?: number;
  replay_salt?: number;
  players: MatchApiPlayer[];
}

/** Полные данные матча из API — нужны для страницы матча, даже когда реплея нет. */
export async function fetchMatchApi(matchId: number): Promise<MatchApi> {
  const cacheKey = `match:${matchId}`;
  const cached = getFromCache<MatchApi>(cacheKey);
  if (cached) return cached;

  const response = await fetchWithRateLimit(
    `${OPENDOTA_API_BASE}/matches/${matchId}`,
    `match ${matchId}`,
  );
  const data = (await response.json()) as MatchApi;
  setCache(cacheKey, data, CACHE_TTL.TOTALS);
  return data;
}

export function savedRecentMatches(accountId: number): RecentMatch[] {
  const steamId = String(BigInt(accountId) + 76561197960265728n);
  const heroIds = new Map(HERO_CATALOG.map(h=>[h.name.replace("npc_dota_hero_", ""),h.id]));
  return getApmStore().allReplays().flatMap(m => {
    const p=m.players.find(p=>p.steam_id===steamId);
    if(!p || !m.start_time) return [];
    return [{match_id:m.match_id,player_slot:p.team==="radiant"?0:128,radiant_win:m.winner==="radiant",start_time:m.start_time,duration:Math.round(m.duration_min*60),hero_id:heroIds.get(p.hero)??0,kills:p.kills,deaths:p.deaths,assists:p.assists}];
  }).sort((a,b)=>b.start_time-a.start_time);
}
