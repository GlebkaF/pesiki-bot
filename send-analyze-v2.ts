/**
 * Enhanced match analysis v2 - "WOW level" analysis
 * 
 * A) Executive summary (5-8 lines)
 * B) Phase breakdown (laning / early mid / late)
 * C) Player-specific analysis (mistakes + priorities)
 * D) Reference comparison (v2 - placeholder for now)
 * 
 * Usage: npx tsx send-analyze-v2.ts [match_id]
 */
import "dotenv/config";
import { Bot } from "grammy";
import OpenAI from "openai";
import { PLAYER_IDS } from "./src/config.js";
import { fetchRecentMatches, fetchPlayerProfile } from "./src/opendota.js";
import { getHeroName } from "./src/heroes.js";
import { getItemNames } from "./src/items.js";

const OPENDOTA_API_BASE = "https://api.opendota.com/api";
const OPENAI_MODEL = process.env.OPENAI_MODEL || "gpt-5.2";

// Parse request configuration
const PARSE_CHECK_INTERVAL_MS = 5000; // Check every 5 seconds
const PARSE_MAX_WAIT_MS = 120000; // Max 2 minutes wait (default)
const PARSE_MAX_WAIT_LONG_MS = 300000; // Max 5 minutes wait (--wait-longer)

// ============================================================================
// Types
// ============================================================================

interface PurchaseLog {
  time: number;
  key: string;
}

interface KillLog {
  time: number;
  key: string;  // victim hero name
}

interface BuybackLog {
  time: number;
  slot: number;
}

interface Objective {
  time: number;
  type: string;
  key?: string;
  unit?: string;
  slot?: number;
  player_slot?: number;
  team?: number;
}

