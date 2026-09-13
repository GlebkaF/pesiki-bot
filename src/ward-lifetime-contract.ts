import type {WardLifetimes} from './replay.js';

/** Reject a malformed upgrade before it can replace previously retained observations. */
export function assertWardLifetimes(value:unknown):asserts value is WardLifetimes {
 const fail=():never=>{throw Error('Invalid ward lifetime observations');};
 if(!value||typeof value!=='object')fail();
 const raw=value as WardLifetimes,c=raw.coverage;
 const count=(n:unknown)=>Number.isSafeInteger(n)&&Number(n)>=0;
 const finite=(n:unknown)=>typeof n==='number'&&Number.isFinite(n);
 const nullable=(n:unknown)=>n===null||finite(n);
 const side=(s:unknown)=>s===null||s==='radiant'||s==='dire';
 const text=(s:unknown)=>s===null||typeof s==='string';
 if(raw.version!=='ward-lifetimes-v1'||!Array.isArray(raw.entries)||raw.entries.length>4096||!c||typeof c!=='object')fail();
 for(const key of ['entities_seen','entities_stored','owner_resolved','creation_time_known','death_observed','killer_matched','ambiguous_killer_matches','position_observed','moved_entities','dropped_entities','dropped_killer_events'] as const)if(!count(c[key]))fail();
 if(c.entities_stored!==raw.entries.length||c.entities_seen<c.entities_stored||typeof c.game_end_observed!=='boolean'||typeof c.truncated!=='boolean'||!nullable(c.tick_interval_seconds)||!nullable(c.max_death_observation_window_seconds))fail();
 if(c.clock_source!=='gamerules'||!count(c.clock_samples_dropped)||typeof c.clock_complete!=='boolean')fail();
 const ids=new Set<string>();
 for(const e of raw.entries){
  if(!e||typeof e.id!=='string'||!/^\d+:\d+(?::\d+)?$/.test(e.id)||ids.has(e.id)||!count(e.entity_index)||!count(e.entity_serial)||!['observer','sentry'].includes(e.kind)||!side(e.team)||!text(e.owner_hero)||!text(e.owner_steam_id))fail();
  if(e.id.split(':').slice(0,2).join(':')!==`${e.entity_index}:${e.entity_serial}`||!finite(e.first_observed_seconds)||!finite(e.last_observed_seconds)||e.last_observed_seconds<e.first_observed_seconds)fail();
  for(const n of [e.placed_seconds,e.death_observed_seconds,e.deleted_observed_seconds,e.left_observed_seconds])if(!nullable(n))fail();
  if(e.alive_at_end!==null&&typeof e.alive_at_end!=='boolean'||typeof e.position_moved!=='boolean'||typeof e.observation_complete!=='boolean')fail();
  const w=e.death_observation_window_seconds;if(w!==null&&(!w||!finite(w.from)||!finite(w.to)||w.to<w.from))fail();
  const p=e.position;if(p!==null&&(!p||p.source!=='ward_entity'||!finite(p.x)||!finite(p.y)))fail();
  const k=e.killer;if(k!==null&&(!k||k.source!=='unique-last-damage-match'||typeof k.attacker!=='string'||!text(k.attacker_hero)||!side(k.attacker_team)||!finite(k.combat_seconds)||typeof k.source_controlled!=='boolean'||typeof k.source_illusion!=='boolean'))fail();
  ids.add(e.id);
 }
}
