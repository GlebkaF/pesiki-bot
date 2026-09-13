import type {HeroDeathJournal} from './replay.js';
/** Validate the additive journal before it can replace retained observations. */
export function assertHeroDeathJournal(value:unknown):asserts value is HeroDeathJournal {
 const fail=():never=>{throw Error('Invalid hero death journal');};
 const object=(x:unknown)=>!!x&&typeof x==='object'&&!Array.isArray(x);
 const count=(x:unknown)=>Number.isSafeInteger(x)&&Number(x)>=0;
 const finite=(x:unknown)=>typeof x==='number'&&Number.isFinite(x);
 const text=(x:unknown)=>x===null||typeof x==='string'&&x.length>0;
 const side=(x:unknown)=>x===null||x==='radiant'||x==='dire';
 const flag=(x:unknown)=>x===null||typeof x==='boolean';
 const slot=(x:unknown)=>x===null||count(x)&&Number(x)<64;
 if(!object(value))fail();const raw=value as HeroDeathJournal,c=raw.coverage;
 if(raw.version!=='hero-death-journal-v1'||!Array.isArray(raw.entries)||raw.entries.length>4096||!object(c))fail();
 if(c.clock_source!=='gamerules'||typeof c.clock_complete!=='boolean'||typeof c.game_end_observed!=='boolean'||typeof c.truncated!=='boolean')fail();
 for(const k of ['raw_deaths','entries_stored','verified_deaths','verified_reincarnations','verified_kills','unverified','contradictions','counter_resets','dropped_events','dropped_counter_samples'] as const)if(!count(c[k]))fail();
 if(c.entries_stored!==raw.entries.length||c.raw_deaths<c.entries_stored+c.dropped_events||(!c.truncated&&(c.dropped_events>0||c.dropped_counter_samples>0)))fail();
 const ids=new Set<string>();let deaths=0,returns=0,kills=0,unknown=0,contradictions=0;
 for(const e of raw.entries){
  if(!object(e)||typeof e.id!=='string'||!/^death-[1-9]\d*$/.test(e.id)||ids.has(e.id)||!finite(e.seconds))fail();ids.add(e.id);
  for(const v of [e.victim_hero,e.victim_steam_id,e.killer_hero,e.killer_steam_id,e.raw_source])if(!text(v))fail();
  if(typeof e.raw_target!=='string'||typeof e.raw_attacker!=='string'||![e.victim_team,e.killer_team,e.attacker_team].every(side)||!slot(e.victim_resource_slot)||!slot(e.killer_resource_slot)||!flag(e.will_reincarnate)||typeof e.source_controlled!=='boolean'||typeof e.source_illusion!=='boolean')fail();
  if(!['verified_death','verified_reincarnation','unverified','contradiction'].includes(e.status)||!['verified_enemy_kill','allied_deny','self','environment','unknown'].includes(e.attribution))fail();
  for(const w of [e.death_counter,e.kill_counter])if(w!==null){
   if(!object(w)||w.source!=='CDOTA_PlayerResource'||!finite(w.from)||!finite(w.to)||w.to<w.from||!count(w.before)||!count(w.after)||!Number.isSafeInteger(w.delta)||w.delta!==w.after-w.before)fail();
   // Combat timestamps are float32 while counter times are float64; permit rounding only.
   const rounding=.01;if(e.seconds<w.from-rounding||e.seconds>w.to+rounding)fail();
  }
  if(e.status==='verified_death'){deaths++;if(!e.death_counter||e.death_counter.delta<=0||!e.victim_hero||!e.victim_steam_id||!e.victim_team||e.victim_resource_slot===null||e.will_reincarnate===true)fail();}
  else if(e.status==='verified_reincarnation'){returns++;if(e.will_reincarnate!==true||!e.death_counter||e.death_counter.delta!==0||!e.victim_hero||!e.victim_team||e.victim_resource_slot===null)fail();}
  else if(e.status==='contradiction')contradictions++;else unknown++;
  if(e.attribution==='verified_enemy_kill'){kills++;if(e.status!=='verified_death'||!e.kill_counter||e.kill_counter.delta<=0||!e.killer_hero||!e.killer_steam_id||!e.killer_team||e.killer_resource_slot===null||e.killer_team===e.victim_team||e.killer_team!==e.attacker_team)fail();}
 }
 if(c.verified_deaths!==deaths||c.verified_reincarnations!==returns||c.verified_kills!==kills||c.unverified!==unknown||c.contradictions!==contradictions)fail();
 if(!Array.isArray(c.final_audit)||c.final_audit.length>10)fail();const heroes=new Set<string>();
 for(const a of c.final_audit){
  if(!object(a)||typeof a.hero!=='string'||!a.hero||heroes.has(a.hero)||!count(a.death_events)||!count(a.kill_events)||!(a.counter_deaths===null||count(a.counter_deaths))||!(a.counter_kills===null||count(a.counter_kills))||!flag(a.deaths_match)||!flag(a.kills_match))fail();heroes.add(a.hero);
  if(a.death_events!==raw.entries.filter(e=>e.status==='verified_death'&&e.victim_hero===a.hero).length||a.kill_events!==raw.entries.filter(e=>e.attribution==='verified_enemy_kill'&&e.killer_hero===a.hero).length)fail();
  if(a.deaths_match!==(a.counter_deaths===null?null:a.death_events===a.counter_deaths)||a.kills_match!==(a.counter_kills===null?null:a.kill_events===a.counter_kills))fail();
 }
}
