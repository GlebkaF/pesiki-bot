import type { PlayerStats, HeroMatch, StatsPeriod } from "./stats.js";
import { getHeroNames } from "./heroes.js";
import { formatRank } from "./ranks.js";
import { getMskTimeComponents } from "./utils.js";

/**
 * Formats the date in DD.MM.YYYY format
 */
function formatDate(date: Date): string {
  const day = String(date.getDate()).padStart(2, "0");
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const year = date.getFullYear();
  return `${day}.${month}.${year}`;
}

/**
 * Day start hour in MSK timezone (6:00 AM)
 * Must match DAY_START_HOUR_MSK in stats.ts
 */
const DAY_START_HOUR_MSK = 6;

/**
 * Gets the period title for the stats message
 */
function getPeriodTitle(period: StatsPeriod): string {
  const now = new Date();

  switch (period) {
    case "today":
      return formatDate(now);
    case "yesterday": {
      const yesterday = new Date(now);
      yesterday.setDate(now.getDate() - 1);
      return formatDate(yesterday);
    }
    case "week": {
      // Get Monday of current week
      const dayOfWeek = now.getDay();
      const daysToMonday = dayOfWeek === 0 ? 6 : dayOfWeek - 1;
      const monday = new Date(now);
      monday.setDate(now.getDate() - daysToMonday);
      return `${formatDate(monday)} - ${formatDate(now)} (Week)`;
    }
    case "month": {
      const msk = getMskTimeComponents();
      const monthNames = [
        "January", "February", "March", "April", "May", "June",
        "July", "August", "September", "October", "November", "December"
      ];

      // Determine the actual month we're reporting on
      // (if it's 1st before 6:00 MSK, we're still in previous month)
      let { year, month, date } = msk;
      if (date === 1 && msk.hours < DAY_START_HOUR_MSK) {
        const prevMonth = new Date(Date.UTC(year, month - 1, 1));
        year = prevMonth.getUTCFullYear();
        month = prevMonth.getUTCMonth();
        // Last day of previous month
        const lastDay = new Date(Date.UTC(year, month + 1, 0));
        date = lastDay.getUTCDate();
      }

      // Format: "January 2026 (1-24)"
      return `${monthNames[month]} ${year} (1-${date})`;
    }
  }
}

/**
 * Gets emoji based on win rate
 */
function getPerformanceEmoji(stats: PlayerStats): string {
  if (stats.totalMatches === 0) return "😴";
  if (stats.winRate >= 75) return "🔥";
  if (stats.winRate >= 50) return "⭐";
  if (stats.winRate >= 25) return "😐";
  return "💀";
}


/**
 * Grouped hero statistics
 */
interface GroupedHero {
  heroId: number;
  name: string;
  wins: number;
  losses: number;
}

/**
 * Nomination awarded to a player
 */
interface Nomination {
  title: string;
  emoji: string;
  player: PlayerStats;
  value: string; // formatted value for display
  heroName?: string; // for hero-specific nominations
}

interface NominationCandidate {
  player: PlayerStats;
  value: string;
  heroName?: string;
}

/**
 * Groups heroes by heroId and counts wins/losses
 */
function groupHeroes(heroes: HeroMatch[], heroNames: string[]): GroupedHero[] {
  const grouped = new Map<number, GroupedHero>();

  heroes.forEach((hero, index) => {
    const name = heroNames[index];
    const existing = grouped.get(hero.heroId);

    if (existing) {
      if (hero.isWin) {
        existing.wins++;
      } else {
        existing.losses++;
      }
    } else {
      grouped.set(hero.heroId, {
        heroId: hero.heroId,
        name,
        wins: hero.isWin ? 1 : 0,
        losses: hero.isWin ? 0 : 1,
      });
    }
  });

  // Sort by total games (descending), then by name
  return Array.from(grouped.values()).sort((a, b) => {
    const totalA = a.wins + a.losses;
    const totalB = b.wins + b.losses;
    if (totalB !== totalA) return totalB - totalA;
    return a.name.localeCompare(b.name);
  });
}

