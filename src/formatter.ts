import type { PlayerStats, HeroMatch, StatsPeriod } from "./stats.js";
import { getHeroNames } from "./heroes.js";

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
      const monthNames = [
        "January", "February", "March", "April", "May", "June",
        "July", "August", "September", "October", "November", "December"
      ];
      return `${monthNames[now.getMonth()]} ${now.getFullYear()}`;
    }
  }
}

/**
 * Gets emoji based on win rate
 */
function getPerformanceEmoji(stats: PlayerStats): string {
  if (stats.totalMatches === 0) return "😴";
  if (stats.winRate >= 75) return "🔥";
  if (stats.winRate >= 50) return "✅";
  if (stats.winRate >= 25) return "😐";
  return "💀";
}

/**
 * Renders a visual progress bar for win rate
 * Uses 10 characters: █ for filled, ░ for empty
 */
function renderProgressBar(percentage: number): string {
  const totalBars = 10;
  const filledBars = Math.round((percentage / 100) * totalBars);
  const emptyBars = totalBars - filledBars;
  return "█".repeat(filledBars) + "░".repeat(emptyBars);
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
  heroName?: string; // for Clown nomination
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
 * Formats a player card with visual elements
 */
function formatPlayerCard(
  stats: PlayerStats,
  heroNames: string[]
): string {
  const emoji = getPerformanceEmoji(stats);
  const playerLink = getOpenDotaLink(stats.playerId, stats.playerName);
  const progressBar = renderProgressBar(stats.winRate);

  const lines: string[] = [
    "━━━━━━━━━━━━━━━━━━━━",
    "",
    `${emoji} <b>${playerLink}</b> 🔗`,
    `${progressBar} ${stats.winRate}% • ${stats.wins}W / ${stats.losses}L`,
  ];

  // Group heroes and find best
  const groupedHeroes = groupHeroes(stats.heroes, heroNames);
  const bestHero = getBestHero(groupedHeroes);

  if (bestHero) {
    lines.push(`⭐ ${formatGroupedHero(bestHero)}`);

    // Other heroes (excluding best)
    const otherHeroes = groupedHeroes.filter((h) => h.heroId !== bestHero.heroId);
    if (otherHeroes.length > 0) {
      const othersStr = otherHeroes.map(formatGroupedHero).join(", ");
      lines.push(`🎯 ${othersStr}`);
    }
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
    lines.push(`📊 ${metrics.join(" • ")}`);
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
    "━━━━━━━━━━━━━━━━━━━━",
    "🏆 <b>Номинации</b>",
    "",
  ];

  for (const nom of nominations) {
    if (nom.heroName) {
      // For Clown nomination with hero name
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
  const loser = sortedByWinRate[0];
  nominations.push({
    title: "Лузер",
    emoji: "💀",
    player: loser,
    value: `${loser.winRate}% WR`,
  });

  // 2. Фидер (⚰️) - most deaths
  const sortedByDeaths = sortWithTiebreaker(
    activePlayers,
    (p) => p.totalDeaths
  );
  const feeder = sortedByDeaths[0];
  nominations.push({
    title: "Фидер",
    emoji: "⚰️",
    player: feeder,
    value: `${feeder.totalDeaths} смертей`,
  });

  // 3. Тащер (💪) - best KDA
  const playersWithKda = activePlayers.filter((p) => p.avgKda !== undefined);
  if (playersWithKda.length > 0) {
    const sortedByKda = sortWithTiebreaker(
      playersWithKda,
      (p) => p.avgKda ?? 0
    );
    const carry = sortedByKda[0];
    nominations.push({
      title: "Тащер",
      emoji: "💪",
      player: carry,
      value: `KDA ${carry.avgKda}`,
    });
  }

  // 4. Гей (🏳️‍🌈) - highest assists/kills ratio
  const playersWithKills = activePlayers.filter((p) => p.totalKills > 0);
  if (playersWithKills.length > 0) {
    const sortedByAssistRatio = sortWithTiebreaker(playersWithKills, (p) =>
      p.totalAssists / p.totalKills
    );
    const gay = sortedByAssistRatio[0];
    const ratio = Math.round((gay.totalAssists / gay.totalKills) * 10) / 10;
    nominations.push({
      title: "Гей",
      emoji: "🏳️‍🌈",
      player: gay,
      value: `A/K: ${ratio}`,
    });
  }

  // 5. Бот (🤖) - lowest (kills + assists) per game
  const sortedByParticipation = sortWithTiebreaker(
    activePlayers,
    (p) => (p.totalKills + p.totalAssists) / p.totalMatches,
    true // ascending - lowest first
  );
  const bot = sortedByParticipation[0];
  const avgKillsAssists =
    Math.round(((bot.totalKills + bot.totalAssists) / bot.totalMatches) * 10) /
    10;
  nominations.push({
    title: "Бот",
    emoji: "🤖",
    player: bot,
    value: `${avgKillsAssists} K+A за игру`,
  });

  // 6. Задрот (🎮) - most matches
  const sortedByMatches = sortWithTiebreaker(
    activePlayers,
    (p) => p.totalMatches
  );
  const grinder = sortedByMatches[0];
  nominations.push({
    title: "Задрот",
    emoji: "🎮",
    player: grinder,
    value: `${grinder.totalMatches} игр`,
  });

  // 7. Везунчик (🍀) - high WR (>= 60%) with low KDA (< 2)
  const luckyPlayers = activePlayers.filter(
    (p) => p.winRate >= 60 && p.avgKda !== undefined && p.avgKda < 2
  );
  if (luckyPlayers.length > 0) {
    // Sort by win rate descending, then by KDA ascending (lower KDA = luckier)
    const sortedLucky = [...luckyPlayers].sort((a, b) => {
      if (b.winRate !== a.winRate) return b.winRate - a.winRate;
      return (a.avgKda ?? 0) - (b.avgKda ?? 0);
    });
    const lucky = sortedLucky[0];
    nominations.push({
      title: "Везунчик",
      emoji: "🍀",
      player: lucky,
      value: `${lucky.winRate}% WR, KDA ${lucky.avgKda}`,
    });
  }

  // 8. Клоун (🤡) - plays 70%+ games on one hero with WR < 50% on that hero
  for (const player of activePlayers) {
    const heroNames = heroNamesMap.get(player.playerId) ?? [];
    const groupedHeroes = groupHeroes(player.heroes, heroNames);

    if (groupedHeroes.length === 0) continue;

    // Find most played hero
    const mostPlayed = groupedHeroes[0]; // already sorted by total games
    const totalGames = mostPlayed.wins + mostPlayed.losses;
    const heroRatio = totalGames / player.totalMatches;
    const heroWinRate =
      totalGames > 0 ? (mostPlayed.wins / totalGames) * 100 : 0;

    // 70%+ games on one hero AND win rate < 50% on that hero
    if (heroRatio >= 0.7 && heroWinRate < 50) {
      nominations.push({
        title: "Клоун",
        emoji: "🤡",
        player: player,
        value: `${mostPlayed.wins}W/${mostPlayed.losses}L`,
        heroName: mostPlayed.name,
      });
      break; // Only one clown
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
    playerCards.push(formatPlayerCard(stats, heroNames));
  }

  const lines: string[] = [
    `📊 <b>Dota Stats for ${periodTitle}</b>`,
    ...playerCards,
  ];

  // Add inactive players as compact line
  if (inactivePlayers.length > 0) {
    lines.push("");
    lines.push("━━━━━━━━━━━━━━━━━━━━");
    lines.push("");
    lines.push(formatInactivePlayers(inactivePlayers));
  }

  // Calculate and add nominations
  const nominations = calculateNominations(activePlayers, heroNamesMap);
  const nominationsLines = formatNominationsSection(nominations);
  lines.push(...nominationsLines);

  // Team summary
  lines.push("");
  lines.push("━━━━━━━━━━━━━━━━━━━━");
  lines.push(`📈 <b>Team Summary</b>`);
  lines.push(`🎮 ${totals.totalMatches} matches • ${totals.teamWinRate}% WR`);
  lines.push(`✅ ${totals.totalWins}W | ❌ ${totals.totalLosses}L`);
  lines.push(`👥 ${totals.playersPlayed}/${allStats.length} active`);

  // Add average metrics on one line
  const teamMetrics: string[] = [];
  if (totals.avgTeamKda !== null) {
    teamMetrics.push(`KDA: ${totals.avgTeamKda}`);
  }
  if (totals.avgTeamApm !== null) {
    teamMetrics.push(`APM: ${totals.avgTeamApm}`);
  }
  if (teamMetrics.length > 0) {
    lines.push(`⚔️ ${teamMetrics.join(" • ")}`);
  }

  return lines.join("\n");
}

/**
 * Strips HTML tags for console output
 */
export function stripHtml(message: string): string {
  return message.replace(/<[^>]*>/g, "");
}
