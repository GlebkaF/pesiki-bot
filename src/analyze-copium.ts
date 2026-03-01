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

const FETCH_TIMEOUT_MS = 30000; // 30s for OpenDota
const OPENAI_TIMEOUT_MS = 120000; // 2 min for LLM

async function fetchWithTimeout(url: string, timeoutMs: number = FETCH_TIMEOUT_MS): Promise<Response> {
  const fetchFn = await getAppFetch();
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetchFn(url, { signal: controller.signal });
    return response;
  } finally {
    clearTimeout(timeout);
  }
}

async function fetchMatchDetails(matchId: number): Promise<MatchDetails> {
  const url = `${OPENDOTA_API_BASE}/matches/${matchId}`;
  let lastError: Error | null = null;
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const response = await fetchWithTimeout(url);
      if (!response.ok) {
        throw new Error(`OpenDota API error: ${response.status}`);
      }
      return response.json();
    } catch (err) {
      lastError = err instanceof Error ? err : new Error(String(err));
      if (attempt < 2) {
        console.warn(`[COPIUM] fetchMatchDetails attempt ${attempt + 1} failed, retrying...`, lastError.message);
        await new Promise((r) => setTimeout(r, 3000));
      }
    }
  }
  throw lastError || new Error("Failed to fetch match details");
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
// Context Builder (BIASED VERSION)
// ============================================================================

