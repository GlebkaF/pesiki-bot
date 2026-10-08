import assert from 'node:assert/strict';
import {mkdtemp, writeFile, rm} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

const dir = await mkdtemp(path.join(os.tmpdir(), 'pesiki-latest-'));
process.env.DATA_DIR = dir;
process.env.APM_DB_PATH = path.join(dir, 'stats.sqlite');
process.env.HTTPS_PROXY = '';
process.env.HTTP_PROXY = '';
const originalFetch = globalThis.fetch;
let calls = 0;
let unavailable = false;
const {PLAYER_IDS} = await import('./config.js');
const match = (id: number, start: number) => ({match_id:id,start_time:start,player_slot:0,radiant_win:true,duration:1200,hero_id:1,kills:1,deaths:1,assists:1});
globalThis.fetch = async input => {
  calls++;
  if (unavailable) throw new Error('test history unavailable');
  const playerId = Number(String(input).match(/players\/(\d+)/)?.[1]);
  // Deliberately unsorted; the latest player's newest match must win.
  return Response.json(playerId === PLAYER_IDS.at(-1)
    ? [match(100,100), match(300,300)] : [match(100,100)]);
};
const {getApmStore} = await import('./apm-store.js');
const store = getApmStore();
try {
  store.saveResults(PLAYER_IDS[0], [match(100,100)]);
  await writeFile(path.join(dir,'feed.json'), JSON.stringify({matches:[{matchId:200,startTime:200,ours:[{steamId:PLAYER_IDS[0],name:'Player'}]}]}));
  const {fetchRecentMatches} = await import('./opendota.js');
  const {findLastPartyMatch} = await import('./analyze-v2.js');
  assert.equal((await findLastPartyMatch())?.matchId,200);
  assert.equal(calls,0,'normal lookup may use saved history');
  await fetchRecentMatches(PLAYER_IDS[0]);
  const before = calls;
  assert.equal((await findLastPartyMatch(true))?.matchId,300);
  assert.equal(calls-before,PLAYER_IDS.length,'refresh queries every player, including cached history');
  assert.ok(store.results(PLAYER_IDS.at(-1)!).some(m=>m.match_id===300),'fresh match is saved');
  unavailable = true;
  assert.equal((await findLastPartyMatch(true))?.matchId,300,'outage preserves newest known match');
  console.log('✓ analyze latest: fresh history, cache bypass, newest selection, persistence and outage fallback');
} finally {
  globalThis.fetch = originalFetch;
  store.close();
  await rm(dir,{recursive:true,force:true});
}
