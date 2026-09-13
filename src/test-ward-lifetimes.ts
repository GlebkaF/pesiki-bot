import assert from 'node:assert/strict';
import {buildWardLifetimes} from './ward-lifetimes.js';
import type {ParsedMatch,WardLifetime,WardLifetimes} from './replay.js';
import {assertWardLifetimes} from './ward-lifetime-contract.js';
import {ApmStore} from './apm-store.js';
import {mkdtempSync,rmSync} from 'node:fs';
import path from 'node:path';import os from 'node:os';
const entry:WardLifetime={id:'100:4',entity_index:100,entity_serial:4,kind:'observer',team:'radiant',owner_hero:'warlock',owner_steam_id:'123',placed_seconds:-30,first_observed_seconds:-29.98,last_observed_seconds:120,
 death_observed_seconds:120,death_observation_window_seconds:{from:119.94,to:120},deleted_observed_seconds:null,left_observed_seconds:null,alive_at_end:false,position:{x:100,y:200,source:'ward_entity'},position_moved:false,observation_complete:true,
 killer:{attacker:'npc_dota_clinkz_skeleton_archer',attacker_hero:'clinkz',attacker_team:'dire',combat_seconds:119.96,source:'unique-last-damage-match',source_controlled:true,source_illusion:false}};
const raw:WardLifetimes={version:'ward-lifetimes-v1',entries:[entry],coverage:{entities_seen:1,entities_stored:1,owner_resolved:1,creation_time_known:1,death_observed:1,killer_matched:1,ambiguous_killer_matches:0,position_observed:1,moved_entities:0,game_end_observed:true,tick_interval_seconds:1/30,max_death_observation_window_seconds:.06,truncated:false,dropped_entities:0,dropped_killer_events:0,clock_source:'gamerules',clock_samples_dropped:0,clock_complete:true}};
const m={match_id:7,duration_min:10,apm_duration_seconds:600,players:[{steam_id:'123',hero:'warlock',team:'radiant'},{steam_id:'456',hero:'clinkz',team:'dire'}],ward_lifetimes:raw} as unknown as ParsedMatch;
const initial=JSON.stringify(m);let model=buildWardLifetimes(m)!;
assert.equal(JSON.stringify(m),initial,'projection is read-only');assert.equal(model.entries[0].knownFromSeconds,-29.98);assert.equal(model.entries[0].knownUntilSeconds,119.94,'death observation window is not all treated as alive');
assert.equal(model.entries[0].killer!.label,'Clinkz');assert.equal(model.entries[0].killer!.controlled,true);assert.equal(model.entries[0].endReason,'death-observed');
const withEntry=(patch:Partial<WardLifetime>)=>buildWardLifetimes({...m,ward_lifetimes:{...raw,entries:[{...entry,...patch}]}})!;
model=withEntry({death_observed_seconds:null,death_observation_window_seconds:null,last_observed_seconds:200,killer:null});
assert.equal(model.entries[0].knownUntilSeconds,200,'missing end stops at last observation');assert.equal(model.entries[0].endReason,'unknown');
model=withEntry({death_observed_seconds:null,death_observation_window_seconds:null,last_observed_seconds:600,alive_at_end:true,killer:null});
assert.equal(model.entries[0].knownUntilSeconds,600);assert.equal(model.entries[0].endReason,'replay-end');
assert.equal(withEntry({left_observed_seconds:40,observation_complete:false}).entries[0].knownFromSeconds,null,'left/reentry gaps cannot be interpolated');
assert.equal(withEntry({placed_seconds:null}).entries[0].knownFromSeconds,null,'unknown creation cannot authorize lifetime');
assert.equal(withEntry({position_moved:true}).entries[0].position,null,'moving ward cannot be drawn at one fixed point');
assert.equal(withEntry({owner_steam_id:'456'}).entries[0].ownerLabel,null,'wrong owner identity');
assert.equal(withEntry({owner_steam_id:'456'}).entries[0].killer,null,'uncertain ownership cannot authorize matched killer');
assert.equal(withEntry({killer:{...entry.killer!,combat_seconds:100}}).entries[0].killer,null,'unrelated damage time is not a killer');
assert.equal(withEntry({killer:{...entry.killer!,attacker_team:'radiant'}}).entries[0].killer,null,'wrong actor team');
assert.equal(withEntry({last_observed_seconds:Infinity}).coverage.invalid,1);
assert.equal(buildWardLifetimes({...m,ward_lifetimes:undefined}),null);
assert.equal(buildWardLifetimes({...m,ward_lifetimes:{...raw,coverage:{...raw.coverage,entities_stored:2}}}),null);
const duplicate=buildWardLifetimes({...m,ward_lifetimes:{...raw,entries:[entry,{...entry}],coverage:{...raw.coverage,entities_seen:2,entities_stored:2}}})!;
assert.equal(duplicate.entries.length,0);assert.equal(duplicate.coverage.invalid,2,'duplicate identities rejected together');
assertWardLifetimes(raw);
assert.throws(()=>assertWardLifetimes({...raw,entries:[{...entry,id:'100:40'}]}),/Invalid/);
assert.throws(()=>assertWardLifetimes({...raw,entries:[{...entry,position:{x:Infinity,y:0,source:'ward_entity'}}]}),/Invalid/);
const dir=mkdtempSync(path.join(os.tmpdir(),'ward-life-store-')),file=path.join(dir,'stats.sqlite');let store=new ApmStore(file);
try{
 const saved={...m,parser_version:'pesiki-replay-v10'};
 assert.equal(store.saveReplay(saved),true);const before=store.replay(7)!;
 assert.throws(()=>store.saveReplay({...saved,ward_lifetimes:{...raw,version:'broken'} as unknown as WardLifetimes}),/Invalid/);
 assert.deepEqual(store.replay(7),before,'invalid upgrade cannot erase saved observations');
 assert.equal(store.saveReplay({...saved,parser_version:'pesiki-replay-v9',ward_lifetimes:undefined}),false,'old cache cannot erase v10');
 assert.equal(store.saveReplay({...saved,ward_lifetimes:undefined}),true);
 assert.deepEqual(store.replay(7)!.ward_lifetimes,raw,'thin enrichment preserves observations');
 store.close();store=new ApmStore(file);assert.deepEqual(store.replay(7)!.ward_lifetimes,raw,'persistent after restart');
}finally{store.close();rmSync(dir,{recursive:true,force:true});}
console.log('Ward lifetimes tests passed: observation bounds, gaps, moving entities, unique identity, owner/killer evidence, missing data.');
