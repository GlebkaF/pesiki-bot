import assert from 'node:assert/strict';
import {mkdtemp,rm,writeFile,readFile} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {AdviceSources,parsePopularity,type AdviceItem,type AdviceKnowledge} from './advice-sources.js';
import {buildCandidates,buildAdviceContext,canAdvise} from './advice-context.js';
import {LiveAdviceService,adviceFingerprint} from './live-advice.js';
import type {LiveMatch,LivePlayer} from './live-match.js';
import {adviceText,replyAdvice} from './advice-command.js';
import {AdviceJournal,type AdviceJournalEvent} from './advice-journal.js';
import {renderLiveAdvice} from './web/live-advice-render.js';

const item=(id:number,key:string,cost:number,components:string[]=[]):AdviceItem=>({id,key,name:key,cost,components,description:'Fixture mechanics',notes:'',attributes:''});
const knowledge:AdviceKnowledge={revision:'test',items:[item(1,'staff',1000),item(2,'force_staff',2200,['staff']),item(3,'hurricane_pike',4500,['force_staff']),item(4,'black_king_bar',4050)]};
let now=1_790_000_000_000;
const player=(account:number,ours=false):LivePlayer=>({account,name:'Игрок <b>',hero:'Lich',heroId:31,ours,slot:account-1,items:[1],gold:1200,netWorth:6000,level:12});
const match:LiveMatch={matchId:'123',kind:'stack',stackCount:1,gameMode:23,time:900,delay:120,updatedAt:now,detailed:true,buildings:[],history:[],teams:[{name:'Radiant',players:[player(1,true),...Array.from({length:4},(_,i)=>player(i+2))]},{name:'Dire',players:Array.from({length:5},(_,i)=>player(i+6))}]};
const raw={start_game_items:{},early_game_items:{},mid_game_items:{'2':12,'3':6},late_game_items:{'3':4}};
const popularity=parsePopularity(31,raw,now);
assert.equal(popularity.counts['3'],10);
assert.deepEqual(popularity.byPhase?.['3'],{start:0,early:0,mid:6,late:4});
assert.throws(()=>parsePopularity(31,{...raw,late_game_items:{'3':-1}}));
assert.throws(()=>parsePopularity(31,{}));
assert.ok(canAdvise(match,now));
assert.ok(!canAdvise({...match,updatedAt:now-90_000},now));
assert.ok(!canAdvise({...match,kind:'public'},now));
assert.ok(!canAdvise({...match,detailed:false},now));
assert.ok(!canAdvise({...match,teams:match.teams.slice(0,1)},now));
const candidates=buildCandidates(match.teams[0].players[0],knowledge,popularity);
assert.equal(candidates.find(c=>c.id===2)?.remainingCost,1200);
assert.equal(candidates.find(c=>c.id===3)?.remainingCost,3500);
assert.deepEqual(candidates.find(c=>c.id===3)?.purchasesByPhase,{start:0,early:0,mid:6,late:4});
assert.deepEqual(candidates.find(c=>c.id===4)?.purchasesByPhase,{start:0,early:0,mid:0,late:0});
assert.equal(buildCandidates(player(1,true),knowledge).find(c=>c.id===4)?.purchasesByPhase,null);
assert.equal(buildCandidates(player(1,true),knowledge,{...popularity,byPhase:undefined}).find(c=>c.id===4)?.purchasesByPhase,null);
const withRecipe={...knowledge,items:[...knowledge.items,item(5,'recipe_force_staff',1200)]};
assert.equal(buildCandidates({...player(1,true),items:[1,5]},withRecipe,popularity).find(c=>c.id===2)?.remainingCost,0);
assert.ok(!buildCandidates({...player(1,true),items:[]},withRecipe,{...popularity,counts:{'5':100,'2':1}}).some(c=>c.id===5));
assert.ok(!buildCandidates({...player(1,true),items:[3]},knowledge,popularity).some(c=>[1,2,3].includes(c.id)));
const context=buildAdviceContext(match,knowledge,new Map([[31,popularity]]),now);
assert.equal(context.gameMode,23);assert.equal(context.players[0].role,null);
assert.equal(context.sourceLagSeconds,null);
assert.equal(context.nominalSpectatorDelay,120);
assert.equal(context.inputPolicy,'draft-and-stack-inventory-v1');
// Metamorphic test: excluded facts cannot affect context, candidates or cache.
const hiddenChanged:LiveMatch={...match,teams:match.teams.map(t=>({...t,netWorth:999999,
 players:t.players.map(p=>p.ours?p:{...p,items:[4,3,2],gold:99999,netWorth:88888,level:30})}))};
