import OpenAI from "openai";
import { getAppFetch, getOpenAIFetch } from "./proxy.js";
import { PLAYER_IDS } from "./config.js";
import { fetchRecentMatches, fetchPlayerProfile } from "./opendota.js";
import { getHeroName } from "./heroes.js";
import { getItemNames } from "./items.js";
import { getRankName } from "./ranks.js";
import { maybeAppendOutcomeCanonStrophe } from "./canon.js";
import { escapeHtml } from "./telegram-html.js";

const OPENDOTA_API_BASE = "https://api.opendota.com/api";

// ============================================================================
// CONFIGURATION
// ============================================================================

const OPENAI_MODEL = process.env.OPENAI_MODEL || "gpt-5.2";

// Cache for analysis results (match_id -> analysis + metadata)
interface AnalysisCacheEntry {
  analysis: string;
  timestamp: number;
  isParsed: boolean; // Track if analysis was done with parsed data
}
const analysisCache = new Map<number, AnalysisCacheEntry>();
const CACHE_TTL_MS = 24 * 60 * 60 * 1000; // 24 hours

const LANE_NAMES: Record<number, string> = {
  1: "Safelane",
  2: "Mid",
  3: "Offlane",
  4: "Jungle",
};

const KEY_ITEMS = [
  "blink", "black_king_bar", "manta", "butterfly", "satanic", "skadi",
  "hand_of_midas", "battle_fury", "radiance", "aghanims_scepter",
  "refresher", "sheepstick", "assault", "shivas_guard", "heart",
  "travel_boots", "bloodthorn", "nullifier", "sphere", "aeon_disk",
  "desolator", "mjollnir", "greater_crit", "monkey_king_bar",
];

// ============================================================================
// Types
// ============================================================================

interface PurchaseLog {
  time: number;
  key: string;
}

interface Objective {
  time: number;
  type: string;
  key?: string;
}

interface TeamfightPlayer {
  deaths: number;
  damage: number;
  gold_delta: number;
}

interface Teamfight {
  start: number;
  end: number;
  deaths: number;
  players: TeamfightPlayer[];
}

