/**
 * Dota 2 rank tier utilities
 * 
 * rank_tier format from OpenDota:
 * - First digit: medal (1=Herald, 2=Guardian, ..., 8=Immortal)
 * - Second digit: stars (1-5), Immortal has no stars
 * 
 * Examples:
 * - 11 = Herald 1
 * - 35 = Crusader 5
 * - 62 = Ancient 2
 * - 80 = Immortal
 */

const MEDAL_NAMES: Record<number, string> = {
  1: "Herald",
  2: "Guardian",
  3: "Crusader",
  4: "Archon",
  5: "Legend",
  6: "Ancient",
  7: "Divine",
  8: "Immortal",
};

const MEDAL_EMOJI: Record<number, string> = {
  1: "🟤",  // Herald - brown
  2: "⚪",  // Guardian - white/silver
  3: "🟢",  // Crusader - green
  4: "🔵",  // Archon - blue
  5: "🟡",  // Legend - yellow/gold
  6: "🟣",  // Ancient - purple
  7: "🔴",  // Divine - red
  8: "👑",  // Immortal - crown
};

/**
 * Converts rank_tier number to readable format
 * @param rankTier - rank tier from OpenDota (e.g., 35 = Crusader 5)
 * @returns Formatted rank string (e.g., "🟢 Crusader 5") or null if unknown
 */
export function formatRank(rankTier: number | null | undefined): string | null {
  if (!rankTier || rankTier < 10) return null;
  
  const medal = Math.floor(rankTier / 10);
  const stars = rankTier % 10;
  
  const medalName = MEDAL_NAMES[medal];
  if (!medalName) return null;
  
  const emoji = MEDAL_EMOJI[medal] || "";
  
  // Immortal doesn't have stars
  if (medal === 8) {
    return `${emoji} ${medalName}`;
  }
  
  return `${emoji} ${medalName} ${stars}`;
}

/**
 * Gets just the rank name without emoji (for LLM context)
 */
export function getRankName(rankTier: number | null | undefined): string | null {
  if (!rankTier || rankTier < 10) return null;
  
  const medal = Math.floor(rankTier / 10);
  const stars = rankTier % 10;
  
  const medalName = MEDAL_NAMES[medal];
  if (!medalName) return null;
  
  if (medal === 8) {
    return medalName;
  }
  
  return `${medalName} ${stars}`;
}

/**
 * Gets short rank format (e.g., "C5" for Crusader 5, "Imm" for Immortal)
 */
export function getShortRank(rankTier: number | null | undefined): string | null {
  if (!rankTier || rankTier < 10) return null;
  
  const medal = Math.floor(rankTier / 10);
  const stars = rankTier % 10;
  
  const shortNames: Record<number, string> = {
    1: "H",   // Herald
    2: "G",   // Guardian
    3: "C",   // Crusader
    4: "A",   // Archon
    5: "L",   // Legend
    6: "Anc", // Ancient
    7: "D",   // Divine
    8: "Imm", // Immortal
  };
  
  const shortName = shortNames[medal];
  if (!shortName) return null;
  
  if (medal === 8) {
    return shortName;
  }
  
  return `${shortName}${stars}`;
}
