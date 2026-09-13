import type {ParsedMatch,CombatTimelineRow} from './replay.js';
export interface CombatWindowTotals {
 damage:number; damageEnemies:number; damageAllies:number; damageSelf:number; healing:number; incoming:number; healingSelf:number; healingAllies:number; healingEnemies:number;
 controlledDamage:number; illusionDamage:number; controlledEnemyDamage:number; illusionEnemyDamage:number;
}
export interface CombatWindowBreakdown {byAbility:Record<string,number>;byTarget:Record<string,number>;bySource:Record<string,number>}
export interface CombatWindowActor {
 heroIndex:number;hero:string;steamId:string;team:'radiant'|'dire'|null;
 totals:CombatWindowTotals|null;recorded:CombatWindowTotals;
 damage:CombatWindowBreakdown;enemyDamage:CombatWindowBreakdown;healing:CombatWindowBreakdown;
}
export interface MatchCombatWindow {
 requested:{startSeconds:number;endSeconds:number};actualWindow:{startSecond:number;endSecondExclusive:number}|null;
 coverage:{state:'complete'|'partial'|'missing'|'invalid';completeUntilSecond:number|null;issues:string[];targetScope:'real-heroes';includesControlledSources:true;ownerAttributionComplete:boolean};
 totals:CombatWindowTotals|null;recordedTotals:CombatWindowTotals;
 players:CombatWindowActor[];teams:{radiant:{totals:CombatWindowTotals|null;recorded:CombatWindowTotals};dire:{totals:CombatWindowTotals|null;recorded:CombatWindowTotals}};
 unknownOwner:{totals:CombatWindowTotals|null;recorded:CombatWindowTotals;damage:CombatWindowBreakdown;healing:CombatWindowBreakdown};
}
const zero=():CombatWindowTotals=>({damage:0,damageEnemies:0,damageAllies:0,damageSelf:0,healing:0,incoming:0,healingSelf:0,healingAllies:0,healingEnemies:0,controlledDamage:0,illusionDamage:0,controlledEnemyDamage:0,illusionEnemyDamage:0});
const breakdown=():CombatWindowBreakdown=>({byAbility:Object.create(null),byTarget:Object.create(null),bySource:Object.create(null)});
const integer=(v:unknown,min=0):v is number=>typeof v==='number'&&Number.isSafeInteger(v)&&v>=min;
const normalized=(v:string)=>v.replace(/^npc_dota_hero_/,'').replace(/_/g,'');
const add=(map:Record<string,number>,key:string,amount:number)=>{map[key]=(map[key]??0)+amount;};
const detail=(b:CombatWindowBreakdown,source:string,target:string,ability:string,amount:number)=>{add(b.bySource,source,amount);add(b.byTarget,target,amount);add(b.byAbility,ability,amount);};
/**
 * Observed real-hero combat in whole one-second bins [start,end). Owner-attributed
 * totals include explicitly attributed controlled sources; unknown owners remain
 * separate. Completeness concerns retained observations, not Valve instrumentation.
 * No inferred participant list, damage type classification, or legacy-field writes.
 */
