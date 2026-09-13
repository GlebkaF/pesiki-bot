import assert from "node:assert/strict";
import { mkdtempSync,rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { ApmStore } from "./apm-store.js";
import type { ParsedMatch } from "./replay.js";
import { buildEconomy } from "./profile-economy.js";
import { renderEconomy } from "./web/profile-economy-render.js";
const dir=mkdtempSync(path.join(os.tmpdir(),"economy-test-"));
const store=new ApmStore(path.join(dir,"stats.sqlite"));
const account=94014640;
try {
  const match={match_id:777,duration_min:20,winner:"radiant",players:[{
    steam_id:String(BigInt(account)+76561197960265728n),hero:"warlock",team:"radiant",
    networth_by_minute:Array.from({length:30},(_,i)=>i===4?-1:(i+1)*500),
    item_timings:[{item:"force_staff",min:8.15},{item:"boots",min:1},{item:"<script>alert(1)</script>",min:2},{item:"bad_negative",min:-1},{item:"after_end",min:21}],
    gpm:999999
  }]} as unknown as ParsedMatch;
  store.saveReplay(match);
  let reads=0;
  const read=store.replay.bind(store);store.replay=id=>{reads++;return read(id);};
  const data=buildEconomy(store,account,777)!;
  assert.equal(reads,1,"one selected replay read; no full-history scan");
  assert.equal(data.hero,"Warlock");
  assert.deepEqual(data.checkpoints,[{minute:10,value:5000},{minute:20,value:10000},{minute:30,value:null}]);
  assert.equal(data.networth[0].minute,1,"first sample is minute one, not zero");
  assert.equal(data.networth.length,19,"invalid points and samples past game end excluded");
  assert.equal(data.purchases.find(p=>p.item==="force_staff")!.seconds,489,"decimal minutes become 8:09");
  assert.equal(data.purchases.filter(p=>p.key).length,1);
  assert.equal(data.purchases.length,3);
  const html=renderEconomy(data);
  assert.ok(html.includes("8:09"));assert.ok(html.includes("Force Staff"));
  assert.ok(html.includes("&lt;script&gt;"));assert.ok(!html.includes("<script>"));
  assert.ok(!html.includes("999999"),"parser-derived fake GPM is not exposed");
  assert.equal((html.match(/<polyline /g)||[]).length,2,"chart does not bridge missing samples");
  assert.equal(buildEconomy(store,account+1,777),null,"cannot display another account's economy");
  assert.equal(buildEconomy(store,account,778),null);
  assert.equal(buildEconomy(store,NaN,777),null);
  assert.ok(renderEconomy(null).includes("пока недоступна"));
  console.log("Profile economy tests passed");
} finally {store.close();rmSync(dir,{recursive:true,force:true});}