async function buildBiasedContext(match: MatchDetails): Promise<string> {
  const playerIdsSet = new Set<number>(PLAYER_IDS as readonly number[]);
  const isParsed = match.players.some(p => p.gold_t && p.gold_t.length > 0);
  
  // Determine our team
  const ourPlayers = match.players.filter(p => p.account_id && playerIdsSet.has(p.account_id));
  const weAreRadiant = ourPlayers.length > 0 ? ourPlayers[0].isRadiant : true;
  const weWon = weAreRadiant ? match.radiant_win : !match.radiant_win;
  
  // Categorize all players
  const ourTeamPlayers = match.players.filter(p => p.isRadiant === weAreRadiant);
  const enemyPlayers = match.players.filter(p => p.isRadiant !== weAreRadiant);
  const randomAllies = ourTeamPlayers.filter(p => !p.account_id || !playerIdsSet.has(p.account_id));
  
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
MATCH: ${match.match_id} | Duration: ${formatDuration(match.duration)}
RESULT: ${weWon ? "🏆 WE WON" : "💀 WE LOST"}
Score: ${weAreRadiant ? "Our team" : "Enemy"} ${match.radiant_score} - ${match.dire_score} ${weAreRadiant ? "Enemy" : "Our team"}
Mode: ${match.game_mode === 23 ? "Turbo" : match.game_mode === 22 ? "All Pick" : `Mode ${match.game_mode}`}
Data: ${isParsed ? "PARSED (full data)" : "BASIC"}
`;

  // Economy timeline (if parsed)
  if (match.radiant_gold_adv && match.radiant_gold_adv.length > 0) {
    const goldAdv = match.radiant_gold_adv;
    const min10 = Math.min(10, goldAdv.length - 1);
    const min20 = Math.min(20, goldAdv.length - 1);
    const endMin = goldAdv.length - 1;
    
    // Convert to "our team" perspective
    const mult = weAreRadiant ? 1 : -1;
    context += `
ECONOMY (our team perspective):
• 10 min: ${(goldAdv[min10] * mult) > 0 ? "+" : ""}${goldAdv[min10] * mult} gold
• 20 min: ${(goldAdv[min20] * mult) > 0 ? "+" : ""}${goldAdv[min20] * mult} gold
• End: ${(goldAdv[endMin] * mult) > 0 ? "+" : ""}${goldAdv[endMin] * mult} gold
`;
  }

  // Player formatter with role marker
  const formatPlayer = (p: MatchPlayer, role: "our" | "random_ally" | "enemy") => {
    const hero = heroNames.get(p.hero_id) || "Unknown";
    const name = p.personaname || "Anonymous";
    const items = playerItems.get(p.player_slot) || "None";
    const rank = getRankName(p.rank_tier);
    
    let marker = "";
    if (role === "our") marker = "⭐ [OUR PLAYER - PRAISE THEM] ";
    else if (role === "random_ally") marker = "🤷 [RANDOM ALLY - FIND THEIR MISTAKES] ";
    else marker = "⚔️ [ENEMY - ACKNOWLEDGE IF STRONG] ";
    
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
  
  // Find worst random ally stats for blame
  let worstRandomStats = "";
  if (randomAllies.length > 0) {
    const sortedByKDA = [...randomAllies].sort((a, b) => a.kda - b.kda);
    const worst = sortedByKDA[0];
    const worstHero = heroNames.get(worst.hero_id) || "Unknown";
    worstRandomStats = `
WORST RANDOM ALLY: ${worst.personaname || "Anonymous"} (${worstHero})
• KDA: ${worst.kills}/${worst.deaths}/${worst.assists} = ${worst.kda.toFixed(2)}
• Deaths: ${worst.deaths} (potential feeding)
`;
  }
  
  // Find strongest enemy for excuse
  const sortedEnemies = [...enemyPlayers].sort((a, b) => b.hero_damage - a.hero_damage);
  const strongestEnemy = sortedEnemies[0];
  const strongestHero = heroNames.get(strongestEnemy.hero_id) || "Unknown";
  const strongestEnemyStats = `
STRONGEST ENEMY (excuse material): ${strongestEnemy.personaname || "Anonymous"} (${strongestHero})
• KDA: ${strongestEnemy.kills}/${strongestEnemy.deaths}/${strongestEnemy.assists}
• Hero Damage: ${strongestEnemy.hero_damage.toLocaleString()} (${strongestEnemy.benchmarks?.hero_damage_per_min ? formatBenchmark(strongestEnemy.benchmarks.hero_damage_per_min.pct) : "N/A"})
• Net Worth: ${strongestEnemy.net_worth.toLocaleString()}
`;

  context += `
${worstRandomStats}
${strongestEnemyStats}

═══════════════════════════════════════════════════════════════════
OUR STACK (defend and praise these players!):
═══════════════════════════════════════════════════════════════════
${ourPlayers.map(p => formatPlayer(p, "our")).join("\n\n")}

═══════════════════════════════════════════════════════════════════
RANDOM ALLIES (find their mistakes, blame them if we lost):
═══════════════════════════════════════════════════════════════════
${randomAllies.length > 0 ? randomAllies.map(p => formatPlayer(p, "random_ally")).join("\n\n") : "No random allies - full stack!"}

═══════════════════════════════════════════════════════════════════
ENEMIES (acknowledge strength as excuse for our loss):
═══════════════════════════════════════════════════════════════════
${enemyPlayers.map(p => formatPlayer(p, "enemy")).join("\n\n")}
`;

  return context;
}

// ============================================================================
// LLM Analysis (BIASED VERSION - "Copium Mode")
// ============================================================================

const COPIUM_SYSTEM_PROMPT = `Ты — адвокат и фанат нашего стака в Dota 2. Твоя задача — ВСЕГДА защищать наших игроков [OUR PLAYER] и находить оправдания.

ТВОИ ПРИНЦИПЫ:
1. Наши игроки [OUR PLAYER] — ВСЕГДА молодцы, даже если статы средние
2. Рандомные союзники [RANDOM ALLY] — виноваты в проблемах команды
3. Сильные враги [ENEMY] — это оправдание, если мы проиграли

ЛИЧНОСТИ (выбери ОДНУ случайно на каждый ответ и пиши в ее стиле, не называй ее вслух):
1) Тренер-ветеран — сухо, дисциплина, по делу
2) Токсичный фанат стака — хайп, подколы, преданность
3) Мемный кастер — мемы, гипербола, уличный сленг
4) Аналитик-зануда — цифры, детали, разбор по полочкам
5) Капитан-стратег — макро, коллы, карта
6) Саркастичный философ — ирония, "все тлен", но по делу
7) Бустер-психолог — мотивация, уверенность, поддержка
8) Лейнер-снайпер — лайн, трейды, денай, матчапы
9) Тайминговый маньяк — пики силы, предметы, тайминги
10) Хаос-шутник — абсурд, дерзкий юмор, но в рамках фактов

