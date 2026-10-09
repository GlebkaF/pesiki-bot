import type { ParsedMatch } from './replay.js';
import { buildMatchCombatWindow } from './match-combat-window.js';

export interface ReplayNominationStats {
  wardMatches: number;
  observers: number;
  fightMatches: number;
  fights: number;
  participated: number;
  teammateParticipations: number;
}
export const emptyReplayNominations = (): ReplayNominationStats => ({
  wardMatches: 0, observers: 0, fightMatches: 0, fights: 0,
  participated: 0, teammateParticipations: 0,
});
const normalize = (hero: string) => hero.replace(/^npc_dota_hero_/, '').replace(/_/g, '');

/** Observed combat participation, not kill participation or proximity to a fight. */
export function replayNominations(match: ParsedMatch): Map<string, ReplayNominationStats> {
  const result = new Map(match.players.map(p => [p.steam_id, emptyReplayNominations()]));
  for (const p of match.players) {
    const c = p.combat_details;
    if (c?.coverage.ward_placements && c.dropped_events === 0) {
      const stats = result.get(p.steam_id)!;
      stats.wardMatches = 1;
      stats.observers = c.wards.filter(w => w.event === 'place' && w.kind === 'observer').length;
    }
  }
  const duration = match.apm_duration_seconds ?? match.duration_min * 60;
  const validation = buildMatchCombatWindow(match, 0, duration);
  // Missing/truncated logs must never look like non-participation.
  if (validation.coverage.state !== 'complete' ||
      match.players.length !== 10 || new Set(match.players.map(p => p.steam_id)).size !== 10 ||
      ['radiant', 'dire'].some(team => match.players.filter(p => p.team === team).length !== 5) ||
      match.players.some(p => !p.combat_details || p.combat_details.dropped_events !== 0)) return result;
  const timeline = match.combat_timeline!;
  // Unowned lane creeps/buildings and neutral creeps are normal environmental damage.
  // Unknown hero/summon owners could hide a player's contribution: abstain in that case.
  const environment = /^(?:dota_fountain$|npc_dota_(?:creep_|neutral_|goodguys_(?:tower|siege)|badguys_(?:tower|siege)|roshan$|dark_troll_warlord_skeleton_warrior$|miniboss$|enraged_wildkin_tornado$))/;
  if ([...timeline.damage, ...timeline.healing].some(row =>
    row[2] < 0 && !environment.test(timeline.sources[row[1]])
  )) return result;
  const heroes = new Map(match.players.map((p, i) => [normalize(p.hero), i]));
  // Parser fight windows are based on deaths. Include the lead-in and immediate aftermath.
  const windows: { start: number; end: number }[] = [];
  for (const fight of [...match.teamfights].sort((a, b) => a.start_min - b.start_min)) {
    if (!Number.isFinite(fight.start_min) || !Number.isFinite(fight.end_min) || fight.end_min < fight.start_min) return result;
    const start = Math.max(0, Math.floor(fight.start_min * 60) - 10);
    const end = Math.min(duration, Math.ceil(fight.end_min * 60) + 5);
    if (end <= start) continue;
    const prev = windows.at(-1);
    if (prev && start <= prev.end) prev.end = Math.max(prev.end, end);
    else windows.push({ start, end });
  }
  for (const stats of result.values()) stats.fightMatches = 1;
  for (const { start, end } of windows) {
    const participants = new Set<number>();
    for (const [second, , owner, target, , , , amount] of timeline.damage) {
      if (second < start || second >= end || owner < 0 || amount <= 0 ||
          match.players[owner].team === match.players[target].team) continue;
      participants.add(owner);
      participants.add(target); // Tanking is participation too.
    }
    // Healing an ally already involved in combat also counts; self-healing does not.
    for (const [second, , owner, target, , , , amount] of timeline.healing) {
      if (second >= start && second < end && owner >= 0 && owner !== target && amount > 0 &&
          match.players[owner].team === match.players[target].team && participants.has(target)) participants.add(owner);
    }
    // Include targeted control and support casts so zero-damage supports are not penalized.
    match.players.forEach((p, i) => {
      for (const cast of p.combat_details!.casts) {
        const target = cast.target ? heroes.get(normalize(cast.target)) : undefined;
        if (cast.min * 60 >= start && cast.min * 60 < end && target !== undefined && target !== i &&
            (match.players[target].team !== p.team || participants.has(target))) participants.add(i);
      }
      for (const modifier of p.combat_details!.modifiers ?? []) {
        const target = heroes.get(normalize(modifier.target));
        const until = modifier.min * 60;
        const since = until - (modifier.elapsed ?? 0);
        const control = (modifier.stun ?? 0) > 0 || (modifier.slow ?? 0) > 0 || modifier.silence || modifier.root;
        if (control && target !== undefined && match.players[target].team !== p.team &&
            Number.isFinite(since) && since < end && until >= start) participants.add(i);
      }
    });
    for (const team of ['radiant', 'dire'] as const) {
      const allies = match.players.map((p, i) => p.team === team ? i : -1).filter(i => i >= 0);
      const involved = allies.filter(i => participants.has(i)).length;
      const enemies = [...participants].filter(i => match.players[i].team !== team).length;
      if (involved < 3 || enemies < 2) continue; // Exclude duels and small ganks.
      for (const i of allies) {
        const stats = result.get(match.players[i].steam_id)!;
        const present = Number(participants.has(i));
        stats.fights++;
        stats.participated += present;
        stats.teammateParticipations += involved - present;
      }
    }
  }
  return result;
}

export function summarizeReplayNominations(
  accountId: number, matches: { match_id: number }[],
  load: (matchId: number) => Map<string, ReplayNominationStats> | undefined,
): ReplayNominationStats {
  const result = emptyReplayNominations();
  const steamId = String(BigInt(accountId) + 76561197960265728n);
  for (const matchId of new Set(matches.map(m => m.match_id))) {
    const stats = load(matchId)?.get(steamId);
    if (stats) for (const key of Object.keys(result) as (keyof ReplayNominationStats)[]) result[key] += stats[key];
  }
  return result;
}