export function buildMatchCombatWindow(match:ParsedMatch,startSeconds:number,endSeconds:number):MatchCombatWindow {
 const players:CombatWindowActor[]=match.players.map((p,i)=>({heroIndex:i,hero:p.hero,steamId:p.steam_id,team:p.team==='radiant'||p.team==='dire'?p.team:null,totals:null,recorded:zero(),damage:breakdown(),enemyDamage:breakdown(),healing:breakdown()}));
 const out:MatchCombatWindow={requested:{startSeconds,endSeconds},actualWindow:null,coverage:{state:'missing',completeUntilSecond:null,issues:[],targetScope:'real-heroes',includesControlledSources:true,ownerAttributionComplete:false},totals:null,recordedTotals:zero(),players,teams:{radiant:{totals:null,recorded:zero()},dire:{totals:null,recorded:zero()}},unknownOwner:{totals:null,recorded:zero(),damage:breakdown(),healing:breakdown()}};
 const fail=(issue:string)=>{out.coverage.state='invalid';out.coverage.issues.push(issue);return out;};
 const duration=typeof match.apm_duration_seconds==='number'&&Number.isFinite(match.apm_duration_seconds)&&match.apm_duration_seconds>0?match.apm_duration_seconds:match.duration_min*60;
 if(!Number.isFinite(startSeconds)||!Number.isFinite(endSeconds)||endSeconds<=startSeconds||!Number.isFinite(duration)||duration<=0)return fail('invalid-window');
 const start=Math.max(0,Math.floor(startSeconds)),end=Math.min(Math.ceil(duration),Math.ceil(endSeconds));
 if(start>=end)return fail('window-outside-match');
 out.actualWindow={startSecond:start,endSecondExclusive:end};
 const t=match.combat_timeline;if(!t){out.coverage.issues.push('timeline-not-recorded');return out;}
 if(t.version!=='combat-timeline-v1'||t.bucket_seconds!==1||t.coverage?.target_scope!=='real-heroes')return fail('unsupported-timeline');
 if(players.some(p=>!p.team))return fail('invalid-hero-team');
 if(!Array.isArray(t.heroes)||t.heroes.length!==players.length||t.heroes.some((h,i)=>h!==players[i].hero))return fail('hero-order-mismatch');
 const dictionary=(v:unknown):v is string[]=>Array.isArray(v)&&v.every(s=>typeof s==='string'&&s.length>0)&&new Set(v).size===v.length;
 if(!dictionary(t.sources)||!dictionary(t.abilities)||!Array.isArray(t.damage)||!Array.isArray(t.healing))return fail('invalid-dictionaries');
 const c=t.coverage,counts=[c.damage_events,c.healing_events,c.stored_damage_events,c.stored_healing_events,c.owner_known_damage_events,c.damage_rows,c.healing_rows,c.dropped_events,c.row_limit,c.byte_limit];
 if(!counts.every(v=>integer(v))||c.damage_rows+c.healing_rows>c.row_limit||c.damage_rows!==t.damage.length||c.healing_rows!==t.healing.length||c.stored_damage_events>c.damage_events||c.stored_healing_events>c.healing_events||c.owner_known_damage_events>c.stored_damage_events||c.damage_rows>c.stored_damage_events||c.healing_rows>c.stored_healing_events||c.stored_damage_events+c.stored_healing_events+c.dropped_events!==c.damage_events+c.healing_events)return fail('invalid-coverage-counts');
 if(typeof c.truncated!=='boolean'||c.truncated!==(c.dropped_events>0)||(c.truncated?!integer(c.complete_until_second):c.complete_until_second!==null))return fail('invalid-complete-prefix');
 out.coverage.completeUntilSecond=c.complete_until_second;
 // Reject malformed rows anywhere: a corrupt dictionary/index must not produce
 // plausible exact totals merely because the corrupt row is outside this window.
 const valid=(r:CombatTimelineRow)=>Array.isArray(r)&&r.length===8&&r.every((v,i)=>integer(v,i===2||i===5?-1:0))&&r[0]<Math.ceil(duration)&&r[1]<t.sources.length&&r[2]<players.length&&r[3]<players.length&&r[4]<t.abilities.length&&r[6]<=1;
 if(!t.damage.every(valid)||!t.healing.every(valid))return fail('invalid-row');
 for(const rows of [t.damage,t.healing]){const keys=rows.map(r=>r.slice(0,7).join(','));if(new Set(keys).size!==keys.length)return fail('duplicate-bucket');}
 let unknownRows=0;
 for(const [healing,rows]of [[false,t.damage],[true,t.healing]] as const)for(const r of rows){
  const [second,sourceIndex,owner,target,abilityIndex,,flags,amount]=r;if(second<start||second>=end)continue;
  const receiver=players[target],actor=owner>=0?players[owner]:null,source=t.sources[sourceIndex],ability=t.abilities[abilityIndex],record=actor?.recorded??out.unknownOwner.recorded;
  if(!actor)unknownRows++;
  const type=healing?'healing':'damage';record[type]+=amount;out.recordedTotals[type]+=amount;
  detail(actor?actor[type]:out.unknownOwner[type],source,receiver.hero,ability,amount);
  if(!healing){
   if(actor){const category=owner===target?'damageSelf':actor.team===receiver.team?'damageAllies':'damageEnemies';record[category]+=amount;out.recordedTotals[category]+=amount;if(category==='damageEnemies')detail(actor.enemyDamage,source,receiver.hero,ability,amount);}
   receiver.recorded.incoming+=amount;out.recordedTotals.incoming+=amount;
   if(flags&1){record.illusionDamage+=amount;out.recordedTotals.illusionDamage+=amount;}
   if(actor&&((flags&1)||(source!=='unknown'&&source!=='dota_unknown'&&normalized(source)!==normalized(actor.hero)))){record.controlledDamage+=amount;out.recordedTotals.controlledDamage+=amount;if(actor.team!==receiver.team){record.controlledEnemyDamage+=amount;out.recordedTotals.controlledEnemyDamage+=amount;if(flags&1){record.illusionEnemyDamage+=amount;out.recordedTotals.illusionEnemyDamage+=amount;}}}
  }else if(actor){
   const category=owner===target?'healingSelf':actor.team&&receiver.team?(actor.team===receiver.team?'healingAllies':'healingEnemies'):null;
   if(category){record[category]+=amount;out.recordedTotals[category]+=amount;}
  }
 }
 // Safe sums matter too: individually valid integers can overflow in aggregation.
 const records=[out.recordedTotals,out.unknownOwner.recorded,...players.map(p=>p.recorded)];
 if(records.some(v=>Object.values(v).some(n=>!Number.isSafeInteger(n))))return fail('aggregate-overflow');
 for(const p of players)if(p.team)for(const key of Object.keys(p.recorded) as (keyof CombatWindowTotals)[])out.teams[p.team].recorded[key]+=p.recorded[key];
 out.coverage.state=c.complete_until_second===null||end<=c.complete_until_second?'complete':'partial';
 out.coverage.ownerAttributionComplete=unknownRows===0;
 if(unknownRows)out.coverage.issues.push('some-sources-have-no-explicit-roster-owner');
 if(players.some(p=>!p.team))out.coverage.issues.push('some-hero-teams-unknown');
 if(out.coverage.state==='partial')out.coverage.issues.push('window-intersects-incomplete-prefix');
 if(out.coverage.state==='complete'){
  out.totals={...out.recordedTotals};out.unknownOwner.totals={...out.unknownOwner.recorded};
  for(const p of players)p.totals={...p.recorded};
  for(const team of ['radiant','dire'] as const)out.teams[team].totals={...out.teams[team].recorded};
 }
 return out;
}
