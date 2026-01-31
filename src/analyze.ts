import OpenAI from "openai";
import { PLAYER_IDS } from "./config.js";
import { fetchRecentMatches, fetchPlayerProfile } from "./opendota.js";
import { getHeroName } from "./heroes.js";
import { getItemNames } from "./items.js";

const OPENDOTA_API_BASE = "https://api.opendota.com/api";

// ============================================================================
// CONFIGURATION
// ============================================================================

// OpenAI model to use (gpt-5.2 by default for best quality)
const OPENAI_MODEL = process.env.OPENAI_MODEL || "gpt-5.2";

// Cache for analysis results (match_id -> analysis text)
const analysisCache = new Map<number, { analysis: string; timestamp: number }>();
const CACHE_TTL_MS = 24 * 60 * 60 * 1000; // 24 hours

// Lane names mapping
const LANE_NAMES: Record<number, string> = {
  1: "Safelane",
  2: "Mid",
  3: "Offlane",
  4: "Jungle",
};

/**
 * Match details from OpenDota API
 */
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
  // Parsed match data (only available if match was parsed)
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
  players: MatchPlayer[];
}

/**
 * Fetches detailed match data from OpenDota
 */
async function fetchMatchDetails(matchId: number): Promise<MatchDetails> {
  const url = `${OPENDOTA_API_BASE}/matches/${matchId}`;
  const response = await fetch(url);
  
  if (!response.ok) {
    throw new Error(`OpenDota API error: ${response.status}`);
  }
  
  return response.json();
}

/**
 * Formats duration as MM:SS
 */
function formatDuration(seconds: number): string {
  const mins = Math.floor(seconds / 60);
  const secs = seconds % 60;
  return `${mins}:${secs.toString().padStart(2, "0")}`;
}

/**
 * Formats benchmark percentile
 */
function formatBenchmark(pct: number): string {
  const percent = Math.round(pct * 100);
  if (percent >= 80) return `${percent}% 🔥`;
  if (percent >= 60) return `${percent}% ✅`;
  if (percent >= 40) return `${percent}%`;
  if (percent >= 20) return `${percent}% ⚠️`;
  return `${percent}% 💀`;
}

/**
 * Finds the last match where any of our players participated
 */
async function findLastPartyMatch(): Promise<{
  matchId: number;
  playerId: number;
  playerName: string;
} | null> {
  // Check recent matches for each player and find the most recent one
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
  
  // Get player name
  const profile = await fetchPlayerProfile(latestMatch.playerId as (typeof PLAYER_IDS)[number]);
  const playerName = profile.profile?.personaname || String(latestMatch.playerId);
  
  return {
    matchId: latestMatch.matchId,
    playerId: latestMatch.playerId,
    playerName,
  };
}

/**
 * Builds context for LLM analysis
 */