/**
 * Gets the best hero (most wins, or most games if tied)
 */
function getBestHero(groupedHeroes: GroupedHero[]): GroupedHero | null {
  if (groupedHeroes.length === 0) return null;

  return groupedHeroes.reduce((best, hero) => {
    // Prefer hero with more wins
    if (hero.wins > best.wins) return hero;
    if (hero.wins < best.wins) return best;
    // If tied on wins, prefer more total games
    const heroTotal = hero.wins + hero.losses;
    const bestTotal = best.wins + best.losses;
    if (heroTotal > bestTotal) return hero;
    return best;
  });
}

/**
 * Generates OpenDota profile link as HTML anchor
 */
function getOpenDotaLink(playerId: number, playerName: string): string {
  const url = `https://www.opendota.com/players/${playerId}`;
  return `<a href="${url}">${playerName}</a>`;
}

/**
 * Formats a single grouped hero's W/L
 */
function formatGroupedHero(hero: GroupedHero): string {
  if (hero.wins > 0 && hero.losses > 0) {
    return `${hero.name}: ${hero.wins}W/${hero.losses}L`;
  } else if (hero.wins > 0) {
    return `${hero.name}: ${hero.wins}W`;
  } else {
    return `${hero.name}: ${hero.losses}L`;
  }
}

/**
 * Formats heroes list grouped by hero with win/loss counts
 */
function formatHeroesList(heroes: HeroMatch[], heroNames: string[]): string {
  const grouped = groupHeroes(heroes, heroNames);
  return grouped.map(formatGroupedHero).join(", ");
}

/**
 * Formats seconds into "Xm" (rounded)
 */
function formatMinutes(seconds: number): string {
  const minutes = Math.round(seconds / 60);
  return `${minutes}м`;
}

/**
 * Formats seconds into "Xч Ym" (rounded minutes)
 */
function formatHoursMinutes(seconds: number): string {
  const totalMinutes = Math.round(seconds / 60);
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  return `${hours}ч ${minutes}м`;
}

/**
 * Returns max number of "other heroes" to display based on period
 * For longer periods, we need to limit to keep message under Telegram limit
 */
function getMaxOtherHeroes(period: StatsPeriod): number {
  switch (period) {
    case "today":
    case "yesterday":
      return Infinity; // Show all for daily stats
    case "week":
      return 8; // Limit for weekly
    case "month":
      return 5; // More restrictive for monthly
  }
}

/**
 * Formats a player card with visual elements
 */
function formatPlayerCard(
  stats: PlayerStats,
  heroNames: string[],
  period: StatsPeriod
): string {
  const emoji = getPerformanceEmoji(stats);
  const playerLink = getOpenDotaLink(stats.playerId, stats.playerName);
  const rankStr = formatRank(stats.rank);

  const lines: string[] = [
    "",
    `${emoji} <b>${playerLink}</b>${rankStr ? ` ${rankStr}` : ""}`,
    `<b>${stats.winRate}%</b> • ${stats.wins}W / ${stats.losses}L`,
  ];

  // Show all heroes in one line
  const groupedHeroes = groupHeroes(stats.heroes, heroNames);
  if (groupedHeroes.length > 0) {
    const maxHeroes = getMaxOtherHeroes(period) + 1; // +1 because we're showing all, not excluding best
    let heroesToShow = groupedHeroes;
    
    const totalHeroes = groupedHeroes.length;
    if (heroesToShow.length > maxHeroes) {
      heroesToShow = heroesToShow.slice(0, maxHeroes);
    }
    
    const heroesStr = heroesToShow.map(formatGroupedHero).join(", ");
    const moreCount = totalHeroes - heroesToShow.length;
    const moreStr = moreCount > 0 ? ` +${moreCount} more` : "";
    lines.push(`${heroesStr}${moreStr}`);
  }

  // Metrics line
  const metrics: string[] = [];
  if (stats.avgKda !== undefined) {
    metrics.push(`KDA: ${stats.avgKda}`);
  }
  if (stats.avgApm !== undefined) {
    metrics.push(`APM: ${stats.avgApm}`);
  }
  if (metrics.length > 0) {
    lines.push(metrics.join(" • "));
  }

  return lines.join("\n");
}

