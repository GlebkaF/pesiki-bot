import type {ApmStore} from './apm-store.js';
import {APM_VERSION} from './apm-store.js';
import {PLAYERS} from './config.js';
import {HERO_CATALOG} from './hero-catalog.js';
import type {ParsedMatch,ParsedPlayer} from './replay.js';
import {verifiedReplayScoreboard} from './replay-scoreboard.js';

export interface ComparisonEvidence<T> {value:T|null;source:string|null;reason:string}
export interface ComparisonPoint {minute:number;value:number}
export interface ComparisonCurve {points:ComparisonPoint[];source:string|null;coverage:{observed:number;expected:number;complete:boolean};reason:string}
export interface ComparisonPurchase {item:string;seconds:number}
export interface ComparedMatch {
 matchId:number;account:number;hero:string;heroLabel:string;team:string;mode:string|null;startTime:number|null;durationSeconds:number;
 result:ComparisonEvidence<boolean>;kda:ComparisonEvidence<[number,number,number]>;
 apm:ComparisonEvidence<{apm:number;actions:number;durationSeconds:number}>;
 curves:Record<'networth'|'xp'|'lastHits',ComparisonCurve>;
 checkpoints:{minute:number;networth:number|null}[];
 firstPurchases:{items:ComparisonPurchase[];source:string|null;reason:string};
}
export interface ComparisonDelta {minute:number;left:number;right:number;delta:number}
export interface MatchComparison {
 account:number;left:ComparedMatch;right:ComparedMatch;sameHero:boolean;sameMode:boolean|null;
 curves:Record<'networth'|'xp'|'lastHits',ComparisonDelta[]>;
 purchases:{item:string;leftSeconds:number|null;rightSeconds:number|null;deltaSeconds:number|null}[];
 warnings:string[];notes:string[];
}
const normalize=(s:string)=>s.replace(/^npc_dota_hero_/,'').replace(/_/g,'');
const nonnegative=(v:unknown):v is number=>typeof v==='number'&&Number.isFinite(v)&&v>=0;
const unknown=<T>(reason:string):ComparisonEvidence<T>=>({value:null,source:null,reason});
function curve(raw:unknown,duration:number,source:string|null,reason:string):ComparisonCurve {
 const expected=Math.floor(duration/60);
 const points=source&&Array.isArray(raw)?raw.flatMap((v,i)=>nonnegative(v)&&i<expected?[{minute:i+1,value:v}]:[]):[];
 return {points,source:points.length?source:null,coverage:{observed:points.length,expected,complete:expected>0&&points.length===expected},reason};
}
function one(store:ApmStore,m:ParsedMatch,p:ParsedPlayer,account:number):ComparedMatch {
 const durationSeconds=nonnegative(m.apm_duration_seconds)&&m.apm_duration_seconds>0?m.apm_duration_seconds:m.duration_min*60,hero=HERO_CATALOG.find(h=>normalize(h.name)===normalize(p.hero));
 let kda=unknown<[number,number,number]>('Проверенное итоговое KDA не сохранено; счётчики combat log не используются.');
 const scoreboard=verifiedReplayScoreboard(p);
 if(scoreboard)kda={value:[scoreboard.kills,scoreboard.deaths,scoreboard.assists],source:'replay-scoreboard',reason:'Итоговое табло CDOTA_PlayerResource с подтверждённым концом игры.'};
 else {
  // Account alone or matching hero alone cannot authorize another player's row.
  const rows=store.officialPlayers(m.match_id).filter(q=>hero&&q.hero_id===hero.id&&q.account_id===account&&Number.isSafeInteger(q.player_slot)&&((q.player_slot>=0&&q.player_slot<=4&&p.team==='radiant')||(q.player_slot>=128&&q.player_slot<=132&&p.team==='dire'))&&[q.kills,q.deaths,q.assists].every(v=>Number.isSafeInteger(v)&&v>=0));
  if(rows.length===1)kda={value:[rows[0].kills,rows[0].deaths,rows[0].assists],source:'saved-official',reason:'Сохранённый официальный ответ/история: совпали аккаунт, герой и сторона.'};
 }
 let apm=unknown<{apm:number;actions:number;durationSeconds:number}>('Нет проверенного измерения spectator-orders-v1.');
 if(m.apm_version===APM_VERSION&&nonnegative(m.apm_duration_seconds)&&m.apm_duration_seconds>0&&Number.isSafeInteger(p.actions)&&p.actions!>=0&&Number.isSafeInteger(p.actions_per_min)&&p.actions_per_min===Math.floor(p.actions!*60/m.apm_duration_seconds))apm={value:{apm:p.actions_per_min!,actions:p.actions!,durationSeconds:m.apm_duration_seconds},source:APM_VERSION,reason:'Действия и отдельная длительность измерения APM из сохранённого реплея.'};
 const d=p.combat_details,known=d&&['combat-log-v1','combat-log-v2','combat-log-v3'].includes(d.version);
 const curves={networth:curve(p.networth_by_minute,durationSeconds,'replay-networth','Имущество на целой минуте, не заработанное золото.'),xp:curve(known&&d.coverage?.xp===true?d.xp_by_minute:null,durationSeconds,known&&d.coverage?.xp===true?d.version:null,'Накопленный опыт только при подтверждённых XP-событиях.'),lastHits:curve(known?d.last_hits_by_minute:null,durationSeconds,known?d.version:null,'Добивания по сохранённым минутным снимкам combat log.')};
 const first=new Map<string,number>();
 if(Array.isArray(p.item_timings))for(const t of p.item_timings){
  if(!t||typeof t.item!=='string'||!nonnegative(t.min)||t.min*60>durationSeconds)continue;
  const item=t.item.replace(/^item_/,'');if(!/^[a-z0-9_]+$/.test(item))continue;
  const seconds=t.min*60;first.set(item,Math.min(first.get(item)??Infinity,seconds));
 }
 const validSide=(s:unknown)=>s==='radiant'||s==='dire';
 return {matchId:m.match_id,account,hero:p.hero,heroLabel:hero?.localized_name??p.hero,team:p.team,mode:typeof m.game_mode==='string'&&/^mode_[1-9]\d*$/.test(m.game_mode)?m.game_mode:null,startTime:nonnegative(m.start_time)&&m.start_time>0?m.start_time:null,durationSeconds,
 result:validSide(m.winner)&&validSide(p.team)?{value:m.winner===p.team,source:'saved-replay-result',reason:'Победившая сторона сохранённого матча.'}:unknown('Победившая сторона неизвестна.'),kda,apm,curves,
 checkpoints:[10,20].map(minute=>({minute,networth:curves.networth.points.find(p=>p.minute===minute)?.value??null})),
 firstPurchases:{items:[...first].map(([item,seconds])=>({item,seconds})).sort((a,b)=>a.seconds-b.seconds||a.item.localeCompare(b.item)),source:Array.isArray(p.item_timings)?'replay-purchase':null,reason:'Первое наблюдаемое PURCHASE каждого ключа. Отсутствие события не доказывает отсутствие предмета; это не доставка и не сборка.'}};
}
/** Read-only, two selected JSONs only. Left/right follow request order; deltas are right minus left. */
export function buildMatchComparison(store:ApmStore,account:number,leftMatchId:number,rightMatchId:number):MatchComparison|null {
 if(!Number.isSafeInteger(account)||!PLAYERS.some(p=>p.steamId===account)||![leftMatchId,rightMatchId].every(id=>Number.isSafeInteger(id)&&id>0)||leftMatchId===rightMatchId)return null;
 const steam=String(BigInt(account)+76561197960265728n),raw=[store.replay(leftMatchId),store.replay(rightMatchId)];
 const selected:ParsedPlayer[]=[];
 for(let i=0;i<raw.length;i++){
  const m=raw[i];if(!m||m.match_id!==[leftMatchId,rightMatchId][i]||!nonnegative(m.duration_min)||m.duration_min<=0||!Number.isFinite(m.duration_min*60)||!Array.isArray(m.players))return null;
  const ps=m.players.filter(p=>p&&p.steam_id===steam);if(ps.length!==1||typeof ps[0].hero!=='string'||!['radiant','dire'].includes(ps[0].team))return null;selected.push(ps[0]);
 }
 const left=one(store,raw[0]!,selected[0],account),right=one(store,raw[1]!,selected[1],account);
 const curves={} as MatchComparison['curves'];
 for(const key of ['networth','xp','lastHits'] as const){const r=new Map(right.curves[key].points.map(p=>[p.minute,p.value]));curves[key]=left.curves[key].points.flatMap(p=>r.has(p.minute)?[{minute:p.minute,left:p.value,right:r.get(p.minute)!,delta:r.get(p.minute)!-p.value}]:[]);}
 const l=new Map(left.firstPurchases.items.map(p=>[p.item,p.seconds])),r=new Map(right.firstPurchases.items.map(p=>[p.item,p.seconds]));
 const sameHero=normalize(left.hero)===normalize(right.hero),sameMode=left.mode&&right.mode?left.mode===right.mode:null;
 const warnings:string[]=[];if(!sameHero)warnings.push('Разные герои: показатели зависят от героя и роли.');if(sameMode===false)warnings.push('Разные режимы: темп и правила экономики могут различаться.');if(sameMode===null)warnings.push('Режим одной из игр неизвестен; сопоставимость не подтверждена.');if(left.durationSeconds!==right.durationSeconds)warnings.push('Разная длительность: дельты считаются только на общих записанных минутах.');
 return {account,left,right,sameHero,sameMode,curves,purchases:[...new Set([...l.keys(),...r.keys()])].sort().map(item=>({item,leftSeconds:l.get(item)??null,rightSeconds:r.get(item)??null,deltaSeconds:l.has(item)&&r.has(item)?r.get(item)!-l.get(item)!:null})),warnings,
 notes:['Все дельты — правая игра минус левая; это не оценка качества игры.','Пропуски неизвестны: без нулевых подстановок, интерполяции и продления последнего значения.','Первый элемент минутного ряда соответствует минуте 1. Конечные итоги разных по длительности игр не сравниваются как один момент.','Только сохранённые данные; внешние API не вызываются.']};
}
