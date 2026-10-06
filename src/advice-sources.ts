import {mkdir,readFile,writeFile,rename} from 'node:fs/promises';
import path from 'node:path';
import {getAppFetch} from './proxy.js';
import {HERO_CATALOG} from './hero-catalog.js';

export const KNOWLEDGE_REVISION='b4b5a8299de5f3e0704e62fdd04a6a54c4d4548e';
const ROOT=`https://raw.githubusercontent.com/odota/dotaconstants/${KNOWLEDGE_REVISION}/build`;
export interface AdviceItem {id:number;key:string;name:string;cost:number;components:string[];description:string;notes:string;attributes:string;}
export interface AdviceAbility {name:string;description:string;damageType:string;piercesDebuffImmunity:string;dispellable:string;}
export interface AdviceKnowledge {revision:string;items:AdviceItem[];itemNames?:Record<number,string>;heroAbilities?:Record<number,AdviceAbility[]>;}
export type PurchasePhases=Record<'start'|'early'|'mid'|'late',number>;
export interface ItemPopularity {heroId:number;counts:Record<string,number>;byPhase?:Record<string,PurchasePhases>;fetchedAt:number;source:string;}
const object=(x:unknown):x is Record<string,unknown>=>!!x&&typeof x==='object'&&!Array.isArray(x);
const clean=(x:unknown,max=2000)=>typeof x==='string'?x.replace(/<[^>]*>/g,' ').replace(/\s+/g,' ').trim().slice(0,max):'';
export function parseKnowledge(raw:unknown):AdviceKnowledge {
 if(!object(raw))throw Error('Invalid item knowledge');
 const items:AdviceItem[]=[],itemNames:Record<number,string>={};
 for(const [key,value] of Object.entries(raw)){
  // Inventory identity includes free and neutral items; purchase candidates do not.
  if(object(value)&&Number.isSafeInteger(value.id)&&Number(value.id)>0&&typeof value.dname==='string'){const name=clean(value.dname,80);if(name)itemNames[Number(value.id)]=name;}
  if(!object(value)||!Number.isSafeInteger(value.id)||Number(value.id)<=0||typeof value.dname!=='string'||typeof value.cost!=='number'||value.cost<=0||value.qual==='neutral'||value.tier!==undefined)continue;
  items.push({id:Number(value.id),key,name:clean(value.dname,80),cost:value.cost,
   components:Array.isArray(value.components)?value.components.filter((v):v is string=>typeof v==='string'):[],
   description:Array.isArray(value.abilities)?value.abilities.filter(object).map(a=>clean(a.title,100)+': '+clean(a.description,1500)).join('\n').slice(0,3500):'',
   notes:clean(value.notes),attributes:Array.isArray(value.attrib)?value.attrib.filter(object).filter(a=>typeof a.display==='string').map(a=>clean(a.display,100).replace('{value}',clean(String(a.value),100))).join('; '):''});
 }
 if(items.length<100)throw Error('Incomplete item knowledge');
 return {revision:KNOWLEDGE_REVISION,items,itemNames};
}
export function parsePopularity(heroId:number,raw:unknown,now=Date.now()):ItemPopularity {
 if(!object(raw))throw Error('Invalid item popularity');
 const counts:Record<string,number>={},byPhase:Record<string,PurchasePhases>={};
 for(const [phase,label] of [['start_game_items','start'],['early_game_items','early'],['mid_game_items','mid'],['late_game_items','late']] as const){
  const values=raw[phase];if(!object(values))throw Error('Incomplete item popularity');
  for(const [id,count] of Object.entries(values)){
   if(!/^\d+$/.test(id)||typeof count!=='number'||!Number.isSafeInteger(count)||count<0)throw Error('Invalid purchase count');
   counts[id]=(counts[id]??0)+count;
   (byPhase[id]??={start:0,early:0,mid:0,late:0})[label]=count;
  }
 }
 return {heroId,counts,byPhase,fetchedAt:now,source:`https://api.opendota.com/api/heroes/${heroId}/itemPopularity`};
}
export function parseHeroAbilities(abilities:unknown,heroes:unknown):Record<number,AdviceAbility[]>{
 if(!object(abilities)||!object(heroes))throw Error('Invalid ability knowledge');
 const result:Record<number,AdviceAbility[]>={};
 for(const hero of HERO_CATALOG){
  const entry=heroes[hero.name];if(!object(entry)||!Array.isArray(entry.abilities))continue;
  result[hero.id]=entry.abilities.filter((key):key is string=>typeof key==='string').flatMap(key=>{
   const a=abilities[key];if(!object(a)||!a.dname)return [];
   return [{name:clean(a.dname,80),description:clean(a.desc,1200),damageType:clean(a.dmg_type,100),piercesDebuffImmunity:clean(a.bkbpierce,100),dispellable:clean(a.dispellable,100)}];
  });
 }
 if(Object.keys(result).length<100)throw Error('Incomplete ability knowledge');
 return result;
}

