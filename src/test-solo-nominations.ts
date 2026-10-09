import assert from 'node:assert/strict';
import { summarizeSoloStats } from './solo-nominations.js';
import type { RecentMatch } from './opendota.js';
import { formatStatsMessage } from './formatter.js';
import type { PlayerStats } from './stats.js';
import { ApmStore } from './apm-store.js';
import type { ParsedMatch } from './replay.js';

const roster = Array.from({length: 10}, (_, i) => i + 1);
const match = (id: number, win = true, slot = 0): RecentMatch => ({
  match_id: id, player_slot: slot, radiant_win: win, start_time: 1,
  duration: 1800, hero_id: 1, kills: 1, deaths: 1, assists: 2,
});
const summarize = (matches: RecentMatch[], ids: (number | undefined)[] | undefined = roster) =>
  summarizeSoloStats(1, matches, [1, 99], () => ids);
assert.deepEqual(summarize([match(1), match(2, false), match(3, false, 128)]),
  { knownMatches: 3, matches: 3, wins: 2, losses: 1 });
for (const ids of [roster.slice(1), [...roster.slice(0, 9), undefined], [...roster.slice(0, 9), 0], [...roster.slice(0, 9), 1]]) {
  assert.equal(summarize([match(1)], ids).knownMatches, 0);
}
assert.equal(summarizeSoloStats(1, [match(1)], [1], () => undefined).knownMatches, 0);
assert.equal(summarize([match(1)], roster.map(id => id === 10 ? 99 : id)).matches, 0);
assert.equal(summarizeSoloStats(42, [match(1)], [42], () => roster).knownMatches, 0);
assert.equal(summarize([match(1), match(1)]).matches, 1);

const player: PlayerStats = {
  playerId: 1, playerName: 'Solo', totalMatches: 5, wins: 4, losses: 1, winRate: 80,
  heroes: [], totalKills: 10, totalDeaths: 5, totalAssists: 20,
  totalDurationSeconds: 9000, avgDurationSeconds: 1800, longMatches: 0,
  longWins: 0, nightMatches: 0, morningMatches: 0,
  solo: { knownMatches: 5, matches: 5, wins: 4, losses: 1 },
};
assert.ok((await formatStatsMessage([player])).includes('🐺 Одинокий волк: Solo (без наших 4W/1L)'));
assert.ok((await formatStatsMessage([{...player, solo: {...player.solo!, wins: 1, losses: 4}}])).includes('🍽️ Одинокий корм: Solo (без наших 1W/4L)'));
for (const p of [
  {...player, solo: undefined},
  {...player, solo: {...player.solo!, knownMatches: 4}},
  {...player, totalMatches: 2, solo: {knownMatches: 2, matches: 2, wins: 2, losses: 0}},
  {...player, totalMatches: 8, solo: {...player.solo!, knownMatches: 8}},
  {...player, solo: {...player.solo!, wins: 3, losses: 2}},
]) {
  const message = await formatStatsMessage([p]);
  assert.ok(!message.includes('Одинокий волк:') && !message.includes('Одинокий корм:'));
}
const boundary = {...player, totalMatches: 10, solo: {knownMatches: 10, matches: 7, wins: 7, losses: 0}};
assert.ok((await formatStatsMessage([boundary])).includes('Одинокий волк:'));
for (const [wins, losses, expected] of [
  [3, 0, 'волк'], [0, 3, 'корм'], [3, 1, 'волк'], [1, 3, 'корм'],
  [4, 2, 'волк'], [2, 4, 'корм'], [3, 3, ''], [5, 5, ''],
  [6, 4, ''], [4, 6, ''], [7, 3, 'волк'], [3, 7, 'корм'],
  [2, 1, ''], [1, 2, ''], [3, 2, ''], [2, 3, ''],
] as const) {
  const total = wins + losses;
  const report = await formatStatsMessage([{ ...player, totalMatches: total,
    solo: { knownMatches: total, matches: total, wins, losses } }]);
  assert.equal(report.includes('Одинокий волк:'), expected === 'волк', `${wins}W/${losses}L`);
  assert.equal(report.includes('Одинокий корм:'), expected === 'корм', `${wins}W/${losses}L`);
}
const store = new ApmStore(':memory:');
assert.equal(store.profileRoster(1), undefined);
store.saveReplay({match_id: 1, players: roster.map(id => ({steam_id: String(76561197960265728n + BigInt(id)), hero: `hero${id}`, team: id <= 5 ? 'radiant' : 'dire'})), duration_min: 30, winner: 'radiant'} as ParsedMatch);
assert.equal(store.profileRoster(1)?.players.length, 10);
console.log('Solo nomination checks passed');
