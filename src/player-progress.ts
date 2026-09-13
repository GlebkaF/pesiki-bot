import type { ApmStore } from "./apm-store.js";
import type { PlayerProfile } from "./player-profile.js";
import { heroName } from "./player-profile.js";
export interface ProgressMilestone { key:string;label:string;value:number;reached:number|null;next:number;ratio:number }
export interface ItemBenchmark { hero:string;mode:string;item:string;itemLabel:string;matchId:number;latestSeconds:number;medianSeconds:number;differenceSeconds:number;sample:number }
export interface PlayerProgress {
  account:number;period:string;games:number;officialKdaGames:number;knownResults:number;
  totals:{kills:number;assists:number;wins:number;heroes:number};
  streaks:{bestWins:number;currentWins:number;currentLosses:number;datedGames:number};
  milestones:ProgressMilestone[];benchmarks:ItemBenchmark[];
  benchmarkCoverage:{considered:number;replays:number;limit:number;minimumOtherGames:number};
}
const ITEM_LABELS:Record<string,string>={blink:"Blink Dagger",force_staff:"Force Staff",glimmer_cape:"Glimmer Cape",black_king_bar:"Black King Bar",ultimate_scepter:"Aghanim’s Scepter",aghanims_shard:"Aghanim’s Shard",manta:"Manta Style",bfury:"Battle Fury",radiance:"Radiance",butterfly:"Butterfly",satanic:"Satanic",skadi:"Eye of Skadi",refresher:"Refresher Orb",sheepstick:"Scythe of Vyse",heart:"Heart of Tarrasque",greater_crit:"Daedalus",mjollnir:"Mjollnir",maelstrom:"Maelstrom",gleipnir:"Gleipnir",bloodthorn:"Bloodthorn",orchid:"Orchid Malevolence",abyssal_blade:"Abyssal Blade",cyclone:"Eul’s Scepter",aeon_disk:"Aeon Disk",lotus_orb:"Lotus Orb",sphere:"Linken’s Sphere",pipe:"Pipe of Insight",shivas_guard:"Shiva’s Guard",arcane_boots:"Arcane Boots",power_treads:"Power Treads",phase_boots:"Phase Boots",tranquil_boots:"Tranquil Boots",boots_of_bearing:"Boots of Bearing",guardian_greaves:"Guardian Greaves",hurricane_pike:"Hurricane Pike"};
const finite=(n:unknown):n is number=>typeof n==="number"&&Number.isFinite(n)&&n>=0;
const median=(ns:number[])=>{const sorted=[...ns].sort((a,b)=>a-b);return (sorted[Math.floor((sorted.length-1)/2)]+sorted[Math.floor(sorted.length/2)])/2;};
function milestone(key:string,label:string,value:number,levels:number[]):ProgressMilestone {
  const reached=levels.filter(n=>n<=value).at(-1)??null;
  const next=levels.find(n=>n>value)??(Math.floor(value/levels.at(-1)!)+1)*levels.at(-1)!;
  return {key,label,value,reached,next,ratio:Math.min(1,value/next)};
}
interface CompactPurchaseGame { id:number;hero:string;mode:string;first:Record<string,number> }
interface BenchmarkCache { at:number;signature:string;benchmarks:ItemBenchmark[];coverage:PlayerProgress["benchmarkCoverage"] }
const caches=new WeakMap<ApmStore,Map<string,BenchmarkCache>>();
const projections=new WeakMap<ApmStore,Map<number,{at:number;rows:ReturnType<ApmStore["economyHistory"]>}>>();
function compactHistory(store:ApmStore,account:number,now:number){
  let cache=projections.get(store);if(!cache){cache=new Map();projections.set(store,cache);}
  const old=cache.get(account);if(old&&now-old.at<60000)return old.rows;
  const rows=store.economyHistory(account);cache.set(account,{at:now,rows});return rows;
}
function benchmarks(store:ApmStore,profile:PlayerProfile,now:number){
  const candidates=profile.measured.filter(m=>finite(m.start)&&m.start>0).sort((a,b)=>b.start!-a.start!||b.id-a.id).filter((m,i,ms)=>ms.findIndex(x=>x.id===m.id)===i).slice(0,100);
  const key=`${profile.account}:${profile.period}`,signature=candidates.map(m=>m.id).join(",");
  let cache=caches.get(store);if(!cache){cache=new Map();caches.set(store,cache);}
  const old=cache.get(key);if(old&&now-old.at<60000&&old.signature===signature)return old;
  const source=new Map(compactHistory(store,profile.account,now).map(r=>[r.matchId,r]));
  const games:CompactPurchaseGame[]=[];
  for(const candidate of candidates){
    const replay=source.get(candidate.id);
    if(!replay||!/^mode_\d+$/.test(replay.mode)||!finite(replay.duration))continue;
    let items:unknown;
    try{items=JSON.parse(replay.items);}catch{continue;}
    if(!Array.isArray(items))continue;
    const first:Record<string,number>={};
    for(const purchase of items){
      if(!purchase||typeof purchase!=="object")continue;
      const item=typeof purchase.item==="string"?purchase.item.replace(/^item_/,""):"";
      if(!Object.hasOwn(ITEM_LABELS,item)||!finite(purchase.min)||purchase.min>replay.duration)continue;
      const seconds=Math.round(purchase.min*60);first[item]=Math.min(first[item]??Infinity,seconds);
    }
    games.push({id:replay.matchId,hero:heroName(replay.hero),mode:replay.mode,first});
  }
  const output:ItemBenchmark[]=[],seen=new Set<string>();
  for(let i=0;i<games.length;i++){
    const latest=games[i],group=`${latest.hero}:${latest.mode}`;
    if(seen.has(group))continue;seen.add(group);
    const prior=games.slice(i+1).filter(g=>g.hero===latest.hero&&g.mode===latest.mode&&g.id!==latest.id);
    for(const [item,latestSeconds] of Object.entries(latest.first)){
      const samples=prior.flatMap(g=>Object.hasOwn(g.first,item)?[g.first[item]]:[]);
      if(samples.length<5)continue;
      const medianSeconds=Math.round(median(samples));
      output.push({hero:latest.hero,mode:latest.mode,item,itemLabel:ITEM_LABELS[item],matchId:latest.id,latestSeconds,medianSeconds,differenceSeconds:latestSeconds-medianSeconds,sample:samples.length});
    }
  }
  const result:BenchmarkCache={at:now,signature,benchmarks:output,coverage:{considered:candidates.length,replays:games.length,limit:100,minimumOtherGames:5}};
  cache.set(key,result);return result;
}
/** Own stored history only. Official KDA is never reconstructed from combat events. */
export function buildPlayerProgress(store:ApmStore,profile:PlayerProfile,now=Date.now()):PlayerProgress {
  const official=profile.matches.filter(m=>["OpenDota","табло реплея"].includes(m.kdaSource??"")&&m.kda?.every(finite));
  const totals={kills:official.reduce((sum,m)=>sum+m.kda![0],0),assists:official.reduce((sum,m)=>sum+m.kda![2],0),wins:profile.matches.filter(m=>m.win===true).length,heroes:new Set(profile.matches.map(m=>m.hero).filter(h=>h&&h!=="Неизвестный герой")).size};
  const dated=profile.matches.filter(m=>finite(m.start)&&m.start>0).sort((a,b)=>b.start!-a.start!||b.id-a.id);
  let bestWins=0,run=0;for(const m of [...dated].reverse()){run=m.win===true?run+1:0;bestWins=Math.max(bestWins,run);}
  const current=(value:boolean)=>{let n=0;for(const m of dated){if(m.win!==value)break;n++;}return n;};
  const cached=benchmarks(store,profile,now);
  return {account:profile.account,period:profile.period,games:profile.matches.length,officialKdaGames:official.length,knownResults:profile.matches.filter(m=>m.win!==null).length,totals,
    streaks:{bestWins,currentWins:current(true),currentLosses:current(false),datedGames:dated.length},
    milestones:[milestone("wins","Победы",totals.wins,[10,25,50,100,250,500,1000]),milestone("kills","Убийства",totals.kills,[100,500,1000,2500,5000,10000]),milestone("assists","Помощь в убийствах",totals.assists,[100,500,1000,2500,5000,10000]),milestone("heroes","Герои в истории",totals.heroes,[5,10,20,30,50,75,100])],benchmarks:cached.benchmarks,benchmarkCoverage:cached.coverage};
}
