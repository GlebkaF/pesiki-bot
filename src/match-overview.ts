import type {ParsedMatch,ParsedPlayer} from "./replay.js";
import {buildMatchInsights} from "./match-insights.js";
export type OverviewTeam="radiant"|"dire";
export interface AdvantagePoint {minute:number;radiant:number;dire:number;advantage:number;source:"minute"|"final"}
export interface OverviewEvent {kind:"fight"|"building"|"roshan";startMinute:number;endMinute:number;label:string;team:OverviewTeam|null;lostTeam?:OverviewTeam|null;radiantDeaths?:number;direDeaths?:number}
export interface OverviewSwing {fromMinute:number;toMinute:number;delta:number;beneficiary:OverviewTeam;xpDelta:number|null;events:OverviewEvent[]}
export interface OverviewContribution {steamId:string;hero:string;value:number|null;share:number|null}
export interface OverviewMetric {total:number|null;known:number;expected:5;players:OverviewContribution[]}
export interface OverviewTeamSummary {team:OverviewTeam;players:number;heroDamage:OverviewMetric;damageTaken:OverviewMetric;towerDamage:OverviewMetric;alliedHealing:OverviewMetric;wardsPlaced:OverviewMetric;buybacks:OverviewMetric}
export interface OverviewEvidence {title:string;body:string;minute:number|null;kind:"phase"|"swing"|"coverage"}
export interface MatchOverview {
 matchId:number;durationSeconds:number;winner:OverviewTeam|null;headline:string;story:string[];rosterComplete:boolean;
 score:{radiant:number|null;dire:number|null};winnerMaxDeficit:{minute:number;amount:number}|null;
 coverage:{networthMinutes:number;xpMinutes:number;totalFullMinutes:number};
 networthAdvantage:AdvantagePoint[];xpAdvantage:AdvantagePoint[];
 phases:{key:"10"|"20"|"end";networth:AdvantagePoint|null;xp:AdvantagePoint|null}[];
 swings:OverviewSwing[];events:OverviewEvent[];teams:OverviewTeamSummary[];evidence:OverviewEvidence[];
}
const valid=(v:unknown):v is number=>typeof v==="number"&&Number.isFinite(v)&&v>=0;
const side=(v:unknown):v is OverviewTeam=>v==="radiant"||v==="dire";
const normalize=(hero:string)=>hero.replace(/^npc_dota_hero_/,"").replace(/_/g,"").toLowerCase();
const teamLabel=(team:OverviewTeam)=>team==="radiant"?"Radiant":"Dire";
const count=(n:number)=>new Intl.NumberFormat("ru-RU",{maximumFractionDigits:0}).format(n);

