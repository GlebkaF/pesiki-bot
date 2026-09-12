import assert from 'node:assert/strict';
import {mkdtemp,writeFile,rm} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
const dir=await mkdtemp(path.join(os.tmpdir(),'pesiki-outage-'));
process.env.DATA_DIR=dir;
process.env.APM_DB_PATH=path.join(dir,'stats.sqlite');
process.env.HTTPS_PROXY='';process.env.HTTP_PROXY='';
let calls=0;
globalThis.fetch=async()=>{calls++;return new Response('rate limited',{status:429});};
const {getApmStore}=await import('./apm-store.js');
const store=getApmStore();
try{
 store.saveReplay({match_id:123,start_time:Math.floor(Date.now()/1000)-8*86400,duration_min:20,winner:'radiant',players:[{steam_id:String(76561197960265728n+1869377945n),hero:'invoker',team:'radiant',kills:5,deaths:2,assists:3}]} as any);
 await writeFile(path.join(dir,'feed.json'),JSON.stringify({updatedAt:0,matches:[{matchId:456,startTime:1,duration:600,win:true,ours:[]}]}));
 const {rebuildFeed,getFeed}=await import('./web/feed.js');
 const feed=await rebuildFeed();
 assert.ok(feed.some(m=>m.matchId===123),'rebuild from durable database');
 assert.ok(feed.some(m=>m.matchId===456),'preserve previous feed on partial failures');
 assert.equal(calls,1,'single 429 opens shared cooldown instead of 14 retry chains');
 const {findLastPartyMatch}=await import('./analyze-v2.js');
 assert.equal((await findLastPartyMatch())?.matchId,123);
 assert.equal(calls,1,'last known match works without API');
 await writeFile(path.join(dir,'feed.json'),JSON.stringify({updatedAt:Date.now(),matches:[]}));
 assert.ok((await getFeed()).matches.length,'recover empty feed cache');
 assert.equal(calls,1);
 console.log('✓ API outage: restore feed from DB, preserve known rows, /analyze lookup, one 429 request');
}finally{store.close();await rm(dir,{recursive:true,force:true});}
