import Database from 'better-sqlite3';
import {mkdirSync} from 'node:fs';
import path from 'node:path';
import {randomUUID} from 'node:crypto';

/** All timestamps in this module are Unix milliseconds. Scope includes namespace and chat. */
export interface Evidence {id:string;accountId?:number;kind:'match'|'chat';at:number;text:string}
export interface MemoryPatch {accountId:number;delta:number;summary:string;evidenceIds:string[]}
export interface ChatMemoryInput {scope:string;messageId:string|number;at:number;authorId:string|number;authorName:string;text:string;replyTo?:string|number}
export interface VoiceDraftInput {experiment?:{id:string;variant:"legacy"|"new";model:string};baselinePublicationId?:number;scope:string;matchId:string|number;matchAt:number;createdAt:number;text:string;patches:MemoryPatch[];evidence:Evidence[]}
export interface VoiceDraft extends VoiceDraftInput {id:string;baselinePublicationId:number}
export interface MemoryPlayer {accountId:number;score:number;summary:string;updatedAt:number|null;lastMatchAt:number|null;evidence:Evidence[]}
export interface MemoryPublication {id:number;draftId:string;messageId:string;matchId:string;at:number;text:string}
export interface PublishResult {publicationId:number;appliedAccountIds:number[];skipped:{accountId:number;reason:string}[];duplicate:boolean}
export interface VoiceMemoryContext {revision:number;players:MemoryPlayer[];recentPublications:MemoryPublication[];chat:(ChatMemoryInput & {evidenceId:string})[]}
export const VOICE_MEMORY_HALF_LIFE_MS=14*24*60*60*1000;
export function voiceMemoryScope(chatId:string|number,namespace='live'):string {return JSON.stringify([namespace,String(chatId)]);}
export function voiceMemoryPath():string {return process.env.APM_DB_PATH || path.join(process.env.DATA_DIR || 'data','stats.sqlite');}
const finiteTime=(n:number)=>{if(!Number.isSafeInteger(n)||n<0)throw Error('Invalid timestamp');};
const string=(v:unknown,max:number,name:string):string=>{if(typeof v!=='string'||!v.trim()||v.length>max)throw Error(`Invalid ${name}`);return v;};
const account=(v:number)=>{if(!Number.isSafeInteger(v)||v<=0||v>4294967295)throw Error('Invalid accountId');};
const key=(v:string|number)=>string(String(v),200,'identifier');
const decay=(score:number,from:number,to:number)=>score*Math.pow(0.5,Math.max(0,to-from)/VOICE_MEMORY_HALF_LIFE_MS);
type State={score:number;summary:string;at:number;match_at:number;evidence:string};

