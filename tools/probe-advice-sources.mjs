// Read-only research probe. Does not load bot credentials, contact Steam, or send messages.
// node tools/probe-advice-sources.mjs [hero IDs, default: Invoker, Lich, Ancient Apparition]
const revision = 'b4b5a8299de5f3e0704e62fdd04a6a54c4d4548e';
const constantsBase = `https://raw.githubusercontent.com/odota/dotaconstants/${revision}/build`;
const apiBase = 'https://api.opendota.com/api';
const heroIds = [...new Set(process.argv.slice(2).length ? process.argv.slice(2).map(Number) : [74, 31, 68])];
if (heroIds.length > 5 || heroIds.some(id => !Number.isSafeInteger(id) || id <= 0)) {
  throw Error('Supply one to five positive hero IDs');
}
const report = { checkedAt: new Date().toISOString(), constantsRevision: revision, requests: [], heroes: [] };
let limited = false;
async function read(url) {
  if (limited && url.startsWith(apiBase)) return undefined;
  const record = { url };
  report.requests.push(record);
  try {
    const response = await fetch(url, { signal: AbortSignal.timeout(12000) });
    record.status = response.status;
    if (response.status === 429) limited = true;
    if (!response.ok) return undefined;
    return await response.json();
  } catch {
    record.error = 'Network, timeout, or invalid JSON';
    return undefined;
  }
}
const items = await read(`${constantsBase}/items.json`);
const heroes = await read(`${constantsBase}/heroes.json`);
const byId = new Map(Object.entries(items ?? {}).map(([key, item]) => [String(item.id), { key, ...item }]));
const stats = await read(`${apiBase}/heroStats`);
for (const heroId of heroIds) {
  const popularity = await read(`${apiBase}/heroes/${heroId}/itemPopularity`);
  const hero = { heroId, name: heroes?.[heroId]?.localized_name ?? null, popularity: {}, turbo: null };
  const heroStats = Array.isArray(stats) ? stats.find(row => row.id === heroId) : undefined;
  if (Number.isSafeInteger(heroStats?.turbo_picks) && Number.isSafeInteger(heroStats?.turbo_wins)
      && heroStats.turbo_picks > 0 && heroStats.turbo_wins >= 0 && heroStats.turbo_wins <= heroStats.turbo_picks) {
    hero.turbo = { picks: heroStats.turbo_picks, wins: heroStats.turbo_wins,
      note: 'Hero aggregate only; not Turbo item builds or evidence that an item improves win rate.' };
  }
  for (const phase of ['start_game_items', 'early_game_items', 'mid_game_items', 'late_game_items']) {
    const values = popularity?.[phase];
    if (!values || typeof values !== 'object' || Array.isArray(values)) continue;
    hero.popularity[phase] = Object.entries(values)
      .filter(([id, count]) => /^\d+$/.test(id) && Number.isSafeInteger(count) && count >= 0)
      .sort((a, b) => b[1] - a[1]).slice(0, 8)
      .map(([id, purchases]) => {
        const item = byId.get(id);
        return { itemId: Number(id), name: item?.dname ?? null, key: item?.key ?? null,
          purchases, cost: item?.cost ?? null, components: item?.components ?? null };
      });
  }
  report.heroes.push(hero);
}
report.limitations = [
  'This is a source availability probe, not a personalized recommendation or production integration.',
  'Popularity is purchase-event counts, not percentage of players, win rate, or optimal purchase order.',
  'OpenDota describes popularity as professional games; current source selects at most 100 parsed hero records.',
  'Popularity does not expose patch, role, mode, match dates, or actual sample size; do not transfer timings to Turbo.',
  'A pinned constants revision is reproducible, but is not proof every field matches the current letter patch.',
  'Requests stop on OpenDota 429. Missing data remains missing; no guessed fallback statistics.'
];
console.log(JSON.stringify(report, null, 2));
if (!items || report.heroes.every(hero => Object.keys(hero.popularity).length === 0)) process.exitCode = 1;