/** Shared disk cache; failed fetches never become fresh data and callers coalesce. */
export class AdviceSources {
 private memory=new Map<string,{at:number;raw:unknown}>();
 private pending=new Map<string,Promise<unknown>>();
 private retryAfter=new Map<string,number>();
 constructor(private directory=path.join(process.env.DATA_DIR||'data','advice-sources'),private request:typeof fetch=async(input,init)=>(await getAppFetch())(input,init),private now=Date.now){}
 private async load<T>(key:string,url:string,ttl:number,parse:(raw:unknown,at:number)=>T):Promise<T>{
  if(this.pending.has(key))return this.pending.get(key)! as Promise<T>;
  const operation=(async()=>{
   let cached=this.memory.get(key);
   if(!cached){try{const saved=JSON.parse(await readFile(path.join(this.directory,key+'.json'),'utf8'));if(object(saved)&&typeof saved.at==='number'&&saved.at<=this.now()&&saved.at>0){parse(saved.raw,saved.at);cached={at:saved.at,raw:saved.raw};this.memory.set(key,cached);}}catch{/* Cold or corrupt cache is refetched. */}}
   if(cached&&this.now()-cached.at<ttl)return parse(cached.raw,cached.at);
   if((this.retryAfter.get(key)??0)>this.now())throw Error('Advice source temporarily unavailable');
   try{
    const response=await this.request(url,{signal:AbortSignal.timeout(12000)});
    if(!response.ok)throw Error('Advice source HTTP '+response.status);
    const raw:unknown=await response.json(),at=this.now(),value=parse(raw,at);
    this.memory.set(key,{at,raw});
    await mkdir(this.directory,{recursive:true});
    const dest=path.join(this.directory,key+'.json'),temp=dest+'.tmp';
    await writeFile(temp,JSON.stringify({at,raw}));await rename(temp,dest);
    return value;
   }catch(error){this.retryAfter.set(key,this.now()+15*60_000);throw error;}
  })();
  this.pending.set(key,operation);
  try{return await operation;}finally{this.pending.delete(key);}
 }
 async knowledge():Promise<AdviceKnowledge>{
  const validateObject=(raw:unknown)=>{if(!object(raw)||Object.keys(raw).length<100)throw Error('Incomplete dictionary');return raw;};
  const [items,abilities,heroes]=await Promise.all([
   this.load(`items-${KNOWLEDGE_REVISION}`,`${ROOT}/items.json`,Number.MAX_SAFE_INTEGER,parseKnowledge),
   this.load(`abilities-${KNOWLEDGE_REVISION}`,`${ROOT}/abilities.json`,Number.MAX_SAFE_INTEGER,validateObject),
   this.load(`hero-abilities-${KNOWLEDGE_REVISION}`,`${ROOT}/hero_abilities.json`,Number.MAX_SAFE_INTEGER,validateObject)
  ]);
  return {...items,heroAbilities:parseHeroAbilities(abilities,heroes)};
 }
 popularity(heroId:number){
  if(!Number.isSafeInteger(heroId)||heroId<=0)return Promise.reject(Error('Invalid hero ID'));
  return this.load(`hero-${heroId}`,`https://api.opendota.com/api/heroes/${heroId}/itemPopularity`,6*60*60_000,(raw,at)=>parsePopularity(heroId,raw,at));
 }
}
export const adviceSources=new AdviceSources();
