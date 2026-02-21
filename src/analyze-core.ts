import OpenAI from "openai";
import { getAppFetch, getOpenAIFetch } from "./proxy.js";
import { PLAYER_IDS } from "./config.js";
import { fetchRecentMatches, fetchPlayerProfile } from "./opendota.js";
import { getHeroName } from "./heroes.js";
import { getItemNames } from "./items.js";
import { getRankName } from "./ranks.js";
import { OPENDOTA_API_BASE } from "./constants.js";

// ============================================================================
// Configuration
// ============================================================================

export const OPENAI_MODEL = process.env.OPENAI_MODEL || "gpt-5.2";

const FETCH_TIMEOUT_MS = 30000; // 30s for OpenDota
const FETCH_MAX_RETRIES = 3;
const FETCH_RETRY_DELAY_MS = 3000;

// ============================================================================
// Constants
// ============================================================================

export const KEY_ITEMS = [
  "blink", "black_king_bar", "manta", "butterfly", "satanic", "skadi",
  "hand_of_midas", "battle_fury", "radiance", "aghanims_scepter",
  "refresher", "sheepstick", "assault", "shivas_guard", "heart",
  "travel_boots", "bloodthorn", "nullifier", "sphere", "aeon_disk",
  "desolator", "mjollnir", "greater_crit", "monkey_king_bar",
];

export const LANE_NAMES: Record<number, string> = {
  1: "Safelane",
  2: "Mid",
  3: "Offlane",
  4: "Jungle",
};

// ============================================================================
// Types
// ============================================================================

export interface PurchaseLog {
  time: number;
  key: string;
}

export interface Objective {
  time: number;
  type: string;
  key?: string;
}

export interface TeamfightPlayer {
  deaths: number;
  damage: number;
  gold_delta: number;
}

export interface Teamfight {
  start: number;
  end: number;
  deaths: number;
  players: TeamfightPlayer[];
}

export interface MatchPlayer {
  account_id?: number;
  player_slot: number;
  hero_id: number;
  hero_variant: number;
  kills: number;
  deaths: number;
  assists: number;
  last_hits: number;
  denies: number;
  gold_per_min: number;
  xp_per_min: number;
  level: number;
  net_worth: number;
  hero_damage: number;
  tower_damage: number;
  hero_healing: number;
  item_0: number;
  item_1: number;
  item_2: number;
  item_3: number;
  item_4: number;
  item_5: number;
  item_neutral: number;
  personaname?: string;
  isRadiant: boolean;
  win: number;
  kda: number;
  rank_tier?: number | null;
  lane?: number | null;
  lane_role?: number | null;
  is_roaming?: boolean | null;
  lane_efficiency_pct?: number | null;
  obs_placed?: number | null;
  sen_placed?: number | null;
  camps_stacked?: number | null;
  stuns?: number | null;
  teamfight_participation?: number | null;
  actions_per_min?: number | null;
  gold_t?: number[];
  xp_t?: number[];
  lh_t?: number[];
  dn_t?: number[];
  purchase_log?: PurchaseLog[];
  benchmarks?: {
    gold_per_min?: { raw: number; pct: number };
    xp_per_min?: { raw: number; pct: number };
    kills_per_min?: { raw: number; pct: number };
    last_hits_per_min?: { raw: number; pct: number };
    hero_damage_per_min?: { raw: number; pct: number };
    hero_healing_per_min?: { raw: number; pct: number };
    tower_damage?: { raw: number; pct: number };
  };
}

export interface MatchDetails {
  match_id: number;
  duration: number;
  radiant_win: boolean;
  start_time: number;
  game_mode: number;
  first_blood_time?: number;
  radiant_score: number;
  dire_score: number;
  radiant_gold_adv?: number[];
  radiant_xp_adv?: number[];
  objectives?: Objective[];
  teamfights?: Teamfight[];
  players: MatchPlayer[];
}

// ============================================================================
// Formatting helpers
// ============================================================================

export function formatDuration(seconds: number): string {
  const mins = Math.floor(seconds / 60);
  const secs = seconds % 60;
  return `${mins}:${secs.toString().padStart(2, "0")}`;
}

export function formatTime(seconds: number): string {
  const sign = seconds < 0 ? "-" : "";
  const abs = Math.abs(seconds);
  const mins = Math.floor(abs / 60);
  const secs = abs % 60;
  return `${sign}${mins}:${secs.toString().padStart(2, "0")}`;
}

