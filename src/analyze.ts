import { PLAYER_IDS } from "./config.js";
import {
  type MatchDetails,
  type MatchPlayer,
  OPENAI_MODEL,
  formatDuration,
  formatTime,
  formatBenchmark,
  resolveHeroNames,
  resolvePlayerItems,
  formatPlayerContext,
  fetchMatchDetails,
  findLastPartyMatch,
  createAnalysisCache,
  callLLM,
  isMatchParsed,
  getOurPlayers,
  formatNonParsedFooter,
} from "./analyze-core.js";

const LOG_PREFIX = "ANALYZE";
const analysisCache = createAnalysisCache(LOG_PREFIX);

// ============================================================================
// Context Builder (neutral analysis)
// ============================================================================

async function buildAnalysisContext(match: MatchDetails): Promise<string> {
  const playerIdsSet = new Set<number>(PLAYER_IDS as readonly number[]);
  const ourPlayers = getOurPlayers(match);
  const isParsed = isMatchParsed(match);

  const heroNames = await resolveHeroNames(match.players);
  const playerItems = await resolvePlayerItems(match.players);

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
  const formatPlayer = (p: MatchPlayer) => {
    const isOurs = p.account_id !== undefined && playerIdsSet.has(p.account_id);
    const marker = isOurs ? "⭐ [OUR PLAYER] " : "";
    return formatPlayerContext(p, heroNames, playerItems, marker);
  };

  const radiant = match.players.filter(p => p.isRadiant);
  const dire = match.players.filter(p => !p.isRadiant);

  context += `
\nRADIANT ${match.radiant_win ? "(WIN)" : "(LOSE)"}:
${radiant.map(formatPlayer).join("\n\n")}

DIRE ${!match.radiant_win ? "(WIN)" : "(LOSE)"}:
${dire.map(formatPlayer).join("\n\n")}

OUR PLAYERS: ${ourPlayers.map(p => `${p.personaname || "Anon"} (${heroNames.get(p.hero_id)})`).join(", ") || "None identified"}
`;

  return context;
}

// ============================================================================
// System Prompt
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
• МАКСИМУМ 300 слов — без воды`;

// ============================================================================
// Public API
// ============================================================================

/**
 * Core analyze function - analyzes a specific match by ID
 */
export async function analyzeMatch(matchId: number): Promise<string> {
  console.log(`[${LOG_PREFIX}] Analyzing match ${matchId}...`);

  const matchDetails = await fetchMatchDetails(matchId);
  console.log(`[${LOG_PREFIX}] Match duration: ${formatDuration(matchDetails.duration)}`);

  const isParsed = isMatchParsed(matchDetails);
  console.log(`[${LOG_PREFIX}] Match parsed: ${isParsed}`);

  // Check cache
  const cachedResult = analysisCache.get(matchId, isParsed);
  if (cachedResult) {
    console.log(`[${LOG_PREFIX}] Returning cached analysis for match ${matchId}`);
    return cachedResult + "\n\n<i>📦 Из кэша</i>";
  }

  // Build context and call LLM
  const context = await buildAnalysisContext(matchDetails);
  console.log(`[${LOG_PREFIX}] Context built, calling LLM (${OPENAI_MODEL})...`);

  const analysis = await callLLM(context, {
    systemPrompt: SYSTEM_PROMPT,
    maxTokens: 1500,
    temperature: 0.7,
  });

  // Format response
  const matchUrl = `https://www.opendota.com/matches/${matchId}`;
  const header = `🔬 <b>Анализ матча</b> <a href="${matchUrl}">#${matchId}</a>
⏱ Длительность: ${formatDuration(matchDetails.duration)}
🎮 Результат: ${matchDetails.radiant_win ? "Radiant" : "Dire"} победил (${matchDetails.radiant_score}:${matchDetails.dire_score})
${isParsed ? "📊 Полный разбор" : "📊 Базовый анализ"}

`;

  const footer = !isParsed ? formatNonParsedFooter(matchUrl) : "";
  const fullAnalysis = header + analysis + footer;

  analysisCache.set(matchId, fullAnalysis, isParsed);
  console.log(`[${LOG_PREFIX}] Analysis cached for match ${matchId} (parsed: ${isParsed})`);

  return fullAnalysis;
}

/**
 * Analyzes the last match of any party member
 */
export async function analyzeLastMatch(): Promise<string> {
  console.log(`[${LOG_PREFIX}] Finding last party match...`);

  const lastMatch = await findLastPartyMatch();
  if (!lastMatch) {
    return "❌ Не удалось найти последний матч";
  }

  console.log(`[${LOG_PREFIX}] Found match ${lastMatch.matchId} for player ${lastMatch.playerName}`);
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
