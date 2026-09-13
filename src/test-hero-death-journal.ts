import assert from 'node:assert/strict';
import {existsSync,readFileSync} from 'node:fs';
import {buildHeroDeathJournal} from './hero-death-journal.js';
import {assertHeroDeathJournal} from './hero-death-contract.js';
import {buildMatchInsights} from './match-insights.js';
import type {ParsedMatch,HeroDeathJournal,HeroDeathJournalEntry,HeroCounterWindow} from './replay.js';

const window=(before=0,after=1,from=9.99,to=10.02):HeroCounterWindow=>({from,to,before,after,delta:after-before,source:'CDOTA_PlayerResource'});
function fixture():ParsedMatch {
 const players=[{hero:'kunkka',steam_id:'76561198000000001',team:'radiant'},{hero:'pudge',steam_id:'76561198000000002',team:'dire'},{hero:'undying',steam_id:'76561198000000003',team:'dire'}];
 return {match_id:1,duration_min:2,apm_duration_seconds:120,players,kills:[],buildings:[],teamfights:[],roshan_kills_min:[],hero_death_journal:{version:'hero-death-journal-v1',entries:[],coverage:{}}} as unknown as ParsedMatch;
}
function event(m:ParsedMatch,id=1,victim=1,seconds=10):HeroDeathJournalEntry {
 const p=m.players[victim],killer=m.players[0];
 return {id:`death-${id}`,seconds,victim_hero:p.hero,victim_steam_id:p.steam_id,victim_team:p.team,victim_resource_slot:victim,raw_target:'npc_dota_hero_'+p.hero,raw_attacker:'npc_dota_hero_'+killer.hero,raw_source:'npc_dota_hero_'+killer.hero,attacker_team:killer.team,will_reincarnate:null,status:'verified_death',death_counter:window(),killer_hero:killer.hero,killer_steam_id:killer.steam_id,killer_team:killer.team,killer_resource_slot:0,kill_counter:window(),attribution:'verified_enemy_kill',source_controlled:false,source_illusion:false};
}
function recount(m:ParsedMatch):ParsedMatch {
 const raw=m.hero_death_journal!,es=raw.entries;
 raw.coverage={clock_source:'gamerules',clock_complete:true,game_end_observed:true,raw_deaths:es.length,entries_stored:es.length,verified_deaths:es.filter(e=>e.status==='verified_death').length,verified_reincarnations:es.filter(e=>e.status==='verified_reincarnation').length,verified_kills:es.filter(e=>e.attribution==='verified_enemy_kill').length,unverified:es.filter(e=>e.status==='unverified').length,contradictions:es.filter(e=>e.status==='contradiction').length,counter_resets:0,truncated:false,dropped_events:0,dropped_counter_samples:0,final_audit:m.players.map(p=>{const d=es.filter(e=>e.status==='verified_death'&&e.victim_hero===p.hero).length,k=es.filter(e=>e.attribution==='verified_enemy_kill'&&e.killer_hero===p.hero).length;return {hero:p.hero,death_events:d,counter_deaths:d,kill_events:k,counter_kills:k,deaths_match:true,kills_match:true};})};
 assertHeroDeathJournal(raw);return m;
}
function one(){const m=fixture();m.hero_death_journal!.entries=[event(m)];return recount(m);}
const model=(m:ParsedMatch)=>{const v=buildHeroDeathJournal(m);assert.ok(v);return v;};
const base=one();assert.equal(model(base).coverage.complete,true);assert.equal(model(base).coverage.verifiedKills,1);assert.equal(model(base).cells.find(c=>c.killer===0&&c.victim===2)!.count,0,'complete absence is measured zero');
for(const flag of [false,null]){const m=one();m.hero_death_journal!.entries[0].will_reincarnate=flag;assert.equal(model(m).coverage.verifiedDeaths,1);}
for(const patch of [{will_reincarnate:true},{status:'made_up'},{death_counter:null},{seconds:NaN},{victim_resource_slot:99}]){const m=one();Object.assign(m.hero_death_journal!.entries[0],patch);assert.equal(buildHeroDeathJournal(m),null,'malformed journal rejected');}
for(const flag of [true,false,null]){const m=one(),e=m.hero_death_journal!.entries[0];Object.assign(e,{status:'verified_reincarnation',will_reincarnate:true,death_counter:window(0,0),killer_hero:null,killer_steam_id:null,killer_team:null,killer_resource_slot:null,kill_counter:null,attribution:'unknown'});recount(m);e.will_reincarnate=flag;if(flag===true){assert.equal(model(m).coverage.reincarnations,1);assert.equal(model(m).coverage.verifiedKills,0);}else assert.equal(buildHeroDeathJournal(m),null);}
// The projection and persistence validator use the same bounded float rounding allowance.
{const m=one(),e=m.hero_death_journal!.entries[0];e.seconds=10.025;e.death_counter=window(0,1,9.99,10.02);e.kill_counter=window(0,1,9.99,10.02);assertHeroDeathJournal(m.hero_death_journal);assert.equal(model(m).coverage.verifiedKills,1);e.seconds=10.031;assert.equal(buildHeroDeathJournal(m),null);}
// Full +2 batch is supported. Losing one member cannot turn the other into a +1 fact.
{const m=fixture();m.hero_death_journal!.entries=[event(m,1,1),event(m,2,2)];for(const e of m.hero_death_journal!.entries)e.kill_counter=window(0,2);recount(m);assert.equal(model(m).coverage.verifiedKills,2);m.hero_death_journal!.entries.pop();const later=event(m,3,2,20);later.death_counter=window(0,1,19.99,20.02);later.kill_counter=window(2,3,19.99,20.02);m.hero_death_journal!.entries.push(later);recount(m);const v=model(m);assert.equal(v.coverage.complete,false);assert.equal(v.coverage.verifiedKills,1);assert.equal(v.cells.find(c=>c.killer===0&&c.victim===2)!.count,1,'retain independent confirmed minimum');assert.equal(v.cells.find(c=>c.killer===0&&c.victim===1)!.count,null,'incomplete zero is unknown');}
// Distinct observation windows cannot claim the same underlying counter increment twice.
{const m=fixture();const a=event(m,1,1),b=event(m,2,1,10.005);b.death_counter=window(0,1,9.98,10.03);b.kill_counter=window(0,1,9.98,10.03);m.hero_death_journal!.entries=[a,b];recount(m);assert.equal(model(m).coverage.verifiedDeaths,0);assert.equal(model(m).coverage.verifiedKills,0);}
// Audit identities and actual counters must agree with the roster, not just array length.
{const m=recount(fixture());m.hero_death_journal!.coverage.final_audit[2].hero='axe';assertHeroDeathJournal(m.hero_death_journal);assert.equal(model(m).coverage.complete,false);m.hero_death_journal!.coverage.final_audit[2].hero='kunk_ka';assertHeroDeathJournal(m.hero_death_journal);assert.equal(model(m).coverage.complete,false);}
{const m=one();m.players[0].replay_scoreboard={version:'player-resource-v1',source:'CDOTA_PlayerResource',resource_slot:0,team_slot:0,hero_id:23,kills:99,deaths:0,assists:0,complete:true,end_state_observed:true};assert.equal(model(m).coverage.complete,false);assert.equal(model(m).coverage.verifiedKills,1,'final audit never rewrites confirmed events');m.players[0].replay_scoreboard.resource_slot=4;assert.equal(model(m).coverage.verifiedKills,0,'counter owner slot mismatch');}
{const m=one();m.hero_death_journal!.entries[0].raw_source='npc_dota_hero_axe';assert.equal(model(m).coverage.verifiedKills,0);assert.equal(model(m).coverage.nonHeroKills,0,'unknown attribution is not proof of an environmental death');assert.equal(model(m).coverage.unresolved,1);}
{const m=one();m.hero_death_journal!.entries[0].raw_target='npc_dota_hero_axe';assert.equal(model(m).coverage.verifiedDeaths,0);}
// Recap IDs use MatchInsights' filtered index, never the raw combat array index.
{const m=one();m.players[1].combat_details={version:'combat-log-v3',deaths:[{min:-1,killer:'kunkka',x:1,y:2},{min:NaN,killer:'kunkka',x:2,y:3},{min:10/60,killer:'kunkka',x:0,y:-100,coordinates_source:'hero_entity'},{min:2.1,killer:'kunkka',x:3,y:4}]} as ParsedMatch['players'][number]['combat_details'];const v=model(m);assert.equal(v.entries[0].legacyDeathId,m.players[1].steam_id+':0');assert.equal(v.entries[0].x,0);const insights=buildMatchInsights(m);assert.equal(insights.players[1].deaths!.length,1);assert.equal(insights.players[1].deaths![0].x,0);m.players[1].combat_details!.version='unknown' as never;assert.equal(model(m).entries[0].legacyDeathId,null);assert.equal(model(m).entries[0].x,null);}
// One precise event must not steal a point from another event, and vice versa.
{const m=one();m.players[1].combat_details={version:'combat-log-v3',deaths:[{min:10/60,killer:'kunkka',x:1,y:2},{min:10.01/60,killer:'kunkka',x:3,y:4}]} as ParsedMatch['players'][number]['combat_details'];assert.equal(model(m).entries[0].legacyDeathId,null);assert.equal(model(m).entries[0].x,null);m.players[1].combat_details!.deaths.pop();const second=event(m,2,1,10.01);second.death_counter=window(0,2);second.kill_counter=window(0,2);m.hero_death_journal!.entries[0].death_counter=window(0,2);m.hero_death_journal!.entries[0].kill_counter=window(0,2);m.hero_death_journal!.entries.push(second);recount(m);assert.ok(model(m).entries.every(e=>e.x===null&&e.legacyDeathId===null));}
// Valid partial coverage keeps evidence, but never manufactures zeroes for missing pairs.
{const m=one();m.hero_death_journal!.coverage.truncated=true;m.hero_death_journal!.coverage.dropped_events=1;m.hero_death_journal!.coverage.raw_deaths++;const v=model(m);assert.equal(v.coverage.complete,false);assert.equal(v.coverage.verifiedKills,1);assert.equal(v.cells.find(c=>c.killer===0&&c.victim===2)!.count,null);}
const expected:Record<string,[number,number,number]>={shared:[87,86,2],warlock:[59,58,2],long:[93,92,4],old:[93,89,0],second:[78,77,2],short:[56,53,0],paused:[61,60,1]};
const totals=[0,0,0];let fixtures=0;
for(const [name,counts]of Object.entries(expected)){
 const path=`/tmp/pesiki-hero-death-probe/${name}-v11.json`;if(!existsSync(path))continue;
 const m=JSON.parse(readFileSync(path,'utf8')) as ParsedMatch,v=model(m);assert.equal(v.coverage.complete,true,name+' complete');assert.deepEqual([v.coverage.verifiedDeaths,v.coverage.verifiedKills,v.coverage.reincarnations],counts,name);counts.forEach((n,i)=>totals[i]+=n);fixtures++;
 const insights=buildMatchInsights(m);for(const e of v.entries){if(e.legacyDeathId===null)continue;assert.notEqual(e.victim,null);const id=Number(e.legacyDeathId.split(':').at(-1)),d=insights.players[e.victim!].deaths?.[id];assert.ok(d,name+' recap exists');assert.ok(Math.abs(d.seconds-e.seconds)<=.55,name+' recap time agrees');}
}
if(fixtures===7)assert.deepEqual(totals,[527,515,11]);
console.log(`hero death journal model tests passed; ${fixtures}/7 local replay fixtures checked`);
