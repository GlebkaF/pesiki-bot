import type {LiveMatch,LivePlayer} from './live-match.js';
import type {AdviceItem,AdviceKnowledge,AdviceAbility,ItemPopularity} from './advice-sources.js';
export interface AdviceCandidate extends AdviceItem {purchases:number|null;ownedComponents:string[];remainingCost:number;}
export interface AdvicePlayerContext {account:number;hero:string;heroId:number;gold:number|null;netWorth:number|null;level:number|null;role:null;inventory:string[];candidates:AdviceCandidate[];sourceAt:number|null;}
export interface AdviceContext {matchId:string;gameMode:number|null;gameTime:number;delay:number|null;snapshotAt:number;knowledgeRevision:string;players:AdvicePlayerContext[];teams:Array<{name:string;netWorth:number|null;players:Array<{hero:string;ours:boolean;level:number|null;netWorth:number|null;inventory:string[];possibleAbilities:AdviceAbility[]}>}>;}
const GENERAL_ITEMS=new Set(['black_king_bar','force_staff','glimmer_cape','ghost','lotus_orb','sphere','cyclone','aeon_disk','pipe','crimson_guard','heavens_halberd','sheepstick','orchid','bloodthorn','nullifier','shivas_guard','assault','skadi','monkey_king_bar']);
export function canAdvise(match:LiveMatch|null,now=Date.now()):match is LiveMatch {
 return !!match&&match.kind==='stack'&&match.stackCount>0&&match.detailed&&now-match.updatedAt>=0&&now-match.updatedAt<90_000&&typeof match.time==='number'&&match.time>=0&&match.teams.length===2&&match.teams.every(t=>t.players.length===5)&&match.teams.flatMap(t=>t.players).some(p=>p.ours&&p.heroId);
}
export function buildCandidates(player:LivePlayer,knowledge:AdviceKnowledge,popularity?:ItemPopularity):AdviceCandidate[]{
 const byKey=new Map(knowledge.items.map(i=>[i.key,i]));
 const byId=new Map(knowledge.items.map(i=>[i.id,i]));
 const inventory=player.items.map(id=>byId.get(id)).filter((i):i is AdviceItem=>!!i);
 const blocked=new Set(inventory.map(i=>i.key));
 // Do not recommend a component of an upgrade already in the visible inventory.
 const blockChildren=(key:string,seen=new Set<string>())=>{if(seen.has(key))return;seen.add(key);for(const child of byKey.get(key)?.components??[]){blocked.add(child);blockChildren(child,seen);}};
 inventory.forEach(i=>blockChildren(i.key));
 // Consumed permanent upgrades are not reliably visible in the terse inventory.
 const consumed=new Set(['aghanims_shard','ultimate_scepter_2','moon_shard']);
 return knowledge.items.filter(i=>i.cost>=1000&&!consumed.has(i.key)&&!blocked.has(i.key)&&((popularity?.counts[String(i.id)]??0)>0||GENERAL_ITEMS.has(i.key)))
  .map(item=>{
   // Each owned instance can pay for only one component, including nested components.
   const remaining=new Map<string,number>();inventory.forEach(i=>remaining.set(i.key,(remaining.get(i.key)??0)+1));
   const ownedComponents:string[]=[];
   const credit=(key:string,seen=new Set<string>()):number=>{if(seen.has(key))return 0;const next=new Set(seen).add(key);const value=byKey.get(key);if(!value)return 0;if((remaining.get(key)??0)>0){remaining.set(key,remaining.get(key)!-1);ownedComponents.push(value.name);return value.cost;}return value.components.reduce((sum,c)=>sum+credit(c,next),0);};
   const saved=item.components.reduce((sum,key)=>sum+credit(key),0);
   return {...item,purchases:popularity?.counts[String(item.id)]??null,ownedComponents,remainingCost:Math.max(0,item.cost-saved)};
  }).sort((a,b)=>Number(b.ownedComponents.length>0)-Number(a.ownedComponents.length>0)||(b.purchases??0)-(a.purchases??0)||a.id-b.id).slice(0,32);
}
export function buildAdviceContext(match:LiveMatch,knowledge:AdviceKnowledge,popularities:Map<number,ItemPopularity>,now=Date.now()):AdviceContext {
 if(!canAdvise(match,now))throw Error('No fresh complete stack match');
 const byId=new Map(knowledge.items.map(i=>[i.id,i]));
 const inventory=(p:LivePlayer)=>p.items.filter(id=>id>0).map(id=>byId.get(id)?.name??`Unknown item #${id}`);
 return {matchId:match.matchId,gameMode:match.gameMode??null,gameTime:match.time!,delay:match.delay??null,snapshotAt:match.updatedAt,knowledgeRevision:knowledge.revision,
  players:match.teams.flatMap(t=>t.players).filter(p=>p.ours&&p.heroId).map(p=>({account:p.account,hero:p.hero,heroId:p.heroId!,gold:p.gold??null,netWorth:p.netWorth??null,level:p.level??null,role:null,inventory:inventory(p),candidates:buildCandidates(p,knowledge,popularities.get(p.heroId!)),sourceAt:popularities.get(p.heroId!)?.fetchedAt??null})),
  teams:match.teams.map(t=>({name:t.name,netWorth:t.netWorth??null,players:t.players.map(p=>({hero:p.hero,ours:p.ours,level:p.level??null,netWorth:p.netWorth??null,inventory:inventory(p),possibleAbilities:knowledge.heroAbilities?.[p.heroId??0]??[]}))}))};
}