async function buildAnalysisContext(match: MatchDetails): Promise<string> {
  // Find our players in the match
  const playerIdsSet = new Set<number>(PLAYER_IDS as readonly number[]);
  const ourPlayers = match.players.filter(p => 
    p.account_id && playerIdsSet.has(p.account_id)
  );
  
  // Get hero names for all players
  const heroNames = new Map<number, string>();
  for (const player of match.players) {
    if (!heroNames.has(player.hero_id)) {
      heroNames.set(player.hero_id, await getHeroName(player.hero_id));
    }
  }
  
  // Get item names for all players
  const playerItems = new Map<number, string>();
  for (const player of match.players) {
    const itemIds = [player.item_0, player.item_1, player.item_2, player.item_3, player.item_4, player.item_5]
      .filter(i => i > 0);
    const itemNames = await getItemNames(itemIds);
    playerItems.set(player.player_slot, itemNames.filter(n => n).join(", "));
  }
  
  const radiantPlayers = match.players.filter(p => p.isRadiant);
  const direPlayers = match.players.filter(p => !p.isRadiant);
  
  const formatPlayer = (p: MatchPlayer, isOurs: boolean) => {
    const hero = heroNames.get(p.hero_id) || "Unknown";
    const name = p.personaname || "Anonymous";
    const items = playerItems.get(p.player_slot) || "None";
    
    // Lane info (only if parsed)
    let laneInfo = "";
    if (p.lane !== null && p.lane !== undefined) {
      const laneName = LANE_NAMES[p.lane] || `Lane ${p.lane}`;
      laneInfo = `\n    Lane: ${laneName}`;
      if (p.lane_efficiency_pct !== null && p.lane_efficiency_pct !== undefined) {
        laneInfo += ` (${p.lane_efficiency_pct}% efficiency)`;
      }
    }
    
    // Parsed stats (wards, stacks, stuns, teamfights)
    let parsedStats = "";
    if (p.obs_placed !== null || p.stuns !== null || p.teamfight_participation !== null) {
      const parts: string[] = [];
      if (p.obs_placed !== null && p.obs_placed !== undefined) {
        parts.push(`Wards: ${p.obs_placed} obs / ${p.sen_placed ?? 0} sent`);
      }
      if (p.camps_stacked !== null && p.camps_stacked !== undefined && p.camps_stacked > 0) {
        parts.push(`Stacks: ${p.camps_stacked}`);
      }
      if (p.stuns !== null && p.stuns !== undefined) {
        parts.push(`Stuns: ${p.stuns.toFixed(1)}s`);
      }
      if (p.teamfight_participation !== null && p.teamfight_participation !== undefined) {
        parts.push(`Teamfight: ${Math.round(p.teamfight_participation * 100)}%`);
      }
      if (p.actions_per_min !== null && p.actions_per_min !== undefined) {
        parts.push(`APM: ${p.actions_per_min}`);
      }
      if (parts.length > 0) {
        parsedStats = `\n    ${parts.join(" | ")}`;
      }
    }
    
    let benchmarkInfo = "";
    if (p.benchmarks) {
      const b = p.benchmarks;
      benchmarkInfo = `
    Benchmarks (percentile vs other ${hero} players):
    - GPM: ${b.gold_per_min ? formatBenchmark(b.gold_per_min.pct) : "N/A"}
    - XPM: ${b.xp_per_min ? formatBenchmark(b.xp_per_min.pct) : "N/A"}
    - Hero Damage/min: ${b.hero_damage_per_min ? formatBenchmark(b.hero_damage_per_min.pct) : "N/A"}
    - Last Hits/min: ${b.last_hits_per_min ? formatBenchmark(b.last_hits_per_min.pct) : "N/A"}`;
    }
    
    return `  ${isOurs ? "⭐ " : ""}${name} (${hero})${isOurs ? " [OUR PLAYER]" : ""}
    KDA: ${p.kills}/${p.deaths}/${p.assists} (${p.kda.toFixed(2)})
    GPM: ${p.gold_per_min} | XPM: ${p.xp_per_min} | Level: ${p.level}
    Net Worth: ${p.net_worth.toLocaleString()} gold
    Hero Damage: ${p.hero_damage.toLocaleString()} | Tower Damage: ${p.tower_damage.toLocaleString()}
    Last Hits: ${p.last_hits} | Denies: ${p.denies}
    Items: ${items}${laneInfo}${parsedStats}${benchmarkInfo}`;
  };
  
  const context = `
MATCH ANALYSIS DATA
==================
Match ID: ${match.match_id}
Duration: ${formatDuration(match.duration)}
Result: ${match.radiant_win ? "Radiant Victory" : "Dire Victory"}
Game Mode: ${match.game_mode === 23 ? "Turbo" : match.game_mode === 22 ? "All Pick" : `Mode ${match.game_mode}`}

RADIANT TEAM ${match.radiant_win ? "(WINNERS)" : "(LOSERS)"}:
${radiantPlayers.map(p => formatPlayer(p, playerIdsSet.has(p.account_id as number))).join("\n\n")}

DIRE TEAM ${!match.radiant_win ? "(WINNERS)" : "(LOSERS)"}:
${direPlayers.map(p => formatPlayer(p, playerIdsSet.has(p.account_id as number))).join("\n\n")}

OUR PLAYERS IN THIS MATCH: ${ourPlayers.length > 0 ? ourPlayers.map(p => p.personaname || "Anonymous").join(", ") : "None identified (private profiles)"}
`;

  return context;
}

/**
 * Analyzes match using OpenAI
 */
