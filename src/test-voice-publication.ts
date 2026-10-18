import assert from 'node:assert/strict';
import Database from 'better-sqlite3';
import {mkdtempSync,rmSync} from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {VoiceMemoryStore,voiceMemoryScope} from './voice-memory.js';
import {publishVoiceDraft} from './voice-publication.js';

const dir=mkdtempSync(path.join(os.tmpdir(),'voice-publication-')),filename=path.join(dir,'stats.sqlite');
let store=new VoiceMemoryStore(filename);
const scope=voiceMemoryScope(-123,'test:publication'),t=1700000000000;
let clock=t,calls=0;
const draft=(matchId:number,selectedScope=scope)=>store.draft({scope:selectedScope,matchId,matchAt:clock-1000,createdAt:clock,text:`draft ${matchId}`,patches:[{accountId:42,delta:0.5,summary:'Grounded impression',evidenceIds:['fact']}],evidence:[{id:'fact',accountId:42,kind:'match',at:clock-1000,text:'Verified contribution'}]});
const send=async()=>{calls++;return {message_id:calls};};
const deliver=(draftId:string,actualText:string,sender=send)=>publishVoiceDraft({store,draftId,actualText,send:sender,filename,now:()=>clock});
const readStatus=(draftId:string)=>{const db=new Database(filename);try{return (db.prepare('SELECT status FROM voice_delivery_attempts WHERE draft_id=?').get(draftId) as {status:string}|undefined)?.status;}finally{db.close();}};
try {
 const success=draft(1);clock+=10;
 const result=await deliver(success,'Exact published HTML');
 assert.deepEqual(result.appliedAccountIds,[42]);assert.equal(calls,1);assert.equal(readStatus(success),'complete');
 assert.equal(store.context(scope,[42],clock+1).recentPublications[0].text,'Exact published HTML');
 store.close();store=new VoiceMemoryStore(filename);
 const duplicate=await deliver(success,'Different retry text must not replace published text');
 assert.equal(duplicate.duplicate,true);assert.equal(calls,1,'completed receipt survives reopen, never sends twice');
 assert.equal(store.context(scope,[42],clock+1).recentPublications[0].text,'Exact published HTML');
 // Telegram succeeds, but memory transaction fails. The durable delivered receipt is replayed locally.
 clock+=2000;const interrupted=draft(2);clock+=10;
 const originalPublish=store.publish.bind(store);
 store.publish=()=>{throw Error('simulated memory commit failure');};
 await assert.rejects(deliver(interrupted,'Receipt text'),/memory commit failure/);
 assert.equal(calls,2);assert.equal(readStatus(interrupted),'delivered');
 assert.equal(store.context(scope,[42],clock+1).recentPublications.length,1);
 store.publish=originalPublish;
 store.close();store=new VoiceMemoryStore(filename);
 const recovered=await deliver(interrupted,'Retry should use saved receipt');
 assert.deepEqual(recovered.appliedAccountIds,[42]);assert.equal(calls,2);assert.equal(readStatus(interrupted),'complete');
 assert.equal(store.context(scope,[42],clock+1).recentPublications.at(-1)?.text,'Receipt text');
 // Failure after memory commit is also idempotent on receipt recovery.
 clock+=2000;const postCommit=draft(3);clock+=10;
 const publishBeforeCrash=store.publish.bind(store);
 store.publish=(...args)=>{publishBeforeCrash(...args);throw Error('crash after memory commit');};
 await assert.rejects(deliver(postCommit,'Committed before crash'),/crash after/);
 assert.equal(readStatus(postCommit),'delivered');const score=store.context(scope,[42],clock+1).players[0].score;
 store.publish=publishBeforeCrash;
 assert.equal((await deliver(postCommit,'Ignored')).duplicate,true);assert.equal(calls,3);
 assert.equal(store.context(scope,[42],clock+1).players[0].score,score);
 // Two connections contend while the first asynchronous sender remains in flight.
 clock+=2000;const pending=draft(4),sameMatch=draft(4);
 let release!:(message:{message_id:number})=>void;
 const waiting=new Promise<{message_id:number}>(resolve=>{release=resolve;});
 const first=deliver(pending,'First in flight',async()=>{calls++;return waiting;});
 assert.equal(readStatus(pending),'sending');
 const otherStore=new VoiceMemoryStore(filename);
 try {
  await assert.rejects(publishVoiceDraft({store:otherStore,draftId:pending,actualText:'duplicate',filename,now:()=>clock,send}),/unresolved/);
  await assert.rejects(publishVoiceDraft({store:otherStore,draftId:sameMatch,actualText:'another draft',filename,now:()=>clock,send}),/UNIQUE/);
  assert.equal(calls,4,'both simultaneous claims prevented before send');
 }finally{otherStore.close();}
 clock+=10;release({message_id:4});await first;
 assert.equal(readStatus(pending),'complete');
 // Network ambiguity blocks both retry of the same draft and a fresh draft for that match.
 clock+=2000;const ambiguous=draft(5);const beforeCount=store.context(scope,[42],clock+1).recentPublications.length;
 await assert.rejects(deliver(ambiguous,'Could be delivered',async()=>{calls++;throw Error('socket closed');}),/outcome unknown/);
 assert.equal(readStatus(ambiguous),'unknown');
 await assert.rejects(deliver(ambiguous,'retry'),/unresolved/);
 const bypass=draft(5);await assert.rejects(deliver(bypass,'new draft same match'),/UNIQUE/);
 assert.equal(calls,5);assert.equal(store.context(scope,[42],clock+1).recentPublications.length,beforeCount);
 // A definite rejection never commits memory and can be explicitly retried using a new draft.
 clock+=2000;const rejected=draft(6);
 await assert.rejects(deliver(rejected,'Bad HTML',async()=>{calls++;throw {error_code:400};}),/rejected/);
 assert.equal(readStatus(rejected),'failed');await assert.rejects(deliver(rejected,'same draft'),/unresolved/);
 const replacement=draft(6);clock+=10;assert.deepEqual((await deliver(replacement,'Fixed HTML')).appliedAccountIds,[42]);
 // Unknown delivery in one namespace does not block another namespace.
 clock+=2000;const otherScope=voiceMemoryScope(-123,'pilot:B'),isolated=draft(5,otherScope);clock+=10;
 assert.deepEqual((await deliver(isolated,'Other namespace')).appliedAccountIds,[42]);
 const db=new Database(filename);
 try {
  assert.equal((db.prepare('SELECT COUNT(*) AS n FROM voice_memory_publications').get() as {n:number}).n,6);
  assert.equal((db.prepare('SELECT COUNT(*) AS n FROM voice_memory_states').get() as {n:number}).n,6);
  assert.equal((db.prepare("SELECT COUNT(*) AS n FROM voice_delivery_attempts WHERE status='unknown'").get() as {n:number}).n,1);
 }finally{db.close();}
 console.log('✓ voice publication: durable receipt recovery, no resend, ambiguous delivery block, concurrent claims, rejection, namespaces and atomic real SQLite memory');
}finally{store.close();rmSync(dir,{recursive:true,force:true});}