assert.deepEqual(buildAdviceContext(hiddenChanged,knowledge,new Map([[31,popularity]]),now),context);
assert.equal(adviceFingerprint(hiddenChanged),adviceFingerprint(match));
assert.ok(context.teams.every(t=>!('netWorth' in t)&&t.players.every(p=>!('inventory' in p)&&!('level' in p))));
const reordered={...match,teams:[...match.teams].reverse().map(t=>({...t,players:[...t.players].reverse()}))};
assert.equal(adviceFingerprint(reordered),adviceFingerprint(match));
const ownChanged={...match,teams:match.teams.map(t=>({...t,players:t.players.map(p=>p.ours?{...p,items:[4]}:p)}))};
assert.notEqual(adviceFingerprint(ownChanged),adviceFingerprint(match));
assert.notDeepEqual(buildAdviceContext(ownChanged,knowledge,new Map([[31,popularity]]),now).players[0].candidates,context.players[0].candidates);
const opposingStack={...match,teams:match.teams.map((t,i)=>({...t,players:t.players.map((p,j)=>i===1&&j===0?{...p,ours:true}:p)}))};
assert.equal(canAdvise(opposingStack,now),false,'one shared response cannot expose opposing tracked inventories');
assert.throws(()=>buildAdviceContext(opposingStack,knowledge,new Map(),now));
const duplicateAccount={...match,teams:match.teams.map((t,i)=>({...t,players:t.players.map((p,j)=>i===1&&j===0?{...p,account:1}:p)}))};
assert.equal(canAdvise(duplicateAccount,now),false);

const output={players:[{account:1,itemId:2,reason:'Проверочный совет',alternativeId:4,alternativeReason:'Условная альтернатива',threatHeroIds:[]}],plan:'Проверочный план'};

const dir=await mkdtemp(path.join(os.tmpdir(),'pesiki-advice-test-'));
try{
 let calls=0;
 const fetcher:typeof fetch=async()=>{calls++;return new Response(JSON.stringify(raw),{status:200});};
 const sources=new AdviceSources(dir,fetcher,()=>now);
 const [a,b]=await Promise.all([sources.popularity(31),sources.popularity(31)]);
 assert.deepEqual(a,b);assert.equal(calls,1);
 const reloaded=new AdviceSources(dir,fetcher,()=>now);
 await reloaded.popularity(31);assert.equal(calls,1,'disk cache survives restart');
 now+=7*60*60_000;
 let failures=0;
 const broken=new AdviceSources(dir,async()=>{failures++;return new Response('',{status:429});},()=>now);
 await assert.rejects(broken.popularity(31));await assert.rejects(broken.popularity(31));
 assert.equal(failures,1,'failed upstream is not hammered or returned as fresh cache');
}finally{await rm(dir,{recursive:true,force:true});}

