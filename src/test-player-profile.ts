import Database from "better-sqlite3";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { ApmStore, APM_VERSION } from "./apm-store.js";
import { buildProfile, importFeed } from "./player-profile.js";
import { groupActions, validActionCounts } from "./action-counts.js";
import { renderPlayer, renderPlayers } from "./web/player-render.js";
import { PLAYERS } from "./config.js";
import type { ParsedMatch } from "./replay.js";
const dir=mkdtempSync(path.join(os.tmpdir(),"profiles-test-")),file=path.join(dir,"stats.sqlite");
let store=new ApmStore(file);
const id=94014640,partner=1869377945,enemy=126449680;
const now=Date.UTC(2026,8,13,12),start=now/1000-3600;
const steam=(n:number)=>String(BigInt(n)+76561197960265728n);
const match={match_id:123,start_time:start,duration_min:2,winner:"radiant",apm_version:APM_VERSION,apm_duration_seconds:120,
 players:[{steam_id:steam(id),team:"radiant",hero:"npc_dota_hero_crystal_maiden",actions:200,actions_per_min:100,kills:999,deaths:0,assists:999,
 action_counts:{DOTA_UNIT_ORDER_MOVE_TO_POSITION:180,DOTA_UNIT_ORDER_CAST_NO_TARGET:19,UNKNOWN_NEW_COMMAND:1}},
 {steam_id:steam(partner),team:"radiant",hero:"invoker"},{steam_id:steam(enemy),team:"dire",hero:"pudge"}]} as unknown as ParsedMatch;