interface MatchPlayer {
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

interface MatchDetails {
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
// Helpers
// ============================================================================

function formatDuration(seconds: number): string {
  const mins = Math.floor(seconds / 60);
  const secs = seconds % 60;
  return `${mins}:${secs.toString().padStart(2, "0")}`;
}

function formatTime(seconds: number): string {
  const sign = seconds < 0 ? "-" : "";
  const abs = Math.abs(seconds);
  const mins = Math.floor(abs / 60);
  const secs = abs % 60;
  return `${sign}${mins}:${secs.toString().padStart(2, "0")}`;
}

function formatBenchmark(pct: number): string {
  const percent = Math.round(pct * 100);
  if (percent >= 80) return `${percent}% 🔥`;
  if (percent >= 60) return `${percent}% ✅`;
  if (percent >= 40) return `${percent}%`;
  if (percent >= 20) return `${percent}% ⚠️`;
  return `${percent}% 💀`;
}

async function fetchMatchDetails(matchId: number): Promise<MatchDetails> {
  const url = `${OPENDOTA_API_BASE}/matches/${matchId}`;
  const fetchFn = await getAppFetch();
  const response = await fetchFn(url);
  if (!response.ok) {
    throw new Error(`OpenDota API error: ${response.status}`);
  }
  return response.json();
}

async function findLastPartyMatch(): Promise<{
  matchId: number;
  playerId: number;
  playerName: string;
} | null> {
  let latestMatch: { matchId: number; startTime: number; playerId: number } | null = null;
  
  for (const playerId of PLAYER_IDS) {
    try {
      const matches = await fetchRecentMatches(playerId as number);
      if (matches.length > 0) {
        const recent = matches[0];
        if (!latestMatch || recent.start_time > latestMatch.startTime) {
          latestMatch = {
            matchId: recent.match_id,
            startTime: recent.start_time,
            playerId: playerId as number,
          };
        }
      }
    } catch (error) {
      console.error(`Failed to fetch matches for ${playerId}:`, error);
    }
  }
  
  if (!latestMatch) return null;
  
  const profile = await fetchPlayerProfile(latestMatch.playerId as (typeof PLAYER_IDS)[number]);
  const playerName = profile.profile?.personaname || String(latestMatch.playerId);
  
  return {
    matchId: latestMatch.matchId,
    playerId: latestMatch.playerId,
    playerName,
  };
}

// ============================================================================
// Context Builder
// ============================================================================

async function buildAnalysisContext(match: MatchDetails): Promise<string> {
  const playerIdsSet = new Set<number>(PLAYER_IDS as readonly number[]);
  const ourPlayers = match.players.filter(p => p.account_id && playerIdsSet.has(p.account_id));
  const isParsed = match.players.some(p => p.gold_t && p.gold_t.length > 0);
  
  // Get hero names
  const heroNames = new Map<number, string>();
  for (const p of match.players) {
    if (!heroNames.has(p.hero_id)) {
      heroNames.set(p.hero_id, await getHeroName(p.hero_id));
    }
  }
  
  // Get item names
  const playerItems = new Map<number, string>();
  for (const p of match.players) {
    const itemIds = [p.item_0, p.item_1, p.item_2, p.item_3, p.item_4, p.item_5].filter(i => i > 0);
    const itemNames = await getItemNames(itemIds);
    playerItems.set(p.player_slot, itemNames.filter(n => n).join(", "));
  }
  
  // Match overview
  let context = `
MATCH: ${match.match_id} | Duration: ${formatDuration(match.duration)} | ${match.radiant_win ? "Radiant Win" : "Dire Win"}
Score: Radiant ${match.radiant_score} - ${match.dire_score} Dire
Mode: ${match.game_mode === 23 ? "Turbo" : match.game_mode === 22 ? "All Pick" : `Mode ${match.game_mode}`}
First Blood: ${match.first_blood_time ? formatTime(match.first_blood_time) : "N/A"}
Data: ${isParsed ? "PARSED (full data)" : "BASIC"}
`;

  // Economy timeline (if parsed)
  if (match.radiant_gold_adv && match.radiant_gold_adv.length > 0) {
    const goldAdv = match.radiant_gold_adv;
    const min10 = Math.min(10, goldAdv.length - 1);
    const min20 = Math.min(20, goldAdv.length - 1);
    const endMin = goldAdv.length - 1;
    
    context += `
ECONOMY:
• 10 min: ${goldAdv[min10] > 0 ? "+" : ""}${goldAdv[min10]} Radiant
• 20 min: ${goldAdv[min20] > 0 ? "+" : ""}${goldAdv[min20]} Radiant
• End: ${goldAdv[endMin] > 0 ? "+" : ""}${goldAdv[endMin]} Radiant
`;
  }

  // Teamfights (if parsed)
  if (match.teamfights && match.teamfights.length > 0) {
    const bigFights = match.teamfights
      .filter(tf => tf.deaths >= 3)
      .sort((a, b) => b.deaths - a.deaths)
      .slice(0, 3);
    
    if (bigFights.length > 0) {
      context += `\nKEY TEAMFIGHTS:`;
      for (const tf of bigFights) {
        const radiantGold = tf.players.slice(0, 5).reduce((sum, p) => sum + p.gold_delta, 0);
        const direGold = tf.players.slice(5, 10).reduce((sum, p) => sum + p.gold_delta, 0);
        const winner = radiantGold > direGold ? "Radiant" : "Dire";
        context += `\n• ${formatTime(tf.start)}: ${tf.deaths} deaths, ${winner} won (+${Math.abs(radiantGold - direGold)} gold)`;
      }
    }
  }

  // Players
  const formatPlayer = (p: MatchPlayer, isOurs: boolean) => {
    const hero = heroNames.get(p.hero_id) || "Unknown";
    const name = p.personaname || "Anonymous";
    const items = playerItems.get(p.player_slot) || "None";
    const rank = getRankName(p.rank_tier);
    const marker = isOurs ? "⭐ [OUR PLAYER] " : "";
    
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
  };
  
  const radiant = match.players.filter(p => p.isRadiant);
  const dire = match.players.filter(p => !p.isRadiant);
  
  context += `
\nRADIANT ${match.radiant_win ? "(WIN)" : "(LOSE)"}:
${radiant.map(p => formatPlayer(p, playerIdsSet.has(p.account_id as number))).join("\n\n")}

DIRE ${!match.radiant_win ? "(WIN)" : "(LOSE)"}:
${dire.map(p => formatPlayer(p, playerIdsSet.has(p.account_id as number))).join("\n\n")}

OUR PLAYERS: ${ourPlayers.map(p => `${p.personaname || "Anon"} (${heroNames.get(p.hero_id)})`).join(", ") || "None identified"}
`;

  return context;
}

// ============================================================================
// LLM Analysis
// ============================================================================

const SYSTEM_PROMPT = `Ты — токсичный но полезный тренер по Dota 2.
Фокус на игроках [OUR PLAYER] — их разбираем детально.

СТРУКТУРА (коротко и по делу):

KDA TABLE — ЭТО САМЫЙ ПЕРВЫЙ БЛОК:
KDA TABLE:
RADIANT:
• Name (Hero) K/D/A
DIRE:
• Name (Hero) K/D/A

🎯 ВЕРДИКТ (2-3 предложения)
Почему выиграли/продули + главный перелом матча

👤 РАЗБОР НАШИХ
Для каждого [OUR PLAYER]:
• Что хорошо / что плохо (с цифрами из benchmarks)
• 2-3 конкретных косяка
• Один совет на следующую игру

💀 ИТОГ
MVP и LVP матча + токсичный комментарий

ПРАВИЛА:
• БЕЗ Markdown — только plain text + эмодзи 🔥 ✅ ⚠️ 💀
• Benchmarks: 80%+ = 🔥, <30% = 💀
• Русский со сленгом (го, затащить, сфидить)
• Конкретика: "BKB на 25 мин это поздно" вместо "улучши билд"
• Пиши компактно, без длинных вступлений
• МАКСИМУМ 220 слов — без воды`;

async function analyzeWithLLM(context: string): Promise<string> {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    throw new Error("OPENAI_API_KEY not configured");
  }
  const baseURL = process.env.OPENAI_BASE_URL;
  const fetch = await getOpenAIFetch();
  const openai = new OpenAI({ apiKey, baseURL, fetch });
  const isGpt5 = OPENAI_MODEL.startsWith("gpt-5");
  
