/** Offline upgrade of retained archives. Never downloads or removes original files. */
import "dotenv/config";
import { readdir, mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { getApmStore } from "./apm-store.js";
import { decompress, type ParsedMatch } from "./replay.js";
import { validActionCounts } from "./action-counts.js";
const store=getApmStore();
const dir=path.join(process.env.DATA_DIR||"data","replay-archives");
let updated=0, skipped=0, failed=0;
for(const file of (await readdir(dir)).filter(f=>/^\d+\.dem\.archive$/.test(f)).sort()) {
  const id=Number(file.split(".")[0]), old=store.replay(id);
  if(old?.players.every(p=>p.actions!==undefined&&validActionCounts(p.action_counts,p.actions))) {skipped++;continue;}
  const scratch=await mkdtemp(path.join(os.tmpdir(),"pesiki-orders-"));
  try {
    const dem=path.join(scratch,"match.dem"); await decompress(path.join(dir,file),dem);
    const {stdout}=await promisify(execFile)(process.env.REPLAY_PARSER_BIN||"tools/replay-parser/replay-parser",[dem],{maxBuffer:1<<28,timeout:180000});
    const parsed=JSON.parse(stdout) as ParsedMatch;
    if(parsed.match_id!==id||!parsed.apm_version||!parsed.players.every(p=>p.actions!==undefined&&validActionCounts(p.action_counts,p.actions))) throw Error("Missing or invalid action breakdown");
    if(old) {
      for(const p of old.players) {
        const next=parsed.players.find(x=>x.steam_id===p.steam_id);
        if(!next) throw Error("Roster changed");
        if(p.actions!==undefined && (next.actions!==p.actions||next.actions_per_min!==p.actions_per_min)) throw Error("APM changed; manual inspection required");
      }
      // Preserve official stats and enrichment already stored in the old parse.
      store.save({...old,apm_version:parsed.apm_version,apm_duration_seconds:parsed.apm_duration_seconds,
        players:old.players.map(p=>{const n=parsed.players.find(x=>x.steam_id===p.steam_id)!;
          return {...p,actions:n.actions,actions_per_min:n.actions_per_min,action_counts:n.action_counts};})});
    } else store.save(parsed);
    updated++; console.log(`[ACTIONS] ${id}: saved ${parsed.players.length} players`);
  } catch(error) {failed++;console.error(`[ACTIONS] ${id}: ${(error as Error).message}`);}
  finally {await rm(scratch,{recursive:true,force:true});}
}
console.log(JSON.stringify({updated,skipped,failed}));store.close();if(failed)process.exitCode=1;
