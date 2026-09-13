import type {ParsedMatch,HeroCounterWindow,HeroDeathJournalEntry} from './replay.js';
import {heroName} from './player-profile.js';
import {verifiedReplayScoreboard} from './replay-scoreboard.js';
import {assertHeroDeathJournal} from './hero-death-contract.js';

export interface HeroDeathView {
 id:string;seconds:number;status:HeroDeathJournalEntry['status'];victim:number|null;killer:number|null;
 attribution:HeroDeathJournalEntry['attribution'];x:number|null;y:number|null;coordinatesSource:string|null;legacyDeathId:string|null;
 sourceControlled:boolean;sourceIllusion:boolean;deathCounter:HeroCounterWindow|null;killCounter:HeroCounterWindow|null;
}
export interface HeroDeathModel {
 players:{hero:string;heroLabel:string;steamId:string;team:'radiant'|'dire'}[];
 entries:HeroDeathView[];cells:{killer:number;victim:number;count:number|null;eventIds:string[]}[];
 coverage:{complete:boolean;verifiedDeaths:number;verifiedKills:number;reincarnations:number;unresolved:number;nonHeroKills:number;invalid:number};
}
const finite=(n:unknown):n is number=>typeof n==='number'&&Number.isFinite(n);
const integer=(n:unknown):n is number=>Number.isSafeInteger(n)&&Number(n)>=0;
const norm=(s:string)=>s.replace(/^npc_dota_hero_/,'').replace(/_/g,'');
const counter=(c:HeroCounterWindow|null|undefined,seconds:number):c is HeroCounterWindow=>!!c&&c.source==='CDOTA_PlayerResource'&&finite(c.from)&&finite(c.to)&&c.to>=c.from&&seconds>=c.from-.01&&seconds<=c.to+.01&&[c.before,c.after,c.delta].every(integer)&&c.after-c.before===c.delta;
const key=(index:number,c:HeroCounterWindow)=>[index,c.from,c.to,c.before,c.after,c.delta].join(':');

