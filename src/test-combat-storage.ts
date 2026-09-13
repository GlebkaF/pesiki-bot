import assert from "node:assert/strict";
import Database from "better-sqlite3";
import {mkdtempSync,rmSync} from "node:fs";
import os from "node:os";import path from "node:path";
import {ApmStore,APM_VERSION} from "./apm-store.js";
import type {ParsedMatch} from "./replay.js";
const dir=mkdtempSync(path.join(os.tmpdir(),"combat-store-test-")),file=path.join(dir,"stats.sqlite");
let store=new ApmStore(file);const account=94014640;
const original={match_id:123,start_time:1700000000,parser_version:"pesiki-replay-v3",duration_min:2,winner:"radiant",game_mode:"mode_23",apm_version:APM_VERSION,apm_duration_seconds:120,players:[{steam_id:String(BigInt(account)+76561197960265728n),hero:"warlock",team:"radiant",kills:7,deaths:1,assists:9,hero_damage:12345,actions:200,actions_per_min:100,action_counts:{MOVE:200}}]} as unknown as ParsedMatch;
const fresh={...original,parser_version:"pesiki-replay-v5",analytics_version:"combat-log-v2",players:original.players.map(p=>({...p,kills:999,deaths:999,assists:999,hero_damage:1,combat_details:{version:"combat-log-v2",dropped_events:0,xp_events:1,healing:{self:10,other_heroes:0,units:0,by_target:{warlock:10},by_ability:{unknown:10}},damage:{by_ability:{attack:50},by_target:{pudge:50},by_type:{unknown:50}},deaths:[],wards:[],casts:[],buybacks:[],gold:[],modifiers:[],xp_by_minute:[0,10],last_hits_by_minute:[0,1],denies_by_minute:[0,0],coverage:{xp:true,ultimate_classification:false,death_positions:false,ward_placements:true}}}))} as ParsedMatch;
try{
 store.save(original);
 const other=new ApmStore(file);
 other.save({...original,players:original.players.map(p=>({...p,kills:13,hero_damage:20000}))});other.close();
 store.saveResults(account,[{match_id:123,start_time:1700000000,duration:120,hero_id:37,kills:13,deaths:1,assists:9,radiant_win:true,player_slot:0}],"opendota");
 const official=store.results(account),apm=store.history(account);
 store.mergeReplayAnalytics(fresh);
 let latest=store.replay(123)!;
 assert.equal(latest.players[0].kills,13,"concurrent official enrichment survives backfill");
 assert.equal(latest.players[0].deaths,1);assert.equal(latest.players[0].assists,9);assert.equal(latest.players[0].hero_damage,20000);
 assert.deepEqual(store.history(account),apm,"every existing APM field remains unchanged");
 assert.deepEqual(store.results(account),official,"official results table remains unchanged");
 assert.equal(latest.parser_version,"pesiki-replay-v5");assert.equal(latest.analytics_version,"combat-log-v2");
 const failureDb=new Database(file);
 failureDb.exec("CREATE TRIGGER fail_apm_insert BEFORE INSERT ON player_match_apm WHEN NEW.match_id=124 BEGIN SELECT RAISE(ABORT,'injected APM failure'); END");failureDb.close();
 assert.throws(()=>store.save({...fresh,match_id:124}),/injected APM failure/);
 assert.equal(store.replay(124),undefined,"APM write failure rolls back replay JSON too");
 assert.ok(!store.profileRosters().some(r=>r.match_id===124),"projection participates in save transaction");
 const before=JSON.stringify(latest);
 for(const invalid of [{...fresh,apm_duration_seconds:119.9},{...fresh,players:fresh.players.map(p=>({...p,team:"dire"}))},{...fresh,players:fresh.players.map(p=>({...p,actions:202,actions_per_min:101,action_counts:{MOVE:202}}))},{...fresh,players:fresh.players.map(p=>({...p,action_counts:{MOVE:1}}))}]){
  assert.throws(()=>store.mergeReplayAnalytics(invalid as ParsedMatch));
  assert.equal(JSON.stringify(store.replay(123)),before,"failed upgrade is atomic");assert.deepEqual(store.history(account),apm);
 }
 const v4={...fresh,parser_version:"pesiki-replay-v4",analytics_version:"combat-log-v1",players:fresh.players.map(p=>({...p,combat_details:{...p.combat_details!,version:"combat-log-v1"}}))} as ParsedMatch;
 assert.throws(()=>store.mergeReplayAnalytics(v4),/downgrade/);
 assert.equal(store.saveReplay(v4),false,"v4 cache cannot downgrade v5 analytics");
 const oldCache={...original,players:original.players.map(p=>({...p,kills:999,actions:400,actions_per_min:200,action_counts:{MOVE:400}}))};
 assert.equal(store.saveReplay(oldCache),false);
 store.save(oldCache);
 assert.equal(JSON.stringify(store.replay(123)),before,"old cache cannot erase analytics, parser metadata or official KDA");
 assert.deepEqual(store.history(account),apm,"rejected legacy save cannot overwrite APM rows after saveReplay returns");
 store.saveReplay({...latest,players:latest.players.map(p=>({...p,combat_details:undefined}))});
 assert.equal(store.replay(123)!.players[0].combat_details!.healing.self,10,"same-version thin snapshot preserves combat detail");
 store.close();store=new ApmStore(file);latest=store.replay(123)!;
 assert.equal(latest.players[0].combat_details!.version,"combat-log-v2","detail survives restart");assert.equal(latest.players[0].kills,13);assert.deepEqual(store.history(account),apm);
 assert.throws(()=>store.mergeReplayAnalytics({...fresh,players:[]}),/Missing/);
 assert.throws(()=>store.mergeReplayAnalytics({...fresh,players:fresh.players.map(p=>({...p,combat_details:undefined}))}),/Missing/);
 console.log("Combat storage tests passed: atomic merge, official KDA/APM preservation, downgrade protection, cache and restart");
}finally{store.close();rmSync(dir,{recursive:true,force:true});}
