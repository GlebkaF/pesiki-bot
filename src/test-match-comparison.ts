import assert from 'node:assert/strict';
import {existsSync,readFileSync} from 'node:fs';
import type {ApmStore} from './apm-store.js';
import {APM_VERSION} from './apm-store.js';
import type {ParsedMatch} from './replay.js';
import {PLAYERS} from './config.js';
import {buildMatchComparison} from './match-comparison.js';
const account=94014640,steam=String(BigInt(account)+76561197960265728n);
const fixture=(id:number)=>({match_id:id,duration_min:20,winner:'radiant',game_mode:'mode_22',apm_version:APM_VERSION,apm_duration_seconds:1200,players:[{steam_id:steam,hero:'warlock',team:'radiant',kills:999,deaths:888,assists:777,actions:2000,actions_per_min:100,networth_by_minute:Array.from({length:22},(_,i)=>(i+1)*500),item_timings:[{item:'item_blink',min:10},{item:'blink',min:9},{item:'boots',min:0},{item:'bad',min:-1},{item:'late',min:21}],combat_details:{version:'combat-log-v2',coverage:{xp:true},xp_by_minute:[0,100,200],last_hits_by_minute:[0,1,2]}}]}) as unknown as ParsedMatch;
const left=fixture(11),right=fixture(12);right.duration_min=10;right.apm_duration_seconds=600;right.players[0].actions_per_min=200;right.players[0].networth_by_minute[1]=NaN;right.players[0].networth_by_minute[9]=5500;right.players[0].item_timings=[{item:'blink',min:8},{item:'wand',min:2}];
let reads=0;const games=new Map([[11,left],[12,right]]);let official:unknown[]=[];
const store={replay:(id:number)=>{reads++;return games.get(id);},officialPlayers:()=>official} as unknown as ApmStore;
const before=JSON.stringify([left,right]);let result=buildMatchComparison(store,account,11,12)!;
assert.equal(reads,2);assert.equal(JSON.stringify([left,right]),before,'read-only, no enrichment mutation');
assert.equal(result.left.kda.value,null,'unverified combat KDA excluded');
assert.deepEqual(result.left.apm.value,{apm:100,actions:2000,durationSeconds:1200});
assert.equal(result.curves.networth[0].minute,1);assert.equal(result.curves.networth.length,9);assert.ok(!result.curves.networth.some(p=>p.minute===2),'no interpolation');
assert.equal(result.curves.networth.at(-1)!.delta,500);assert.equal(result.left.checkpoints[1].networth,10000);assert.equal(result.right.checkpoints[1].networth,null,'no final value substitution at minute20');
assert.equal(result.left.curves.networth.coverage.complete,true);assert.equal(result.right.curves.networth.coverage.complete,false);
assert.deepEqual(result.purchases.find(p=>p.item==='blink'),{item:'blink',leftSeconds:540,rightSeconds:480,deltaSeconds:-60});
assert.equal(result.purchases.find(p=>p.item==='boots')!.leftSeconds,0);assert.equal(result.purchases.find(p=>p.item==='boots')!.rightSeconds,null);assert.equal(result.purchases.find(p=>p.item==='wand')!.deltaSeconds,null);
assert.deepEqual(result.curves.xp[0],{minute:1,left:0,right:0,delta:0},'observed zero remains zero');
right.players[0].combat_details!.coverage!.xp=false;result=buildMatchComparison(store,account,11,12)!;assert.deepEqual(result.curves.xp,[]);assert.equal(result.right.curves.xp.source,null);
right.players[0].actions_per_min=101;right.game_mode='mode_23';right.players[0].hero='pudge';result=buildMatchComparison(store,account,11,12)!;assert.equal(result.right.apm.value,null);assert.equal(result.sameHero,false);assert.equal(result.sameMode,false);assert.ok(result.warnings.length>=3);
right.game_mode='mode_0';assert.equal(buildMatchComparison(store,account,11,12)!.sameMode,null);
assert.equal(buildMatchComparison(store,account,11,11),null);assert.equal(buildMatchComparison(store,123456,11,12),null);assert.equal(buildMatchComparison(store,account,11,99),null);
right.players.push({...right.players[0]});assert.equal(buildMatchComparison(store,account,11,12),null);right.players.pop();right.players[0].steam_id='0';assert.equal(buildMatchComparison(store,account,11,12),null);right.players[0].steam_id=steam;
official=[{account_id:account,hero_id:37,player_slot:0,kills:0,deaths:4,assists:12}];assert.deepEqual(buildMatchComparison(store,account,11,12)!.left.kda.value,[0,4,12]);
for(const patch of [{account_id:account+1},{account_id:null},{hero_id:14},{player_slot:128},{kills:-1}]){official=[{account_id:account,hero_id:37,player_slot:0,kills:0,deaths:4,assists:12,...patch}];assert.equal(buildMatchComparison(store,account,11,12)!.left.kda.value,null);}
left.players[0].replay_scoreboard={version:'player-resource-v1',source:'CDOTA_PlayerResource',complete:true,end_state_observed:true,resource_slot:0,team_slot:0,hero_id:37,kills:3,deaths:5,assists:19};
assert.deepEqual(buildMatchComparison(store,account,11,12)!.left.kda.value,[3,5,19]);assert.equal(buildMatchComparison(store,account,11,12)!.left.kda.source,'replay-scoreboard');
(left.players[0].replay_scoreboard as unknown as {complete:boolean}).complete=false;assert.equal(buildMatchComparison(store,account,11,12)!.left.kda.value,null);
right.apm_duration_seconds=599;assert.equal(buildMatchComparison(store,account,11,12)!.right.checkpoints[0].networth,null,'exact seconds exclude rounded final minute');assert.equal(buildMatchComparison(store,account,11,12)!.right.durationSeconds,599);
const fixtures=['/tmp/pesiki-v7-shared.json','/tmp/pesiki-v7-warlock.json'];
if(fixtures.every(existsSync)){
 const [a,b]=fixtures.map(p=>JSON.parse(readFileSync(p,'utf8')) as ParsedMatch),tracked=PLAYERS.find(p=>[a,b].every(m=>m.players.some(q=>q.steam_id===String(BigInt(p.steamId)+76561197960265728n))));
 if(tracked){const local={replay:(id:number)=>id===a.match_id?a:b,officialPlayers:()=>[]} as unknown as ApmStore;const real=buildMatchComparison(local,tracked.steamId,a.match_id,b.match_id)!;assert.ok(real);assert.ok(real.curves.networth.length>0);for(const key of ['networth','xp','lastHits'] as const)for(const p of real.curves[key])assert.equal(p.delta,p.right-p.left);console.log('Real replay comparison verified:',real.curves.networth.length,'common NW minutes');}
}
console.log('Match comparison tests passed');