interface TeamfightPlayer {
  deaths: number;
  buybacks: number;
  damage: number;
  healing: number;
  gold_delta: number;
  xp_delta: number;
  killed?: Record<string, number>;
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
  personaname?: string;
  isRadiant: boolean;
  win: number;
  kills: number;
  deaths: number;
  assists: number;
  kda: number;
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
  // Parsed data
  lane?: number | null;
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
  kills_log?: KillLog[];
  buyback_log?: BuybackLog[];
  benchmarks?: {
    gold_per_min?: { raw: number; pct: number };
    xp_per_min?: { raw: number; pct: number };
    hero_damage_per_min?: { raw: number; pct: number };
    last_hits_per_min?: { raw: number; pct: number };
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

const LANE_NAMES: Record<number, string> = {
  1: "Safelane", 2: "Mid", 3: "Offlane", 4: "Jungle",
};

const KEY_ITEMS = [
  "blink", "black_king_bar", "manta", "butterfly", "satanic", "skadi",
  "hand_of_midas", "battle_fury", "radiance", "aghanims_scepter",
  "refresher", "sheepstick", "dagon_5", "assault", "shivas_guard",
  "heart", "boots_of_bearing", "arcane_blink", "overwhelming_blink",
  "swift_blink", "travel_boots", "travel_boots_2", "bloodthorn",
  "nullifier", "sphere", "aeon_disk", "desolator", "mjollnir",
  "greater_crit", "monkey_king_bar", "ethereal_blade", "orchid",
];

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
  const response = await fetch(`${OPENDOTA_API_BASE}/matches/${matchId}`);
  if (!response.ok) throw new Error(`API error: ${response.status}`);
  return response.json();
}

/**
 * Request match parsing from OpenDota
 * Returns job_id if parse was requested, null if already parsed
 */
async function requestParse(matchId: number): Promise<{ jobId: number | null; alreadyParsed: boolean }> {
  const response = await fetch(`${OPENDOTA_API_BASE}/request/${matchId}`, {
    method: "POST",
  });
  
  if (!response.ok) {
    console.log(`[PARSE] Request failed: ${response.status}`);
    return { jobId: null, alreadyParsed: false };
  }
  
  const data = await response.json();
  // If job.jobId is 0 or missing, match might already be parsed
  if (!data.job?.jobId) {
    return { jobId: null, alreadyParsed: true };
  }
  
  return { jobId: data.job.jobId, alreadyParsed: false };
}

/**
 * Check if match is parsed by fetching match details
 */
async function isMatchParsed(matchId: number): Promise<boolean> {
  const response = await fetch(`${OPENDOTA_API_BASE}/matches/${matchId}`);
  if (!response.ok) return false;
  
  const match = await response.json();
  // Check if parsed data is available (gold_t array exists and has data)
  return match.players?.some((p: any) => p.gold_t && p.gold_t.length > 0) ?? false;
}

/**
 * Check parse job status
 */
async function getJobStatus(jobId: number): Promise<{ attempts: number; priority: number } | null> {
  try {
    const response = await fetch(`${OPENDOTA_API_BASE}/request/${jobId}`);
    if (!response.ok) return null;
    const data = await response.json();
    return {
      attempts: data.attempts || 0,
      priority: data.priority || 0,
    };
  } catch {
    return null;
  }
}

/**
 * Wait for match to be parsed
 */
async function waitForParse(matchId: number, jobId: number | null, maxWaitMs: number = PARSE_MAX_WAIT_MS): Promise<boolean> {
  const startTime = Date.now();
  
  console.log(`[PARSE] Waiting for match ${matchId} to be parsed (timeout: ${maxWaitMs / 1000}s)...`);
  if (jobId) {
    console.log(`[PARSE] Job ID: ${jobId}`);
    const jobStatus = await getJobStatus(jobId);
    if (jobStatus) {
      const priorityDesc = jobStatus.priority < 0 ? "low (turbo/unranked)" : 
                          jobStatus.priority > 0 ? "high" : "normal";
      console.log(`[PARSE] Queue priority: ${jobStatus.priority} (${priorityDesc})`);
    }
  }
  
  let checkCount = 0;
  while (Date.now() - startTime < maxWaitMs) {
    // Check if match is now parsed
    const parsed = await isMatchParsed(matchId);
    if (parsed) {
      console.log(`[PARSE] ✅ Match parsed successfully!`);
      return true;
    }
    
    checkCount++;
    const elapsed = Math.round((Date.now() - startTime) / 1000);
    
    // Check job status occasionally
    if (jobId && checkCount % 4 === 0) {
      const jobStatus = await getJobStatus(jobId);
      if (jobStatus) {
        console.log(`[PARSE] Still in queue... attempts: ${jobStatus.attempts}, priority: ${jobStatus.priority} (${elapsed}s elapsed)`);
      } else {
        console.log(`[PARSE] Job may be processing... (${elapsed}s elapsed)`);
      }
    } else {
      console.log(`[PARSE] Checking... (${elapsed}s elapsed)`);
    }
    
    // Wait before next check
    await new Promise(resolve => setTimeout(resolve, PARSE_CHECK_INTERVAL_MS));
  }
  
  console.log(`[PARSE] ⚠️ Timeout waiting for parse (${maxWaitMs / 1000}s)`);
  console.log(`[PARSE] 💡 Turbo matches have low priority. Try again later or use --skip-parse for basic analysis.`);
  if (maxWaitMs < PARSE_MAX_WAIT_LONG_MS) {
    console.log(`[PARSE] 💡 Use --wait-longer to wait up to ${PARSE_MAX_WAIT_LONG_MS / 1000}s`);
  }
  return false;
}

/**
 * Ensure match is parsed before analysis
 * Returns true if match is parsed (or was successfully parsed), false otherwise
 */
async function ensureMatchParsed(matchId: number, waitLonger: boolean = false): Promise<boolean> {
  const maxWaitMs = waitLonger ? PARSE_MAX_WAIT_LONG_MS : PARSE_MAX_WAIT_MS;
  
  // First check if already parsed
  console.log(`[PARSE] Checking if match ${matchId} is already parsed...`);
  const alreadyParsed = await isMatchParsed(matchId);
  
  if (alreadyParsed) {
    console.log(`[PARSE] ✅ Match already parsed!`);
    return true;
  }
  
  console.log(`[PARSE] Match not parsed, requesting parse...`);
  const { jobId, alreadyParsed: wasAlreadyParsed } = await requestParse(matchId);
  
  if (wasAlreadyParsed) {
    // Double-check by fetching again
    const parsed = await isMatchParsed(matchId);
    if (parsed) {
      console.log(`[PARSE] ✅ Match was already parsed!`);
      return true;
    }
  }
  
  // Wait for parse to complete
  return waitForParse(matchId, jobId, maxWaitMs);
}

async function findLastMatch() {
  let latest: { matchId: number; startTime: number; playerId: number } | null = null;
  
  for (const playerId of PLAYER_IDS) {
    try {
      const matches = await fetchRecentMatches(playerId as number);
      if (matches.length > 0 && (!latest || matches[0].start_time > latest.startTime)) {
        latest = { matchId: matches[0].match_id, startTime: matches[0].start_time, playerId: playerId as number };
      }
    } catch {}
  }
  
  if (!latest) return null;
  const profile = await fetchPlayerProfile(latest.playerId as any);
  return { matchId: latest.matchId, playerName: profile.profile?.personaname || String(latest.playerId) };
}

// ============================================================================
// Context Builder - Enhanced
// ============================================================================

async function buildEnhancedContext(match: MatchDetails): Promise<string> {
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
  
  // =========================================================================
  // Section 1: Match Overview
  // =========================================================================
  let context = `
══════════════════════════════════════════════════════════════════════════════
                           MATCH ANALYSIS DATA
══════════════════════════════════════════════════════════════════════════════

MATCH OVERVIEW:
• Match ID: ${match.match_id}
• Duration: ${formatDuration(match.duration)}
• Result: ${match.radiant_win ? "RADIANT WIN" : "DIRE WIN"}
• Score: Radiant ${match.radiant_score} - ${match.dire_score} Dire
• Game Mode: ${match.game_mode === 23 ? "Turbo" : match.game_mode === 22 ? "All Pick" : `Mode ${match.game_mode}`}
• First Blood: ${match.first_blood_time ? formatTime(match.first_blood_time) : "N/A"}
• Data Quality: ${isParsed ? "FULL PARSED DATA AVAILABLE" : "BASIC DATA ONLY"}
`;

  // =========================================================================
  // Section 2: Economy Timeline (if parsed)
  // =========================================================================
  if (match.radiant_gold_adv && match.radiant_gold_adv.length > 0) {
    const duration = match.duration;
    const goldAdv = match.radiant_gold_adv;
    const xpAdv = match.radiant_xp_adv || [];
    
    // Key time points
    const min10 = Math.min(10, Math.floor(duration / 60));
    const min20 = Math.min(20, Math.floor(duration / 60));
    const min30 = Math.min(30, Math.floor(duration / 60));
    const endMin = Math.floor(duration / 60);
    
    // Find swing points (biggest changes in advantage)
    let maxSwing = { time: 0, change: 0, from: 0, to: 0 };
    for (let i = 1; i < goldAdv.length - 1; i++) {
      const change = Math.abs(goldAdv[i + 1] - goldAdv[i - 1]);
      if (change > maxSwing.change) {
        maxSwing = { time: i, change, from: goldAdv[i - 1], to: goldAdv[i + 1] };
      }
    }
    
    context += `
ECONOMY TIMELINE:
• 10 min: Gold ${goldAdv[min10] > 0 ? "+" : ""}${goldAdv[min10] || 0} Radiant${xpAdv[min10] ? `, XP ${xpAdv[min10] > 0 ? "+" : ""}${xpAdv[min10]}` : ""}
• 20 min: Gold ${goldAdv[min20] > 0 ? "+" : ""}${goldAdv[min20] || 0} Radiant${xpAdv[min20] ? `, XP ${xpAdv[min20] > 0 ? "+" : ""}${xpAdv[min20]}` : ""}
• 30 min: Gold ${goldAdv[min30] > 0 ? "+" : ""}${goldAdv[min30] || 0} Radiant${xpAdv[min30] ? `, XP ${xpAdv[min30] > 0 ? "+" : ""}${xpAdv[min30]}` : ""}
• End:    Gold ${goldAdv[endMin] > 0 ? "+" : ""}${goldAdv[endMin] || 0} Radiant
• Biggest swing: ~${maxSwing.time} min (${maxSwing.from > 0 ? "+" : ""}${maxSwing.from} → ${maxSwing.to > 0 ? "+" : ""}${maxSwing.to}, Δ${Math.round(maxSwing.change)})
`;
  }

  // =========================================================================
  // Section 3: Objectives Timeline
  // =========================================================================
  if (match.objectives && match.objectives.length > 0) {
    const towers = match.objectives.filter(o => o.type === "building_kill" && o.key?.includes("tower"));
    const roshans = match.objectives.filter(o => o.type === "CHAT_MESSAGE_ROSHAN_KILL");
    
    // Group towers by time ranges
    const earlyTowers = towers.filter(t => t.time < 15 * 60);
    const midTowers = towers.filter(t => t.time >= 15 * 60 && t.time < 30 * 60);
    const lateTowers = towers.filter(t => t.time >= 30 * 60);
    
    context += `
OBJECTIVES:
• Early towers (0-15 min): ${earlyTowers.length} destroyed`;
    
    for (const t of earlyTowers.slice(0, 3)) {
      const side = t.key?.includes("goodguys") ? "Radiant" : "Dire";
      const lane = t.key?.includes("mid") ? "Mid" : t.key?.includes("top") ? "Top" : "Bot";
      context += `\n  - ${formatTime(t.time)} ${side} ${lane} T1`;
    }
    
    context += `
• Mid game towers (15-30 min): ${midTowers.length} destroyed
• Late towers (30+ min): ${lateTowers.length} destroyed
• Roshan kills: ${roshans.length}`;
    
    for (const r of roshans) {
      context += `\n  - ${formatTime(r.time)}`;
    }
  }

  // =========================================================================
  // Section 4: Teamfights Analysis
  // =========================================================================
  if (match.teamfights && match.teamfights.length > 0) {
    context += `
\nTEAMFIGHTS (${match.teamfights.length} total):`;
    
    // Find most impactful teamfights
    const significantFights = match.teamfights
      .filter(tf => tf.deaths >= 3)
      .sort((a, b) => {
        // Calculate gold swing
        const aRadiantGold = a.players.slice(0, 5).reduce((sum, p) => sum + p.gold_delta, 0);
        const bRadiantGold = b.players.slice(0, 5).reduce((sum, p) => sum + p.gold_delta, 0);
        return Math.abs(bRadiantGold) - Math.abs(aRadiantGold);
      })
      .slice(0, 5);
    
    for (const tf of significantFights) {
      const radiantGold = tf.players.slice(0, 5).reduce((sum, p) => sum + p.gold_delta, 0);
      const direGold = tf.players.slice(5, 10).reduce((sum, p) => sum + p.gold_delta, 0);
      const radiantDeaths = tf.players.slice(0, 5).reduce((sum, p) => sum + p.deaths, 0);
      const direDeaths = tf.players.slice(5, 10).reduce((sum, p) => sum + p.deaths, 0);
      const winner = radiantGold > direGold ? "Radiant" : "Dire";
      
      context += `\n• ${formatTime(tf.start)} - ${formatTime(tf.end)}: ${tf.deaths} deaths (R:${radiantDeaths} D:${direDeaths}), ${winner} won (+${Math.abs(radiantGold - direGold)} gold swing)`;
    }
  }

  // =========================================================================
  // Section 5: Player Details
  // =========================================================================
  const formatPlayer = (p: MatchPlayer, isOurs: boolean) => {
    const hero = heroNames.get(p.hero_id) || "Unknown";
    const name = p.personaname || "Anonymous";
    const items = playerItems.get(p.player_slot) || "None";
    const marker = isOurs ? "⭐ [OUR PLAYER] " : "";
    
    let info = `${marker}${name} (${hero})
    • KDA: ${p.kills}/${p.deaths}/${p.assists} (${p.kda.toFixed(2)})
    • GPM: ${p.gold_per_min} | XPM: ${p.xp_per_min} | NW: ${p.net_worth.toLocaleString()}
    • Hero Damage: ${p.hero_damage.toLocaleString()} | Tower Damage: ${p.tower_damage.toLocaleString()}
    • CS: ${p.last_hits}/${p.denies}`;
    
    // Lane info
    if (p.lane !== null && p.lane !== undefined) {
      info += `\n    • Lane: ${LANE_NAMES[p.lane] || "Unknown"}`;
      if (p.lane_efficiency_pct) {
        info += ` (${p.lane_efficiency_pct}% efficiency)`;
      }
    }
    
    // Items
    info += `\n    • Items: ${items}`;
    
    // Key item timings (if parsed)
    if (p.purchase_log && p.purchase_log.length > 0) {
      const keyPurchases = p.purchase_log.filter(pl => KEY_ITEMS.includes(pl.key));
      if (keyPurchases.length > 0) {
        info += `\n    • Key item timings:`;
        for (const purchase of keyPurchases.slice(0, 5)) {
          info += ` ${purchase.key}@${formatTime(purchase.time)},`;
        }
        info = info.slice(0, -1); // Remove trailing comma
      }
    }
    
    // Support stats
    if ((p.obs_placed ?? 0) > 0 || (p.camps_stacked ?? 0) > 0) {
      info += `\n    • Support: ${p.obs_placed || 0} obs, ${p.sen_placed || 0} sents, ${p.camps_stacked || 0} stacks`;
    }
    
    // Benchmarks
    if (p.benchmarks) {
      const b = p.benchmarks;
      info += `\n    • Benchmarks: GPM ${b.gold_per_min ? formatBenchmark(b.gold_per_min.pct) : "N/A"}, Hero DMG ${b.hero_damage_per_min ? formatBenchmark(b.hero_damage_per_min.pct) : "N/A"}`;
    }
    
    // Teamfight participation
    if (p.teamfight_participation !== null && p.teamfight_participation !== undefined) {
      info += `\n    • Teamfight participation: ${Math.round(p.teamfight_participation * 100)}%`;
    }
    
    // Laning phase CS (if parsed)
    if (p.lh_t && p.lh_t.length >= 10) {
      const cs10 = p.lh_t[10] || 0;
      const dn10 = p.dn_t?.[10] || 0;
      info += `\n    • 10 min CS: ${cs10}/${dn10}`;
    }
    
    return info;
  };
  
  const radiant = match.players.filter(p => p.isRadiant);
  const dire = match.players.filter(p => !p.isRadiant);
  
  context += `
\n══════════════════════════════════════════════════════════════════════════════
                              RADIANT TEAM ${match.radiant_win ? "(WINNERS)" : "(LOSERS)"}
══════════════════════════════════════════════════════════════════════════════
${radiant.map(p => formatPlayer(p, playerIdsSet.has(p.account_id as number))).join("\n\n")}

══════════════════════════════════════════════════════════════════════════════
                              DIRE TEAM ${!match.radiant_win ? "(WINNERS)" : "(LOSERS)"}
══════════════════════════════════════════════════════════════════════════════
${dire.map(p => formatPlayer(p, playerIdsSet.has(p.account_id as number))).join("\n\n")}

══════════════════════════════════════════════════════════════════════════════
OUR PLAYERS: ${ourPlayers.map(p => `${p.personaname || "Anon"} (${heroNames.get(p.hero_id)})`).join(", ") || "None identified"}
══════════════════════════════════════════════════════════════════════════════
`;

  return context;
}

// ============================================================================
// LLM Analysis - Enhanced Prompt
// ============================================================================

const SYSTEM_PROMPT = `Ты — токсичный но полезный тренер по Dota 2.
Фокус на игроках [OUR PLAYER] — их разбираем детально.

СТРУКТУРА (коротко и по делу):

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
• МАКСИМУМ 300 слов — без воды`;

async function analyzeWithLLM(context: string): Promise<string> {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) throw new Error("OPENAI_API_KEY not configured");
  