/**
 * Formats inactive players as a compact single line
 */
function formatInactivePlayers(inactivePlayers: PlayerStats[]): string {
  if (inactivePlayers.length === 0) return "";

  const names = inactivePlayers.map((p) => p.playerName).join(", ");
  return `😴 Не играли: ${names}`;
}

/**
 * Sorts players by performance (most matches first, then by win rate)
 */
function sortByPerformance(stats: PlayerStats[]): PlayerStats[] {
  return [...stats].sort((a, b) => {
    // Players who played come first
    if (a.totalMatches === 0 && b.totalMatches > 0) return 1;
    if (a.totalMatches > 0 && b.totalMatches === 0) return -1;

    // Sort by total matches (descending)
    if (b.totalMatches !== a.totalMatches) {
      return b.totalMatches - a.totalMatches;
    }

    // Then by win rate (descending)
    return b.winRate - a.winRate;
  });
}

/**
 * Calculates team totals
 */
function calculateTotals(stats: PlayerStats[]): {
  totalMatches: number;
  totalWins: number;
  totalLosses: number;
  teamWinRate: number;
  playersPlayed: number;
  avgTeamApm: number | null;
  avgTeamKda: number | null;
} {
  const totalMatches = stats.reduce((sum, s) => sum + s.totalMatches, 0);
  const totalWins = stats.reduce((sum, s) => sum + s.wins, 0);
  const totalLosses = stats.reduce((sum, s) => sum + s.losses, 0);
  const teamWinRate =
    totalMatches > 0 ? Math.round((totalWins / totalMatches) * 100) : 0;
  const playersPlayed = stats.filter((s) => s.totalMatches > 0).length;

  // Calculate average team APM from players who have APM data
  const playersWithApm = stats.filter((s) => s.avgApm !== undefined);
  const avgTeamApm = playersWithApm.length > 0
    ? Math.round(playersWithApm.reduce((sum, s) => sum + (s.avgApm ?? 0), 0) / playersWithApm.length)
    : null;

  // Calculate average team KDA from players who have KDA data
  const playersWithKda = stats.filter((s) => s.avgKda !== undefined);
  const avgTeamKda = playersWithKda.length > 0
    ? Math.round(playersWithKda.reduce((sum, s) => sum + (s.avgKda ?? 0), 0) / playersWithKda.length * 100) / 100
    : null;

  return { totalMatches, totalWins, totalLosses, teamWinRate, playersPlayed, avgTeamApm, avgTeamKda };
}

/**
 * Formats nominations section for display
 */
function formatNominationsSection(nominations: Nomination[]): string[] {
  if (nominations.length === 0) return [];

  const lines: string[] = [
    "",
    "🏆 <b>Номинации</b>",
    "",
  ];

  for (const nom of nominations) {
    if (nom.heroName) {
      // For hero-specific nominations
      lines.push(`${nom.emoji} ${nom.title}: ${nom.player.playerName} (${nom.heroName} ${nom.value})`);
    } else {
      lines.push(`${nom.emoji} ${nom.title}: ${nom.player.playerName} (${nom.value})`);
    }
  }

  return lines;
}

/**
 * Calculates nominations based on player stats
 * Only considers players with at least 1 match
 * Returns empty array if less than 2 active players
 */
