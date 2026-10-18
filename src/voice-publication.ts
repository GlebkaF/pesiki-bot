/** Durable send receipt. Ambiguous Telegram outcomes are never automatically resent. */
import Database from 'better-sqlite3';
import {voiceMemoryPath,type VoiceMemoryStore} from './voice-memory.js';
export async function publishVoiceDraft(options:{store:VoiceMemoryStore;draftId:string;actualText:string;send:()=>Promise<{message_id:number}>;filename?:string;now?:()=>number}){
 const {store,draftId,actualText,send}=options,now=options.now??Date.now;
 const draft=store.getDraft(draftId);if(!draft)throw Error('Unknown voice draft');
 const db=new Database(options.filename??voiceMemoryPath());db.pragma('busy_timeout = 5000');
 db.exec(`CREATE TABLE IF NOT EXISTS voice_delivery_attempts(draft_id TEXT PRIMARY KEY,scope TEXT NOT NULL,match_id TEXT NOT NULL,status TEXT NOT NULL,started_at INTEGER NOT NULL,message_id INTEGER,delivered_at INTEGER,actual_text TEXT NOT NULL);
 CREATE UNIQUE INDEX IF NOT EXISTS voice_delivery_inflight_v2 ON voice_delivery_attempts(scope,match_id) WHERE status IN ('sending','unknown','delivered');`);
 try {
  const receipt=db.transaction(()=>{
   const row=db.prepare('SELECT * FROM voice_delivery_attempts WHERE draft_id=?').get(draftId) as {status:string;message_id:number;delivered_at:number;actual_text:string}|undefined;
   if(row){if(row.status==='delivered'||row.status==='complete')return row;throw Error('Previous delivery is unresolved or failed; no automatic resend');}
   db.prepare("INSERT INTO voice_delivery_attempts(draft_id,scope,match_id,status,started_at,actual_text) VALUES(?,?,?,'sending',?,?)").run(draftId,draft.scope,String(draft.matchId),now(),actualText);return null;
  }).immediate();
  if(receipt){const result=store.publish(draftId,receipt.message_id,receipt.delivered_at,receipt.actual_text);db.prepare("UPDATE voice_delivery_attempts SET status='complete' WHERE draft_id=?").run(draftId);return result;}
  let message:{message_id:number};
  try{message=await send();}catch(error){
   const code=(error as {error_code?:number})?.error_code;
   const definite=typeof code==='number'&&Number.isInteger(code)&&code>=400&&code<500;
   db.prepare('UPDATE voice_delivery_attempts SET status=? WHERE draft_id=?').run(definite?'failed':'unknown',draftId);
   throw Error(definite?'Telegram rejected the voice publication':'Telegram delivery outcome unknown; automatic resend blocked');
  }
  const at=now();
  db.prepare("UPDATE voice_delivery_attempts SET status='delivered',message_id=?,delivered_at=? WHERE draft_id=?").run(message.message_id,at,draftId);
  const result=store.publish(draftId,message.message_id,at,actualText);
  db.prepare("UPDATE voice_delivery_attempts SET status='complete' WHERE draft_id=?").run(draftId);
  return result;
 }finally{db.close();}
}