export function formatBenchmark(pct: number): string {
  const percent = Math.round(pct * 100);
  if (percent >= 80) return `${percent}% 🔥`;
  if (percent >= 60) return `${percent}% ✅`;
  if (percent >= 40) return `${percent}%`;
  if (percent >= 20) return `${percent}% ⚠️`;
  return `${percent}% 💀`;
}

// ============================================================================
// Data helpers (hero names, item names for players)
// ============================================================================

export async function resolveHeroNames(players: MatchPlayer[]): Promise<Map<number, string>> {
  const heroNames = new Map<number, string>();
  for (const p of players) {
    if (!heroNames.has(p.hero_id)) {
      heroNames.set(p.hero_id, await getHeroName(p.hero_id));
    }
  }
  return heroNames;
}

export async function resolvePlayerItems(players: MatchPlayer[]): Promise<Map<number, string>> {
  const playerItems = new Map<number, string>();
  for (const p of players) {
    const itemIds = [p.item_0, p.item_1, p.item_2, p.item_3, p.item_4, p.item_5].filter(i => i > 0);
    const itemNames = await getItemNames(itemIds);
    playerItems.set(p.player_slot, itemNames.filter(n => n).join(", "));
  }
  return playerItems;
}

/**
 * Formats a single player's stats block for LLM context
 */
export function formatPlayerContext(
  p: MatchPlayer,
  heroNames: Map<number, string>,
  playerItems: Map<number, string>,
  marker: string,
): string {
  const hero = heroNames.get(p.hero_id) || "Unknown";
  const name = p.personaname || "Anonymous";
  const items = playerItems.get(p.player_slot) || "None";
  const rank = getRankName(p.rank_tier);

  let info = `${marker}${name} (${hero})${rank ? ` [${rank}]` : ""}
    • KDA: ${p.kills}/${p.deaths}/${p.assists} (${p.kda.toFixed(2)})
    • GPM: ${p.gold_per_min} | XPM: ${p.xp_per_min} | NW: ${p.net_worth.toLocaleString()}
    • Hero Damage: ${p.hero_damage.toLocaleString()} | Tower: ${p.tower_damage.toLocaleString()}
    • Items: ${items}`;

  // Key item timings (if parsed)
  if (p.purchase_log && p.purchase_log.length > 0) {
    const keyPurchases = p.purchase_log.filter(pl => KEY_ITEMS.includes(pl.key));
    if (keyPurchases.length > 0) {
      const timings = keyPurchases.slice(0, 4).map(pl => `${pl.key}@${formatTime(pl.time)}`).join(", ");
      info += `\n    • Timings: ${timings}`;
    }
  }

  // Benchmarks
  if (p.benchmarks) {
    const b = p.benchmarks;
    info += `\n    • Benchmarks: GPM ${b.gold_per_min ? formatBenchmark(b.gold_per_min.pct) : "N/A"}, DMG ${b.hero_damage_per_min ? formatBenchmark(b.hero_damage_per_min.pct) : "N/A"}`;
  }

  // 10 min CS (if parsed)
  if (p.lh_t && p.lh_t.length >= 10) {
    info += `\n    • 10 min CS: ${p.lh_t[10] || 0}/${p.dn_t?.[10] || 0}`;
  }

  return info;
}

// ============================================================================
// Fetch match details with retry
// ============================================================================

export async function fetchMatchDetails(matchId: number): Promise<MatchDetails> {
  const url = `${OPENDOTA_API_BASE}/matches/${matchId}`;
  let lastError: Error | null = null;

  for (let attempt = 0; attempt < FETCH_MAX_RETRIES; attempt++) {
    const fetchFn = await getAppFetch();
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
    try {
      const response = await fetchFn(url, { signal: controller.signal });
      clearTimeout(timeout);
      if (!response.ok) {
        throw new Error(`OpenDota API error: ${response.status}`);
      }
      return response.json();
    } catch (err) {
      clearTimeout(timeout);
      lastError = err instanceof Error ? err : new Error(String(err));
      if (attempt < FETCH_MAX_RETRIES - 1) {
        console.warn(`fetchMatchDetails attempt ${attempt + 1} failed, retrying...`, lastError.message);
        await new Promise((r) => setTimeout(r, FETCH_RETRY_DELAY_MS));
      }
    }
  }
  throw lastError || new Error("Failed to fetch match details");
}

// ============================================================================
// Find last party match
// ============================================================================