СТРУКТУРА ОТВЕТА:

KDA TABLE — ЭТО САМЫЙ ПЕРВЫЙ БЛОК:
KDA TABLE:
RADIANT:
• Name (Hero) K/D/A
DIRE:
• Name (Hero) K/D/A

🎯 ВЕРДИКТ
${`• Если ВЫИГРАЛИ: "Наш стак вытащил игру несмотря на [найди что-то негативное о рандомах]"`}
${`• Если ПРОИГРАЛИ: "Невозможно было выиграть из-за [рандомы/сильные враги/пик/везение]"`}

⭐ НАШИ ГЕРОИ (хвали каждого [OUR PLAYER])
Для каждого нашего:
• Что делал хорошо (найди позитив даже в плохих статах!)
• Если KDA низкий — "играл на команду", "создавал пространство", "жертвовал собой"
• Если KDA высокий — "машина", "затащил", "на нём держалась игра"

🤷 ПРОБЛЕМЫ РАНДОМОВ (критикуй [RANDOM ALLY])
${`• Найди косяки: фид, плохие тайминги, не там стоял, плохой пик`}
${`• Если рандомов нет — пропусти этот блок`}

⚔️ ВРАГИ
${`• Если проиграли: признай силу врагов как оправдание ("против ТАКОГО Invoker'а любой бы слил")`}
${`• Если выиграли: "враги были неплохи, но наш стак сильнее"`}

💊 COPIUM-ИТОГ
Токсичное, но смешное оправдание почему всё было не так уж плохо (или почему победа — наша заслуга)

ПРАВИЛА:
• БЕЗ Markdown — только plain text + эмодзи 🔥 ✅ ⚠️ 💀 🤡 💊
• Русский со сленгом (го, затащить, сфидить, рандомы, стак)
• ВСЕГДА на стороне [OUR PLAYER] — они не могут быть виноваты
• Каждый ответ использует 2-3 разных угла: пик/драфт, лайнинг, тимфайты, тайминги предметов, карта/вижн, командные решения
• Не повторяй одинаковые фразы и клише между ответами — перефразируй и меняй формулировки
• Допускается лёгкая импровизация и перестановка подпунктов, но основные блоки должны оставаться
• Запрет клише и штампов (НЕ ИСПОЛЬЗУЙ):
  - Конструкцию "не X, а Y"
  - "искал окна"
  - "играл от ..."
  - "не смог реализовать потенциал"
  - "просел по ..."
  - "команда не доиграла"
  - "не дожал"
  - "отдали ..."
  - "не хватило дисциплины"
  - "ключевые ошибки"
  - "решающий момент"
  - "повезло/не повезло"