/** Complete observed team sums only. Never interpolate a missing player or minute. */
export function buildMatchOverview(match:ParsedMatch):MatchOverview {
 const durationSeconds=valid(match.apm_duration_seconds)&&match.apm_duration_seconds>0?match.apm_duration_seconds:valid(match.duration_min)?match.duration_min*60:0;
 const fullMinutes=Math.floor(durationSeconds/60),players=Array.isArray(match.players)?match.players:[];
 const radiant=players.filter(p=>p.team==="radiant"),dire=players.filter(p=>p.team==="dire");
 const heroKeys=players.map(p=>typeof p.hero==="string"?normalize(p.hero):"");
 const accounts=players.map(p=>p.steam_id).filter(id=>typeof id==="string"&&/^\d+$/.test(id)&&BigInt(id)>0n);
 const rosterComplete=players.length===10&&radiant.length===5&&dire.length===5&&heroKeys.every(Boolean)&&new Set(heroKeys).size===10&&new Set(accounts).size===accounts.length;
 const point=(minute:number,values:(number|null|undefined)[],source:AdvantagePoint["source"]):AdvantagePoint|null=>{
  if(!rosterComplete||values.length!==10||!values.every(valid))return null;
  let r=0,d=0;for(let i=0;i<players.length;i++)if(players[i].team==="radiant")r+=values[i]!;else d+=values[i]!;
  return Number.isFinite(r)&&Number.isFinite(d)?{minute,radiant:r,dire:d,advantage:r-d,source}:null;
 };
 const curves=(get:(p:ParsedPlayer)=>number[]|undefined):AdvantagePoint[]=>{
  if(!rosterComplete)return [];
  const arrays=players.map(get),max=Math.min(fullMinutes,...arrays.map(a=>Array.isArray(a)?a.length:0));
  const result:AdvantagePoint[]=[];for(let i=0;i<max;i++){const p=point(i+1,arrays.map(a=>a?.[i]),"minute");if(p)result.push(p)}return result;
 };
 const networthAdvantage=curves(p=>p.networth_by_minute),xpAdvantage=curves(p=>p.combat_details?.coverage?.xp===true?p.combat_details.xp_by_minute:undefined);
 const nw=new Map(networthAdvantage.map(p=>[p.minute,p])),xp=new Map(xpAdvantage.map(p=>[p.minute,p]));
 const finalNW=durationSeconds>0?point(durationSeconds/60,players.map(p=>p.networth_final),"final"):null;
 const phases:MatchOverview["phases"]=[{key:"10",networth:nw.get(10)??null,xp:xp.get(10)??null},{key:"20",networth:nw.get(20)??null,xp:xp.get(20)??null},{key:"end",networth:finalNW,xp:xp.get(fullMinutes)??null}];
 const events:OverviewEvent[]=[];
 const eventTime=(min:unknown):min is number=>valid(min)&&min*60<=durationSeconds;
 for(const f of match.teamfights??[])if(eventTime(f.start_min)&&eventTime(f.end_min)&&f.end_min>=f.start_min&&valid(f.radiant_died)&&valid(f.dire_died)){
  events.push({kind:"fight",startMinute:f.start_min,endMinute:f.end_min,label:`Боевой эпизод: смертей Radiant ${f.radiant_died}, Dire ${f.dire_died}`,team:null,radiantDeaths:f.radiant_died,direDeaths:f.dire_died});
 }
 for(const b of match.buildings??[])if(eventTime(b.min)&&typeof b.name==="string"&&/(?:^|_)(?:tower[1-4](?:_|$)|(?:melee|range)_rax(?:_|$)|fort(?:_|$))/.test(b.name)){
  const lostTeam:OverviewTeam|null=/goodguys/.test(b.name)?"radiant":/badguys/.test(b.name)?"dire":null;
  const tower=/tower([1-4])(?:_(top|mid|bot))?(?:_|$)/.exec(b.name),barracks=/(melee|range)_rax_(top|mid|bot)/.exec(b.name);
  const lane:Record<string,string>={top:"верх",mid:"центр",bot:"низ"};
  const name=tower?`башня T${tower[1]}${tower[2]?` (${lane[tower[2]]})`:""}`:barracks?`казарма ${barracks[1]==="melee"?"ближнего":"дальнего"} боя (${lane[barracks[2]]})`:/fort/.test(b.name)?"Древний":b.name;
  events.push({kind:"building",startMinute:b.min,endMinute:b.min,label:lostTeam?`${teamLabel(lostTeam)} потеряли: ${name}`:`Уничтожено здание: ${name}`,team:null,lostTeam});
 }
 for(const min of match.roshan_kills_min??[])if(eventTime(min))events.push({kind:"roshan",startMinute:min,endMinute:min,label:"Рошан убит · команда не записана",team:null});
 events.sort((a,b)=>a.startMinute-b.startMinute||a.endMinute-b.endMinute||a.kind.localeCompare(b.kind)||a.label.localeCompare(b.label));
 const candidates:OverviewSwing[]=[];
 for(const p of networthAdvantage){
  const end=nw.get(p.minute+3);if(!end||![1,2].every(n=>nw.has(p.minute+n)))continue;
  const delta=end.advantage-p.advantage;if(!delta)continue;
  const xpFrom=xp.get(p.minute),xpTo=xp.get(p.minute+3);
  candidates.push({fromMinute:p.minute,toMinute:p.minute+3,delta,beneficiary:delta>0?"radiant":"dire",xpDelta:xpFrom&&xpTo&&[1,2].every(n=>xp.has(p.minute+n))?xpTo.advantage-xpFrom.advantage:null,events:events.filter(e=>e.startMinute<=p.minute+3&&e.endMinute>=p.minute)});
 }
 candidates.sort((a,b)=>Math.abs(b.delta)-Math.abs(a.delta)||a.fromMinute-b.fromMinute);
 const swings:OverviewSwing[]=[];for(const s of candidates){if(swings.every(x=>s.toMinute<=x.fromMinute||s.fromMinute>=x.toMinute))swings.push(s);if(swings.length===3)break}
 const insights=buildMatchInsights(match);
 // hero_damage can be overwritten by official enrichment. Team comparison uses
 // only the same replay-derived damage partition for every participant.
 const replayDamage=players.map(p=>{const map=p.combat_details?.damage?.by_ability;return map&&typeof map==="object"&&!Array.isArray(map)&&Object.values(map).every(valid)?Object.values(map).reduce((n,v)=>n+v,0):null});
 const damageComplete=rosterComplete&&replayDamage.every(valid);
 const replayDamageByHero=new Map(players.map((p,i)=>[p.hero,replayDamage[i]]));
 const wardCoverageByHero=new Map(players.map(p=>[p.hero,p.combat_details?.coverage?.ward_placements===true]));
 const teams:OverviewTeamSummary[]=(['radiant','dire'] as const).map(team=>{
  const ps=insights.players.filter(p=>p.team===team);
  const metric=(get:(p:typeof ps[number])=>number|null):OverviewMetric=>{
   const rows=ps.map(p=>({steamId:p.steamId,hero:p.hero,value:get(p),share:null as number|null}));
   const known=rows.filter(r=>valid(r.value)).length;
   const sum=known===5&&ps.length===5&&rosterComplete?rows.reduce((n,r)=>n+r.value!,0):null;
   const total=sum!==null&&Number.isFinite(sum)?sum:null;
   for(const row of rows)if(total!==null&&total>0&&row.value!==null)row.share=row.value/total;
   rows.sort((a,b)=>(b.value??-1)-(a.value??-1)||a.hero.localeCompare(b.hero));
   return {total,known,expected:5,players:rows};
  };
  return {team,players:ps.length,heroDamage:metric(p=>damageComplete?replayDamageByHero.get(p.hero)??null:null),damageTaken:metric(p=>p.damage.received),towerDamage:metric(p=>p.damage.buildings),alliedHealing:metric(p=>p.healing.allies),wardsPlaced:metric(p=>wardCoverageByHero.get(p.hero)?p.vision.placements?.length??null:null),buybacks:metric(p=>p.buybacks.total)};
 });
 const winner=side(match.winner)?match.winner:null;
 const winnerSign=winner==="radiant"?1:-1;
 const deficitPoint=winner?networthAdvantage.filter(p=>p.advantage*winnerSign<0).sort((a,b)=>Math.abs(b.advantage)-Math.abs(a.advantage)||a.minute-b.minute)[0]:undefined;
 const winnerMaxDeficit=deficitPoint?{minute:deficitPoint.minute,amount:Math.abs(deficitPoint.advantage)}:null;
 const headline=winner?`Победа ${teamLabel(winner)}${winnerMaxDeficit?` · отставание до ${count(winnerMaxDeficit.amount)} по имуществу`:""}`:"Победитель не записан";
 const describe=(p:AdvantagePoint,when:string)=>p.advantage===0?`${when} имущество команд было равным.`:`${when} у ${p.advantage>0?"Radiant":"Dire"} было на ${count(Math.abs(p.advantage))} больше имущества.`;
 const story:string[]=[];
 if(winner&&winnerMaxDeficit)story.push(`Победители ${teamLabel(winner)} уступали до ${count(winnerMaxDeficit.amount)} по имуществу: максимальное отставание среди полных минутных снимков отмечено на ${winnerMaxDeficit.minute}-й минуте.`);
 else if(finalNW)story.push(describe(finalNW,"В финальном снимке"));
 const lateSwing=swings.find(s=>s.toMinute>=fullMinutes*.6)??swings[0];
 if(lateSwing){
  story.push(`С ${lateSwing.fromMinute}-й по ${lateSwing.toMinute}-ю минуту разница имущества изменилась на ${count(Math.abs(lateSwing.delta))} в пользу ${teamLabel(lateSwing.beneficiary)}.`);
  const following=events.filter(e=>e.kind!=="fight"&&e.startMinute>lateSwing.toMinute&&e.startMinute<=lateSwing.toMinute+2).slice(0,3);
  if(following.length)story.push(`В следующие две минуты в журнале: ${following.map(e=>e.label).join("; ")}.`);
 }
 const evidence:OverviewEvidence[]=phases.flatMap(phase=>phase.networth?[{title:phase.key==="end"?"Имущество к концу":`${phase.key}-я минута`,body:describe(phase.networth,phase.key==="end"?"В финальном снимке":`На ${phase.key}-й минуте`),minute:phase.networth.minute,kind:"phase" as const}]:[]);

 for(const swing of swings){const body=`С ${swing.fromMinute}-й по ${swing.toMinute}-ю минуту разница имущества изменилась на ${count(Math.abs(swing.delta))} в пользу ${teamLabel(swing.beneficiary)}. ${swing.events.length?`В этом окне отмечены события: ${swing.events.map(e=>e.label).join("; ")}.`:"События зданий, Рошана и боевых эпизодов в этом окне не записаны."} Совпадение по времени не устанавливает причину изменения.`;evidence.push({title:`Изменение за 3 минуты: ${teamLabel(swing.beneficiary)}`,body,minute:swing.fromMinute,kind:"swing"});}
 if(!rosterComplete)evidence.push({title:"Неполный состав",body:"Для сумм и преимущества нужны пять однозначных героев на каждой стороне. Командные итоги недоступны.",minute:null,kind:"coverage"});
 else if(networthAdvantage.length<fullMinutes||xpAdvantage.length<fullMinutes)evidence.push({title:"Покрытие по минутам",body:`Полные снимки имущества: ${networthAdvantage.length} из ${fullMinutes}; опыта: ${xpAdvantage.length} из ${fullMinutes}. Пропуски не интерполируются.`,minute:null,kind:"coverage"});
 return {matchId:match.match_id,durationSeconds,winner,headline,story,rosterComplete,winnerMaxDeficit,score:{radiant:valid(match.radiant_score)?match.radiant_score:null,dire:valid(match.dire_score)?match.dire_score:null},coverage:{networthMinutes:networthAdvantage.length,xpMinutes:xpAdvantage.length,totalFullMinutes:fullMinutes},networthAdvantage,xpAdvantage,phases,swings,events,teams,evidence};
}
