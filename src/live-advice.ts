import {createHash,randomUUID} from 'node:crypto';
import {mkdir,readFile,writeFile,rename} from 'node:fs/promises';
import path from 'node:path';
import {adviceSources,type AdviceSources,type ItemPopularity} from './advice-sources.js';
import {buildAdviceContext,canAdvise,adviceObservationKey,type AdviceContext,type AdviceCandidate} from './advice-context.js';
import {generateAdvice,ADVICE_ENGINE_REVISION,type ModelAdvice} from './advice-model.js';
import {AdviceJournal,type AdviceJournalSink,type AdviceJournalEvent} from './advice-journal.js';
import type {LiveMatch} from './live-match.js';
export interface AdviceCard {account:number;name:string;hero:string;item:AdviceCandidate;reason:string;alternative:AdviceCandidate|null;alternativeReason:string;}
export interface LiveAdvice {matchId:string;snapshotAt:number;generatedAt:number;gameTime:number;delay:number|null;gameMode:number|null;cards:AdviceCard[];plan:string;knowledgeRevision:string;statisticsAt:number|null;}
export type AdviceState={status:'ready';advice:LiveAdvice}|{status:'unavailable'|'loading'|'limited';message:string};
export function adviceFingerprint(match:LiveMatch):string{
 return createHash('sha256').update(adviceObservationKey(match)).digest('hex');
}
/** One generation per match, shared by the website and Telegram. */
export class LiveAdviceService {
 private pending:Promise<AdviceState>|undefined;
 private latestMatch:LiveMatch|null=null;
 private cached:LiveAdvice|undefined;
 private lastFingerprint='';
 private lastRoster='';
 private nextAttempt=0;
 private counts=new Map<string,number>();
 private day='';private dailyCount=0;
 private lastState:{matchId:string;state:AdviceState}|undefined;
 private budgetLoaded=false;
 private opportunityKey='';
 private journal:AdviceJournalSink|null;
 constructor(private sources:Pick<AdviceSources,'knowledge'|'popularity'>=adviceSources,private model:(context:AdviceContext)=>Promise<ModelAdvice>=generateAdvice,private now=Date.now,private budgetFile:string|null=path.join(process.env.DATA_DIR||'data','advice-budget.json'),journal?:AdviceJournalSink|null){
  this.journal=journal===undefined?(budgetFile?new AdviceJournal(path.join(path.dirname(budgetFile),'advice-decisions')):null):journal;
 }
 private async record(decisionId:string,matchId:string|null,kind:AdviceJournalEvent['kind'],data:unknown):Promise<void>{
  try{await this.journal?.record({schemaVersion:1,at:this.now(),decisionId,matchId,kind,data});}
  catch{console.warn('[ADVICE] Decision journal unavailable');}
 }
 private async reserveBudget(matchId:string):Promise<boolean>{
  if(!this.budgetLoaded&&this.budgetFile){
   try{
    const saved=JSON.parse(await readFile(this.budgetFile,'utf8'));
    if(typeof saved.day!=='string'||!Number.isSafeInteger(saved.dailyCount)||saved.dailyCount<0||!Array.isArray(saved.counts)||saved.counts.length>100||!saved.counts.every((p:unknown)=>Array.isArray(p)&&typeof p[0]==='string'&&Number.isSafeInteger(p[1])&&p[1]>=0))throw Error('Invalid advice budget');
    this.day=saved.day;this.dailyCount=saved.dailyCount;this.counts=new Map(saved.counts);
   }catch(error){if((error as NodeJS.ErrnoException).code!=='ENOENT')throw error;}
  }
  this.budgetLoaded=true;
  const day=new Date(this.now()).toISOString().slice(0,10);if(day!==this.day){this.day=day;this.dailyCount=0;}
  if((this.counts.get(matchId)??0)>=20||this.dailyCount>=100)return false;
  this.dailyCount++;this.counts.set(matchId,(this.counts.get(matchId)??0)+1);
  if(this.counts.size>100)this.counts.delete(this.counts.keys().next().value!);
  if(this.budgetFile){
   await mkdir(path.dirname(this.budgetFile),{recursive:true});
   await writeFile(this.budgetFile+'.tmp',JSON.stringify({day:this.day,dailyCount:this.dailyCount,counts:[...this.counts]}));await rename(this.budgetFile+'.tmp',this.budgetFile);
  }
  return true;
 }
 peek(match:LiveMatch|null):AdviceState{
  // Calls from web/Telegram also update the state an in-flight answer must satisfy.
  if(!match||!this.latestMatch||match.updatedAt>=this.latestMatch.updatedAt)this.latestMatch=match;
  if(!canAdvise(match,this.now()))return {status:'unavailable',message:'Совет появится, когда будет доступен подробный матч наших.'};
  const roster=match.teams.flatMap(t=>t.players);
  const rosterKey=JSON.stringify(roster.map(p=>[p.account,p.heroId,p.ours]));
  const bought=this.cached?.cards.some(c=>roster.find(p=>p.account===c.account)?.items.some(id=>id===c.item.id||id===c.alternative?.id));
  if(this.cached?.matchId===match.matchId&&this.now()-this.cached.snapshotAt<180_000&&this.lastRoster===rosterKey&&!bought)return {status:'ready',advice:this.cached};
  if(!this.pending&&this.lastState?.matchId===match.matchId&&this.lastState.state.status!=='ready')return this.lastState.state;
  return {status:this.pending?'loading':'unavailable',message:this.pending?'Разбираем составы и предметы…':'Готовим следующий шаг для наших.'};
 }
 async get(match:LiveMatch|null):Promise<AdviceState>{
  const decisionId=randomUUID();
  const opportunityKey=match?adviceFingerprint(match):'none';
  if(opportunityKey!==this.opportunityKey){
   this.opportunityKey=opportunityKey;
   await this.record(decisionId,match?.matchId??null,'opportunity',{sampling:'requested-state-change',eligible:canAdvise(match,this.now()),observation:canAdvise(match,this.now())?JSON.parse(adviceObservationKey(match)):null});
  }
  if(!canAdvise(match,this.now()))return this.peek(match);
  const fingerprint=adviceFingerprint(match),existing=this.peek(match);
  if(existing.status==='ready'&&(this.lastFingerprint===fingerprint||this.now()<this.nextAttempt))return existing;
  // A pending result for an earlier match must never leak into a new match.
  if(this.pending){await this.pending;return this.peek(match);}
  if(this.now()<this.nextAttempt)return {status:'loading',message:'Ждём следующий снимок для обновления совета.'};
  const day=new Date(this.now()).toISOString().slice(0,10);if(day!==this.day){this.day=day;this.dailyCount=0;}
  if((this.counts.get(match.matchId)??0)>=20||this.dailyCount>=100){const state:AdviceState={status:'limited',message:'Лимит разборов на сегодня или этот матч достигнут.'};this.lastState={matchId:match.matchId,state};return state;}
  this.nextAttempt=this.now()+120_000;
  const run=(async():Promise<AdviceState>=>{
   let stage='sources';
   try{
    const knowledge=await this.sources.knowledge();
    const heroIds=[...new Set(match.teams.flatMap(t=>t.players).filter(p=>p.ours&&p.heroId).map(p=>p.heroId!))];
    const popularities=new Map<number,ItemPopularity>();
    // At most five heroes; serial reads respect the shared OpenDota circuit breaker.
    for(const id of heroIds){try{popularities.set(id,await this.sources.popularity(id));}catch{/* Verified item descriptions still permit a conditional suggestion. */}}
    const context=buildAdviceContext(match,knowledge,popularities,this.now());
    stage='budget';
    await this.record(decisionId,match.matchId,'prepared',{context,engine:ADVICE_ENGINE_REVISION,model:process.env.ADVICE_MODEL||process.env.OPENAI_MODEL_V2||process.env.OPENAI_MODEL||'gpt-5.6-sol'});
    if(!await this.reserveBudget(match.matchId))return {status:'limited',message:'Лимит разборов на сегодня или этот матч достигнут.'};
    stage='model';
    const output=await this.model(context);
    await this.record(decisionId,match.matchId,'generated',{output});
    if(!output.players.length)return {status:'unavailable',message:'Пока нет обоснованного следующего шага по доступным данным.'};
    stage='revalidation';
    if(!canAdvise(this.latestMatch,this.now())||this.latestMatch.matchId!==match.matchId||adviceFingerprint(this.latestMatch)!==fingerprint)return {status:'unavailable',message:'Ситуация изменилась во время разбора. Ждём совет по новому снимку.'};
    if(!canAdvise(match,this.now()))return {status:'unavailable',message:'Снимок устарел во время разбора. Ждём обновления матча.'};
    const roster=match.teams.flatMap(t=>t.players);
    const cards=output.players.map(p=>{const player=context.players.find(c=>c.account===p.account)!,identity=roster.find(c=>c.account===p.account)!;return {account:p.account,name:identity.name,hero:identity.hero,item:player.candidates.find(c=>c.id===p.itemId)!,reason:p.reason,alternative:player.candidates.find(c=>c.id===p.alternativeId)??null,alternativeReason:p.alternativeReason};});
    const dates=[...popularities.values()].map(p=>p.fetchedAt);
    this.cached={matchId:match.matchId,snapshotAt:match.updatedAt,generatedAt:this.now(),gameTime:match.time!,delay:match.delay??null,gameMode:match.gameMode??null,cards,plan:output.plan,knowledgeRevision:knowledge.revision,statisticsAt:dates.length?Math.min(...dates):null};
    this.lastFingerprint=fingerprint;
    this.lastRoster=JSON.stringify(roster.map(p=>[p.account,p.heroId,p.ours]));
    return {status:'ready',advice:this.cached};
   }catch{await this.record(decisionId,match.matchId,'rejected',{stage});console.warn('[ADVICE] Generation unavailable');return {status:'unavailable',message:'Не удалось подготовить обоснованный совет. Попробуем на следующем снимке.'};}
  })();
  this.pending=run;
  try{const state=await run;await this.record(decisionId,match.matchId,'returned',{state});this.lastState={matchId:match.matchId,state};return state;}finally{this.pending=undefined;}
 }
}
export const liveAdvice=new LiveAdviceService();
