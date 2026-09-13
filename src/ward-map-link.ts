import type {WardInsight} from './match-insights.js';
import type {WardLifetimeModel} from './ward-lifetimes.js';

const normalized=(hero:string)=>hero.replace(/^npc_dota_hero_/,'').replace(/_/g,'');
const sameHero=(a:string|null,b:string|null)=>!!a&&!!b&&normalized(a)===normalized(b);
/** Link only mutually unique identities/timestamps. Pass all teams' events together. */
export function enrichWardMapCoordinates<T extends WardInsight&{preciseSeconds?:number}>(events:readonly T[],lifetimes:WardLifetimeModel|null|undefined):T[]{
 if(!lifetimes)return [...events];
 const candidates=events.map(e=>{
  if(e.event!=='destroy'||!Number.isFinite(e.preciseSeconds)||!e.targetTeam||!e.attackerTeam)return [];
  return lifetimes.entries.flatMap((life,i)=>{
   const k=life.killer;
   return k?.source==='unique-last-damage-match'&&life.kind===e.kind&&life.team===e.targetTeam&&k.team===e.attackerTeam&&sameHero(e.targetOwnerHero,life.ownerHero)&&sameHero(e.attackerHero,k.hero)&&Number.isFinite(k.seconds)&&Math.abs(e.preciseSeconds!-k.seconds)<=.031+1e-9?[i]:[];
  });
 });
 const uses=new Map<number,number>();for(const choices of candidates)for(const i of choices)uses.set(i,(uses.get(i)??0)+1);
 return events.map((e,i)=>{
  if(Number.isFinite(e.x)||Number.isFinite(e.y)||candidates[i].length!==1)return e;
  const index=candidates[i][0],life=lifetimes.entries[index];
  if(uses.get(index)!==1||life.positionMoved||!life.position||!Number.isFinite(life.position.x)||!Number.isFinite(life.position.y))return e;
  return {...e,x:life.position.x,y:life.position.y,coordinatesSource:'ward_lifetime'};
 });
}