  const openai = new OpenAI({ apiKey });
  const isGpt5 = OPENAI_MODEL.startsWith("gpt-5");
  
  console.log(`[LLM] Using model: ${OPENAI_MODEL}`);
  
  const response = await openai.chat.completions.create({
    model: OPENAI_MODEL,
    messages: [
      { role: "system", content: SYSTEM_PROMPT },
      { role: "user", content: context },
    ],
    ...(isGpt5 ? { max_completion_tokens: 1500 } : { max_tokens: 1500 }),
  });
  
  return response.choices[0]?.message?.content || "Не удалось получить анализ";
}

// ============================================================================
// Main
// ============================================================================

async function main() {
  const contextOnly = process.argv.includes("--context-only");
  
  if (!contextOnly) {
    const apiKey = process.env.OPENAI_API_KEY;
    if (!apiKey || apiKey === "your_openai_api_key_here") {
      console.error("Set OPENAI_API_KEY! (or use --context-only to see data)");
      process.exit(1);
    }
  }
  
  // Check for match_id argument (first non-flag argument)
  const matchIdArg = process.argv.find(arg => !arg.startsWith("-") && arg !== process.argv[0] && arg !== process.argv[1]);
  let matchId: number;
  
  if (matchIdArg) {
    matchId = parseInt(matchIdArg, 10);
    if (isNaN(matchId)) {
      console.error("Invalid match ID");
      process.exit(1);
    }
    console.log(`Using provided match ID: ${matchId}`);
  } else {
    console.log("Finding last match...");
    const lastMatch = await findLastMatch();
    if (!lastMatch) {
      console.error("No match found");
      process.exit(1);
    }
    matchId = lastMatch.matchId;
    console.log(`Found match ${matchId}`);
  }
  
  // Optional: try to trigger parse (but don't wait)
  const triggerParse = process.argv.includes("--trigger-parse");
  if (triggerParse) {
    console.log("[PARSE] Triggering parse request (not waiting)...");
    await requestParse(matchId);
  }
  
  console.log("\nFetching match details...");
  const matchDetails = await fetchMatchDetails(matchId);
  
  const isParsed = matchDetails.players.some(p => p.gold_t && p.gold_t.length > 0);
  console.log(`Match parsed: ${isParsed}`);
  console.log(`Duration: ${formatDuration(matchDetails.duration)}`);
  console.log(`Score: Radiant ${matchDetails.radiant_score} - ${matchDetails.dire_score} Dire`);
  
  console.log("\nBuilding enhanced context...");
  const context = await buildEnhancedContext(matchDetails);
  
  // Print context for debugging
  console.log("\n" + "=".repeat(80));
  console.log("CONTEXT FOR LLM:");
  console.log("=".repeat(80));
  console.log(context);
  console.log("=".repeat(80) + "\n");
  
  if (contextOnly) {
    console.log("💡 --context-only mode: Skipping LLM analysis");
    console.log(`\nContext length: ${context.length} chars`);
    return;
  }
  
  console.log("Calling LLM for analysis...");
  const analysis = await analyzeWithLLM(context);
  
  const matchUrl = `https://www.opendota.com/matches/${matchId}`;
  const header = `🔬 <b>Анализ матча</b> <a href="${matchUrl}">#${matchId}</a>
⏱ Длительность: ${formatDuration(matchDetails.duration)}
🎮 Результат: ${matchDetails.radiant_win ? "Radiant" : "Dire"} победил (${matchDetails.radiant_score}:${matchDetails.dire_score})
${isParsed ? "📊 Полный разбор (parsed data)" : "📊 Базовый анализ"}

`;

  // Footer for non-parsed matches
  const footer = !isParsed ? `

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
📌 <b>Это базовый анализ</b> — без детальных таймингов предметов, тимфайтов и лейнинга.

Для полного разбора:
1. Открой <a href="${matchUrl}">матч на OpenDota</a>
2. Нажми кнопку "Request Parse"
3. Подожди 1-2 минуты
4. Запроси анализ снова — получишь полный разбор с таймингами!` : "";

  const message = header + analysis + footer;
  
  console.log("\n" + "=".repeat(80));
  console.log("FINAL MESSAGE:");
  console.log("=".repeat(80));
  console.log(message);
  console.log("=".repeat(80));
  
  // Ask if should send to Telegram
  const sendToTg = process.argv.includes("--send");
  
  if (sendToTg) {
    const bot = new Bot(process.env.TELEGRAM_BOT_TOKEN!);
    const chatId = process.env.TELEGRAM_CHAT_ID!;
    
    console.log(`\nSending to chat ${chatId}...`);
    
    // Split message if too long (Telegram limit is 4096)
    if (message.length > 4000) {
      const parts = [];
      let current = header;
      const lines = analysis.split("\n");
      
      for (const line of lines) {
        if ((current + line + "\n").length > 3900) {
          parts.push(current);
          current = "";
        }
        current += line + "\n";
      }
      if (current.trim()) parts.push(current);
      
      for (let i = 0; i < parts.length; i++) {
        const part = i === 0 ? parts[i] : `(продолжение ${i + 1}/${parts.length})\n\n${parts[i]}`;
        await bot.api.sendMessage(chatId, part, {
          parse_mode: "HTML",
          link_preview_options: { is_disabled: true },
        });
        console.log(`Sent part ${i + 1}/${parts.length}`);
      }
    } else {
      await bot.api.sendMessage(chatId, message, {
        parse_mode: "HTML",
        link_preview_options: { is_disabled: true },
      });
    }
    
    console.log("✅ Sent to Telegram!");
  } else {
    console.log("\n💡 Available flags:");
    console.log("   --send          Send to Telegram");
    console.log("   --trigger-parse Trigger parse request on OpenDota");
    console.log("   --context-only  Show context without LLM");
  }
}

main().catch(console.error);