export class VoiceMemoryStore {
 private db:Database.Database;
 constructor(filename=voiceMemoryPath()) {
  if(filename!==':memory:')mkdirSync(path.dirname(filename),{recursive:true});
  this.db=new Database(filename);this.db.pragma('journal_mode = WAL');this.db.pragma('busy_timeout = 5000');
  this.db.exec(`
   CREATE TABLE IF NOT EXISTS voice_memory_chat(scope TEXT NOT NULL,message_id TEXT NOT NULL,at INTEGER NOT NULL,payload TEXT NOT NULL,PRIMARY KEY(scope,message_id));
   CREATE INDEX IF NOT EXISTS voice_memory_chat_time ON voice_memory_chat(scope,at);
   CREATE TABLE IF NOT EXISTS voice_memory_drafts(id TEXT PRIMARY KEY,scope TEXT NOT NULL,payload TEXT NOT NULL);
   CREATE TABLE IF NOT EXISTS voice_memory_publications(id INTEGER PRIMARY KEY AUTOINCREMENT,scope TEXT NOT NULL,draft_id TEXT NOT NULL UNIQUE,message_id TEXT NOT NULL,match_id TEXT NOT NULL,at INTEGER NOT NULL,text TEXT NOT NULL,result TEXT NOT NULL,UNIQUE(scope,message_id));
   CREATE INDEX IF NOT EXISTS voice_memory_pub_time ON voice_memory_publications(scope,at);
   CREATE TABLE IF NOT EXISTS voice_memory_states(publication_id INTEGER NOT NULL,scope TEXT NOT NULL,account_id INTEGER NOT NULL,match_id TEXT NOT NULL,match_at INTEGER NOT NULL,at INTEGER NOT NULL,score REAL NOT NULL,summary TEXT NOT NULL,evidence TEXT NOT NULL,PRIMARY KEY(publication_id,account_id),UNIQUE(scope,match_id,account_id));
   CREATE INDEX IF NOT EXISTS voice_memory_state_time ON voice_memory_states(scope,account_id,at);
  `);
 }
 addChat(input:ChatMemoryInput):void {
  string(input.scope,500,'scope');finiteTime(input.at);key(input.messageId);key(input.authorId);
  const value={...input,messageId:key(input.messageId),authorId:key(input.authorId),authorName:String(input.authorName).slice(0,200),text:String(input.text).slice(0,4000),...(input.replyTo===undefined?{}:{replyTo:key(input.replyTo)})};
  // Duplicate updates are immutable: editing a message must not rewrite historical context.
  this.db.prepare('INSERT OR IGNORE INTO voice_memory_chat(scope,message_id,at,payload) VALUES(?,?,?,?)').run(input.scope,value.messageId,input.at,JSON.stringify(value));
 }
 context(scope:string,accountIds:number[],before:number):VoiceMemoryContext {
  string(scope,500,'scope');finiteTime(before);accountIds.forEach(account);
  return this.db.transaction(()=>{
  const players=[...new Set(accountIds)].map(accountId=>{
   const s=this.db.prepare('SELECT * FROM voice_memory_states WHERE scope=? AND account_id=? AND at<? ORDER BY at DESC,publication_id DESC LIMIT 1').get(scope,accountId,before) as State|undefined;
   return {accountId,score:s?decay(s.score,s.at,before):0,summary:s?.summary??'',updatedAt:s?.at??null,lastMatchAt:s?.match_at??null,evidence:s?JSON.parse(s.evidence) as Evidence[]:[]};
  });
  const recentPublications=(this.db.prepare('SELECT id,draft_id AS draftId,message_id AS messageId,match_id AS matchId,at,text FROM voice_memory_publications WHERE scope=? AND at<? ORDER BY at DESC,id DESC LIMIT 12').all(scope,before) as MemoryPublication[]).reverse();
  const chat=(this.db.prepare('SELECT payload FROM voice_memory_chat WHERE scope=? AND at<? ORDER BY at DESC,message_id DESC LIMIT 60').all(scope,before) as {payload:string}[]).reverse().map(r=>{const c=JSON.parse(r.payload) as ChatMemoryInput;return {...c,evidenceId:`chat:${JSON.stringify([scope,String(c.messageId)])}`};});
  const revision=(this.db.prepare('SELECT COALESCE(MAX(id),0) AS n FROM voice_memory_publications WHERE scope=? AND at<?').get(scope,before) as {n:number}).n;
  return {revision,players,recentPublications,chat};
  }).deferred();
 }
 draft(input:VoiceDraftInput):string {
  string(input.scope,500,'scope');key(input.matchId);finiteTime(input.matchAt);finiteTime(input.createdAt);
  if(input.matchAt>input.createdAt)throw Error('Match is after draft');string(input.text,40000,'text');
  if(!Array.isArray(input.evidence)||input.evidence.length>300||!Array.isArray(input.patches)||input.patches.length>10)throw Error('Invalid memory payload');
  const evidence=new Map<string,Evidence>();
  for(const e of input.evidence){string(e.id,1000,'evidence id');if(evidence.has(e.id))throw Error('Duplicate evidence');finiteTime(e.at);if(e.at>input.createdAt)throw Error('Future evidence');if(e.kind!=='match'&&e.kind!=='chat')throw Error('Invalid evidence kind');if(e.accountId!==undefined)account(e.accountId);string(e.text,4000,'evidence text');evidence.set(e.id,e);}
  const seen=new Set<number>();
  for(const p of input.patches){account(p.accountId);if(seen.has(p.accountId))throw Error('Duplicate account patch');seen.add(p.accountId);if(!Number.isFinite(p.delta)||Math.abs(p.delta)>0.5)throw Error('Invalid delta');string(p.summary,600,'summary');if(!Array.isArray(p.evidenceIds)||!p.evidenceIds.length||p.evidenceIds.length>20||new Set(p.evidenceIds).size!==p.evidenceIds.length)throw Error('Invalid evidence references');const refs=p.evidenceIds.map(id=>{const e=evidence.get(id);if(!e)throw Error('Missing evidence');return e;});if(!refs.some(e=>e.accountId===p.accountId)||refs.some(e=>e.accountId!==undefined&&e.accountId!==p.accountId))throw Error('Evidence account mismatch');}
  return this.db.transaction(()=>{
   const baseline=this.db.prepare('SELECT COALESCE(MAX(id),0) AS n FROM voice_memory_publications WHERE scope=?').get(input.scope) as {n:number};
   const revision=input.baselinePublicationId??baseline.n;
   if(!Number.isSafeInteger(revision)||revision<0||revision>baseline.n)throw Error('Invalid baseline publication revision');
   if(revision!==0&&!this.db.prepare('SELECT 1 FROM voice_memory_publications WHERE scope=? AND id=?').get(input.scope,revision))throw Error('Baseline revision belongs to another scope');
   const id=randomUUID();const value:VoiceDraft={...input,matchId:key(input.matchId),id,baselinePublicationId:revision};
   this.db.prepare('INSERT INTO voice_memory_drafts(id,scope,payload) VALUES(?,?,?)').run(id,input.scope,JSON.stringify(value));return id;
  }).immediate();
 }
 getDraft(id:string):VoiceDraft|null {const row=this.db.prepare('SELECT payload FROM voice_memory_drafts WHERE id=?').get(id) as {payload:string}|undefined;return row?JSON.parse(row.payload) as VoiceDraft:null;}
 /** Call only after successful delivery; transport ambiguity must be resolved by the caller. */
 publish(draftId:string,messageId:string|number,at:number,actualText?:string):PublishResult {
  finiteTime(at);key(messageId);
  return this.db.transaction(()=>{
   const d=this.getDraft(draftId);if(!d)throw Error('Unknown draft');
   const old=this.db.prepare('SELECT message_id,result FROM voice_memory_publications WHERE draft_id=?').get(draftId) as {message_id:string;result:string}|undefined;
   if(old){if(old.message_id!==key(messageId))throw Error('Draft already published with different message');return {...JSON.parse(old.result),duplicate:true} as PublishResult;}
   if(at<d.createdAt)throw Error('Publication predates draft');
   const text=actualText===undefined?d.text:string(actualText,40000,'published text');
   const latest=this.db.prepare('SELECT COALESCE(MAX(id),0) AS id,COALESCE(MAX(at),0) AS at FROM voice_memory_publications WHERE scope=?').get(d.scope) as {id:number;at:number};
   const stale=latest.id>d.baselinePublicationId||latest.at>d.createdAt||latest.at>at;
   const result:PublishResult={publicationId:0,appliedAccountIds:[],skipped:[],duplicate:false};
   const inserted=this.db.prepare('INSERT INTO voice_memory_publications(scope,draft_id,message_id,match_id,at,text,result) VALUES(?,?,?,?,?,?,?)').run(d.scope,d.id,key(messageId),key(d.matchId),at,text,'{}');result.publicationId=Number(inserted.lastInsertRowid);
   for(const p of d.patches){
    const prior=this.db.prepare('SELECT * FROM voice_memory_states WHERE scope=? AND account_id=? ORDER BY at DESC,publication_id DESC LIMIT 1').get(d.scope,p.accountId) as State|undefined;
    const used=this.db.prepare('SELECT 1 FROM voice_memory_states WHERE scope=? AND match_id=? AND account_id=?').get(d.scope,key(d.matchId),p.accountId);
    const reason=d.matchAt===0?'unknown_match_time':used?'match_already_applied':stale?'stale_draft':prior&&d.matchAt<=prior.match_at?'historical_match':undefined;
    if(reason){result.skipped.push({accountId:p.accountId,reason});continue;}
    const score=Math.max(-3,Math.min(3,(prior?decay(prior.score,prior.at,at):0)+p.delta));
    const evidence=d.evidence.filter(e=>p.evidenceIds.includes(e.id));
    this.db.prepare('INSERT INTO voice_memory_states(publication_id,scope,account_id,match_id,match_at,at,score,summary,evidence) VALUES(?,?,?,?,?,?,?,?,?)').run(result.publicationId,d.scope,p.accountId,key(d.matchId),d.matchAt,at,score,p.summary,JSON.stringify(evidence));result.appliedAccountIds.push(p.accountId);
   }
   this.db.prepare('UPDATE voice_memory_publications SET result=? WHERE id=?').run(JSON.stringify(result),result.publicationId);return result;
  }).immediate();
 }
 close():void {this.db.close();}
}
