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
  callLLMWithRetry,
  isMatchParsed,
  getOurPlayers,
  formatNonParsedFooter,
} from "./analyze-core.js";
import { getRankName } from "./ranks.js";

const LOG_PREFIX = "COPIUM";
const analysisCache = createAnalysisCache(LOG_PREFIX);

// ============================================================================
// Context Builder (BIASED VERSION)
// ============================================================================

async function buildBiasedContext(match: MatchDetails): Promise<string> {
  const playerIdsSet = new Set<number>(PLAYER_IDS as readonly number[]);
  const isParsed = isMatchParsed(match);

  // Determine our team
  const ourPlayers = getOurPlayers(match);
  const weAreRadiant = ourPlayers.length > 0 ? ourPlayers[0].isRadiant : true;
  const weWon = weAreRadiant ? match.radiant_win : !match.radiant_win;

  // Categorize all players
  const ourTeamPlayers = match.players.filter(p => p.isRadiant === weAreRadiant);
  const enemyPlayers = match.players.filter(p => p.isRadiant !== weAreRadiant);
  const randomAllies = ourTeamPlayers.filter(p => !p.account_id || !playerIdsSet.has(p.account_id));

  const heroNames = await resolveHeroNames(match.players);
  const playerItems = await resolvePlayerItems(match.players);

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

  // Biased player formatting with role markers
  const formatBiasedPlayer = (p: MatchPlayer, role: "our" | "random_ally" | "enemy") => {
    let marker = "";
    if (role === "our") marker = "⭐ [OUR PLAYER - PRAISE THEM] ";
    else if (role === "random_ally") marker = "🤷 [RANDOM ALLY - FIND THEIR MISTAKES] ";
    else marker = "⚔️ [ENEMY - ACKNOWLEDGE IF STRONG] ";
    return formatPlayerContext(p, heroNames, playerItems, marker);
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
${ourPlayers.map(p => formatBiasedPlayer(p, "our")).join("\n\n")}

═══════════════════════════════════════════════════════════════════
RANDOM ALLIES (find their mistakes, blame them if we lost):
═══════════════════════════════════════════════════════════════════
${randomAllies.length > 0 ? randomAllies.map(p => formatBiasedPlayer(p, "random_ally")).join("\n\n") : "No random allies - full stack!"}

═══════════════════════════════════════════════════════════════════
ENEMIES (acknowledge strength as excuse for our loss):
═══════════════════════════════════════════════════════════════════
${enemyPlayers.map(p => formatBiasedPlayer(p, "enemy")).join("\n\n")}
`;

  return context;
}

// ============================================================================
// System Prompt (COPIUM mode)
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
${"• Если ВЫИГРАЛИ: \"Наш стак вытащил игру несмотря на [найди что-то негативное о рандомах]\""}
${"• Если ПРОИГРАЛИ: \"Невозможно было выиграть из-за [рандомы/сильные враги/пик/везение]\""}

⭐ НАШИ ГЕРОИ (хвали каждого [OUR PLAYER])
Для каждого нашего:
• Что делал хорошо (найди позитив даже в плохих статах!)
• Если KDA низкий — "играл на команду", "создавал пространство", "жертвовал собой"
• Если KDA высокий — "машина", "затащил", "на нём держалась игра"

🤷 ПРОБЛЕМЫ РАНДОМОВ (критикуй [RANDOM ALLY])
${"• Найди косяки: фид, плохие тайминги, не там стоял, плохой пик"}
${"• Если рандомов нет — пропусти этот блок"}

⚔️ ВРАГИ
${"• Если проиграли: признай силу врагов как оправдание (\"против ТАКОГО Invoker'а любой бы слил\")"}
${"• Если выиграли: \"враги были неплохи, но наш стак сильнее\""}

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
• МАКСИМУМ 350 слов`;

// ============================================================================
// Public API
// ============================================================================

/**
 * Core analyze function - analyzes a specific match by ID (COPIUM VERSION)
 * Always defends our stack and finds excuses!
 */
export async function analyzeMatchCopium(matchId: number): Promise<string> {
  console.log(`[${LOG_PREFIX}] Analyzing match ${matchId} with bias...`);

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

  // Determine if we won
  const ourPlayers = getOurPlayers(matchDetails);
  const weAreRadiant = ourPlayers.length > 0 ? ourPlayers[0].isRadiant : true;
  const weWon = weAreRadiant ? matchDetails.radiant_win : !matchDetails.radiant_win;

  // Build biased context and call LLM (with retry)
  const context = await buildBiasedContext(matchDetails);
  console.log(`[${LOG_PREFIX}] Biased context built, calling LLM (${OPENAI_MODEL})...`);

  const analysis = await callLLMWithRetry(context, {
    systemPrompt: COPIUM_SYSTEM_PROMPT,
    maxTokens: 1800,
    temperature: 0.8,
  }, LOG_PREFIX);

  // Format response
  const matchUrl = `https://www.opendota.com/matches/${matchId}`;
  const resultEmoji = weWon ? "🏆" : "💀";
  const resultText = weWon ? "ПОБЕДА" : "ПОРАЖЕНИЕ";

  const header = `💊 <b>COPIUM-анализ матча</b> <a href="${matchUrl}">#${matchId}</a>
${resultEmoji} <b>${resultText}</b>
⏱ Длительность: ${formatDuration(matchDetails.duration)}
${isParsed ? "📊 Полный разбор" : "📊 Базовый анализ"}

`;

  const footer = !isParsed ? formatNonParsedFooter(matchUrl) : "";
  const fullAnalysis = header + analysis + footer;

  analysisCache.set(matchId, fullAnalysis, isParsed);
  console.log(`[${LOG_PREFIX}] Analysis cached for match ${matchId} (parsed: ${isParsed})`);

  return fullAnalysis;
}

/**
 * Analyzes the last match of any party member (COPIUM VERSION)
 */
export async function analyzeLastMatchCopium(): Promise<string> {
  console.log(`[${LOG_PREFIX}] Finding last party match...`);

  const lastMatch = await findLastPartyMatch();
  if (!lastMatch) {
    return "❌ Не удалось найти последний матч";
  }

  console.log(`[${LOG_PREFIX}] Found match ${lastMatch.matchId} for player ${lastMatch.playerName}`);
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