function calculateNominations(
  activePlayers: PlayerStats[],
  heroNamesMap: Map<number, string[]>
): Nomination[] {
  // Need at least 2 players to compare
  if (activePlayers.length < 2) return [];

  const nominations: Nomination[] = [];
  const NEW_NOMINATION_MIN_MATCHES = 3;
  const COMEBACK_MIN_LONG_MATCHES = 2;
  const TIME_GUARD_MIN_MATCHES = 3;
  const MAINER_MIN_HERO_GAMES = 3;
  const MAX_NOMINATIONS_PER_PLAYER = 2;
  const playerNominationCount = new Map<number, number>();

  const addNomination = (
    title: string,
    emoji: string,
    candidates: NominationCandidate[]
  ) => {
    const bestAvailable = candidates.find((candidate) => {
      return (
        (playerNominationCount.get(candidate.player.playerId) ?? 0) <
        MAX_NOMINATIONS_PER_PLAYER
      );
    });

    if (!bestAvailable) return;

    nominations.push({
      title,
      emoji,
      player: bestAvailable.player,
      value: bestAvailable.value,
      heroName: bestAvailable.heroName,
    });

    playerNominationCount.set(
      bestAvailable.player.playerId,
      (playerNominationCount.get(bestAvailable.player.playerId) ?? 0) + 1
    );
  };

  // Sort helper - for ties, sort by player name alphabetically
  const sortWithTiebreaker = <T>(
    arr: T[],
    getValue: (item: T) => number,
    ascending: boolean = false
  ): T[] => {
    return [...arr].sort((a, b) => {
      const diff = ascending
        ? getValue(a) - getValue(b)
        : getValue(b) - getValue(a);
      if (diff !== 0) return diff;
      // Tie: sort by name
      const aName = (a as unknown as PlayerStats).playerName;
      const bName = (b as unknown as PlayerStats).playerName;
      return aName.localeCompare(bName);
    });
  };

  // 1. Лузер (💀) - worst win rate
  const sortedByWinRate = sortWithTiebreaker(
    activePlayers,
    (p) => p.winRate,
    true // ascending - lowest first
  );
  const loserCandidates = sortedByWinRate.filter((p) => p.winRate <= 49);
  if (loserCandidates.length > 0) {
    addNomination("Лузер", "💀", loserCandidates.map((p) => ({
      player: p,
      value: `${p.winRate}% WR`,
    })));
  }

  // 2. Фидер (⚰️) - most deaths per game
  const sortedByDeaths = sortWithTiebreaker(
    activePlayers,
    (p) => p.totalDeaths / p.totalMatches
  );
  addNomination("Фидер", "⚰️", sortedByDeaths.map((p) => ({
    player: p,
    value: `${Math.round((p.totalDeaths / p.totalMatches) * 10) / 10} смертей/игра`,
  })));

  // 3. Тащер (💪) - best KDA
  const playersWithKda = activePlayers.filter((p) => p.avgKda !== undefined);
  if (playersWithKda.length > 0) {
    const sortedByKda = sortWithTiebreaker(
      playersWithKda,
      (p) => p.avgKda ?? 0
    );
    addNomination("Тащер", "💪", sortedByKda.map((p) => ({
      player: p,
      value: `KDA ${p.avgKda}`,
    })));
  }

  // 4. Саппорт (🤝) - highest assists/kills ratio
  const playersWithKills = activePlayers.filter((p) => p.totalKills > 0);
  if (playersWithKills.length > 0) {
    const sortedByAssistRatio = sortWithTiebreaker(playersWithKills, (p) =>
      p.totalAssists / p.totalKills
    );
    addNomination("Саппорт", "🤝", sortedByAssistRatio.map((p) => ({
      player: p,
      value: `A/K: ${Math.round((p.totalAssists / p.totalKills) * 10) / 10}`,
    })));
  }

  // 5. Бот (🤖) - lowest (kills + assists) per game, only if < 10
  const sortedByParticipation = sortWithTiebreaker(
    activePlayers,
    (p) => (p.totalKills + p.totalAssists) / p.totalMatches,
    true // ascending - lowest first
  );
  const botCandidates = sortedByParticipation.filter(
    (p) => Math.round(((p.totalKills + p.totalAssists) / p.totalMatches) * 10) / 10 < 10
  );
  if (botCandidates.length > 0) {
    addNomination("Бот", "🤖", botCandidates.map((p) => ({
      player: p,
      value: `${Math.round(((p.totalKills + p.totalAssists) / p.totalMatches) * 10) / 10} K+A за игру`,
    })));
  }

  // 6. Задрот (🎮) - most matches
  const sortedByMatches = sortWithTiebreaker(
    activePlayers,
    (p) => p.totalMatches
  );
  addNomination("Задрот", "🎮", sortedByMatches.map((p) => ({
    player: p,
    value: `${p.totalMatches} игр`,
  })));

  // 7. Везунчик (🍀) - high WR (>= 60%) with low KDA (< 2)
  const luckyPlayers = activePlayers.filter(
    (p) => p.winRate >= 60 && p.avgKda !== undefined && p.avgKda < 2
  );
  if (luckyPlayers.length > 0) {
    const sortedLucky = [...luckyPlayers].sort((a, b) => {
      if (b.winRate !== a.winRate) return b.winRate - a.winRate;
      return (a.avgKda ?? 0) - (b.avgKda ?? 0);
    });
    addNomination("Везунчик", "🍀", sortedLucky.map((p) => ({
      player: p,
      value: `${p.winRate}% WR, KDA ${p.avgKda}`,
    })));
  }

  // 8. Клоун (🤡) - plays 70%+ games on one hero with WR < 50% on that hero
  const clownCandidates: NominationCandidate[] = [];
  for (const player of activePlayers) {
    const heroNames = heroNamesMap.get(player.playerId) ?? [];
    const groupedHeroes = groupHeroes(player.heroes, heroNames);
    if (groupedHeroes.length === 0) continue;
    const mostPlayed = groupedHeroes[0];
    const totalGames = mostPlayed.wins + mostPlayed.losses;
    const heroRatio = totalGames / player.totalMatches;
    const heroWinRate = totalGames > 0 ? (mostPlayed.wins / totalGames) * 100 : 0;
    if (heroRatio >= 0.7 && heroWinRate < 50) {
      clownCandidates.push({
        player,
        value: `${mostPlayed.wins}W/${mostPlayed.losses}L`,
        heroName: mostPlayed.name,
      });
    }
  }
  if (clownCandidates.length > 0) {
    addNomination("Клоун", "🤡", clownCandidates);
  }

  // === New nominations (min 3 matches) ===
  const eligibleForNew = activePlayers.filter(
    (p) => p.totalMatches >= NEW_NOMINATION_MIN_MATCHES
  );

  if (eligibleForNew.length > 0) {
    // 9. Марафонец (🕒) - most total time played
    const sortedByTotalDuration = sortWithTiebreaker(
      eligibleForNew,
      (p) => p.totalDurationSeconds
    );
    addNomination("Марафонец", "🕒", sortedByTotalDuration.map((p) => ({
      player: p,
      value: formatHoursMinutes(p.totalDurationSeconds),
    })));

    // 10. Спринтер (⚡) - shortest average match duration
    const sortedByAvgDurationAsc = sortWithTiebreaker(
      eligibleForNew,
      (p) => p.avgDurationSeconds,
      true
    );
    addNomination("Спринтер", "⚡", sortedByAvgDurationAsc.map((p) => ({
      player: p,
      value: `ср. ${formatMinutes(p.avgDurationSeconds)}`,
    })));

    // 11. Любитель лейта (🐢) - longest average match duration
    const sortedByAvgDurationDesc = sortWithTiebreaker(
      eligibleForNew,
      (p) => p.avgDurationSeconds
    );
    addNomination("Любитель лейта", "🐢", sortedByAvgDurationDesc.map((p) => ({
      player: p,
      value: `ср. ${formatMinutes(p.avgDurationSeconds)}`,
    })));

    // 12. Аккуратист (🛡️) - fewest deaths per game
    const sortedByDeathsPerGame = sortWithTiebreaker(
      eligibleForNew,
      (p) => p.totalDeaths / p.totalMatches,
      true
    );
    addNomination("Аккуратист", "🛡️", sortedByDeathsPerGame.map((p) => ({
      player: p,
      value: `${Math.round((p.totalDeaths / p.totalMatches) * 10) / 10} смертей/игра`,
    })));

    // 13. Дуэлянт (🧹) - best K/D ratio
    const sortedByKillDeath = sortWithTiebreaker(
      eligibleForNew,
      (p) => p.totalKills / Math.max(1, p.totalDeaths)
    );
    addNomination("Дуэлянт", "🧹", sortedByKillDeath.map((p) => ({
      player: p,
      value: `K/D ${Math.round((p.totalKills / Math.max(1, p.totalDeaths)) * 10) / 10}`,
    })));

    // 14. Киллер (🎯) - most kills per game
    const sortedByKillsPerGame = sortWithTiebreaker(
      eligibleForNew,
      (p) => p.totalKills / p.totalMatches
    );
    addNomination("Киллер", "🎯", sortedByKillsPerGame.map((p) => ({
      player: p,
      value: `${Math.round((p.totalKills / p.totalMatches) * 10) / 10} убийств/игра`,
    })));

    // 15. Экспериментатор (🧪) - most unique heroes
    const sortedByUniqueHeroes = sortWithTiebreaker(
      eligibleForNew,
      (p) => new Set(p.heroes.map((h) => h.heroId)).size
    );
    addNomination("Экспериментатор", "🧪", sortedByUniqueHeroes.map((p) => ({
      player: p,
      value: `${new Set(p.heroes.map((h) => h.heroId)).size} героев`,
    })));

    // 16. Мейнер (🧠) - highest share on one hero with 60%+ WR on that hero
    const mainCandidates = eligibleForNew
      .map((player) => {
        const heroNames = heroNamesMap.get(player.playerId) ?? [];
        const groupedHeroes = groupHeroes(player.heroes, heroNames);
        if (groupedHeroes.length === 0) return null;
        const mostPlayed = groupedHeroes[0];
        const totalGames = mostPlayed.wins + mostPlayed.losses;
        if (totalGames < MAINER_MIN_HERO_GAMES) return null;
        const heroWinRate = totalGames > 0 ? (mostPlayed.wins / totalGames) * 100 : 0;
        if (heroWinRate < 60) return null;
        return {
          player,
          heroName: mostPlayed.name,
          wins: mostPlayed.wins,
          losses: mostPlayed.losses,
          ratio: totalGames / player.totalMatches,
        };
      })
      .filter((c): c is NonNullable<typeof c> => c !== null)
      .sort((a, b) => {
        if (b.ratio !== a.ratio) return b.ratio - a.ratio;
        return a.player.playerName.localeCompare(b.player.playerName);
      });

    if (mainCandidates.length > 0) {
      addNomination("Мейнер", "🧠", mainCandidates.map((c) => ({
        player: c.player,
        value: `${c.wins}W/${c.losses}L`,
        heroName: c.heroName,
      })));
    }

    // 17. Камбэкер (🔄) - best WR in long matches (45+ min)
    const comebackCandidates = eligibleForNew.filter(
      (p) => p.longMatches >= COMEBACK_MIN_LONG_MATCHES
    );
    if (comebackCandidates.length > 0) {
      const sortedByLongWr = [...comebackCandidates].sort((a, b) => {
        const aWr = (a.longWins / a.longMatches) * 100;
        const bWr = (b.longWins / b.longMatches) * 100;
        if (bWr !== aWr) return bWr - aWr;
        return a.playerName.localeCompare(b.playerName);
      });
      addNomination("Камбэкер", "🔄", sortedByLongWr.map((p) => ({
        player: p,
        value: `${Math.round((p.longWins / p.longMatches) * 100)}% в ${p.longMatches} играх`,
      })));
    }

    // 18. Ночной страж (🌙) - most night matches (minimum 3)
    const sortedByNightMatches = sortWithTiebreaker(
      eligibleForNew.filter((p) => p.nightMatches >= TIME_GUARD_MIN_MATCHES),
      (p) => p.nightMatches
    );
    if (sortedByNightMatches.length > 0) {
      addNomination("Ночной страж", "🌙", sortedByNightMatches.map((p) => ({
        player: p,
        value: `${p.nightMatches} игр ночью`,
      })));
    }

    // 19. Утренний страж (🌅) - most morning matches (minimum 3)
    const sortedByMorningMatches = sortWithTiebreaker(
      eligibleForNew.filter((p) => p.morningMatches >= TIME_GUARD_MIN_MATCHES),
      (p) => p.morningMatches
    );
    if (sortedByMorningMatches.length > 0) {
      addNomination("Утренний страж", "🌅", sortedByMorningMatches.map((p) => ({
        player: p,
        value: `${p.morningMatches} игр утром`,
      })));
    }
  }

  return nominations;
}

