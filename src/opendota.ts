const OPENDOTA_API_BASE = "https://api.opendota.com/api";

// Rate limiting configuration
// OpenDota free tier: 60 requests/minute, but be conservative
const RATE_LIMIT_DELAY_MS = 2000; // ~30 requests per minute to stay well under 60/min limit
const MAX_RETRIES = 5;
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
  let lastError: Error | null = null;
  
  for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
    await rateLimitDelay();
    
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
    let response: Response;
    try {
      response = await fetch(url, { signal: controller.signal });
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
      // Rate limited - wait with exponential backoff
      const retryDelay = INITIAL_RETRY_DELAY_MS * Math.pow(2, attempt);
      console.warn(
        `Rate limited for ${context}, attempt ${attempt + 1}/${MAX_RETRIES}, ` +
        `waiting ${retryDelay}ms before retry...`
      );
      await new Promise(resolve => setTimeout(resolve, retryDelay));
      lastError = new Error(`OpenDota API rate limit (429) for ${context}`);
      continue;
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
  days?: number
): Promise<RecentMatch[]> {
  const cacheKey = `matches:${accountId}:${days ?? "recent"}`;
  const cached = getFromCache<RecentMatch[]>(cacheKey);
  if (cached) {
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

  const response = await fetchWithRateLimit(url, `recent matches for ${accountId}`);
  const data = await response.json();
  
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
