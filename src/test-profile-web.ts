/** Real HTTP routes with all outgoing fetches disabled in the child server. */
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtemp, writeFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { once } from "node:events";
import { ApmStore, APM_VERSION } from "./apm-store.js";
import { PLAYERS } from "./config.js";
const dir=await mkdtemp(path.join(os.tmpdir(),"profile-http-"));
const store=new ApmStore(path.join(dir,"stats.sqlite"));
store.save({match_id:123,start_time:Math.floor(Date.now()/1000)-3600,duration_min:2,winner:"radiant",
  apm_version:APM_VERSION,apm_duration_seconds:120,
  players:[{steam_id:String(76561197960265728n+94014640n),hero:"crystal_maiden",team:"radiant",actions:200,actions_per_min:100,action_counts:{DOTA_UNIT_ORDER_MOVE_TO_POSITION:200}}]} as any);
store.close();
await writeFile(path.join(dir,"feed.json"),JSON.stringify({updatedAt:Date.now(),matches:[]}));
const worker=spawn(process.execPath,["--import","tsx","--input-type=module","-e",`
  globalThis.fetch=async()=>{console.error("UNEXPECTED_NETWORK_CALL");throw Error("offline test");};
  const {startWebServer}=await import("./src/web/server.ts");startWebServer(3018);
`],{cwd:process.cwd(),env:{...process.env,DATA_DIR:dir,APM_DB_PATH:path.join(dir,"stats.sqlite"),FEED_SYNC_DISABLED:"1"},stdio:["ignore","pipe","pipe"]});
let output="";worker.stdout.on("data",c=>output+=c);worker.stderr.on("data",c=>output+=c);
try {
  await new Promise<void>((resolve,reject)=>{
    const timer=setTimeout(()=>reject(Error("Server did not start: "+output)),10000);
    worker.once("exit",()=>{clearTimeout(timer);reject(Error("Server exited: "+output));});
    worker.stdout.on("data",c=>{if(String(c).includes("витрина на")){clearTimeout(timer);resolve();}});
  });
  for(const period of ["7","30","all"]) {
    const directory=await fetch(`http://localhost:3018/players?period=${period}`);
    assert.equal(directory.status,200);assert.equal(((await directory.text()).match(/class="player-card"/g)||[]).length,14);
    for(const p of PLAYERS) {
      const response=await fetch(`http://localhost:3018/player/${p.steamId}?period=${period}`);
      assert.equal(response.status,200);const html=await response.text();assert.ok(html.includes(p.dotaName));assert.ok(!html.includes("NaN"));
    }
  }
  const selected=await fetch("http://localhost:3018/player/94014640?match=123");
  assert.match(await selected.text(),/100 APM/);
  const matchResponse=await fetch("http://localhost:3018/match/123?player=76561198054280368");
  assert.equal(matchResponse.status,200);
  const matchHtml=await matchResponse.text();
  for(const id of ["overview","timeline","episodes","teams","scoreboard","farm","combat","vision","deaths","builds","events","analysis"])assert.ok(matchHtml.includes(`id="${id}"`),id);
  assert.ok(matchHtml.includes("Стоимость имущества"));
  assert.equal((await fetch("http://localhost:3018/player/999999")).status,404);
  assert.ok(!output.includes("UNEXPECTED_NETWORK_CALL"),output);
  assert.ok(!output.includes("ошибка запроса"),output);
  console.log("Profile HTTP tests passed: 14 players × 3 periods, per-match breakdown, 404, zero outgoing requests.");
} finally {
  const exited=once(worker,"exit");worker.kill("SIGTERM");await exited;
  await rm(dir,{recursive:true,force:true});
}
