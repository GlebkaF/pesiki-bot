import assert from 'node:assert/strict';
import { replayNominations, summarizeReplayNominations } from './replay-nominations.js';
import type { ParsedMatch, CombatTimelineRow } from './replay.js';

function fixture(): ParsedMatch {
  const players = Array.from({ length: 10 }, (_, i) => ({
    steam_id: String(76561197960265728n + BigInt(i + 1)), hero: `hero${i}`,
    team: i < 5 ? 'radiant' : 'dire',
    combat_details: { coverage: { ward_placements: true }, dropped_events: 0, casts: [],
      wards: i === 0 ? [{ event: 'place', kind: 'observer' }, { event: 'purchase', kind: 'observer' }, { event: 'place', kind: 'sentry' }] : [] },
  }));
  // Three separate fights: player 0 is absent; players 1-4 and two enemies fight.
  const damage: CombatTimelineRow[] = [60, 180, 300].flatMap(second =>
    [1, 2, 3, 4].map(owner => [second, 0, owner, owner % 2 + 5, 0, 0, 0, 100] as CombatTimelineRow));
  return {
    match_id: 1, duration_min: 10, players,
    teamfights: [1, 3, 5].map(min => ({ start_min: min, end_min: min + .1 })),
    combat_timeline: { version: 'combat-timeline-v1', bucket_seconds: 1,
      heroes: players.map(p => p.hero), sources: ['hero'], abilities: ['attack'], damage, healing: [],
      coverage: { target_scope: 'real-heroes', damage_events: 12, healing_events: 0,
        stored_damage_events: 12, stored_healing_events: 0, owner_known_damage_events: 12,
        damage_rows: 12, healing_rows: 0, dropped_events: 0, truncated: false,
        complete_until_second: null, row_limit: 1000, byte_limit: 100000 } },
  } as unknown as ParsedMatch;
}
const m = fixture(), id = m.players[0].steam_id;
const absent = replayNominations(m).get(id)!;
assert.deepEqual(absent, { wardMatches: 1, observers: 1, fightMatches: 1, fights: 3, participated: 0, teammateParticipations: 12 });
// Receiving damage counts, not just dealing it.
assert.equal(replayNominations(m).get(m.players[5].steam_id)!.participated, 0); // Their team has only two participants: no team fight denominator.
const support = fixture();
support.players[0].combat_details!.casts = [1, 3, 5].map(min => ({ min, ability: 'save', target: 'npc_dota_hero_hero1' }));
assert.equal(replayNominations(support).get(id)!.participated, 3);
const controller = fixture();
controller.players[0].combat_details!.modifiers = [{ min: 1.2, elapsed: 5, target: 'hero5', modifier: 'stun', stun: 5 }];
assert.equal(replayNominations(controller).get(id)!.participated, 1);
const tank = fixture();
tank.combat_timeline!.damage[0][2] = 5;
tank.combat_timeline!.damage[0][3] = 0;
assert.equal(replayNominations(tank).get(id)!.participated, 1);
const healer = fixture();
healer.combat_timeline!.healing.push([60, 0, 0, 1, 0, 0, 0, 100]);
Object.assign(healer.combat_timeline!.coverage, { healing_events: 1, stored_healing_events: 1, healing_rows: 1 });
assert.equal(replayNominations(healer).get(id)!.participated, 1);
const overlapping = fixture(); overlapping.teamfights.push({ ...overlapping.teamfights[0] });
assert.equal(replayNominations(overlapping).get(id)!.fights, 3);
// Missing coverage does not turn into an absence.
const missing = fixture(); delete missing.combat_timeline;
assert.equal(replayNominations(missing).get(id)!.fightMatches, 0);
const truncated = fixture(); truncated.combat_timeline!.coverage.truncated = true;
assert.equal(replayNominations(truncated).get(id)!.fightMatches, 0);
const unknown = fixture(); unknown.combat_timeline!.damage[0][2] = -1;
assert.equal(replayNominations(unknown).get(id)!.fightMatches, 0);
const dropped = fixture(); dropped.players[0].combat_details!.dropped_events = 1;
assert.equal(replayNominations(dropped).get(id)!.wardMatches, 0);
assert.equal(replayNominations(dropped).get(id)!.fightMatches, 0);
const summary = summarizeReplayNominations(1, [{match_id: 1}, {match_id: 1}, {match_id: 2}], matchId => matchId === 1 ? replayNominations(m) : undefined);
assert.deepEqual(summary, absent);
console.log('Replay nomination checks passed');
