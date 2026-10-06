import {RECIPE_ITEM_KEYS} from './advice-recipes.js';
import type {LiveMatch,LivePlayer} from './live-match.js';
import type {AdviceItem,AdviceKnowledge,AdviceAbility,ItemPopularity} from './advice-sources.js';
export interface AdvicePurchaseStep {id:number;key:string;name:string;cost:number;quantity:number;attributes:string;}
export interface AdviceCandidate extends AdviceItem {purchaseSteps:AdvicePurchaseStep[];componentTreeComplete:boolean;purchases:number|null;ownedComponents:string[];remainingCost:number;}
export interface AdvicePlayerContext {account:number;hero:string;heroId:number;team:string;allies:Array<{heroId:number;hero:string}>;enemies:Array<{heroId:number;hero:string}>;gold:number|null;netWorth:number|null;level:number|null;role:null;inventory:string[];candidates:AdviceCandidate[];sourceAt:number|null;}
export interface AdviceContext {matchId:string;gameMode:number|null;gameTime:number;nominalSpectatorDelay:number|null;sourceLagSeconds:null;snapshotAt:number;inputPolicy:'draft-and-stack-inventory-v1';unknowns:string[];knowledgeRevision:string;players:AdvicePlayerContext[];teams:Array<{name:string;players:Array<{heroId:number;hero:string;ours:boolean;possibleAbilities:AdviceAbility[]}>}>;}
const GENERAL_ITEMS=new Set(['black_king_bar','force_staff','glimmer_cape','ghost','lotus_orb','sphere','cyclone','aeon_disk','pipe','crimson_guard','heavens_halberd','sheepstick','orchid','bloodthorn','nullifier','shivas_guard','assault','skadi','monkey_king_bar']);
export function canAdvise(match:LiveMatch|null,now=Date.now()):match is LiveMatch {
 return !!match&&match.kind==='stack'&&match.stackCount>0&&match.detailed&&now-match.updatedAt>=0&&now-match.updatedAt<90_000&&typeof match.time==='number'&&match.time>=0&&match.teams.length===2&&match.teams.every(t=>t.players.length===5)&&match.teams.filter(t=>t.players.some(p=>p.ours)).length===1&&new Set(match.teams.flatMap(t=>t.players.map(p=>p.account))).size===10&&match.teams.flatMap(t=>t.players).some(p=>p.ours&&p.heroId);
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
 return knowledge.items.filter(i=>i.cost>=1000&&!i.key.startsWith('recipe_')&&!consumed.has(i.key)&&!blocked.has(i.key)&&((popularity?.counts[String(i.id)]??0)>0||GENERAL_ITEMS.has(i.key)||RECIPE_ITEM_KEYS.has(i.key)))
  .map(item=>{
   // Each owned instance can pay for only one component, including nested components.
   const remaining=new Map<string,number>();inventory.forEach(i=>remaining.set(i.key,(remaining.get(i.key)??0)+1));
   const ownedComponents:string[]=[];
   const credit=(key:string,seen=new Set<string>()):number=>{if(seen.has(key))return 0;const next=new Set(seen).add(key);const value=byKey.get(key);if(!value)return 0;if((remaining.get(key)??0)>0){remaining.set(key,remaining.get(key)!-1);ownedComponents.push(value.name);return value.cost;}return value.components.reduce((sum,c)=>sum+credit(c,next),0)+(key.startsWith('recipe_')?0:credit('recipe_'+key,next));};
   const saved=credit(item.key);
   const steps=missingPurchaseSteps(item,inventory,byKey);
   return {...item,...steps,purchases:popularity?.counts[String(item.id)]??null,ownedComponents,remainingCost:Math.max(0,item.cost-saved)};
  }).sort((a,b)=>Number(b.ownedComponents.length>0)-Number(a.ownedComponents.length>0)||(b.purchases??0)-(a.purchases??0)||a.id-b.id);
}
/** Expand the recipe tree as a multiset. Never promise a next component when
 * source children/recipe costs are missing, cyclic or inconsistent. */