/** Derive rivalries from independently observed counter increments, never from final KDA subtraction. */
export function buildHeroDeathJournal(match:ParsedMatch):HeroDeathModel|null {
 const raw=match.hero_death_journal;
 try{assertHeroDeathJournal(raw);}catch{return null;}
 const c=raw.coverage;
 if(!Array.isArray(match.players))return null;
 const duration=finite(match.apm_duration_seconds)&&match.apm_duration_seconds>0?match.apm_duration_seconds:match.duration_min*60;
 if(!finite(duration)||duration<0)return null;
 const legacyDuration=Math.round(Math.max(0,match.duration_min)*60);
 const players=match.players.map(p=>({hero:p.hero,heroLabel:heroName(p.hero),steamId:p.steam_id,team:p.team}));
 function identity(hero:string|null,steam:string|null,team:string|null,slot:number|null):number|null {
  if(typeof hero!=='string'||(team!=='radiant'&&team!=='dire'))return null;
  const found=match.players.flatMap((p,i)=>{const s=verifiedReplayScoreboard(p);return norm(p.hero)===norm(hero)&&p.team===team&&(!steam||p.steam_id===steam)&&(slot===null||!s||s.resource_slot===slot)?[i]:[];});
  return found.length===1?found[0]:null;
 }
 const seen=new Set<string>(),duplicates=new Set<string>();for(const e of raw.entries){if(e&&typeof e.id==='string'){if(seen.has(e.id))duplicates.add(e.id);seen.add(e.id);}}
 let invalid=0;
 const rows=raw.entries.flatMap(e=>{
  if(!e||typeof e.id!=='string'||duplicates.has(e.id)||!finite(e.seconds)||e.seconds< -3600||e.seconds>duration+.25){invalid++;return [];}
  const candidateVictim=identity(e.victim_hero,e.victim_steam_id,e.victim_team,e.victim_resource_slot),candidateKiller=identity(e.killer_hero,e.killer_steam_id,e.killer_team,e.killer_resource_slot);
  const victim=candidateVictim!==null&&e.raw_target.startsWith('npc_dota_hero_')&&norm(e.raw_target)===norm(players[candidateVictim].hero)?candidateVictim:null;
  const killer=candidateKiller!==null&&e.raw_source?.startsWith('npc_dota_hero_')&&norm(e.raw_source)===norm(players[candidateKiller].hero)&&e.attacker_team===players[candidateKiller].team?candidateKiller:null;
  const d=counter(e.death_counter,e.seconds)?e.death_counter:null,k=counter(e.kill_counter,e.seconds)?e.kill_counter:null;
  let status:HeroDeathView['status']='unverified';
  if(e.status==='contradiction')status='contradiction';
  else if(e.status==='verified_death'&&e.will_reincarnate!==true&&victim!==null&&d&&d.delta>0)status='verified_death';
  else if(e.status==='verified_reincarnation'&&victim!==null&&e.will_reincarnate===true&&d?.delta===0)status='verified_reincarnation';
  const eligibleKiller=status==='verified_death'&&killer!==null&&victim!==null&&players[killer].team!==players[victim].team&&e.attribution==='verified_enemy_kill'&&k&&k.delta>0?killer:null;
  return [{raw:e,view:{id:e.id,seconds:e.seconds,status,victim,killer:eligibleKiller,attribution:eligibleKiller!==null?'verified_enemy_kill':e.attribution==='verified_enemy_kill'?'unknown':e.attribution,x:null,y:null,coordinatesSource:null,legacyDeathId:null,sourceControlled:e.source_controlled===true,sourceIllusion:e.source_illusion===true,deathCounter:d,killCounter:eligibleKiller!==null?k:null} as HeroDeathView}];
 });
 // Every event claiming a shared delta must account for that whole delta exactly once.
 const deaths=new Map<string,typeof rows>(),kills=new Map<string,typeof rows>();
 for(const row of rows){const v=row.view;if(v.status==='verified_death'&&v.victim!==null&&v.deathCounter){const k=key(v.victim,v.deathCounter);deaths.set(k,[...(deaths.get(k)??[]),row]);}if(v.killer!==null&&v.killCounter){const k=key(v.killer,v.killCounter);kills.set(k,[...(kills.get(k)??[]),row]);}}
 // Distinct groups cannot each claim the same counter increment with slightly
 // different observation windows. Keep unrelated, fully proved groups usable.
 function incompleteGroups(groups:Map<string,typeof rows>,field:'deathCounter'|'killCounter'){
  const bad=new Set<typeof rows>(),all=[...groups.values()];
  for(const group of all){const window=group[0].view[field]!;if(group.length!==window.delta)bad.add(group);}
  for(let i=0;i<all.length;i++)for(let j=i+1;j<all.length;j++){
   const a=all[i][0].view,b=all[j][0].view,owner=field==='deathCounter'?'victim':'killer';
   const x=a[field]!,y=b[field]!;
   if(a[owner]===b[owner]&&Math.max(x.before,y.before)<Math.min(x.after,y.after)){bad.add(all[i]);bad.add(all[j]);}
  }
  return bad;
 }
 const badDeaths=incompleteGroups(deaths,'deathCounter'),badKills=incompleteGroups(kills,'killCounter');
 for(const group of badDeaths)for(const {view:v} of group){v.status='contradiction';v.killer=null;v.killCounter=null;v.attribution='unknown';}
 for(const group of kills.values())if(badKills.has(group)||group.some(r=>r.view.status!=='verified_death'))for(const {view:v} of group){v.killer=null;v.killCounter=null;v.attribution='unknown';}
 // Reuse an existing death point/recap only when victim and precise combat time match uniquely.
 const pointCandidates=rows.map(({view:v})=>{
  if(v.victim===null)return [];
  const details=match.players[v.victim].combat_details;
  if(!details||!['combat-log-v1','combat-log-v2','combat-log-v3'].includes(details.version)||!Array.isArray(details.deaths))return [];
  // MatchInsights assigns recap indices after this exact version/time filter.
  const filtered=details.deaths.filter(d=>d&&finite(d.min)&&d.min>=0&&d.min*60<=legacyDuration);
  return filtered.flatMap((d,i)=>Math.abs(d.min*60-v.seconds)<=.031+1e-9?[{death:d,index:i,player:v.victim!}]:[]);
 });
 const pointUses=new Map<string,number>();for(const group of pointCandidates)for(const p of group){const k=p.player+':'+p.index;pointUses.set(k,(pointUses.get(k)??0)+1);}
 rows.forEach(({view:v},i)=>{const group=pointCandidates[i];if(group.length!==1)return;const p=group[0];if(pointUses.get(p.player+':'+p.index)!==1)return;
  if(finite(p.death.x)&&finite(p.death.y)){v.x=p.death.x;v.y=p.death.y;v.coordinatesSource=p.death.coordinates_source??null;}
  if(v.status==='verified_death'&&v.seconds>=0)v.legacyDeathId=match.players[p.player].steam_id+':'+p.index;
 });
 const entries=rows.map(r=>r.view),verifiedDeaths=entries.filter(e=>e.status==='verified_death').length,verifiedKills=entries.filter(e=>e.killer!==null).length,reincarnations=entries.filter(e=>e.status==='verified_reincarnation').length;
 const unresolved=entries.filter(e=>e.status==='unverified'||e.status==='contradiction'||e.status==='verified_death'&&e.killer===null&&e.attribution==='unknown').length;
 const rosterHeroes=new Set(players.map(p=>norm(p.hero))),rosterAccounts=new Set(players.map(p=>p.steamId));
 const auditHeroes=new Set(c.final_audit.map(a=>norm(a.hero)));
 const audit=c.final_audit.length===players.length&&rosterHeroes.size===players.length&&rosterAccounts.size===players.length&&auditHeroes.size===players.length&&c.final_audit.every(a=>{
  const index=players.findIndex(p=>norm(p.hero)===norm(a.hero));if(index<0)return false;
  const deaths=entries.filter(e=>e.status==='verified_death'&&e.victim===index).length,kills=entries.filter(e=>e.killer===index).length;
  const official=verifiedReplayScoreboard(match.players[index]);
  return a.deaths_match===true&&a.kills_match===true&&a.death_events===deaths&&a.kill_events===kills&&a.counter_deaths===deaths&&a.counter_kills===kills&&(!official||official.deaths===a.counter_deaths&&official.kills===a.counter_kills);
 });
 const complete=c.clock_complete===true&&c.game_end_observed===true&&c.truncated===false&&c.counter_resets===0&&c.raw_deaths===raw.entries.length&&invalid===0&&unresolved===0&&audit&&verifiedDeaths===c.verified_deaths&&verifiedKills===c.verified_kills&&reincarnations===c.verified_reincarnations;
 const cells=players.flatMap((a,killer)=>players.flatMap((b,victim)=>a.team!==b.team?[{killer,victim,count:entries.filter(e=>e.killer===killer&&e.victim===victim).length|| (complete?0:null),eventIds:entries.filter(e=>e.killer===killer&&e.victim===victim).map(e=>e.id)}]:[]));
 return {players,entries,cells,coverage:{complete,verifiedDeaths,verifiedKills,reincarnations,unresolved,nonHeroKills:entries.filter(e=>e.status==='verified_death'&&e.killer===null&&['allied_deny','self','environment'].includes(e.attribution)).length,invalid}};
}