match.updatedAt=now;
let generations=0,release!:()=>void;
const latch=new Promise<void>(resolve=>{release=resolve;});
const source={knowledge:async()=>knowledge,popularity:async()=>popularity};
const service=new LiveAdviceService(source,async()=>{generations++;await latch;return output;},()=>now,null);
const first=service.get(match),second=service.get(match);
release();
const results=await Promise.all([first,second]);
assert.equal(generations,1);assert.ok(results.every(r=>r.status==='ready'));
const ready=results[0];assert.equal(ready.status,'ready');
if(ready.status==='ready'){
 const html=renderLiveAdvice(ready);assert.ok(html.includes('Игрок &lt;b&gt;'));assert.ok(!html.includes('Игрок <b>'));assert.ok(html.includes('Turbo'));
 assert.ok(adviceText(ready).includes('force_staff'));assert.ok(adviceText(ready).includes('фактическая задержка не измерена'));assert.ok(!adviceText(ready).includes('DotaTV +120'));assert.ok(html.includes('фактическая задержка данных не измерена'));assert.ok(adviceText(ready).length<4096);
 const sent:unknown[]=[];
 const ctx={chat:{id:1},message:{message_id:2},reply:async(...args:unknown[])=>{sent.push(args);return {message_id:3};},api:{editMessageText:async(...args:unknown[])=>{sent.push(args);}}};
 await replyAdvice(ctx as never,async()=>ready);
 assert.equal(sent.length,2);assert.ok(JSON.stringify(sent).includes('Советы и матч на сайте'));assert.ok(!JSON.stringify(sent).includes('parse_mode'));
}
assert.equal((await service.get(match)).status,'ready');assert.equal(generations,1);
const changed={...match,teams:match.teams.map(t=>({...t,players:t.players.map(p=>p.ours?{...p,items:[2]}:p)}))};
assert.notEqual(service.peek(changed).status,'ready','a bought item invalidates displayed advice');
assert.notEqual(service.peek({...match,matchId:'456'}).status,'ready','no cross-match leakage');
now+=91_000;
assert.notEqual((await service.get(match)).status,'ready','stale match does not trigger the model');
assert.equal(generations,1);
// The first caller must not receive an obsolete result even when a second
// observer update arrives while the model is running.
match.updatedAt=now;
for(const change of ['purchase','new-match','no-match','hidden-only','level-gold'] as const){
 let finish!:()=>void,start!:()=>void;
 const started=new Promise<void>(resolve=>{start=resolve;});
 const delayed=new Promise<void>(resolve=>{finish=resolve;});
 const racing=new LiveAdviceService(source,async()=>{start();await delayed;return output;},()=>now,null);
 const pending=racing.get(match);
 await started;
 const next=change==='level-gold'?{...match,updatedAt:now,time:match.time!+30,teams:match.teams.map(t=>({...t,players:t.players.map(p=>({...p,level:(p.level??0)+1,gold:(p.gold??0)+600}))}))}:change==='purchase'?{...changed,updatedAt:now}:
  change==='new-match'?{...match,matchId:'new',updatedAt:now}:
  change==='hidden-only'?{...hiddenChanged,updatedAt:now}:null;
 racing.peek(next);
 finish();
 const state=await pending;
 assert.equal(state.status,['hidden-only','level-gold'].includes(change)?'ready':'unavailable',change);
}
const pairMatch={...match,stackCount:2,teams:match.teams.map(t=>({...t,players:t.players.map(p=>p.account===2?{...p,ours:true}:p)}))};
let pairRelease!:()=>void,pairStart!:()=>void;
const pairStarted=new Promise<void>(resolve=>{pairStart=resolve;});
const pairWait=new Promise<void>(resolve=>{pairRelease=resolve;});
const pairService=new LiveAdviceService(source,async()=>{pairStart();await pairWait;return {...output,players:[output.players[0],{...output.players[0],account:2}]};},()=>now,null);
const pairPending=pairService.get(pairMatch);await pairStarted;
pairService.peek({...pairMatch,teams:pairMatch.teams.map(t=>({...t,players:t.players.map(p=>p.account===1?{...p,items:[2]}:p)}))});
pairRelease();const partial=await pairPending;
assert.equal(partial.status,'ready');
if(partial.status==='ready')assert.deepEqual(partial.advice.cards.map(c=>c.account),[2],'one purchase must not discard the other player decision');
const pairCached=new LiveAdviceService(source,async()=>({...output,players:[output.players[0],{...output.players[0],account:2}]}),()=>now,null);
await pairCached.get(pairMatch);
const afterPurchase=pairCached.peek({...pairMatch,teams:pairMatch.teams.map(t=>({...t,players:t.players.map(p=>p.account===1?{...p,items:[2]}:p)}))});
assert.equal(afterPurchase.status,'ready');
if(afterPurchase.status==='ready')assert.deepEqual(afterPurchase.advice.cards.map(c=>c.account),[2],'cached cards invalidate per player too');
const journalDir=await mkdtemp(path.join(os.tmpdir(),'pesiki-advice-journal-'));
try{
 const journal=new AdviceJournal(journalDir);
 const events:AdviceJournalEvent[]=[];
 const sink={record:async(event:AdviceJournalEvent)=>{events.push(event);await journal.record(event);}};
 const audited=new LiveAdviceService(source,async()=>output,()=>now,null,sink);
 assert.equal((await audited.get(match)).status,'ready');
 assert.deepEqual(events.map(e=>e.kind),['opportunity','prepared','generated','returned']);
 const prepared=events.find(e=>e.kind==='prepared')!;
 assert.deepEqual((prepared.data as {context:unknown}).context,buildAdviceContext(match,knowledge,new Map([[31,popularity]]),now));
 assert.equal(new Set(events.map(e=>e.decisionId)).size,1);
 const file=path.join(journalDir,new Date(now).toISOString().slice(0,10)+'.jsonl');
 assert.deepEqual((await readFile(file,'utf8')).trim().split('\n').map(line=>JSON.parse(line)),events);
 await audited.get({...hiddenChanged,updatedAt:now});
 assert.equal(events.length,4,'polling and hidden-only changes do not create opportunities');
 const failedEvents:AdviceJournalEvent[]=[];
 const failing=new LiveAdviceService(source,async()=>{throw Error('secret-provider-error');},()=>now,null,{record:async(e)=>{failedEvents.push(e);}});
 assert.equal((await failing.get(match)).status,'unavailable');
 assert.ok(failedEvents.some(e=>e.kind==='rejected'&&(e.data as {stage:string}).stage==='model'));
 assert.ok(!JSON.stringify(failedEvents).includes('secret-provider-error'));
 const brokenSink=new LiveAdviceService(source,async()=>output,()=>now,null,{record:async()=>{throw Error('disk full');}});
 assert.equal((await brokenSink.get(match)).status,'ready','journal failures do not break advice');
 // Concurrent appends remain whole JSON lines and preserve submission order.
 await Promise.all([0,1,2].map(i=>journal.record({...events[0],decisionId:String(i)})));
 assert.deepEqual((await readFile(file,'utf8')).trim().split('\n').slice(-3).map(line=>JSON.parse(line).decisionId),['0','1','2']);
}finally{await rm(journalDir,{recursive:true,force:true});}
const budgetDir=await mkdtemp(path.join(os.tmpdir(),'pesiki-advice-budget-'));
try{
 match.updatedAt=now;
 const budgetPath=path.join(budgetDir,'budget.json');
 await writeFile(budgetPath,JSON.stringify({day:new Date(now).toISOString().slice(0,10),dailyCount:20,counts:[[match.matchId,20]]}));
 const limited=new LiveAdviceService(source,async()=>{throw Error('Budget must prevent model call');},()=>now,budgetPath);
 assert.equal((await limited.get(match)).status,'limited');
 assert.equal(limited.peek(match).status,'limited');
 await writeFile(budgetPath,JSON.stringify({day:new Date(now).toISOString().slice(0,10),dailyCount:0,counts:[]}));
 const persisted=new LiveAdviceService(source,async()=>output,()=>now,budgetPath);
 assert.equal((await persisted.get(match)).status,'ready');
 assert.equal(JSON.parse(await readFile(budgetPath,'utf8')).dailyCount,1);
}finally{await rm(budgetDir,{recursive:true,force:true});}
console.log('Advice: source schemas, persisted/coalesced cache, 429 backoff, Turbo context, owned upgrades, component costs, invalid model output, shared generation and stale/cross-match isolation passed.');