export function missingPurchaseSteps(item:AdviceItem,inventory:AdviceItem[],byKey:Map<string,AdviceItem>):{purchaseSteps:AdvicePurchaseStep[];componentTreeComplete:boolean}{
 const owned=new Map<string,number>();
 for(const entry of inventory)owned.set(entry.key,(owned.get(entry.key)??0)+1);
 const missing=new Map<number,AdvicePurchaseStep>();
 let complete=true;
 const visit=(value:AdviceItem,parents=new Set<string>())=>{
  if(parents.has(value.key)){complete=false;return;}
  if((owned.get(value.key)??0)>0){owned.set(value.key,owned.get(value.key)!-1);return;}
  if(!value.components.length){
   const previous=missing.get(value.id);
   missing.set(value.id,{id:value.id,key:value.key,name:value.name,cost:value.cost,attributes:value.attributes,quantity:(previous?.quantity??0)+1});
   return;
  }
  const children=value.components.map(key=>byKey.get(key));
  const recipe=byKey.get('recipe_'+value.key);
  if(recipe&&!value.components.includes(recipe.key))children.push(recipe);
  if(children.some(c=>!c)||children.reduce((sum,c)=>sum+(c?.cost??0),0)!==value.cost){complete=false;return;}
  const next=new Set(parents).add(value.key);
  children.forEach(child=>visit(child!,next));
 };
 visit(item);
 return {purchaseSteps:complete?[...missing.values()].filter(step=>step.id!==item.id):[],componentTreeComplete:complete};
}
export function buildAdviceContext(match:LiveMatch,knowledge:AdviceKnowledge,popularities:Map<number,ItemPopularity>,now=Date.now()):AdviceContext {
 if(!canAdvise(match,now))throw Error('No fresh complete stack match');
 const byId=new Map(knowledge.items.map(i=>[i.id,i]));
 const inventory=(p:LivePlayer)=>p.items.filter(id=>id>0).map(id=>byId.get(id)?.name??`Unknown item #${id}`);
 return {matchId:match.matchId,gameMode:match.gameMode??null,gameTime:match.time!,nominalSpectatorDelay:match.delay??null,sourceLagSeconds:null,snapshotAt:match.updatedAt,inputPolicy:'draft-and-stack-inventory-v1',unknowns:['actual source lag','patch','roles and intentions','enemy inventory and economy','ability levels and cooldowns','facets and upgrades','stash and courier','personal history'],knowledgeRevision:knowledge.revision,
  players:match.teams.flatMap(t=>t.players).filter(p=>p.ours&&p.heroId).map(p=>{const team=match.teams.find(t=>t.players.some(v=>v.account===p.account))!;const identity=(v:LivePlayer)=>({heroId:v.heroId??0,hero:v.hero});return {account:p.account,hero:p.hero,heroId:p.heroId!,team:team.name,allies:team.players.filter(v=>v.account!==p.account).map(identity),enemies:match.teams.filter(t=>t!==team).flatMap(t=>t.players).map(identity),gold:p.gold??null,netWorth:p.netWorth??null,level:p.level??null,role:null,inventory:inventory(p),candidates:buildCandidates(p,knowledge,popularities.get(p.heroId!)),sourceAt:popularities.get(p.heroId!)?.fetchedAt??null};}),
  teams:match.teams.map(t=>({name:t.name,players:t.players.map(p=>({heroId:p.heroId??0,hero:p.hero,ours:p.ours,possibleAbilities:knowledge.heroAbilities?.[p.heroId??0]??[]}))}))};
}

/** Only admitted facts can invalidate advice; spectator-only changes must not
 * influence generation through cache keys or derived features either. */
export function adviceObservationKey(match:LiveMatch):string {
 return JSON.stringify([match.matchId,match.gameMode,Math.floor((match.time??0)/120),
  match.teams.map(t=>({name:t.name,players:t.players.map(p=>({account:p.account,heroId:p.heroId,ours:p.ours,
   ...(p.ours?{level:p.level,items:[...p.items].sort((a,b)=>a-b),gold:p.gold==null?null:Math.floor(p.gold/500),netWorth:p.netWorth==null?null:Math.floor(p.netWorth/2000)}:{})
  })).sort((a,b)=>a.account-b.account)})).sort((a,b)=>a.name.localeCompare(b.name))]);
}
