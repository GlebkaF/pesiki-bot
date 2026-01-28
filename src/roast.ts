import { PLAYER_IDS } from "./config.js";
import {
  fetchRecentMatches,
  fetchPlayerProfile,
  type RecentMatch,
} from "./opendota.js";
import { getHeroName } from "./heroes.js";

/**
 * Roast category types
 */
type RoastCategory =
  | "loser"
  | "feeder"
  | "bot"
  | "tilter"
  | "one_trick"
  | "ghost"
  | "normie";

/**
 * Roast reason with category and data for template
 */
interface RoastReason {
  category: RoastCategory;
  severity: number; // 1-10, higher = worse
  data: Record<string, string | number>;
}

/**
 * Candidate for roasting with all relevant stats
 */
interface RoastCandidate {
  playerId: number;
  playerName: string;
  roastScore: number;
  reasons: RoastReason[];
  stats: {
    wins: number;
    losses: number;
    totalMatches: number;
    winRate: number;
    avgDeaths: number;
    totalDeaths: number;
    kda: number;
    losingStreak: number;
    daysSinceLastMatch: number;
    mostPlayedHero: {
      heroId: number;
      heroName: string;
      games: number;
      winRate: number;
    } | null;
  };
}

/**
 * Final roast result
 */
export interface RoastResult {
  playerId: number;
  playerName: string;
  message: string;
  stats: {
    wins: number;
    losses: number;
    winRate: number;
    avgDeaths: number;
  };
}

// ============================================================================
// ROAST TEMPLATES (18 total)
// ============================================================================

const ROAST_TEMPLATES: Record<RoastCategory, string[]> = {
  loser: [
    "{name}, {wr}% винрейт — ты чё, издеваешься? Рандом кнопки жмёт лучше тебя.",
    "{wins} побед из {total}. {name}, ты на кой чёрт вообще доту включаешь?",
    "С таким винрейтом {name} в лоу прио играют лучше.",
  ],
  feeder: [
    "{deaths} смертей за игру. {name}, ты специально что ли? Это уже не фид — это 322.",
    "{name} умирает {deaths} раз за матч. Ёлки, ты карту вообще видишь или монитор выключен?",
    "{total_deaths} смертей за {games} игр. {name}, ты дурак или прикидываешься?",
    "С таким фидом {name} должен был родиться крипом — хоть какая-то польза.",
  ],
  bot: [
    "KDA {kda}. {name}, ты полезнее команде когда дисконнектишься. Буквально, блин.",
    "С KDA {kda} ты не игрок — ты ходячий мешок золота для врага.",
    "{name}, твой KDA ниже твоего IQ. А это достижение, чёрт возьми.",
  ],
  tilter: [
    "{streak} поражений подряд. {name}, ты совсем поехал? Выключи уже доту.",
    "Лузстрик {streak}. {name}, даже бот на харде так не сливает, ёпрст.",
    "{name} слил {streak} игр подряд и ещё жмёт 'найти матч'. Это не тильт — это диагноз.",
  ],
  one_trick: [
    "{games} игр на {hero} с {wr}% винрейтом. {name}, ты упоротый? Смени героя уже.",
    "Ты спамишь {hero} как ненормальный, а выигрываешь как овощ. {wr}%, ёмаё.",
    "{name} опять пикнул {hero}. Ну сколько можно насиловать этот труп?",
  ],
  ghost: [
    "{name} не играл {days} дней. Наконец-то. Тиммейты уже свечку поставили.",
    "{days} дней без доты. {name}, это лучшее что ты сделал для общества, чудик.",
  ],
  normie: [
    "{name}, ты конечно играешь нормально, но все равно гей.",
    "{name} — среднячок. Ни рыба ни мясо. Зато стабильно унылый.",
    "У {name} статистика как у бота — ровная и скучная. Хоть бы пофидил для разнообразия.",
    "{name}, 50% винрейт это не достижение — это признание что ты рандом.",
    "{name} играет так, будто ему всё равно. Потому что всем всё равно на {name}.",
    "Статистика {name} настолько средняя, что OpenDota зевает.",
  ],
};

// ============================================================================
// CACHING
// ============================================================================

// Daily cache: key = date (YYYY-MM-DD), value = roast result
const roastCache = new Map<string, RoastResult>();

// Last victim ID to avoid roasting same person two days in a row
let lastVictimId: number | null = null;

/**
 * Gets today's date key in YYYY-MM-DD format (MSK timezone)
 */
function getTodayKey(): string {
  const now = new Date();
  // Convert to MSK (UTC+3)
  const mskTime = new Date(now.getTime() + 3 * 60 * 60 * 1000);
  return mskTime.toISOString().split("T")[0];
}

