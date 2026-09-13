import {abilityIsUltimate} from "./ability-labels.js";
import type { ParsedMatch, ParsedPlayer, WardEvent } from "./replay.js";
import { heroName } from "./player-profile.js";
export type InsightFeature = "damage"|"damageBreakdown"|"healing"|"healingBreakdown"|"control"|"networth"|"gold"|"xp"|"lastHits"|"wards"|"wardMap"|"deaths"|"deathMap"|"ultimates"|"buybacks"|"buybackLog";
export interface FeatureCoverage { available:number; total:number; reason:string }
export interface MinutePoint { minute:number; value:number }
export interface BreakdownEntry { key:string; value:number }
export interface LocatedEvent { seconds:number; x:number|null; y:number|null; coordinatesSource?:string }
export interface WardInsight extends LocatedEvent {
 kind:string; event:string; destroyKind:"enemy_deward"|"allied_deny"|"unknown";
 attacker:string|null; attackerHero:string|null; attackerTeam:"radiant"|"dire"|null;
 targetTeam:"radiant"|"dire"|null; targetOwnerHero:string|null; sourceControlled:boolean; sourceIllusion:boolean;
}
export interface DeathInsight extends LocatedEvent { killer:string|null; incoming:{windowSeconds:number;total:number;byAttacker:BreakdownEntry[];byAbility:BreakdownEntry[];complete:boolean}|null }
export interface MatchPlayerInsights {
  steamId:string; hero:string; heroLabel:string; team:"radiant"|"dire";
  detailCoverage:{ultimateClassificationComplete:boolean;deathPositionsComplete:boolean;xpObserved:boolean}|null;
  damage:{heroes:number|null; received:number|null; buildings:number|null; byAbility:BreakdownEntry[]|null; byTarget:BreakdownEntry[]|null; byType:BreakdownEntry[]|null};
  healing:{totalIncludingSelf:number|null; self:number|null; allies:number|null; otherHeroes:number|null; units:number|null; byAbility:BreakdownEntry[]|null; byTarget:BreakdownEntry[]|null};
  control:{stunSeconds:number|null; observations:{seconds:number;target:string;modifier:string;stun:number|null;slow:number|null;elapsed:number|null;silence:boolean;root:boolean}[]|null};
  abilityCasts:BreakdownEntry[]|null;
  castLog:{seconds:number;ability:string;target:string|null;ultimate:boolean}[]|null;
  economy:{networth:MinutePoint[]|null; gold:MinutePoint[]|null; xp:MinutePoint[]|null; lastHits:MinutePoint[]|null; goldLostToDeath:number|null; goldSpentOnSupport:number|null; goldEvents:{seconds:number;value:number;reason:number|null}[]|null; denies:MinutePoint[]|null};
  vision:{destroySemantics?:boolean;observerPurchases:number|null; sentryPurchases:number|null; wardsKilled:number|null; placements:(LocatedEvent&{kind:string})[]|null; events:WardInsight[]|null};
  deaths:DeathInsight[]|null;
  killedBy:BreakdownEntry[]|null;
  ultimates:(LocatedEvent&{ability:string})[]|null;
  buybacks:{total:number|null; events:LocatedEvent[]|null};
}
export interface MatchInsights {
  matchId:number; durationSeconds:number; players:MatchPlayerInsights[];
  wardEvents?:WardInsight[];
  coverage:Record<InsightFeature,FeatureCoverage>;
  kills:{seconds:number;killer:string;victim:string;assists:number|null}[];
  buildings:{seconds:number;name:string;team:string}[];
  roshans:{seconds:number}[];
  teamfights:{startSeconds:number;endSeconds:number;deaths:number;radiantDeaths:number;direDeaths:number;winner:string;heroes:string[]}[];
  notes:string[];
}
const nonnegative=(v:unknown):number|null=>typeof v==="number"&&Number.isFinite(v)&&v>=0?v:null;
const rows=(v:unknown):BreakdownEntry[]|null=>v&&typeof v==="object"&&!Array.isArray(v)?Object.entries(v).flatMap(([key,value])=>nonnegative(value)!==null?[{key,value:value as number}]:[]).sort((a,b)=>b.value-a.value||a.key.localeCompare(b.key)):null;
function curve(v:unknown,duration:number):MinutePoint[]|null {
  if(!Array.isArray(v)||!v.length)return null;
  const points=v.flatMap((value,i)=>nonnegative(value)!==null&&(i+1)*60<=duration?[{minute:i+1,value}]:[]);
  return points.length?points:null;
}
const time=(minutes:unknown,duration:number):number|null=>nonnegative(minutes)!==null&&(minutes as number)*60<=duration?Math.round((minutes as number)*60):null;
function wardInsight(e:WardEvent,duration:number,semantics:boolean):WardInsight|null {
 if(!e||!Number.isFinite(e.min)||e.min*60>duration||(e.min<0&&e.event!=='place')||!['place','destroy','purchase'].includes(e.event))return null;
 const side=(s:unknown):"radiant"|"dire"|null=>s==='radiant'||s==='dire'?s:null;
 const attackerTeam=side(e.attacker_team),targetTeam=side(e.target_team),positioned=Number.isFinite(e.x)&&Number.isFinite(e.y);
 const destroyKind=semantics&&attackerTeam&&targetTeam&&e.event==='destroy'&&((e.destroy_kind==='enemy_deward'&&attackerTeam!==targetTeam)||(e.destroy_kind==='allied_deny'&&attackerTeam===targetTeam))?e.destroy_kind!:'unknown';
 return {seconds:Math.round(e.min*60),x:positioned?e.x!:null,y:positioned?e.y!:null,coordinatesSource:e.coordinates_source,
 kind:['observer','sentry'].includes(e.kind)?e.kind:'other',event:e.event,destroyKind,
 attacker:typeof e.attacker==='string'?e.attacker:null,attackerHero:typeof e.attacker_hero==='string'?e.attacker_hero:null,attackerTeam,targetTeam,
 targetOwnerHero:typeof e.target_owner_hero==='string'?e.target_owner_hero:null,sourceControlled:e.source_controlled===true,sourceIllusion:e.source_illusion===true};
}
/** Only existing observations are exposed. Legacy HEAL has no recipient split; legacy ward counters count purchases. */
export function buildMatchInsights(match:ParsedMatch):MatchInsights {
  const durationSeconds=Math.round((nonnegative(match.duration_min)??0)*60);
  const players:MatchPlayerInsights[]=match.players.map((p:ParsedPlayer)=>({
    steamId:p.steam_id,hero:p.hero,heroLabel:heroName(p.hero),team:p.team,detailCoverage:null,
    damage:{heroes:nonnegative(p.hero_damage),received:nonnegative(p.damage_taken),buildings:nonnegative(p.tower_damage),byAbility:null,byTarget:null,byType:null},
    healing:{totalIncludingSelf:nonnegative(p.healing),self:null,allies:null,otherHeroes:null,units:null,byAbility:null,byTarget:null},
    control:{stunSeconds:nonnegative(p.stuns),observations:null},abilityCasts:rows(p.top_spells),castLog:null,
    economy:{networth:curve(p.networth_by_minute,durationSeconds),gold:null,xp:null,lastHits:null,goldLostToDeath:nonnegative(p.gold_lost_to_death),goldSpentOnSupport:nonnegative(p.gold_spent_on_support),goldEvents:null,denies:null},
    vision:{destroySemantics:false,observerPurchases:nonnegative(p.obs_wards_placed),sentryPurchases:nonnegative(p.sentry_wards_placed),wardsKilled:nonnegative(p.wards_killed),placements:null,events:null},
    deaths:Array.isArray(p.death_times_min)?p.death_times_min.flatMap(t=>{const seconds=time(t,durationSeconds);return seconds===null?[]:[{seconds,x:null,y:null,killer:null,incoming:null}];}):null,
    killedBy:rows(p.killed_by),ultimates:null,buybacks:{total:nonnegative(p.buybacks),events:null}
  }));
  for(let i=0;i<players.length;i++) {
    applyCombatDetails(players[i],match.players[i],durationSeconds);
    const p=players[i];
    const identitiesKnown=p.healing.units===0||(match.players[i].combat_details as CombatDetails|undefined)?.coverage?.healing_target_identity===true;
    if(identitiesKnown&&p.healing.byTarget!==null&&(p.team==="radiant"||p.team==="dire")){
      const normalize=(hero:string)=>hero.replace(/^npc_dota_hero_/,"").replace(/_/g,"");
      const allies=new Set(players.filter(a=>a.team===p.team&&a.steamId!==p.steamId).map(a=>normalize(a.hero)));
      p.healing.allies=p.healing.byTarget.filter(h=>allies.has(normalize(h.key))).reduce((sum,h)=>sum+h.value,0);
    }
  }
  for(const player of players) if(player.castLog){
    for(const cast of player.castLog) if(abilityIsUltimate(cast.ability)===true)cast.ultimate=true;
    const ultimates=player.castLog.filter(c=>c.ultimate);
    if(ultimates.length)player.ultimates=ultimates.map(c=>({...c,x:null,y:null}));
  }
  const selectors:Record<InsightFeature,{read:(p:MatchPlayerInsights)=>unknown;reason:string}>={
    damage:{read:p=>p.damage.heroes,reason:"Общий урон героям из сохранённого матча."},
    damageBreakdown:{read:p=>p.damage.byAbility,reason:"Источники урона из combat log: только реальные герои-цели, без атакующих иллюзий."},
    healing:{read:p=>p.healing.totalIncludingSelf,reason:"Общий HEAL включает самолечение; это не лечение союзников."},
    healingBreakdown:{read:p=>p.healing.byTarget,reason:"Новый разбор разделяет самолечение, других героев и существ. Другие герои не означают только союзников."},
    control:{read:p=>p.control.stunSeconds,reason:"Секунды оглушения доступны только если сохранены официальные данные; это не сумма всех видов контроля."},
    networth:{read:p=>p.economy.networth,reason:"Стоимость имущества по минутам, включая золото и предметы."},
    gold:{read:p=>p.economy.gold,reason:"Отдельная кривая золота не сохранена. Стоимость имущества не подменяет доход."},
    xp:{read:p=>p.economy.xp,reason:"Накопленный опыт из XP-событий по минутам; доступен для нового разбора."},
    lastHits:{read:p=>p.economy.lastHits,reason:"Накопленные добивания из combat log по минутам; доступен для нового разбора."},
    wards:{read:p=>p.vision.observerPurchases,reason:"Старые счётчики — покупки Observer/Sentry, а не установки."},
    wardMap:{read:p=>p.vision.placements,reason:"Установки по созданию сущностей Observer/Sentry с известным владельцем; покупки не подменяют установки."},
    deaths:{read:p=>p.deaths,reason:"Время смертей из combat log, не официальный KDA."},
    deathMap:{read:p=>p.deaths?.some(e=>e.x!==null&&e.y!==null)?true:null,reason:"Координаты смерти из реплея; источник указан у события, покрытие может быть частичным."},
    ultimates:{read:p=>p.ultimates,reason:"Только применения с явным флагом ultimate; при неполном флаге журнал частичный."},
    buybacks:{read:p=>p.buybacks.total,reason:"Количество выкупов из реплея."},
    buybackLog:{read:p=>p.buybacks.events,reason:"Время выкупов доступно для нового разбора."},
  };
  const coverage=Object.fromEntries(Object.entries(selectors).map(([key,{read,reason}])=>[key,{available:players.filter(p=>read(p)!==null&&read(p)!==undefined).length,total:players.length,reason}])) as MatchInsights["coverage"];
  return {matchId:match.match_id,durationSeconds,players,coverage,
    wardEvents:(match.ward_events??[]).flatMap(e=>{const row=wardInsight(e,durationSeconds,true);return row?[row]:[];}),
    kills:(match.kills??[]).flatMap(k=>{const seconds=time(k.min,durationSeconds);return seconds===null?[]:[{seconds,killer:heroName(k.killer),victim:heroName(k.victim),assists:nonnegative(k.assists)}];}),
    buildings:(match.buildings??[]).flatMap(b=>{const seconds=time(b.min,durationSeconds);return seconds===null?[]:[{seconds,name:b.name,team:b.killed_by_team}];}),
    roshans:(match.roshan_kills_min??[]).flatMap(t=>{const seconds=time(t,durationSeconds);return seconds===null?[]:[{seconds}];}),
    teamfights:(match.teamfights??[]).flatMap(f=>{const startSeconds=time(f.start_min,durationSeconds),endSeconds=time(f.end_min,durationSeconds);return startSeconds===null||endSeconds===null||endSeconds<startSeconds?[]:[{startSeconds,endSeconds,deaths:f.deaths,radiantDeaths:f.radiant_died,direDeaths:f.dire_died,winner:f.winner,heroes:f.heroes_died.map(heroName)}];}),
    notes:["Источники урона и число применений — разные показатели. Число кастов не является уроном.","Суммарный HEAL включает себя. Без разбивки получателей нельзя называть его лечением союзников.","События смерти из combat log могут отличаться от официального KDA.","Кривые не восстанавливаются из конечных GPM/XPM или результата игры."]};
}

