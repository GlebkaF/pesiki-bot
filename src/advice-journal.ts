import {appendFile,mkdir,stat} from 'node:fs/promises';
import path from 'node:path';

export interface AdviceJournalEvent {
 schemaVersion:1;
 at:number;
 decisionId:string;
 matchId:string|null;
 kind:'opportunity'|'prepared'|'generated'|'returned'|'rejected';
 data:unknown;
}
export interface AdviceJournalSink {record(event:AdviceJournalEvent):Promise<void>;}

/** Private evaluation data, not an exposure/reading/benefit metric.
 * Callers must supply only the admitted player-advice projection, never raw
 * observer responses, credentials or provider errors. Serialized writes retain
 * event order. A full/unwritable journal must not take down match commands. */
export class AdviceJournal implements AdviceJournalSink {
 private queue:Promise<void>=Promise.resolve();
 constructor(private directory:string,private maxDailyBytes=10_000_000){}
 record(event:AdviceJournalEvent):Promise<void>{
  const write=async()=>{
   const day=new Date(event.at).toISOString().slice(0,10);
   const file=path.join(this.directory,`${day}.jsonl`);
   const line=JSON.stringify(event)+'\n';
   await mkdir(this.directory,{recursive:true,mode:0o700});
   let size=0;
   try{size=(await stat(file)).size;}catch(error){if((error as NodeJS.ErrnoException).code!=='ENOENT')throw error;}
   if(size+Buffer.byteLength(line)>this.maxDailyBytes)throw Error('Journal capacity reached');
   await appendFile(file,line,{encoding:'utf8',mode:0o600});
  };
  this.queue=this.queue.then(write).catch(()=>{console.warn('[ADVICE] Decision journal write failed');});
  return this.queue;
 }
}