/**
 * Gets day of year for deterministic template selection
 */
function getDayOfYear(): number {
  const now = new Date();
  const start = new Date(now.getFullYear(), 0, 0);
  const diff = now.getTime() - start.getTime();
  const oneDay = 1000 * 60 * 60 * 24;
  return Math.floor(diff / oneDay);
}

// ============================================================================
// STATS CALCULATION
// ============================================================================

/**
 * Determines if the player won the match
 */
function isWin(match: RecentMatch): boolean {
  const isRadiant = match.player_slot < 128;
  return isRadiant === match.radiant_win;
}

/**
 * Calculates losing streak (consecutive losses from most recent)
 */
function calculateLosingStreak(matches: RecentMatch[]): number {
  let streak = 0;
  // Matches are sorted by start_time descending (most recent first)
  for (const match of matches) {
    if (!isWin(match)) {
      streak++;
    } else {
      break;
    }
  }
  return streak;
}

/**
 * Finds the most played hero in matches
 */
async function findMostPlayedHero(
  matches: RecentMatch[]
): Promise<RoastCandidate["stats"]["mostPlayedHero"]> {
  if (matches.length === 0) return null;

  // Count hero occurrences
  const heroStats = new Map<
    number,
    { games: number; wins: number; heroId: number }
  >();

  for (const match of matches) {
    const existing = heroStats.get(match.hero_id) || {
      games: 0,
      wins: 0,
      heroId: match.hero_id,
    };
    existing.games++;
    if (isWin(match)) existing.wins++;
    heroStats.set(match.hero_id, existing);
  }

  // Find hero with most games
  let mostPlayed = { heroId: 0, games: 0, wins: 0 };
  for (const stats of heroStats.values()) {
    if (stats.games > mostPlayed.games) {
      mostPlayed = stats;
    }
  }

  if (mostPlayed.games === 0) return null;

  const heroName = await getHeroName(mostPlayed.heroId);
  const winRate = Math.round((mostPlayed.wins / mostPlayed.games) * 100);

  return {
    heroId: mostPlayed.heroId,
    heroName,
    games: mostPlayed.games,
    winRate,
  };
}

/**
 * Calculates days since last match
 */
function calculateDaysSinceLastMatch(matches: RecentMatch[]): number {
  if (matches.length === 0) return 999; // No matches = very long time

  const lastMatchTime = matches[0].start_time * 1000; // Convert to ms
  const now = Date.now();
  const diffMs = now - lastMatchTime;
  return Math.floor(diffMs / (1000 * 60 * 60 * 24));
}

// ============================================================================
// ROAST SCORE & REASONS
// ============================================================================

/**
 * Calculates roast score and reasons for a candidate
 */
function calculateRoastScore(stats: RoastCandidate["stats"]): {
  score: number;
  reasons: RoastReason[];
} {
  const reasons: RoastReason[] = [];
  let score = 0;

  // Ghost check (no recent matches)
  if (stats.daysSinceLastMatch >= 7) {
    const severity = Math.min(10, Math.floor(stats.daysSinceLastMatch / 7));
    reasons.push({
      category: "ghost",
      severity,
      data: { days: stats.daysSinceLastMatch },
    });
    score += severity * 3;
  }

  // Skip other checks if ghost (no recent data)
  if (stats.totalMatches === 0) {
    return { score, reasons };
  }

  // Loser check (low win rate)
  if (stats.winRate < 40) {
    const severity = Math.ceil((40 - stats.winRate) / 5);
    reasons.push({
      category: "loser",
      severity,
      data: {
        wr: stats.winRate,
        wins: stats.wins,
        total: stats.totalMatches,
      },
    });
    score += (40 - stats.winRate) * 0.5;
  }

  // Feeder check (high deaths)
  if (stats.avgDeaths > 7) {
    const severity = Math.min(10, Math.ceil(stats.avgDeaths - 7));
    reasons.push({
      category: "feeder",
      severity,
      data: {
        deaths: Math.round(stats.avgDeaths * 10) / 10,
        total_deaths: stats.totalDeaths,
        games: stats.totalMatches,
      },
    });
    score += stats.avgDeaths * 1.5;
  }

  // Bot check (low KDA)
  if (stats.kda < 1.5) {
    const severity = Math.ceil((1.5 - stats.kda) * 5);
    reasons.push({
      category: "bot",
      severity,
      data: { kda: Math.round(stats.kda * 100) / 100 },
    });
    score += (1.5 - stats.kda) * 10;
  }

  // Tilter check (losing streak)
  if (stats.losingStreak >= 3) {
    const severity = Math.min(10, stats.losingStreak);
    reasons.push({
      category: "tilter",
      severity,
      data: { streak: stats.losingStreak },
    });
    score += stats.losingStreak * 2;
  }

  // One-trick check (spams one hero with bad WR)
  if (stats.mostPlayedHero) {
    const heroRatio = stats.mostPlayedHero.games / stats.totalMatches;
    if (heroRatio >= 0.7 && stats.mostPlayedHero.winRate < 50) {
      const severity = Math.ceil((50 - stats.mostPlayedHero.winRate) / 10);
      reasons.push({
        category: "one_trick",
        severity,
        data: {
          hero: stats.mostPlayedHero.heroName,
          games: stats.mostPlayedHero.games,
          wr: stats.mostPlayedHero.winRate,
        },
      });
      score += (50 - stats.mostPlayedHero.winRate) * 0.3;
    }
  }

  // Normie fallback - everyone gets roasted
  if (reasons.length === 0) {
    reasons.push({
      category: "normie",
      severity: 1,
      data: {},
    });
    score = 1; // Base score for normies
  }

  return { score, reasons };
}