async function analyzeWithLLM(context: string): Promise<string> {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    throw new Error("OPENAI_API_KEY not configured");
  }
  
  const openai = new OpenAI({ apiKey });
  
  const systemPrompt = `Ты — токсичный но полезный тренер по Dota 2 для группы друзей-дегенератов.
Твой стиль: прямой, жёсткий, с чёрным юмором, НО с конкретными полезными советами.

ВАЖНО: Фокус на игроках отмеченных [OUR PLAYER] — это наши чуваки, их надо разобрать по косточкам.

Структура ответа:

🎯 ВЕРДИКТ
1 предложение — почему продули/выиграли

👤 РАЗБОР ИГРОКОВ
Для каждого [OUR PLAYER]:
• Имя и герой
• Что делал хорошо (если есть)
• Где накосячил (цифры, benchmarks)  
• Один конкретный совет

🤝 СИНЕРГИЯ ПАТИ
Как взаимодействовали, что можно было сделать вместе

💡 ГЛАВНЫЙ СОВЕТ
Один ключевой совет для команды

КРИТИЧЕСКИ ВАЖНО — ФОРМАТИРОВАНИЕ:
- НЕ ИСПОЛЬЗУЙ Markdown (никаких ** или __ для выделения)
- Используй ТОЛЬКО plain text без форматирования
- Можно использовать эмодзи: 🔥 ✅ ⚠️ 💀
- Разделяй секции пустыми строками
- Используй • для списков

Правила:
- Цифры из benchmarks (80%+ = топ 🔥, <30% = позор 💀)
- Макс 250 слов
- Конкретные советы: "купи BKB раньше" вместо "улучши итембилд"
- Пиши на русском со сленгом (го, затащить, сфидить)`;

  console.log(`[ANALYZE] Using model: ${OPENAI_MODEL}`);
  
  // GPT-5 models use max_completion_tokens instead of max_tokens
  const isGpt5 = OPENAI_MODEL.startsWith("gpt-5");
  
  const response = await openai.chat.completions.create({
    model: OPENAI_MODEL,
    messages: [
      { role: "system", content: systemPrompt },
      { role: "user", content: context },
    ],
    ...(isGpt5 ? { max_completion_tokens: 1500 } : { max_tokens: 1500 }),
    ...(isGpt5 ? {} : { temperature: 0.7 }), // GPT-5 doesn't support custom temperature
  });
  
  return response.choices[0]?.message?.content || "Не удалось получить анализ";
}

/**
 * Checks if cached analysis is still valid
 */
function getCachedAnalysis(matchId: number): string | null {
  const cached = analysisCache.get(matchId);
  if (!cached) return null;
  
  if (Date.now() - cached.timestamp > CACHE_TTL_MS) {
    analysisCache.delete(matchId);
    return null;
  }
  
  return cached.analysis;
}

/**
 * Stores analysis in cache
 */
function cacheAnalysis(matchId: number, analysis: string): void {
  analysisCache.set(matchId, {
    analysis,
    timestamp: Date.now(),
  });
}

/**
 * Main analyze function - analyzes the last match of any party member
 */
export async function analyzeLastMatch(): Promise<string> {
  console.log("[ANALYZE] Finding last party match...");
  
  // Find the last match
  const lastMatch = await findLastPartyMatch();
  if (!lastMatch) {
    return "❌ Не удалось найти последний матч";
  }
  
  console.log(`[ANALYZE] Found match ${lastMatch.matchId} for player ${lastMatch.playerName}`);
  
  // Check cache first
  const cachedResult = getCachedAnalysis(lastMatch.matchId);
  if (cachedResult) {
    console.log(`[ANALYZE] Returning cached analysis for match ${lastMatch.matchId}`);
    return cachedResult + "\n\n<i>📦 Из кэша</i>";
  }
  
  // Fetch detailed match data
  const matchDetails = await fetchMatchDetails(lastMatch.matchId);
  console.log(`[ANALYZE] Match duration: ${formatDuration(matchDetails.duration)}`);
  
  // Check if match is parsed (has lane data)
  const isParsed = matchDetails.players.some(p => p.lane !== null && p.lane !== undefined);
  console.log(`[ANALYZE] Match parsed: ${isParsed}`);
  
  // Build context for LLM
  const context = await buildAnalysisContext(matchDetails);
  console.log("[ANALYZE] Context built, calling LLM...");
  
  // Analyze with LLM
  const analysis = await analyzeWithLLM(context);
  
  // Format response with link to OpenDota
  const matchUrl = `https://www.opendota.com/matches/${lastMatch.matchId}`;
  const header = `🔬 <b>Анализ матча</b> <a href="${matchUrl}">#${lastMatch.matchId}</a>
⏱ Длительность: ${formatDuration(matchDetails.duration)}
🎮 Результат: ${matchDetails.radiant_win ? "Radiant" : "Dire"} победил
${isParsed ? "📊 Детальная статистика доступна" : ""}
`;

  const fullAnalysis = header + analysis;
  
  // Cache the result
  cacheAnalysis(lastMatch.matchId, fullAnalysis);
  console.log(`[ANALYZE] Analysis cached for match ${lastMatch.matchId}`);
  
  return fullAnalysis;
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
