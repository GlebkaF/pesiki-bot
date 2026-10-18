import assert from 'node:assert/strict';
import {mkdtempSync,rmSync} from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {VoiceMemoryStore,voiceMemoryScope,VOICE_MEMORY_HALF_LIFE_MS,type VoiceDraftInput} from './voice-memory.js';

const dir=mkdtempSync(path.join(os.tmpdir(),'voice-memory-')),file=path.join(dir,'stats.sqlite');
let store=new VoiceMemoryStore(file);
const scope=voiceMemoryScope(-123),other=voiceMemoryScope(-124),pilot=voiceMemoryScope(-123,'pilot:A');
const t=1700000000000;
const input=(matchId:number,createdAt=t,matchAt=createdAt-1000):VoiceDraftInput=>({scope,matchId,matchAt,createdAt,text:`story ${matchId}`,patches:[{accountId:42,delta:0.5,summary:'A grounded impression',evidenceIds:['e']}],evidence:[{id:'e',accountId:42,kind:'match',at:matchAt,text:'Verified event'}]});
try {
 assert.notEqual(scope,pilot);assert.notEqual(voiceMemoryScope('a:b','c'),voiceMemoryScope('b','c:a'));
 store.addChat({scope,messageId:1,at:t-20,authorId:42,authorName:'name',text:'old'});
 store.addChat({scope,messageId:1,at:t+20,authorId:42,authorName:'new name',text:'edited future'});
 store.addChat({scope,messageId:2,at:t+20,authorId:42,authorName:'name',text:'future'});
 assert.deepEqual(store.context(scope,[42],t).chat.map(x=>x.text),['old']);
 assert.ok(store.context(scope,[42],t).chat[0].evidenceId);
 const id=store.draft(input(1));assert.equal(store.getDraft(id)?.text,'story 1');
 assert.equal(store.context(scope,[42],t+1).players[0].score,0,'draft/failed delivery never mutates state');
 assert.equal(store.context(scope,[42],t+1).recentPublications.length,0);
 assert.throws(()=>store.publish(id,1,t-1),/predates/);
 const first=store.publish(id,10,t+10,'<b>Actual sent text</b>');assert.deepEqual(first.appliedAccountIds,[42]);
 assert.equal(store.publish(id,10,t+100).duplicate,true);
 assert.throws(()=>store.publish(id,11,t+100),/different message/);
 assert.equal(store.context(scope,[42],t+10).players[0].score,0,'cutoff is exclusive');
 assert.equal(store.context(scope,[42],t+11).recentPublications[0].text,'<b>Actual sent text</b>');
 assert.equal(store.context(other,[42],t+100).players[0].score,0);assert.equal(store.context(pilot,[42],t+100).recentPublications.length,0);
 store.close();store=new VoiceMemoryStore(file);
 assert.equal(store.context(scope,[42],t+11).players[0].summary,'A grounded impression');
 assert.equal(store.publish(id,10,t+100).duplicate,true,'retry survives restart');
 const half=store.context(scope,[42],t+10+VOICE_MEMORY_HALF_LIFE_MS).players[0].score;
 assert.ok(Math.abs(half-0.25)<1e-10);
 for(let i=0;i<100;i++)assert.equal(store.context(scope,[42],t+10+VOICE_MEMORY_HALF_LIFE_MS).players[0].score,half);
 const repeat=store.draft(input(1,t+100,t-1000));assert.equal(store.publish(repeat,12,t+110).skipped[0].reason,'match_already_applied');
 const historical=store.draft(input(2,t+200,t-2000));assert.equal(store.publish(historical,13,t+210).skipped[0].reason,'historical_match');
 assert.equal(store.context(scope,[42],t+211).recentPublications.length,3,'skipped memory still records publication');
 const second=new VoiceMemoryStore(file);
 try {
  const a=store.draft(input(3,t+300,t+250)),b=second.draft(input(4,t+300,t+260));
  store.publish(a,14,t+310);
  assert.equal(second.publish(b,15,t+310).skipped[0].reason,'stale_draft','same timestamp concurrent drafts use durable sequence');
  assert.equal(store.context(scope,[42],t+305).players[0].lastMatchAt,t-1000,'historical query selects prior snapshot');
  assert.equal(store.context(scope,[42],t+311).players[0].lastMatchAt,t+250);
 } finally {second.close();}
 const collision=store.draft(input(5,t+400,t+350));
 assert.throws(()=>store.publish(collision,15,t+410),/UNIQUE/);
 assert.equal(store.context(scope,[42],t+411).recentPublications.length,5,'failed transaction adds no publication');
 const current=store.getDraft(collision)!;current.patches[0].delta=999;
 assert.equal(store.getDraft(collision)!.patches[0].delta,0.5,'returned draft cannot mutate persisted payload');
 const bad=[
  {...input(6),patches:[{...input(6).patches[0],delta:NaN}]},
  {...input(6),patches:[{...input(6).patches[0],delta:0.51}]},
  {...input(6),patches:[input(6).patches[0],input(6).patches[0]]},
  {...input(6),patches:[{...input(6).patches[0],accountId:43}]},
  {...input(6),patches:[{...input(6).patches[0],evidenceIds:['absent']}]},
  {...input(6),evidence:[{...input(6).evidence[0],at:t+1}]},
  {...input(6),evidence:[input(6).evidence[0],input(6).evidence[0]]},
 ];
 for(const value of bad)assert.throws(()=>store.draft(value));
 for(let i=0;i<12;i++){const created=t+1000+i*100;const d=store.draft(input(100+i,created,created-10));store.publish(d,100+i,created+1);}
 assert.ok(store.context(scope,[42],t+3000).players[0].score<=3);
 assert.equal(store.context(scope,[42],t+3000).recentPublications.length,12);
 for(let i=0;i<70;i++)store.addChat({scope,messageId:100+i,at:t+i,authorId:42,authorName:'name',text:'x'.repeat(5000)});
 const chats=store.context(scope,[],t+3000).chat;assert.equal(chats.length,60);assert.ok(chats.every(c=>c.text.length<=4000));
 const raceScope=voiceMemoryScope(-123,'pilot:race');
 const raceBefore=store.context(raceScope,[42],t+5000);assert.equal(raceBefore.revision,0);
 const firstRace=store.draft({...input(501,t+5000),scope:raceScope,baselinePublicationId:raceBefore.revision});
 store.publish(firstRace,501,t+5000);
 const lateDraft=store.draft({...input(502,t+5000),scope:raceScope,baselinePublicationId:raceBefore.revision});
 assert.equal(store.publish(lateDraft,502,t+5001).skipped[0].reason,'stale_draft','same millisecond publication between context and draft must conflict');
 assert.equal(store.context(raceScope,[42],t+5000).revision,0,'revision respects exclusive cutoff');
 assert.ok(store.context(raceScope,[42],t+5001).revision>0);
 assert.throws(()=>store.draft({...input(503,t+6000),scope:raceScope,baselinePublicationId:999999}),/revision/);
 assert.throws(()=>store.draft({...input(503,t+6000),scope:raceScope,baselinePublicationId:-1}),/revision/);
 assert.throws(()=>store.draft({...input(503,t+6000),scope:raceScope,baselinePublicationId:first.publicationId}),/another scope/);
 const independent=store.draft({...input(1,t+4000),scope:pilot});assert.deepEqual(store.publish(independent,10,t+4001).appliedAccountIds,[42]);
 assert.equal(store.context(pilot,[42],t+4002).recentPublications.length,1);
 console.log('✓ voice memory: publication-only, persistence, isolation, retry, immutable drafts, temporal state, evidence, decay, concurrency, bounds');
} finally {store.close();rmSync(dir,{recursive:true,force:true});}