• Юмор и самоирония приветствуются
• Пиши компактно, без длинных вступлений
• МАКСИМУМ 260 слов`;

async function analyzeWithCopium(context: string): Promise<string> {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    throw new Error("OPENAI_API_KEY not configured");
  }
  const baseURL = process.env.OPENAI_BASE_URL;
  const fetch = await getOpenAIFetch();
  const openai = new OpenAI({ apiKey, baseURL, timeout: OPENAI_TIMEOUT_MS, fetch });
  const isGpt5 = OPENAI_MODEL.startsWith("gpt-5");
  
  console.log(`[COPIUM] Using model: ${OPENAI_MODEL}`);
  
  const response = await openai.chat.completions.create({
    model: OPENAI_MODEL,
    messages: [
      { role: "system", content: COPIUM_SYSTEM_PROMPT },
      { role: "user", content: context },
    ],
    ...(isGpt5 ? { max_completion_tokens: 1800 } : { max_tokens: 1800 }),
    ...(isGpt5 ? {} : { temperature: 0.8 }),
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
    console.log(`[COPIUM] Cache invalidated: match ${matchId} is now parsed`);
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
 * Core analyze function - analyzes a specific match by ID (COPIUM VERSION)
 * Always defends our stack and finds excuses!
 */
export async function analyzeMatchCopium(matchId: number): Promise<string> {
  console.log(`[COPIUM] Analyzing match ${matchId} with bias...`);
  
  // Fetch detailed match data first to check parsed status
  const matchDetails = await fetchMatchDetails(matchId);
  console.log(`[COPIUM] Match duration: ${formatDuration(matchDetails.duration)}`);
  
  // Check if match is parsed
  const isParsed = matchDetails.players.some(p => p.gold_t && p.gold_t.length > 0);
  console.log(`[COPIUM] Match parsed: ${isParsed}`);
  
  // Check cache (with parsed status to handle re-parsing)
  const cachedResult = getCachedAnalysis(matchId, isParsed);
  const playerIdsSet = new Set<number>(PLAYER_IDS as readonly number[]);
  const ourPlayers = matchDetails.players.filter(p => p.account_id && playerIdsSet.has(p.account_id));
  const weAreRadiant = ourPlayers.length > 0 ? ourPlayers[0].isRadiant : true;
  const weWon = weAreRadiant ? matchDetails.radiant_win : !matchDetails.radiant_win;
  if (cachedResult) {
    console.log(`[COPIUM] Returning cached analysis for match ${matchId}`);
    return maybeAppendOutcomeCanonStrophe(cachedResult + "\n\n<i>📦 Из кэша</i>", weWon);
  }
  
  // Build biased context for LLM
  const context = await buildBiasedContext(matchDetails);
  console.log("[COPIUM] Biased context built, calling LLM...");
  
  // Analyze with LLM (with retry for transient timeouts)
  let analysis: string;
  try {
    analysis = await analyzeWithCopium(context);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    const causeMsg = err instanceof Error && err.cause instanceof Error ? err.cause.message : "";
    const isTimeout = /ETIMEDOUT|terminated|timeout|abort/i.test(msg + causeMsg);
    if (isTimeout) {
      console.warn("[COPIUM] LLM timeout, retrying once...");
      analysis = await analyzeWithCopium(context);
    } else {
      throw err;
    }
  }
  
  // Format response (escape AI output to prevent Telegram HTML parse errors on < > &)
  const matchUrl = `https://www.opendota.com/matches/${matchId}`;
  const resultEmoji = weWon ? "🏆" : "💀";
  const resultText = weWon ? "ПОБЕДА" : "ПОРАЖЕНИЕ";
  
  const header = `💊 <b>COPIUM-анализ матча</b> <a href="${matchUrl}">#${matchId}</a>
${resultEmoji} <b>${resultText}</b>
⏱ Длительность: ${formatDuration(matchDetails.duration)}
${isParsed ? "📊 Полный" : "📊 Базовый"}

`;

  const fullAnalysis = header + escapeHtml(analysis);
  
  // Cache the result with parsed status
  cacheAnalysis(matchId, fullAnalysis, isParsed);
  console.log(`[COPIUM] Analysis cached for match ${matchId} (parsed: ${isParsed})`);
  
  return maybeAppendOutcomeCanonStrophe(fullAnalysis, weWon);
}

/**
 * Analyzes the last match of any party member (COPIUM VERSION)
 */
export async function analyzeLastMatchCopium(): Promise<string> {
  console.log("[COPIUM] Finding last party match...");
  
  const lastMatch = await findLastPartyMatch();
  if (!lastMatch) {
    return "❌ Не удалось найти последний матч";
  }
  
  console.log(`[COPIUM] Found match ${lastMatch.matchId} for player ${lastMatch.playerName}`);
  
  return analyzeMatchCopium(lastMatch.matchId);
}

/**
 * For testing - prints raw biased context
 */
export async function getCopiumContext(): Promise<string> {
  const lastMatch = await findLastPartyMatch();
  if (!lastMatch) {
    return "No match found";
  }
  
  const matchDetails = await fetchMatchDetails(lastMatch.matchId);
  return buildBiasedContext(matchDetails);
}
