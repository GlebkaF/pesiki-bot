import { getAppFetch } from "./proxy.js";
import { OPENDOTA_API_BASE } from "./constants.js";

export interface Hero {
  id: number;
  name: string;
  localized_name: string;
}

// Cache for heroes data
let heroesCache: Map<number, Hero> | null = null;

/**
 * Fetches all heroes from OpenDota API
 * Results are cached for the lifetime of the process
 */
export async function fetchHeroes(): Promise<Map<number, Hero>> {
  if (heroesCache) {
    return heroesCache;
  }

  const url = `${OPENDOTA_API_BASE}/heroes`;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 30000);
  const fetchFn = await getAppFetch();
  const response = await fetchFn(url, { signal: controller.signal });
  clearTimeout(timeout);

  if (!response.ok) {
    throw new Error(
      `OpenDota API error: ${response.status} ${response.statusText}`
    );
  }

  const heroes: Hero[] = await response.json();
  heroesCache = new Map(heroes.map((hero) => [hero.id, hero]));

  return heroesCache;
}

/**
 * Gets hero name by ID
 * Returns "Unknown" if hero not found
 */
export async function getHeroName(heroId: number): Promise<string> {
  const heroes = await fetchHeroes();
  const hero = heroes.get(heroId);
  return hero?.localized_name ?? "Unknown";
}

/**
 * Gets multiple hero names by IDs
 * Returns array of hero names in the same order
 */
export async function getHeroNames(heroIds: number[]): Promise<string[]> {
  const heroes = await fetchHeroes();
  return heroIds.map((id) => heroes.get(id)?.localized_name ?? "Unknown");
}

/**
 * Clears the heroes cache (useful for testing)
 */
export function clearHeroesCache(): void {
  heroesCache = null;
}