// Optional v4 observations; kept local so older persisted ParsedMatch JSON stays valid.
interface CombatDetails {
  version?:string;
  healing?:{self?:number;other_heroes?:number;units?:number;by_target?:Record<string,number>;by_ability?:Record<string,number>};
  damage?:{by_ability?:Record<string,number>;by_target?:Record<string,number>;by_type?:Record<string,number>};
  casts?:{min:number;ability:string;target?:string;ultimate?:boolean}[];
  deaths?:{min:number;killer:string;x?:number;y?:number;coordinates_source?:string;incoming?:{window_seconds:number;total:number;by_attacker:Record<string,number>;by_ability:Record<string,number>;complete:boolean}}[];
  wards?:WardEvent[];
  buybacks?:{min:number}[];
  gold?:{min:number;value:number;reason?:number}[];
  xp_by_minute?:number[];last_hits_by_minute?:number[];denies_by_minute?:number[];
  modifiers?:{min:number;target:string;modifier:string;stun?:number;slow?:number;elapsed?:number;silence?:boolean;root?:boolean}[];
  coverage?:Record<string,boolean>;
}
function applyCombatDetails(out:MatchPlayerInsights,player:ParsedPlayer,duration:number){
  const d=(player as ParsedPlayer&{combat_details?:CombatDetails}).combat_details;
  if(!d||!["combat-log-v1","combat-log-v2","combat-log-v3"].includes(d.version??""))return;
  out.detailCoverage={ultimateClassificationComplete:d.coverage?.ultimate_classification===true,deathPositionsComplete:d.coverage?.death_positions===true,xpObserved:d.coverage?.xp===true};
  out.damage.byAbility=rows(d.damage?.by_ability);out.damage.byTarget=rows(d.damage?.by_target);out.damage.byType=rows(d.damage?.by_type);
  out.healing.self=nonnegative(d.healing?.self);out.healing.otherHeroes=nonnegative(d.healing?.other_heroes);out.healing.units=nonnegative(d.healing?.units);out.healing.byTarget=rows(d.healing?.by_target);out.healing.byAbility=rows(d.healing?.by_ability);
  const located=(e:{min:number;x?:number;y?:number;coordinates_source?:string}):LocatedEvent|null=>{const seconds=time(e.min,duration);if(seconds===null)return null;const positioned=typeof e.x==="number"&&Number.isFinite(e.x)&&typeof e.y==="number"&&Number.isFinite(e.y);return {seconds,x:positioned?e.x!:null,y:positioned?e.y!:null,...(typeof e.coordinates_source==="string"?{coordinatesSource:e.coordinates_source}:{})};};
  if(Array.isArray(d.casts))out.castLog=d.casts.flatMap(c=>{const seconds=time(c.min,duration);return seconds===null||typeof c.ability!=="string"?[]:[{seconds,ability:c.ability,target:typeof c.target==="string"?c.target:null,ultimate:c.ultimate===true}];});
  if(out.castLog?.some(c=>c.ultimate)||d.coverage?.ultimate_classification===true)out.ultimates=(out.castLog??[]).filter(c=>c.ultimate).map(c=>({...c,x:null,y:null}));
  if(Array.isArray(d.deaths))out.deaths=d.deaths.flatMap(e=>{
    const p=located(e);if(!p)return [];
    const v=e.incoming;
    const incoming=v&&nonnegative(v.window_seconds)!==null&&nonnegative(v.total)!==null?{windowSeconds:v.window_seconds,total:v.total,byAttacker:rows(v.by_attacker)??[],byAbility:rows(v.by_ability)??[],complete:v.complete===true}:null;
    return [{...p,killer:typeof e.killer==="string"?heroName(e.killer):null,incoming}];
  });
  out.vision.destroySemantics=d.coverage?.ward_destroy_semantics===true;
  if(Array.isArray(d.wards))out.vision.events=d.wards.flatMap(e=>{const row=wardInsight(e,duration,d.coverage?.ward_destroy_semantics===true);return row?[row]:[];}).sort((a,b)=>a.seconds-b.seconds);
  // Only explicit ward entity creation can supply placement; PURCHASE coordinates cannot.
  const placed=out.vision.events?.filter(e=>e.event==="place")??[];
  if(placed.length||d.coverage?.ward_placements===true)out.vision.placements=placed;
  if(Array.isArray(d.buybacks))out.buybacks.events=d.buybacks.flatMap(e=>{const p=located(e);return p?[p]:[];});
  if(Array.isArray(d.gold))out.economy.goldEvents=d.gold.flatMap(e=>{const seconds=time(e.min,duration);return seconds===null||!Number.isFinite(e.value)?[]:[{seconds,value:e.value,reason:nonnegative(e.reason)}];});
  out.economy.xp=d.coverage?.xp===true?curve(d.xp_by_minute,duration):null;out.economy.lastHits=curve(d.last_hits_by_minute,duration);out.economy.denies=curve(d.denies_by_minute,duration);
  if(Array.isArray(d.modifiers))out.control.observations=d.modifiers.flatMap(e=>{const seconds=time(e.min,duration);return seconds===null?[]:[{seconds,target:e.target,modifier:e.modifier,stun:nonnegative(e.stun),slow:nonnegative(e.slow),elapsed:nonnegative(e.elapsed),silence:e.silence===true,root:e.root===true}];});
}

