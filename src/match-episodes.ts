import type {ParsedMatch,ParsedPlayer,CombatDetails} from "./replay.js";
import {buildMatchOverview,type AdvantagePoint,type OverviewEvent,type OverviewTeam} from "./match-overview.js";
import {abilityLabel,abilityIsUltimate} from "./ability-labels.js";
import {heroName} from "./player-profile.js";
export const EPISODE_SETTINGS=Object.freeze({deathGapSeconds:20,minDeaths:3,contextBeforeSeconds:8,contextAfterSeconds:20,purchaseBeforeSeconds:120,objectiveAfterSeconds:120,spatialDiameterUnits:2000} as const);
export interface EpisodeActor {steamId:string;hero:string;heroLabel:string;team:OverviewTeam|null}
export interface EpisodeIncoming {windowSeconds:8;total:number;byAttacker:{key:string;value:number}[];byAbility:{key:string;value:number}[];complete:boolean}
export interface EpisodeDeath extends EpisodeActor {seconds:number;killer:string|null;x:number|null;y:number|null;coordinatesSource:string|null;incoming:EpisodeIncoming|null;incomingState:"available"|"not-recorded"|"invalid";source:"combat-log"|"legacy-times"}
export interface EpisodeCast extends EpisodeActor {seconds:number;ability:string;label:string;target:string|null;item:boolean;ultimate:boolean|null;ultimateSource:"combat-log"|"catalog"|"unknown"}
export interface EpisodeBuyback extends EpisodeActor {seconds:number;goldCost:number|null;verification:"combat-and-gold"|"combat-event"}
export interface EpisodePurchase extends EpisodeActor {seconds:number;item:string;label:string}
export interface MatchEpisode {
 id:string;startSeconds:number;endSeconds:number;contextStartSeconds:number;contextEndSeconds:number;purchaseStartSeconds:number;
 summary:string;deaths:EpisodeDeath[];deathCounts:{radiant:number;dire:number;unknown:number;total:number};uniqueDeadHeroes:(EpisodeActor&{deaths:number})[];
 spatial:{classification:"clustered"|"spread"|"unknown";maxDistance:number|null;located:number;total:number;threshold:number};
 buybacks:EpisodeBuyback[];casts:EpisodeCast[];purchases:EpisodePurchase[];
 networth:{before:AdvantagePoint|null;after:AdvantagePoint|null;delta:number|null;sampleSpanSeconds:number|null};followingObjectives:OverviewEvent[];
 coverage:{locatedDeaths:number;incomingDeaths:number;completeIncomingDeaths:number;invalidIncomingDeaths:number;deathPlayers:number;castPlayers:number;uncappedCastPlayers:number;buybackPlayers:number;purchasePlayers:number;totalPlayers:number;unknownUltimateCasts:number};
}
export interface MatchEpisodes {matchId:number;durationSeconds:number;settings:typeof EPISODE_SETTINGS;episodes:MatchEpisode[];coverage:{deathPlayers:number;totalPlayers:number;totalDeaths:number;episodeDeaths:number;unclusteredDeaths:number};notes:string[]}
const finite=(v:unknown):v is number=>typeof v==="number"&&Number.isFinite(v);
const nonnegative=(v:unknown):v is number=>finite(v)&&v>=0;
const actor=(p:ParsedPlayer):EpisodeActor=>({steamId:p.steam_id,hero:p.hero,heroLabel:heroName(p.hero),team:p.team==="radiant"||p.team==="dire"?p.team:null});
const details=(p:ParsedPlayer):CombatDetails|undefined=>p.combat_details&&["combat-log-v1","combat-log-v2"].includes(p.combat_details.version)?p.combat_details:undefined;
function incoming(v:unknown):EpisodeIncoming|null {
 if(!v||typeof v!=="object")return null;const x=v as Record<string,unknown>;
 const rows=(m:unknown)=>m&&typeof m==="object"&&!Array.isArray(m)&&Object.values(m).every(nonnegative)?Object.entries(m).map(([key,value])=>({key,value:value as number})).sort((a,b)=>b.value-a.value||a.key.localeCompare(b.key)):null;
 const byAttacker=rows(x.by_attacker),byAbility=rows(x.by_ability);
 if(x.window_seconds!==8||!nonnegative(x.total)||!byAttacker||!byAbility||byAttacker.reduce((n,r)=>n+r.value,0)!==x.total||byAbility.reduce((n,r)=>n+r.value,0)!==x.total)return null;
 return {windowSeconds:8,total:x.total,byAttacker,byAbility,complete:x.complete===true};
}
const key=(p:EpisodeActor)=>[p.team,p.steamId,p.hero].join("|");
const order=<T extends EpisodeActor&{seconds:number}>(a:T,b:T)=>a.seconds-b.seconds||a.hero.localeCompare(b.hero)||a.steamId.localeCompare(b.steamId);
/** Temporal death episodes, enriched with observations. Proximity is descriptive, not proof of one fight. */
export function buildMatchEpisodes(match:ParsedMatch):MatchEpisodes {
 const overview=buildMatchOverview(match),durationSeconds=overview.durationSeconds,players=match.players;
 const time=(min:unknown):number|null=>nonnegative(min)&&min*60<=durationSeconds?Math.round(min*60*1e6)/1e6:null;
 const allDeaths:EpisodeDeath[]=[],allCasts:EpisodeCast[]=[],allBuybacks:EpisodeBuyback[]=[],allPurchases:EpisodePurchase[]=[];
 let deathPlayers=0,castPlayers=0,uncappedCastPlayers=0,buybackPlayers=0,purchasePlayers=0;
 for(const p of players){
  const a=actor(p),d=details(p);
  if(Array.isArray(d?.deaths)){
   deathPlayers++;
   for(const e of d.deaths){const seconds=time(e.min);if(seconds===null)continue;const damage=incoming(e.incoming);const positioned=finite(e.x)&&finite(e.y);
    allDeaths.push({...a,seconds,killer:typeof e.killer==="string"?e.killer:null,x:positioned?e.x!:null,y:positioned?e.y!:null,coordinatesSource:typeof e.coordinates_source==="string"?e.coordinates_source:null,incoming:damage,incomingState:damage?"available":e.incoming?"invalid":"not-recorded",source:"combat-log"});
   }
  }else if(Array.isArray(p.death_times_min)){
   deathPlayers++;for(const min of p.death_times_min){const seconds=time(min);if(seconds!==null)allDeaths.push({...a,seconds,killer:null,x:null,y:null,coordinatesSource:null,incoming:null,incomingState:"not-recorded",source:"legacy-times"});}
  }
  if(Array.isArray(d?.casts)){
   castPlayers++;if(d.dropped_events===0)uncappedCastPlayers++;
   for(const e of d.casts){const seconds=time(e.min);if(seconds===null||typeof e.ability!=="string"||!e.ability)continue;
    const catalog=abilityIsUltimate(e.ability),explicit=typeof e.ultimate==="boolean"?e.ultimate:null;
    const ultimate=explicit??(d.coverage?.ultimate_classification===true?false:catalog);
    allCasts.push({...a,seconds,ability:e.ability,label:abilityLabel(e.ability),target:typeof e.target==="string"?e.target:null,item:e.item===true||e.ability.startsWith("item_"),ultimate,ultimateSource:explicit!==null||d.coverage?.ultimate_classification===true?"combat-log":catalog!==null?"catalog":"unknown"});
   }
  }
  if(Array.isArray(d?.buybacks)){
   buybackPlayers++;
   for(const e of d.buybacks){const seconds=time(e.min);if(seconds===null)continue;
    const gold=(Array.isArray(d.gold)?d.gold:[]).filter(g=>g.reason===2&&finite(g.value)&&g.value<0&&time(g.min)!==null&&Math.abs(g.min*60-seconds)<=1);
    const cost=gold.length===1?-gold[0].value:null;
    allBuybacks.push({...a,seconds,goldCost:cost,verification:cost!==null?"combat-and-gold":"combat-event"});
   }
  }
  if(Array.isArray(p.item_timings)){
   purchasePlayers++;for(const e of p.item_timings){const seconds=time(e.min);if(seconds===null||typeof e.item!=="string"||!e.item)continue;allPurchases.push({...a,seconds,item:e.item,label:abilityLabel(e.item.startsWith("item_")?e.item:"item_"+e.item)});}
  }
 }
 allDeaths.sort(order);allCasts.sort(order);allBuybacks.sort(order);allPurchases.sort(order);
 const clusters:EpisodeDeath[][]=[];
 for(const d of allDeaths){const last=clusters.at(-1);if(last&&d.seconds-last.at(-1)!.seconds<=EPISODE_SETTINGS.deathGapSeconds+1e-8)last.push(d);else clusters.push([d])}
 const episodes:MatchEpisode[]=clusters.filter(c=>c.length>=EPISODE_SETTINGS.minDeaths).map(deaths=>{
  const startSeconds=deaths[0].seconds,endSeconds=deaths.at(-1)!.seconds,contextStartSeconds=Math.max(0,startSeconds-EPISODE_SETTINGS.contextBeforeSeconds),contextEndSeconds=Math.min(durationSeconds,endSeconds+EPISODE_SETTINGS.contextAfterSeconds),purchaseStartSeconds=Math.max(0,startSeconds-EPISODE_SETTINGS.purchaseBeforeSeconds);
  const deathCounts={radiant:deaths.filter(d=>d.team==="radiant").length,dire:deaths.filter(d=>d.team==="dire").length,unknown:deaths.filter(d=>d.team===null).length,total:deaths.length};
  const unique=new Map<string,EpisodeActor&{deaths:number}>();for(const d of deaths){const k=key(d),old=unique.get(k);if(old)old.deaths++;else unique.set(k,{steamId:d.steamId,hero:d.hero,heroLabel:d.heroLabel,team:d.team,deaths:1})}
  const uniqueDeadHeroes=[...unique.values()].sort((a,b)=>b.deaths-a.deaths||a.hero.localeCompare(b.hero));
  const positioned=deaths.filter(d=>d.x!==null&&d.y!==null);let maxDistance:number|null=positioned.length>=2?0:null;
  for(let i=0;i<positioned.length;i++)for(let j=i+1;j<positioned.length;j++)maxDistance=Math.max(maxDistance??0,Math.hypot(positioned[i].x!-positioned[j].x!,positioned[i].y!-positioned[j].y!));
  const classification=positioned.length!==deaths.length||maxDistance===null?"unknown":maxDistance<=EPISODE_SETTINGS.spatialDiameterUnits?"clustered":"spread";
  const before=overview.networthAdvantage.find(p=>p.minute===Math.floor(startSeconds/60))??null;
  const nextMinute=overview.networthAdvantage.find(p=>p.minute===Math.ceil(endSeconds/60));
  const final=overview.phases.find(p=>p.key==="end")?.networth;
  const after=nextMinute??(final&&final.minute*60>=endSeconds&&final.minute*60-endSeconds<=60?final:null);
  const casts=allCasts.filter(e=>e.seconds>=contextStartSeconds&&e.seconds<=contextEndSeconds);
  const summary=`${deaths.length} событий смерти, ${uniqueDeadHeroes.length} разных героев: Radiant ${deathCounts.radiant}, Dire ${deathCounts.dire}${deathCounts.unknown?`, сторона неизвестна ${deathCounts.unknown}`:""}. ${classification==="spread"?"Смерти произошли в удалённых друг от друга точках карты.":classification==="clustered"?"Все записанные точки смерти расположены близко; это не доказывает участие в одной драке.":"Координат недостаточно для оценки близости всех смертей."}`;
  return {id:`episode-${Math.round(startSeconds*1000)}`,startSeconds,endSeconds,contextStartSeconds,contextEndSeconds,purchaseStartSeconds,summary,deaths,deathCounts,uniqueDeadHeroes,
   spatial:{classification,maxDistance,located:positioned.length,total:deaths.length,threshold:EPISODE_SETTINGS.spatialDiameterUnits},
   buybacks:allBuybacks.filter(e=>e.seconds>=contextStartSeconds&&e.seconds<=contextEndSeconds),casts,purchases:allPurchases.filter(e=>e.seconds>=purchaseStartSeconds&&e.seconds<=contextEndSeconds),
   networth:{before,after,delta:before&&after?after.advantage-before.advantage:null,sampleSpanSeconds:before&&after?(after.minute-before.minute)*60:null},
   followingObjectives:overview.events.filter(e=>e.kind!=="fight"&&e.startMinute*60>endSeconds&&e.startMinute*60<=Math.min(durationSeconds,endSeconds+EPISODE_SETTINGS.objectiveAfterSeconds)),
   coverage:{locatedDeaths:positioned.length,incomingDeaths:deaths.filter(d=>d.incoming!==null).length,completeIncomingDeaths:deaths.filter(d=>d.incoming?.complete).length,invalidIncomingDeaths:deaths.filter(d=>d.incomingState==="invalid").length,deathPlayers,castPlayers,uncappedCastPlayers,buybackPlayers,purchasePlayers,totalPlayers:players.length,unknownUltimateCasts:casts.filter(c=>c.ultimate===null).length}
  };
 });
 const episodeDeaths=episodes.reduce((n,e)=>n+e.deaths.length,0);
 return {matchId:match.match_id,durationSeconds,settings:EPISODE_SETTINGS,episodes,coverage:{deathPlayers,totalPlayers:players.length,totalDeaths:allDeaths.length,episodeDeaths,unclusteredDeaths:allDeaths.length-episodeDeaths},notes:[
  "Эпизод — цепочка минимум трёх смертей с паузами не более 20 секунд. Одна длинная цепочка может объединять разные столкновения.",
  "Близость измеряется по точкам смертей, а не позициям всех участников; порог 2000 игровых единиц — описательная эвристика.",
  "Касты и покупки попали в окно времени, но это не доказывает участие героя в столкновении. Покупка не равна доставке предмета.",
  "Суммы входящего урона относятся к восьми секундам перед каждой смертью и могут включать урон от существ и иллюзий. complete означает отсутствие усечения буфера.",
  "Изменение имущества относится к указанным минутным снимкам и не является чистой наградой за этот эпизод. Следующие цели связаны только хронологией.",
  "Ultimate — явный флаг или тип способности в закреплённом каталоге Valve, включая вспомогательные кнопки; не число успешных применений." ]};
}
