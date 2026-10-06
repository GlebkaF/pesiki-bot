import {fetchRealtimeDetails,preferDetailedSnapshot} from './live-match-details.js';
import {config,PLAYERS,PLAYER_IDS} from './config.js';
import {getSteamPresence} from './steam-presence.js';
import {findObserverGames,type TVGame} from './dota-observer.js';
import {HERO_CATALOG} from './hero-catalog.js';

export interface LivePlayer{account:number;name:string;hero:string;level?:number;kills?:number;deaths?:number;assists?:number;ours:boolean;slot:number;netWorth?:number;gold?:number;lastHits?:number;denies?:number;x?:number;y?:number;items:number[];}
export interface LiveMatch{matchId:string;kind:'stack'|'public';stackCount:number;time?:number;delay?:number;updatedAt:number;detailed:boolean;buildings:Array<{x:number;y:number;team:number;destroyed:boolean}>;history:Array<{time:number;lead:number}>;teams:Array<{name:string;score?:number;netWorth?:number;players:LivePlayer[]}>;}
const numeric=(value:unknown):number|undefined=>typeof value==='number'&&Number.isFinite(value)?value:undefined;
const roster=new Map(PLAYERS.map(p=>[p.steamId,p.dotaName]));
export function selectLiveGame(games:TVGame[],members:Map<string,number[]>,active:Set<number>,preferredLobby?:string):{game:TVGame;count:number}|undefined{
 const ranked=games.filter(g=>g.is_watch_eligible!==false&&g.match_id&&g.match_id!=='0'&&!g.deactivate_time&&typeof g.last_update_time==='number'&&Math.abs(Date.now()/1000-g.last_update_time)<=180).map(game=>({game,count:new Set([...(members.get(game.lobby_id)??[]),...(game.players??[]).map(p=>p.account_id??0)].filter(id=>active.has(id))).size}));
 return ranked.sort((a,b)=>b.count-a.count||Number(!!a.game.league_id)-Number(!!b.game.league_id)||Number(b.game.lobby_id===preferredLobby)-Number(a.game.lobby_id===preferredLobby))[0];
}
export function liveSnapshot(game:TVGame,count:number,data?:any):LiveMatch|null{
 // Never combine scores from a different match or continue displaying a finished game.
 const detailed=!!data?.match&&String(data.match.match_id)===game.match_id&&Array.isArray(data.teams)&&data.teams.length===2;
 if(detailed&&data.match.game_state>=6)return null;
 const teams=[2,3].map((team,index)=>{
  const source=detailed?data.teams.find((t:any)=>t.team_number===team)??data.teams[index]:undefined;
  const players=source?.players??(game.players??[]).filter(p=>p.team===index).map(p=>({accountid:p.account_id,heroid:p.hero_id}));
  return {netWorth:numeric(source?.net_worth),name:index===0?'Radiant':'Dire',score:detailed?numeric(source?.score):numeric(index===0?game.radiant_score:game.dire_score),players:players.map((p:any,slot:number)=>{
   const account=numeric(p.accountid)??0;
   return {slot:numeric(p.playerid)??index*5+slot,netWorth:numeric(p.net_worth),gold:numeric(p.gold),lastHits:numeric(p.lh_count),denies:numeric(p.denies_count),x:numeric(p.x),y:numeric(p.y),items:Array.isArray(p.items)?p.items.slice(0,9).map((n:unknown)=>numeric(n)??-1):[],account,name:roster.get(account)||String(p.name||'Игрок').slice(0,80),hero:HERO_CATALOG.find(h=>h.id===p.heroid)?.localized_name||'Герой не выбран',ours:roster.has(account),level:numeric(p.level),kills:numeric(p.kill_count),deaths:numeric(p.death_count),assists:numeric(p.assists_count)};
  })};
 });
 return {buildings:detailed&&Array.isArray(data.buildings)?data.buildings.filter((b:any)=>b.type===0&&[2,3].includes(b.team)&&numeric(b.x)!==undefined&&numeric(b.y)!==undefined).map((b:any)=>({x:b.x,y:b.y,team:b.team,destroyed:!!b.destroyed})):[],history:[],matchId:game.match_id!,kind:count?'stack':'public',stackCount:count,time:detailed?numeric(data.match.game_time):numeric(game.game_time),delay:numeric(game.delay),updatedAt:Date.now(),detailed,teams};
}
const completed=new Set<string>();
let preferredLobby:string|undefined;
let cached:LiveMatch|null=null,lastAttempt=0,pending:Promise<LiveMatch|null>|undefined;
async function refresh(retryCompleted=true):Promise<LiveMatch|null>{
 const members=new Map<string,number[]>();
 try{for(const [id,p] of await getSteamPresence(PLAYER_IDS)){
  const lobby=p.richPresence.WatchableGameID;
  if(/^\d+$/.test(lobby??'')&&lobby!=='0')members.set(lobby,[...(members.get(lobby)??[]),id]);
 }}catch{/* Public DotaTV remains available when friends presence is unavailable. */}
 const active=new Set(PLAYER_IDS);
 const targeted=members.size||preferredLobby?await findObserverGames([...new Set([...members.keys(),...preferredLobby?[preferredLobby]:[]])]):[];
 let selected=selectLiveGame(targeted.filter(g=>!completed.has(g.match_id??'')&&(members.has(g.lobby_id)||g.lobby_id===preferredLobby)),members,active,preferredLobby);
 if(!selected)selected=selectLiveGame((await findObserverGames([])).filter(g=>!completed.has(g.match_id??'')),members,active);
 if(!selected)return null;
 const {game,count}=selected;
 preferredLobby=game.lobby_id;
 const details=config.steamApiKey&&game.server_steam_id?await fetchRealtimeDetails(game.server_steam_id,game.match_id!,config.steamApiKey):undefined;
 const snapshot=preferDetailedSnapshot(liveSnapshot(game,count,details),cached);
 if(!snapshot){completed.add(game.match_id!);if(completed.size>100)completed.delete(completed.values().next().value!);preferredLobby=undefined;if(retryCompleted)return refresh(false);}
 return snapshot;
}
export async function getLiveMatch():Promise<LiveMatch|null>{
 if(pending)return pending;
 if(Date.now()-lastAttempt<30_000)return cached&&Date.now()-cached.updatedAt<90_000?cached:null;
 lastAttempt=Date.now();
 pending=refresh().then(value=>{if(value&&value.detailed&&value.time!==undefined&&value.teams.every(t=>t.netWorth!==undefined)){const previous=cached?.matchId===value.matchId?cached.history:[];value.history=[...previous.filter(p=>p.time<value.time!),{time:value.time,lead:value.teams[0].netWorth!-value.teams[1].netWorth!}].slice(-120);}cached=value;return value;}).catch(()=>{console.warn('[LIVE MATCH] Refresh unavailable');return cached&&Date.now()-cached.updatedAt<90_000?cached:null;}).finally(()=>{pending=undefined;});
 return pending;
}
