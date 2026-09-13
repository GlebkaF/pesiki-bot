import { assertReplayIdentity } from "./replay-identity.js";
/** Explicit, resumable historical recovery. Not a polling job. */
import "dotenv/config";
import { mkdir, readFile, writeFile, rename, rm, mkdtemp, stat, statfs } from "node:fs/promises";
import { createWriteStream } from "node:fs";
import { pipeline } from "node:stream/promises";
import { Readable } from "node:stream";
import { promisify } from "node:util";
import { execFile } from "node:child_process";
import os from "node:os";
import path from "node:path";
import { getApmStore } from "./apm-store.js";
import { fetchMatchApi } from "./opendota.js";
import { buildReplayUrl, decompress, type ParsedMatch } from "./replay.js";
import { validActionCounts } from "./action-counts.js";
import { PLAYERS } from "./config.js";
const store=getApmStore(),dataDir=process.env.DATA_DIR||"data",archiveDir=process.env.REPLAY_ARCHIVE_DIR||path.join(dataDir,"replay-archives");
const reportPath=path.join(dataDir,"action-retro-report.json");
const exists=(p:string)=>stat(p).then(()=>true,()=>false);
const ours=new Set(PLAYERS.map(p=>p.steamId));
const report:{startedAt:number;updatedAt:number;finishedAt?:number;rows:Record<string,{status:string;error?:string;at:number}>}=
  await readFile(reportPath,"utf8").then(JSON.parse).catch(()=>({startedAt:Date.now(),updatedAt:Date.now(),rows:{}}));
delete report.finishedAt;
const saveReport=async()=>{report.updatedAt=Date.now();await writeFile(reportPath+".tmp",JSON.stringify(report,null,2));await rename(reportPath+".tmp",reportPath);};
await mkdir(archiveDir,{recursive:true});
const known=new Map(store.profileRosters().map(m=>[m.match_id,{match_id:m.match_id,start_time:m.start_time,priority:0}]));
for(const player of PLAYERS) for(const m of store.results(player.steamId)) if(!known.has(m.match_id)) known.set(m.match_id,{match_id:m.match_id,start_time:m.start_time,priority:1});
const targets=[...known.values()].sort((a,b)=>a.priority-b.priority||(a.start_time??0)-(b.start_time??0)||a.match_id-b.match_id);
let apiAt=0;
for(const target of targets) {
  const id=target.match_id,old=store.replay(id);
  if(old?.players.length&&old.players.every(p=>p.actions!==undefined&&validActionCounts(p.action_counts,p.actions))) {
    report.rows[id]={status:"available",at:Date.now()};continue;
  }
  // Unavailable historical CDN URLs do not become fresher on an immediate retry.
  if(["cdn_unavailable","no_location"].includes(report.rows[id]?.status)&&Date.now()-report.rows[id].at<86400000)continue;
  const scratch=await mkdtemp(path.join(os.tmpdir(),"pesiki-retro-")),archive=path.join(archiveDir,`${id}.dem.archive`),download=path.join(scratch,"download");
  try {
    const disk=await statfs(archiveDir);if(disk.bavail*disk.bsize<3*1024**3)throw Error("DISK_RESERVE: less than 3 GiB available");
    const archiveExists=await exists(archive);
    let api=store.matchApi(id);
    // A cached unparsed response may gain a replay location later.
    if(!api || (!archiveExists && (!api.cluster || !api.replay_salt))) {
      const wait=2000-(Date.now()-apiAt);if(wait>0)await new Promise(r=>setTimeout(r,wait));
      apiAt=Date.now();api=await fetchMatchApi(id);
    }
    if(api.match_id!==id)throw Error("API match ID mismatch");
    for(const p of api.players) if(p.account_id&&ours.has(p.account_id)) store.saveResults(p.account_id,[{
      match_id:id,start_time:api.start_time,duration:api.duration,hero_id:p.hero_id,player_slot:p.player_slot,
      radiant_win:api.radiant_win,kills:p.kills,deaths:p.deaths,assists:p.assists}]);
    if(!archiveExists) {
      if(!api.cluster||!api.replay_salt) {report.rows[id]={status:"no_location",at:Date.now()};console.log(`[RETRO] ${id}: no replay location`);continue;}
      const res=await fetch(buildReplayUrl(id,{cluster:api.cluster,salt:api.replay_salt}),{signal:AbortSignal.timeout(90000)});
      if(res.status===404||res.status===410) {report.rows[id]={status:"cdn_unavailable",error:`Valve HTTP ${res.status}`,at:Date.now()};console.log(`[RETRO] ${id}: Valve ${res.status}`);await res.body?.cancel();continue;}
      if(!res.ok||!res.body)throw Error(`Valve HTTP ${res.status}`);
      await pipeline(Readable.fromWeb(res.body as never),createWriteStream(download));
      // Download and destination may be on different filesystems in Docker.
      const {copyFile}=await import("node:fs/promises");await copyFile(download,archive+".restoring");await rename(archive+".restoring",archive);
    }
    const dem=path.join(scratch,"match.dem");await decompress(archive,dem);
    const {stdout}=await promisify(execFile)(process.env.REPLAY_PARSER_BIN||"tools/replay-parser/replay-parser",[dem],{timeout:180000,maxBuffer:1<<28});
    const parsed=JSON.parse(stdout) as ParsedMatch;assertReplayIdentity(parsed,id,api);
    if(Number.isFinite(api.start_time)&&api.start_time>0)parsed.start_time=api.start_time;
    store.mergeReplayActions(parsed);
    report.rows[id]={status:"restored",at:Date.now()};console.log(`[RETRO] ${id}: restored`);
  } catch(error) {
    const message=(error as Error).message;report.rows[id]={status:"error",error:message,at:Date.now()};console.error(`[RETRO] ${id}: ${message}`);
    if(/\b429\b|cooldown|DISK_RESERVE/.test(message)) {process.exitCode=1;break;}
  } finally {await rm(scratch,{recursive:true,force:true});await rm(archive+".restoring",{force:true});await saveReport();}
}
report.finishedAt=Date.now();await saveReport();
console.log(JSON.stringify(Object.values(report.rows).reduce<Record<string,number>>((r,m)=>{r[m.status]=(r[m.status]??0)+1;return r;},{})));
store.close();