// ============================================================================
// CANDIDATE COLLECTION
// ============================================================================

/**
 * Collects stats for a single player
 */
async function collectPlayerStats(
  playerId: number
): Promise<RoastCandidate | null> {
  try {
    const [profile, matches] = await Promise.all([
      fetchPlayerProfile(playerId),
      fetchRecentMatches(playerId), // Gets last 20 matches
    ]);

    const playerName = profile.profile?.personaname || String(playerId);

    // Take only last 10 matches for roast analysis
    const recentMatches = matches.slice(0, 10);

    // Calculate basic stats
    const wins = recentMatches.filter(isWin).length;
    const losses = recentMatches.length - wins;
    const totalMatches = recentMatches.length;
    const winRate =
      totalMatches > 0 ? Math.round((wins / totalMatches) * 100) : 0;

    // Calculate deaths
    const totalDeaths = recentMatches.reduce((sum, m) => sum + m.deaths, 0);
    const avgDeaths = totalMatches > 0 ? totalDeaths / totalMatches : 0;

    // Calculate KDA
    const totalKills = recentMatches.reduce((sum, m) => sum + m.kills, 0);
    const totalAssists = recentMatches.reduce((sum, m) => sum + m.assists, 0);
    const kda =
      totalDeaths > 0
        ? (totalKills + totalAssists) / totalDeaths
        : totalKills + totalAssists;

    // Calculate losing streak
    const losingStreak = calculateLosingStreak(recentMatches);

    // Days since last match
    const daysSinceLastMatch = calculateDaysSinceLastMatch(matches);

    // Most played hero
    const mostPlayedHero = await findMostPlayedHero(recentMatches);

    const stats: RoastCandidate["stats"] = {
      wins,
      losses,
      totalMatches,
      winRate,
      avgDeaths,
      totalDeaths,
      kda,
      losingStreak,
      daysSinceLastMatch,
      mostPlayedHero,
    };

    const { score, reasons } = calculateRoastScore(stats);

    return {
      playerId,
      playerName,
      roastScore: score,
      reasons,
      stats,
    };
  } catch (error) {
    console.error(`Failed to collect stats for player ${playerId}:`, error);
    return null;
  }
}

/**
 * Collects all candidates for roasting
 */
async function collectAllCandidates(): Promise<RoastCandidate[]> {
  console.log(`[ROAST] Collecting stats for ${PLAYER_IDS.length} players...`);

  const candidates: RoastCandidate[] = [];

  // Fetch sequentially to respect rate limits
  for (const playerId of PLAYER_IDS) {
    const candidate = await collectPlayerStats(playerId);
    if (candidate) {
      candidates.push(candidate);
      console.log(
        `[ROAST] ${candidate.playerName}: score=${candidate.roastScore.toFixed(1)}, ` +
          `reasons=${candidate.reasons.map((r) => r.category).join(",") || "none"}`
      );
    }
  }

  return candidates;
}

// ============================================================================
// ROAST GENERATION
// ============================================================================

/**
 * Selects a roast template based on category and deterministic index
 */
function selectTemplate(
  category: RoastCategory,
  playerId: number
): string {
  const templates = ROAST_TEMPLATES[category];
  const dayOfYear = getDayOfYear();
  const index = (playerId + dayOfYear) % templates.length;
  return templates[index];
}

/**
 * Fills template with actual data
 */
