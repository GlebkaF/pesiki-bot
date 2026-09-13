import assert from "node:assert/strict";
import { ApmStore, APM_VERSION } from "./apm-store.js";
import { assertReplayIdentity } from "./replay-identity.js";
import type { ParsedMatch } from "./replay.js";
import type { MatchApi } from "./opendota.js";

const store=new ApmStore(":memory:");
const steam=String(76561197960265728n+94014640n);
const match={match_id:123,start_time:1700000000,duration_min:2,winner:"radiant",apm_version:APM_VERSION,apm_duration_seconds:120,
  players:[{steam_id:steam,team:"radiant",hero:"npc_dota_hero_crystal_maiden",kills:7,actions:200,actions_per_min:100,action_counts:{MOVE:200}}]} as unknown as ParsedMatch;
try {
  store.save(match);
  const before=JSON.stringify(store.replay(123));
  // 119.9 seconds produces the same floored APM, but changes historical timing.
  assert.throws(()=>store.mergeReplayActions({...match,apm_duration_seconds:119.9}),/duration changed/);
  assert.equal(store.history(94014640)[0].duration_seconds,120);
  assert.equal(JSON.stringify(store.replay(123)),before,"failed merge must leave full JSON intact");
  assert.throws(()=>store.mergeReplayActions({...match,players:[{...match.players[0],team:"dire"}]}),/Roster changed/);
  assert.throws(()=>store.mergeReplayActions({...match,match_id:124,players:[]}),/Invalid action breakdown/);
  assert.equal(store.replay(124),undefined);
  assert.throws(()=>store.mergeReplayActions({...match,match_id:0}),/Invalid action breakdown/);
  store.mergeReplayActions({...match,players:[{...match.players[0],kills:999}]});
  assert.equal(store.replay(123)?.players[0].kills,7,"recovery may not replace official enrichment");

  const api={match_id:123,start_time:1700000000,players:[{account_id:94014640,hero_id:5,player_slot:0}]} as MatchApi;
  assert.throws(()=>assertReplayIdentity({...match,match_id:0,players:[]},123,{...api,players:[]}),/Invalid replay identity/);
  assert.throws(()=>assertReplayIdentity({...match,match_id:0},0,api),/Invalid replay identity/);
  assert.throws(()=>assertReplayIdentity({...match,match_id:0},123,{...api,players:[{...api.players[0],player_slot:5}]}),/Ambiguous API side/);
  const zeroHeader={...match,match_id:0};assertReplayIdentity(zeroHeader,123,api);assert.equal(zeroHeader.match_id,123);
  store.saveMatchApi(api);store.saveMatchApi({...api,players:[]});
  assert.equal(store.matchApi(123)?.players.length,1,"empty API response must not erase independent identity evidence");
  console.log("Retro integrity tests passed: atomic preservation, duration, sides, empty data, zero-header evidence.");
} finally {store.close();}