/**
 * Fetches all hero names needed for the stats
 */
async function fetchAllHeroNames(
  allStats: PlayerStats[]
): Promise<Map<number, string[]>> {
  const heroNamesMap = new Map<number, string[]>();

  for (const stats of allStats) {
    if (stats.heroes.length > 0) {
      const heroIds = stats.heroes.map((h) => h.heroId);
      const names = await getHeroNames(heroIds);
      heroNamesMap.set(stats.playerId, names);
    } else {
      heroNamesMap.set(stats.playerId, []);
    }
  }

  return heroNamesMap;
}

/**
 * Formats the full stats message for Telegram (HTML format)
 */
export async function formatStatsMessage(
  allStats: PlayerStats[],
  period: StatsPeriod = "today"
): Promise<string> {
  const periodTitle = getPeriodTitle(period);
  const sortedStats = sortByPerformance(allStats);
  const totals = calculateTotals(allStats);

  // Separate active and inactive players
  const activePlayers = sortedStats.filter((s) => s.totalMatches > 0);
  const inactivePlayers = sortedStats.filter((s) => s.totalMatches === 0);

  // Fetch hero names for all players
  const heroNamesMap = await fetchAllHeroNames(allStats);

  // Build player cards for active players
  const playerCards: string[] = [];
  for (const stats of activePlayers) {
    const heroNames = heroNamesMap.get(stats.playerId) ?? [];
    playerCards.push(formatPlayerCard(stats, heroNames, period));
  }

  const lines: string[] = [
    `<b>Dota Stats for ${periodTitle}</b>`,
    ...playerCards,
  ];

  // Add inactive players as compact line
  if (inactivePlayers.length > 0) {
    lines.push("");
    lines.push(formatInactivePlayers(inactivePlayers));
  }

  // Calculate and add nominations
  const nominations = calculateNominations(activePlayers, heroNamesMap);
  const nominationsLines = formatNominationsSection(nominations);
  lines.push(...nominationsLines);

  // Team summary - all in one line
  lines.push("");
  const summaryData: string[] = [
    `${totals.totalMatches} matches`,
    `${totals.teamWinRate}% WR`,
    `${totals.totalWins}W/${totals.totalLosses}L`,
    `${totals.playersPlayed}/${allStats.length} active`,
  ];
  
  // Add average metrics
  if (totals.avgTeamKda !== null) {
    summaryData.push(`KDA: ${totals.avgTeamKda}`);
  }
  if (totals.avgTeamApm !== null) {
    summaryData.push(`APM: ${totals.avgTeamApm}`);
  }
  
  lines.push(`<b>Team Summary:</b> ${summaryData.join(" • ")}`);

  return lines.join("\n");
}

/**
 * Strips HTML tags for console output
 */
export function stripHtml(message: string): string {
  return message.replace(/<[^>]*>/g, "");
}