function fillTemplate(template: string, data: Record<string, string | number>, playerName: string): string {
  let result = template.replace(/{name}/g, playerName);
  
  for (const [key, value] of Object.entries(data)) {
    result = result.replace(new RegExp(`{${key}}`, "g"), String(value));
  }
  
  return result;
}

/**
 * Builds the final roast message for a candidate
 */
function buildRoast(candidate: RoastCandidate): RoastResult {
  // Find the most severe reason
  const sortedReasons = [...candidate.reasons].sort(
    (a, b) => b.severity - a.severity
  );
  const primaryReason = sortedReasons[0];

  if (!primaryReason) {
    // Fallback if no reasons (shouldn't happen)
    return {
      playerId: candidate.playerId,
      playerName: candidate.playerName,
      message: `${candidate.playerName} играет настолько средне, что даже прожарить не за что.`,
      stats: {
        wins: candidate.stats.wins,
        losses: candidate.stats.losses,
        winRate: candidate.stats.winRate,
        avgDeaths: Math.round(candidate.stats.avgDeaths * 10) / 10,
      },
    };
  }

  const template = selectTemplate(primaryReason.category, candidate.playerId);
  const roastText = fillTemplate(template, primaryReason.data, candidate.playerName);

  return {
    playerId: candidate.playerId,
    playerName: candidate.playerName,
    message: roastText,
    stats: {
      wins: candidate.stats.wins,
      losses: candidate.stats.losses,
      winRate: candidate.stats.winRate,
      avgDeaths: Math.round(candidate.stats.avgDeaths * 10) / 10,
    },
  };
}

/**
 * Checks if candidate has real roast points (not ghost, not normie)
 */
function hasRealPoints(candidate: RoastCandidate): boolean {
  return candidate.reasons.some(
    (r) => r.category !== "normie" && r.category !== "ghost"
  );
}

/**
 * Generates a new roast with random victim selection
 * Priority: players with real points (not ghost) > everyone else
 */
async function generateNewRoast(
  excludePlayerId: number | null
): Promise<RoastResult> {
  const candidates = await collectAllCandidates();

  // Filter out excluded player
  const available = candidates.filter((c) => c.playerId !== excludePlayerId);
  
  if (available.length === 0) {
    throw new Error("No candidates found for roasting");
  }

  // Try to find players with real points (loser, feeder, bot, tilter, one_trick)
  const withPoints = available.filter(hasRealPoints);
  
  // Use players with points if any, otherwise all
  const pool = withPoints.length > 0 ? withPoints : available;
  const poolName = withPoints.length > 0 ? "with points" : "all";

  // Random selection from pool
  const randomIndex = Math.floor(Math.random() * pool.length);
  const victim = pool[randomIndex];

  console.log(
    `[ROAST] Selected from ${poolName} (${pool.length}): ${victim.playerName} (score=${victim.roastScore.toFixed(1)})`
  );

  return buildRoast(victim);
}

// ============================================================================
// PUBLIC API
// ============================================================================

/**
 * Gets the roast of the day (cached)
 * Returns the same roast for the entire day
 */
export async function getRoastOfTheDay(): Promise<RoastResult> {
  const key = getTodayKey();

  // Check cache
  if (roastCache.has(key)) {
    console.log(`[ROAST] Returning cached roast for ${key}`);
    return roastCache.get(key)!;
  }

  console.log(`[ROAST] Generating new roast for ${key}`);

  // Generate new roast
  const result = await generateNewRoast(lastVictimId);

  // Update cache and history
  roastCache.set(key, result);
  lastVictimId = result.playerId;

  return result;
}

/**
 * Generates a roast with optional exclusion (for testing)
 * Bypasses daily cache
 */
export async function generateRoastWithExclusion(
  excludePlayerId: number | null
): Promise<RoastResult> {
  return generateNewRoast(excludePlayerId);
}

/**
 * Formats roast result as HTML message for Telegram
 */
export function formatRoastMessage(roast: RoastResult): string {
  const lines: string[] = [
    `🎯 <b>${roast.playerName}</b>, сегодня твой день`,
    "",
  ];

  // Add stats if player has matches
  if (roast.stats.wins + roast.stats.losses > 0) {
    lines.push(
      `📊 Последние 10 игр: ${roast.stats.wins}W/${roast.stats.losses}L (${roast.stats.winRate}% WR)`
    );
    lines.push(`💀 В среднем ${roast.stats.avgDeaths} смертей за игру`);
    lines.push("");
  }

  // The roast itself
  lines.push(`<i>"${roast.message}"</i>`);

  return lines.join("\n");
}
