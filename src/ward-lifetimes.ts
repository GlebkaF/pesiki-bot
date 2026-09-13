import type {ParsedMatch} from './replay.js';
import {heroName} from './player-profile.js';

export interface WardLifetimeView {
 id:string;kind:'observer'|'sentry';team:'radiant'|'dire'|null;
 ownerHero:string|null;ownerLabel:string|null;ownerSteamId:string|null;
 position:{x:number;y:number}|null;positionMoved:boolean;
 placedSeconds:number|null;firstObservedSeconds:number;lastObservedSeconds:number;
 deathSeconds:number|null;deathWindow:{from:number;to:number}|null;deletedSeconds:number|null;leftSeconds:number|null;
 knownFromSeconds:number|null;knownUntilSeconds:number|null;observedDurationSeconds:number|null;
 endReason:'death-observed'|'replay-end'|'observation-lost'|'unknown';
 killer:{label:string;hero:string;team:'radiant'|'dire';seconds:number;controlled:boolean;illusion:boolean;source:'unique-last-damage-match'}|null;
}
export interface WardLifetimeModel {
 version:'ward-lifetimes-v1';entries:WardLifetimeView[];durationSeconds:number;
 coverage:{seen:number;stored:number;invalid:number;positioned:number;knownIntervals:number;unknownEnds:number;gameEndObserved:boolean;truncated:boolean;dropped:number};
}
const finite=(n:unknown):n is number=>typeof n==='number'&&Number.isFinite(n);
const count=(n:unknown):n is number=>Number.isSafeInteger(n)&&Number(n)>=0;
const side=(s:unknown):s is 'radiant'|'dire'=>s==='radiant'||s==='dire';
const normalize=(s:string)=>s.replace(/^npc_dota_hero_/,'').replace(/_/g,'');
/** Conservative display projection: a missing end never means that a ward lives forever. */
export function buildWardLifetimes(match:ParsedMatch):WardLifetimeModel|null {
 const raw=match.ward_lifetimes,duration=finite(match.apm_duration_seconds)&&match.apm_duration_seconds>0?match.apm_duration_seconds:match.duration_min*60;
 if(!raw||raw.version!=='ward-lifetimes-v1'||!Array.isArray(raw.entries)||!raw.coverage||!finite(duration)||duration<=0)return null;
 const c=raw.coverage;
 if(c.clock_source!=='gamerules'||!count(c.entities_seen)||!count(c.entities_stored)||c.entities_stored!==raw.entries.length||c.entities_seen<c.entities_stored||raw.entries.length>4096)return null;
 const ids=new Set<string>(),duplicateIds=new Set<string>();for(const e of raw.entries){if(e&&typeof e.id==='string'){if(ids.has(e.id))duplicateIds.add(e.id);ids.add(e.id);}}
 const entries:WardLifetimeView[]=[];let invalid=0;
 const bounded=(n:unknown):n is number=>finite(n)&&n>=-3600&&n<=duration+.25;
 for(const e of raw.entries){
  if(!e||typeof e.id!=='string'||!/^\d+:\d+(?::\d+)?$/.test(e.id)||duplicateIds.has(e.id)||!count(e.entity_index)||!count(e.entity_serial)||!['observer','sentry'].includes(e.kind)||!bounded(e.first_observed_seconds)||!bounded(e.last_observed_seconds)||e.last_observed_seconds<e.first_observed_seconds){invalid++;continue;}
  const owner=typeof e.owner_hero==='string'?match.players.filter(p=>normalize(p.hero)===normalize(e.owner_hero!)&&p.team===e.team&&(!e.owner_steam_id||p.steam_id===e.owner_steam_id)):[];
  const placed=bounded(e.placed_seconds)&&e.placed_seconds<=e.first_observed_seconds+.25?e.placed_seconds:null;
  const death=bounded(e.death_observed_seconds)&&e.death_observed_seconds>=e.first_observed_seconds?e.death_observed_seconds:null;
  const window=e.death_observation_window_seconds;
  const deathWindow=death!==null&&window&&bounded(window.from)&&bounded(window.to)&&window.from>=e.first_observed_seconds&&window.to>=window.from&&Math.abs(window.to-death)<.001?{from:window.from,to:window.to}:null;
  const deleted=bounded(e.deleted_observed_seconds)&&e.deleted_observed_seconds>=e.first_observed_seconds?e.deleted_observed_seconds:null;
  const left=bounded(e.left_observed_seconds)&&e.left_observed_seconds>=e.first_observed_seconds?e.left_observed_seconds:null;
  const complete=e.observation_complete===true&&placed!==null&&left===null;
  const aliveAtEnd=complete&&c.game_end_observed===true&&e.alive_at_end===true&&death===null&&deleted===null;
  const knownFrom=complete?Math.max(placed!,e.first_observed_seconds):null;
  const knownUntil=complete?Math.min(duration,deathWindow?.from??deleted??(aliveAtEnd?duration:e.last_observed_seconds)):null;
  const usable=knownFrom!==null&&knownUntil!==null&&knownUntil>=knownFrom;
  let killer:WardLifetimeView['killer']=null;
  const k=e.killer;
  if(owner.length===1&&k&&k.source==='unique-last-damage-match'&&typeof k.attacker_hero==='string'&&side(k.attacker_team)&&bounded(k.combat_seconds)&&deathWindow&&k.combat_seconds>=deathWindow.from-.001&&k.combat_seconds<=deathWindow.to+.001){
   const actors=match.players.filter(p=>normalize(p.hero)===normalize(k.attacker_hero!)&&p.team===k.attacker_team);
   if(actors.length===1)killer={label:heroName(actors[0].hero),hero:actors[0].hero,team:k.attacker_team,seconds:k.combat_seconds,controlled:k.source_controlled===true,illusion:k.source_illusion===true,source:'unique-last-damage-match'};
  }
  const position=e.position?.source==='ward_entity'&&finite(e.position.x)&&finite(e.position.y)&&e.position_moved!==true?{x:e.position.x,y:e.position.y}:null;
  entries.push({id:e.id,kind:e.kind,team:side(e.team)?e.team:null,ownerHero:owner.length===1?owner[0].hero:null,ownerLabel:owner.length===1?heroName(owner[0].hero):null,ownerSteamId:owner.length===1?owner[0].steam_id:null,
   position,positionMoved:e.position_moved===true,placedSeconds:placed,firstObservedSeconds:e.first_observed_seconds,lastObservedSeconds:e.last_observed_seconds,
   deathSeconds:death,deathWindow,deletedSeconds:deleted,leftSeconds:left,knownFromSeconds:usable?knownFrom:null,knownUntilSeconds:usable?knownUntil:null,observedDurationSeconds:usable?knownUntil!-knownFrom!:null,
   endReason:death!==null?'death-observed':aliveAtEnd?'replay-end':deleted!==null||left!==null?'observation-lost':'unknown',killer});
 }
 return {version:'ward-lifetimes-v1',entries,durationSeconds:duration,coverage:{seen:c.entities_seen,stored:c.entities_stored,invalid,positioned:entries.filter(e=>e.position).length,knownIntervals:entries.filter(e=>e.knownFromSeconds!==null).length,unknownEnds:entries.filter(e=>e.endReason==='unknown'||e.endReason==='observation-lost').length,gameEndObserved:c.game_end_observed===true,truncated:c.truncated===true,dropped:count(c.dropped_entities)?c.dropped_entities:0}};
}
