const OPENDOTA_API_BASE = "https://api.opendota.com/api";

// Rate limiting configuration
const RATE_LIMIT_DELAY_MS = 1100; // ~55 requests per minute to stay under 60/min limit
const MAX_RETRIES = 3;
const INITIAL_RETRY_DELAY_MS = 2000;

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

/**
 * Fetches from OpenDota API with rate limiting and retry logic
 */
async function fetchWithRateLimit(url: string, context: string): Promise<Response> {
  let lastError: Error | null = null;
  
  for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
    await rateLimitDelay();
    
    const response = await fetch(url);
    
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
  const url = `${OPENDOTA_API_BASE}/players/${accountId}`;
  const response = await fetchWithRateLimit(url, `player profile ${accountId}`);
  return response.json();
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
  return response.json();
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
  let url = `${OPENDOTA_API_BASE}/players/${accountId}/totals`;
  if (date !== undefined) {
    url += `?date=${date}`;
  }

  const response = await fetchWithRateLimit(url, `totals for ${accountId}`);
  return response.json();
}