export async function findLastPartyMatch(): Promise<{
  matchId: number;
  playerId: number;
  playerName: string;
} | null> {
  let latestMatch: { matchId: number; startTime: number; playerId: number } | null = null;

  for (const playerId of PLAYER_IDS) {
    try {
      const matches = await fetchRecentMatches(playerId);
      if (matches.length > 0) {
        const recent = matches[0];
        if (!latestMatch || recent.start_time > latestMatch.startTime) {
          latestMatch = {
            matchId: recent.match_id,
            startTime: recent.start_time,
            playerId,
          };
        }
      }
    } catch (error) {
      console.error(`Failed to fetch matches for ${playerId}:`, error);
    }
  }

  if (!latestMatch) return null;

  const profile = await fetchPlayerProfile(latestMatch.playerId);
  const playerName = profile.profile?.personaname || String(latestMatch.playerId);

  return {
    matchId: latestMatch.matchId,
    playerId: latestMatch.playerId,
    playerName,
  };
}

// ============================================================================
// Analysis cache
// ============================================================================

interface AnalysisCacheEntry {
  analysis: string;
  timestamp: number;
  isParsed: boolean;
}

const CACHE_TTL_MS = 24 * 60 * 60 * 1000; // 24 hours

/**
 * Creates a namespaced cache for analysis results.
 * Each analysis mode (normal/copium) gets its own cache instance.
 */
export function createAnalysisCache(logPrefix: string) {
  const cache = new Map<number, AnalysisCacheEntry>();

  return {
    get(matchId: number, currentlyParsed: boolean): string | null {
      const cached = cache.get(matchId);
      if (!cached) return null;

      if (Date.now() - cached.timestamp > CACHE_TTL_MS) {
        cache.delete(matchId);
        return null;
      }

      if (!cached.isParsed && currentlyParsed) {
        console.log(`[${logPrefix}] Cache invalidated: match ${matchId} is now parsed`);
        cache.delete(matchId);
        return null;
      }

      return cached.analysis;
    },

    set(matchId: number, analysis: string, isParsed: boolean): void {
      cache.set(matchId, {
        analysis,
        timestamp: Date.now(),
        isParsed,
      });
    },
  };
}

// ============================================================================
// LLM call
// ============================================================================

export interface LLMOptions {
  systemPrompt: string;
  maxTokens: number;
  temperature?: number; // ignored for gpt-5
}

export async function callLLM(context: string, options: LLMOptions): Promise<string> {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    throw new Error("OPENAI_API_KEY not configured");
  }
  const baseURL = process.env.OPENAI_BASE_URL;
  const fetch = await getOpenAIFetch();
  const openai = new OpenAI({ apiKey, baseURL, fetch });
  const isGpt5 = OPENAI_MODEL.startsWith("gpt-5");

  const response = await openai.chat.completions.create({
    model: OPENAI_MODEL,
    messages: [
      { role: "system", content: options.systemPrompt },
      { role: "user", content: context },
    ],
    ...(isGpt5 ? { max_completion_tokens: options.maxTokens } : { max_tokens: options.maxTokens }),
    ...(isGpt5 || options.temperature === undefined ? {} : { temperature: options.temperature }),
  });

  return response.choices[0]?.message?.content || "Не удалось получить анализ";
}

/**
 * Calls LLM with a single retry on timeout errors
 */
export async function callLLMWithRetry(context: string, options: LLMOptions, logPrefix: string): Promise<string> {
  try {
    return await callLLM(context, options);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    const causeMsg = err instanceof Error && err.cause instanceof Error ? err.cause.message : "";
    const isTimeout = /ETIMEDOUT|terminated|timeout|abort/i.test(msg + causeMsg);
    if (isTimeout) {
      console.warn(`[${logPrefix}] LLM timeout, retrying once...`);
      return await callLLM(context, options);
    }
    throw err;
  }
}

// ============================================================================
// Shared match state helpers
// ============================================================================

export function isMatchParsed(match: MatchDetails): boolean {
  return match.players.some(p => p.gold_t && p.gold_t.length > 0);
}

export function getOurPlayers(match: MatchDetails): MatchPlayer[] {
  const playerIdsSet = new Set<number>(PLAYER_IDS as readonly number[]);
  return match.players.filter(p => p.account_id && playerIdsSet.has(p.account_id));
}

export function formatNonParsedFooter(matchUrl: string): string {
  return `

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
📌 <b>Это базовый анализ</b> — без таймингов предметов и тимфайтов.

Для полного разбора: открой <a href="${matchUrl}">матч на OpenDota</a>, нажми "Request Parse", подожди пару минут и запроси анализ снова!`;
}
