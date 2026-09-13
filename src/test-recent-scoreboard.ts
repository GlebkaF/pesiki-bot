import assert from 'node:assert/strict';
import {mkdtempSync,rmSync} from 'node:fs';import os from 'node:os';import path from 'node:path';
const dir=mkdtempSync(path.join(os.tmpdir(),'recent-scoreboard-'));process.env.APM_DB_PATH=path.join(dir,'stats.sqlite');process.env.HTTP_PROXY='';process.env.HTTPS_PROXY='';
const realFetch=globalThis.fetch;let calls=0,fail=false;
let api={match_id:10,start_time:1700000000,duration:120,hero_id:37,player_slot:2,radiant_win:true,kills:50,deaths:10,assists:50,gold_per_min:501};
globalThis.fetch=async()=>{calls++;if(fail)throw Error('offline mock, no outbound request');return new Response(JSON.stringify([api]),{status:200});};
const {getApmStore}=await import('./apm-store.js');const {fetchRecentMatches,savedRecentMatches}=await import('./opendota.js');const store=getApmStore();
(store as any).allReplays=()=>{throw Error('Recent stats must never load full replays');};
try{
 let rows=await fetchRecentMatches(111);assert.equal(rows[0].kills,50);assert.equal(rows[0].kda_source,'opendota');assert.equal(calls,1);
 store.saveResults(111,[{...api,kills:8,deaths:3,assists:27}],'replay-scoreboard');
 rows=await fetchRecentMatches(111);assert.equal(calls,1,'cache hit makes no API request');assert.deepEqual([rows[0].kills,rows[0].deaths,rows[0].assists],[8,3,27]);assert.equal(rows[0].kda_source,'replay-scoreboard');assert.equal((rows[0] as any).gold_per_min,501,'API extras survive scoreboard projection');
 api={...api,kills:999,gold_per_min:650};rows=await fetchRecentMatches(111,undefined,true);assert.equal(rows[0].kills,8);assert.equal((rows[0] as any).gold_per_min,650,'fresh API extras stay fresh');
 store.saveResults(111,[{...api,match_id:11,start_time:1700000100,kills:9}],'replay-scoreboard');
 rows=await fetchRecentMatches(111);assert.equal(rows[0].match_id,11,'completed replay appears before stale API list catches up');assert.equal(rows.find(m=>m.match_id===10)!.kills,8);
 store.saveResults(222,[{...api,match_id:20,kills:4,assists:9}]);fail=true;
 rows=await fetchRecentMatches(222);assert.equal(rows[0].match_id,20);assert.equal(rows[0].kills,4);assert.equal(rows[0].kda_source,'opendota','API outage retains saved official rows even without a replay');
 rows=await fetchRecentMatches(111,undefined,true);assert.equal(rows.find(m=>m.match_id===10)!.kills,8,'cached outage fallback rechecks scoreboard priority');
 assert.deepEqual(savedRecentMatches(333),[],'missing trusted result never invents final KDA from raw replay');
 await assert.rejects(fetchRecentMatches(333),/cooldown/);
 const now=Math.floor(Date.now()/1000);store.saveResults(444,Array.from({length:30},(_,i)=>({...api,match_id:100+i,start_time:now-3600-i*86400})));
 assert.equal((await fetchRecentMatches(444,7)).length,7,'offline requested date window excludes older saved rows');
 assert.equal((await fetchRecentMatches(444)).length,20,'offline recent endpoint preserves twenty-match limit');
 assert.equal((await fetchRecentMatches(444,1)).length,20,'days=1 uses the same recent20 endpoint semantics as online; stats applies calendar-day filtering');
 console.log('Recent stats source tests passed: API/cache/outage priority, extras, official fallback, no raw replay loads');
}finally{store.close();globalThis.fetch=realFetch;rmSync(dir,{recursive:true,force:true});}