try {
  store.save(match);store.save(match);
  assert.equal(store.history(id).length,1);
  assert.equal(store.history(id)[0].action_counts?.DOTA_UNIT_ORDER_MOVE_TO_POSITION,180);
  store.save({...match,players:match.players.map(p=>({...p,action_counts:undefined}))});
  assert.equal(store.history(id)[0].action_counts?.DOTA_UNIT_ORDER_MOVE_TO_POSITION,180,"old caches must preserve detailed commands");
  assert.equal(store.replay(123)?.players[0].action_counts?.DOTA_UNIT_ORDER_MOVE_TO_POSITION,180);
  store.save({...match,players:match.players.map(p=>({...p,action_counts:{broken:10000}}))});
  assert.equal(store.history(id)[0].action_counts?.DOTA_UNIT_ORDER_MOVE_TO_POSITION,180,"invalid sums must not overwrite valid details");
  store.save({...match,match_id:124,start_time:start-86400*8,players:match.players.map(p=>({...p,actions:0,actions_per_min:0,action_counts:{}}))});
  store.save({...match,match_id:125,start_time:undefined,players:match.players.map(p=>({...p,action_counts:undefined}))});
  store.save({...match,match_id:126,start_time:start-86400,apm_version:undefined,players:match.players.map(p=>({...p,actions:undefined,actions_per_min:undefined,action_counts:undefined}))});
  store.close();
  // Simulate upgrading a pre-profile database: projection must rebuild from old full JSON.
  const legacy=new Database(file);legacy.exec("DROP TABLE profile_rosters");legacy.close();
  store=new ApmStore(file);
  assert.equal(store.profileRosters().length,4,"existing archived games migrate without reparsing");
  assert.ok(!JSON.stringify(store.profileRosters()).includes("action_counts"),"profile reads stay compact");
  assert.equal(store.history(id).length,3,"history survives reopening");
  let p=buildProfile(store,id,"all",now);
  assert.equal(p.matches.length,4);assert.equal(p.measured.length,3);assert.equal(p.detailed.length,2);
  assert.equal(p.avgApm,67,"average includes measured zero, excludes unavailable");
  assert.equal(p.median,100);assert.equal(p.groups.reduce((s,g)=>s+g.count,0),200);
  assert.equal(p.groups.at(-1)!.count,1,"unknown commands stay counted");
  assert.deepEqual(p.partners.map(p=>p.id),[partner],"opponents in our tracked list are not teammates");
  assert.equal(p.matches.filter(m=>m.kda).length,0,"raw combat log kills must not become official KDA");
  assert.equal(buildProfile(store,id,"7",now).matches.length,2,"old/undated matches excluded from rolling periods");
  const official={match_id:123,start_time:start,duration:120,hero_id:5,kills:1,deaths:4,assists:20,player_slot:0,radiant_win:true};
  store.saveResults(id,[official]);
  importFeed(store,[{matchId:123,startTime:start,duration:120,win:false,ours:[{steamId:id,name:"ignored",hero:"Crystal Maiden",heroId:5,kills:999,deaths:0,assists:1,win:false}]}]);
  p=buildProfile(store,id,"all",now);
  assert.deepEqual(p.matches.find(m=>m.id===123)?.kda,[1,4,20],"feed must not downgrade official result");
  assert.equal(p.matches.find(m=>m.id===123)?.win,true);
  assert.equal(p.matches.find(m=>m.id===123)?.kdaSource,"OpenDota");
  const one=renderPlayer(p,[p],1,123);
  assert.ok(one.includes('value="123" selected'),"per-match selection is retained");
  assert.ok(one.includes("100 APM"));
  assert.ok(!renderPlayer(p,[p],1,999999).includes('value="999999"'),"unknown selected match cannot add data");
  const html=renderPlayer(p,[p]);
  assert.ok(html.includes("APM под микроскопом")&&html.includes("UNKNOWN_NEW_COMMAND"));
  for(const player of PLAYERS) {
    assert.ok(!html.includes(String(player.telegramId??"PRIVATE_ID_SENTINEL")),"no private Telegram IDs");
    if(player.birthday) assert.ok(!html.includes(player.birthday));
    if(player.botAttitude) assert.ok(!html.includes(player.botAttitude));
  }
  const absent=buildProfile(store,93921511,"7",now);
  assert.ok(renderPlayer(absent,[absent]).includes("В этом периоде нет сохранённых игр"));
  assert.ok(!renderPlayer(absent,[absent]).includes("NaN"));
  assert.ok(renderPlayers([absent],"7").includes("История ещё собирается"));
  p.matches[0].hero='<script>alert("x")</script>';
  assert.ok(!renderPlayer(p,[p]).includes('<script>alert("x")</script>'),"escape untrusted names");
  assert.equal(validActionCounts({a:1,b:-1},0),false);
  assert.equal(validActionCounts({a:1.5},1.5),false);
  assert.equal(validActionCounts({},0),true);
  assert.equal(validActionCounts(null,0),false);
  assert.equal(groupActions({DOTA_UNIT_ORDER_MOVE_TO_DIRECTION:5,DOTA_UNIT_ORDER_HOLD_POSITION:3}).map(g=>g.count).join(","),"5,0,0,0,3");
  const mergeStore=new ApmStore(":memory:");
  const single={...match,players:[match.players[0]]};
  mergeStore.save({...single,players:[{...single.players[0],kills:7,action_counts:undefined}]});
  mergeStore.mergeReplayActions({...single,players:[{...single.players[0],kills:1}]});
  assert.equal(mergeStore.replay(123)?.players[0].kills,7,"offline backfill preserves latest official enrichment");
  assert.equal(mergeStore.history(id)[0].action_counts?.DOTA_UNIT_ORDER_MOVE_TO_POSITION,180);
  assert.throws(()=>mergeStore.mergeReplayActions({...single,players:[{...single.players[0],actions:300,actions_per_min:150,action_counts:{x:300}}]}),/APM changed/);
  assert.equal(mergeStore.history(id)[0].actions,200,"rejected backfill cannot partially mutate totals");
  mergeStore.close();
  console.log("Player profile tests passed: persistence, sources, coverage, periods, teams, rendering, privacy.");
} finally {store.close();rmSync(dir,{recursive:true,force:true});}
