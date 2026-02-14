import { getAppFetch } from "./proxy.js";
import { getHeroNames } from "./heroes.js";
import { fetchItems } from "./items.js";

const OPENDOTA_API_BASE = "https://api.opendota.com/api";
const PRO_MATCH_SAMPLE_SIZE = 12;
const META_CACHE_TTL_MS = 10 * 60 * 1000;

interface ProMatch {
  match_id: number;
}

interface MatchPlayer {
  hero_id: number;
  player_slot: number;
  net_worth: number;
  isRadiant: boolean;
  win: number;
  item_0: number;
  item_1: number;
  item_2: number;
  item_3: number;
  item_4: number;
  item_5: number;
}

interface MatchDetails {
  match_id: number;
  players: MatchPlayer[];
}

type Role = "pos1" | "pos2" | "pos3" | "pos4" | "pos5";

const ROLE_LABELS: Record<Role, string> = {
  pos1: "🟢 Pos 1 (Carry)",
  pos2: "🟠 Pos 2 (Mid)",
  pos3: "🔵 Pos 3 (Offlane)",
  pos4: "🟣 Pos 4 (Soft Support)",
  pos5: "⚪ Pos 5 (Hard Support)",
};

interface HeroRoleStats {
  heroId: number;
  games: number;
  wins: number;
  itemCounts: Map<number, number>;
}

interface MetaCacheEntry {
  text: string;
  expiresAt: number;
}

let metaCache: MetaCacheEntry | null = null;

async function fetchProMatches(limit: number): Promise<ProMatch[]> {
  const fetchFn = await getAppFetch();
  const url = `${OPENDOTA_API_BASE}/proMatches`;
  const response = await fetchFn(url);
  if (!response.ok) {
    throw new Error(`OpenDota API error for /proMatches: ${response.status}`);
  }

  const data: ProMatch[] = await response.json();
  return data.slice(0, limit);
}

async function fetchMatchDetails(matchId: number): Promise<MatchDetails> {
  const fetchFn = await getAppFetch();
  const url = `${OPENDOTA_API_BASE}/matches/${matchId}`;
  const response = await fetchFn(url);
  if (!response.ok) {
    throw new Error(`OpenDota API error for /matches/${matchId}: ${response.status}`);
  }
  return response.json();
}

function getRoleByNetWorthOrder(orderIndex: number): Role {
  if (orderIndex === 0) return "pos1";
  if (orderIndex === 1) return "pos2";
  if (orderIndex === 2) return "pos3";
  if (orderIndex === 3) return "pos4";
  return "pos5";
}

function addPlayerToStats(
  roleStats: Map<Role, Map<number, HeroRoleStats>>,
  role: Role,
  player: MatchPlayer,
): void {
  const heroMap = roleStats.get(role);
  if (!heroMap) return;

  let hero = heroMap.get(player.hero_id);
  if (!hero) {
    hero = {
      heroId: player.hero_id,
      games: 0,
      wins: 0,
      itemCounts: new Map<number, number>(),
    };
    heroMap.set(player.hero_id, hero);
  }

  hero.games += 1;
  hero.wins += player.win;

  const items = [
    player.item_0,
    player.item_1,
    player.item_2,
    player.item_3,
    player.item_4,
    player.item_5,
  ].filter((itemId) => itemId > 0);

  for (const itemId of items) {
    hero.itemCounts.set(itemId, (hero.itemCounts.get(itemId) ?? 0) + 1);
  }
}

function buildRoleStats(matches: MatchDetails[]): Map<Role, Map<number, HeroRoleStats>> {
  const stats = new Map<Role, Map<number, HeroRoleStats>>([
    ["pos1", new Map()],
    ["pos2", new Map()],
    ["pos3", new Map()],
    ["pos4", new Map()],
    ["pos5", new Map()],
  ]);

  for (const match of matches) {
    const radiant = match.players
      .filter((p) => p.isRadiant)
      .sort((a, b) => (b.net_worth ?? 0) - (a.net_worth ?? 0));
    const dire = match.players
      .filter((p) => !p.isRadiant)
      .sort((a, b) => (b.net_worth ?? 0) - (a.net_worth ?? 0));

    radiant.forEach((player, i) => addPlayerToStats(stats, getRoleByNetWorthOrder(i), player));
    dire.forEach((player, i) => addPlayerToStats(stats, getRoleByNetWorthOrder(i), player));
  }

  return stats;
}

function formatBuild(itemCounts: Map<number, number>, itemNames: Map<number, string>): string {
  const topItems = Array.from(itemCounts.entries())
    .sort((a, b) => b[1] - a[1])
    .slice(0, 6)
    .map(([itemId]) => itemNames.get(itemId) ?? `Item #${itemId}`);

  return topItems.length > 0 ? topItems.join(" → ") : "Нет данных";
}

export async function getProMetaByRole(): Promise<string> {
  if (metaCache && Date.now() < metaCache.expiresAt) {
    return metaCache.text;
  }

  const proMatches = await fetchProMatches(PRO_MATCH_SAMPLE_SIZE);
  const matchDetails = await Promise.all(proMatches.map((m) => fetchMatchDetails(m.match_id)));

  const roleStats = buildRoleStats(matchDetails);
  const allHeroIds = new Set<number>();
  for (const heroMap of roleStats.values()) {
    for (const heroId of heroMap.keys()) {
      allHeroIds.add(heroId);
    }
  }

  const heroIdList = Array.from(allHeroIds);
  const heroNamesList = await getHeroNames(heroIdList);
  const heroNames = new Map(heroIdList.map((id, index) => [id, heroNamesList[index]]));

  const items = await fetchItems();
  const itemNames = new Map<number, string>();
  for (const [itemId, item] of items.entries()) {
    itemNames.set(itemId, item.dname);
  }

  const lines: string[] = [
    "📈 <b>Pro Tracker Meta (топ-3 героя по ролям)</b>",
    `<i>Выборка: последние ${proMatches.length} pro-матчей OpenDota</i>`,
    "",
  ];

  (Object.keys(ROLE_LABELS) as Role[]).forEach((role) => {
    const heroMap = roleStats.get(role);
    if (!heroMap || heroMap.size === 0) {
      lines.push(`${ROLE_LABELS[role]}: нет данных`, "");
      return;
    }

    const topHeroes = Array.from(heroMap.values())
      .filter((h) => h.games >= 2)
      .sort((a, b) => {
        if (b.games !== a.games) return b.games - a.games;
        return b.wins / b.games - a.wins / a.games;
      })
      .slice(0, 3);

    lines.push(`<b>${ROLE_LABELS[role]}</b>`);

    if (topHeroes.length === 0) {
      lines.push("• Недостаточно данных", "");
      return;
    }

    topHeroes.forEach((hero, index) => {
      const heroName = heroNames.get(hero.heroId) ?? `Hero #${hero.heroId}`;
      const winRate = ((hero.wins / hero.games) * 100).toFixed(1);
      const build = formatBuild(hero.itemCounts, itemNames);
      lines.push(
        `${index + 1}. <b>${heroName}</b> — WR: <b>${winRate}%</b> (${hero.wins}/${hero.games})`,
        `   Билд: ${build}`,
      );
    });

    lines.push("");
  });

  const text = lines.join("\n").trim();
  metaCache = {
    text,
    expiresAt: Date.now() + META_CACHE_TTL_MS,
  };

  return text;
}