  console.log(`[ANALYZE] Using model: ${OPENAI_MODEL}`);
  
  const response = await openai.chat.completions.create({
    model: OPENAI_MODEL,
    messages: [
      { role: "system", content: SYSTEM_PROMPT },
      { role: "user", content: context },
    ],
    ...(isGpt5 ? { max_completion_tokens: 1500 } : { max_tokens: 1500 }),
    ...(isGpt5 ? {} : { temperature: 0.7 }),
  });
  
  return response.choices[0]?.message?.content || "Не удалось получить анализ";
}

// ============================================================================
// Cache
// ============================================================================

/**
 * Gets cached analysis if valid.
 * Returns null if:
 * - No cache exists
 * - Cache is expired
 * - Cache was created with unparsed data but match is now parsed
 */
function getCachedAnalysis(matchId: number, currentlyParsed: boolean): string | null {
  const cached = analysisCache.get(matchId);
  if (!cached) return null;
  
  // Check TTL
  if (Date.now() - cached.timestamp > CACHE_TTL_MS) {
    analysisCache.delete(matchId);
    return null;
  }
  
  // Invalidate cache if match was unparsed before but is now parsed
  // This allows users to get full analysis after parsing
  if (!cached.isParsed && currentlyParsed) {
    console.log(`[ANALYZE] Cache invalidated: match ${matchId} is now parsed`);
    analysisCache.delete(matchId);
    return null;
  }
  
  return cached.analysis;
}

function cacheAnalysis(matchId: number, analysis: string, isParsed: boolean): void {
  analysisCache.set(matchId, {
    analysis,
    timestamp: Date.now(),
    isParsed,
  });
}

// ============================================================================
// Public API
// ============================================================================

/**
 * Core analyze function - analyzes a specific match by ID
 */
export async function analyzeMatch(matchId: number): Promise<string> {
  console.log(`[ANALYZE] Analyzing match ${matchId}...`);
  
  // Fetch detailed match data first to check parsed status
  const matchDetails = await fetchMatchDetails(matchId);
  console.log(`[ANALYZE] Match duration: ${formatDuration(matchDetails.duration)}`);
  
  // Check if match is parsed
  const isParsed = matchDetails.players.some(p => p.gold_t && p.gold_t.length > 0);
  console.log(`[ANALYZE] Match parsed: ${isParsed}`);
  
  // Check cache (with parsed status to handle re-parsing)
  const cachedResult = getCachedAnalysis(matchId, isParsed);
  const playerIdsSet = new Set<number>(PLAYER_IDS as readonly number[]);
  const ourPlayers = matchDetails.players.filter(p => p.account_id && playerIdsSet.has(p.account_id));
  const weAreRadiant = ourPlayers.length > 0 ? ourPlayers[0].isRadiant : true;
  const weWon = weAreRadiant ? matchDetails.radiant_win : !matchDetails.radiant_win;
  if (cachedResult) {
    console.log(`[ANALYZE] Returning cached analysis for match ${matchId}`);
    return maybeAppendOutcomeCanonStrophe(cachedResult + "\n\n<i>📦 Из кэша</i>", weWon);
  }
  
  // Build context for LLM
  const context = await buildAnalysisContext(matchDetails);
  console.log("[ANALYZE] Context built, calling LLM...");
  
  // Analyze with LLM
  const analysis = await analyzeWithLLM(context);
  
  // Format response (escape AI output to prevent Telegram HTML parse errors on < > &)
  const matchUrl = `https://www.opendota.com/matches/${matchId}`;
  const header = `🔬 <b>Анализ матча</b> <a href="${matchUrl}">#${matchId}</a>
⏱ Длительность: ${formatDuration(matchDetails.duration)}
🎮 Результат: ${matchDetails.radiant_win ? "Radiant" : "Dire"} победил (${matchDetails.radiant_score}:${matchDetails.dire_score})
${isParsed ? "📊 Полный" : "📊 Базовый"}

`;

  const fullAnalysis = header + escapeHtml(analysis);
  
  // Cache the result with parsed status
  cacheAnalysis(matchId, fullAnalysis, isParsed);
  console.log(`[ANALYZE] Analysis cached for match ${matchId} (parsed: ${isParsed})`);
  
  return maybeAppendOutcomeCanonStrophe(fullAnalysis, weWon);
}

/**
 * Analyzes the last match of any party member
 */
export async function analyzeLastMatch(): Promise<string> {
  console.log("[ANALYZE] Finding last party match...");
  
  const lastMatch = await findLastPartyMatch();
  if (!lastMatch) {
    return "❌ Не удалось найти последний матч";
  }
  
  console.log(`[ANALYZE] Found match ${lastMatch.matchId} for player ${lastMatch.playerName}`);
  
  return analyzeMatch(lastMatch.matchId);
}

/**
 * For testing - prints raw context
 */
export async function getAnalysisContext(): Promise<string> {
  const lastMatch = await findLastPartyMatch();
  if (!lastMatch) {
    return "No match found";
  }
  
  const matchDetails = await fetchMatchDetails(lastMatch.matchId);
  return buildAnalysisContext(matchDetails);
}