/** Valve game schema, not the separate GC match damage enum:
 * https://github.com/SteamDatabase/GameTracking-Dota2/blob/a7122b414f20d0766e4273dbf7b4eab5611c842a/DumpSource2/schemas/client/DAMAGE_TYPES.h
 */
export const damageTypeLabel=(key:string):string=>{
  switch(key){case "1":return "Физический";case "2":return "Магический";case "4":return "Чистый";case "unknown":return "Тип не записан";default:return `Тип из реплея ${key}`;}
};
/** Same pinned game schema: EDOTA_ModifyGold_Reason.h; unknown values remain explicit. */
export const goldReasonLabel=(reason:number|null):string=>{
  if(reason===null)return "Причина не записана";
  const labels:Record<number,string>={0:"Причина не уточнена",1:"Смерть",2:"Выкуп",3:"Покупка расходника",4:"Покупка предмета",5:"Золото вышедшего игрока",6:"Продажа предмета",7:"Стоимость способности",8:"Чит-команда",9:"Штраф за выбор героя",10:"Периодический доход",11:"Здание",12:"Убийство героя",13:"Убийство крипа",14:"Убийство нейтрала",15:"Убийство Рошана",16:"Убийство курьера",17:"Руна богатства",18:"Общее золото",19:"Золото от способности",20:"Уничтожение варда",21:"Курьер убит этим игроком",22:"Убийство призванного юнита"};
  return Object.hasOwn(labels,reason)?labels[reason]:`Причина из реплея ${reason}`;
};
