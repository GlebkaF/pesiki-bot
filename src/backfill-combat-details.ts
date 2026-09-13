/** Offline only: replay archives stay intact, no API traffic or chat messages. */
import "dotenv/config";
import { readdir,mkdtemp,rm,statfs,writeFile,rename } from "node:fs/promises";
import os from "node:os";import path from "node:path";
import {execFile} from "node:child_process";import {promisify} from "node:util";
import {getApmStore} from "./apm-store.js";
import {decompress,type ParsedMatch} from "./replay.js";
import {assertReplayIdentity} from "./replay-identity.js";
const store=getApmStore(),data=process.env.DATA_DIR||"data",dir=process.env.REPLAY_ARCHIVE_DIR||path.join(data,"replay-archives");
const report:{startedAt:number;updated:number;skipped:number;failures:{id:number;error:string}[];finishedAt?:number}={startedAt:Date.now(),updated:0,skipped:0,failures:[]};
const save=async()=>{await writeFile(path.join(data,"combat-backfill-report.json.tmp"),JSON.stringify(report,null,2));await rename(path.join(data,"combat-backfill-report.json.tmp"),path.join(data,"combat-backfill-report.json"));};
for(const file of (await readdir(dir)).filter(f=>/^\d+\.dem\.archive$/.test(f)).sort().reverse()){
 const id=Number(file.split('.')[0]);if(process.env.MATCH_IDS&&!process.env.MATCH_IDS.split(',').includes(String(id)))continue;const old=store.replay(id);
 if(old?.parser_version===(process.env.TARGET_PARSER_VERSION||"pesiki-replay-v8")&&old.analytics_version===(process.env.TARGET_ANALYTICS_VERSION||"combat-log-v3")&&(old.analytics_version!=="combat-log-v3"||old.combat_timeline?.version==="combat-timeline-v1")&&old.players.every(p=>p.combat_details?.version===old.analytics_version)){report.skipped++;continue;}
 const disk=await statfs(dir);if(disk.bavail*disk.bsize<3*1024**3){report.failures.push({id,error:"DISK_RESERVE"});break;}
 const scratch=await mkdtemp(path.join(os.tmpdir(),"pesiki-combat-"));
 try{
  const dem=path.join(scratch,"match.dem");await decompress(path.join(dir,file),dem);
  const {stdout}=await promisify(execFile)(process.env.REPLAY_PARSER_BIN||"tools/replay-parser/replay-parser",[dem],{timeout:180000,maxBuffer:1<<28});
  const parsed=JSON.parse(stdout) as ParsedMatch;assertReplayIdentity(parsed,id,store.matchApi(id));
  if(parsed.parser_version!==(process.env.TARGET_PARSER_VERSION||"pesiki-replay-v8")||parsed.analytics_version!==(process.env.TARGET_ANALYTICS_VERSION||"combat-log-v3")||
    (parsed.analytics_version==="combat-log-v3"&&parsed.combat_timeline?.version!=="combat-timeline-v1"))throw Error("Parser output does not match requested analytics version/timeline");
  store.mergeReplayAnalytics(parsed);report.updated++;console.log(`[COMBAT] ${id}: saved`);
 }catch(e){report.failures.push({id,error:(e as Error).message});console.error(`[COMBAT] ${id}: ${(e as Error).message}`);}
 finally{await rm(scratch,{recursive:true,force:true});await save();}
}
report.finishedAt=Date.now();await save();console.log(JSON.stringify(report));store.close();if(report.failures.length)process.exitCode=1;
