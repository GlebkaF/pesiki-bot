import SteamUser from 'steam-user';
import {readFile} from 'node:fs/promises';
import {join} from 'node:path';
import {randomInt} from 'node:crypto';
import {observerProtocol} from './dota-observer-protocol.js';
import {withTimeout} from './steam-presence.js';

let client:SteamUser|undefined;
let connecting:Promise<SteamUser>|undefined;
let retryAfter=0;
function gc(session:SteamUser,type:number,send:()=>void):Promise<Buffer>{
 return new Promise((resolve,reject)=>{
  const cleanup=()=>{clearTimeout(timer);session.off('receivedFromGC',receive);session.off('disconnected',failed);session.off('error',failed);};
  const failed=()=>{cleanup();reject(new Error('OBSERVER_UNAVAILABLE'));};
  const receive=(app:number,message:number,payload:Buffer)=>{if(app===570&&message===type){cleanup();resolve(payload);}};
  const timer=setTimeout(failed,15_000);
  session.on('receivedFromGC',receive);session.once('disconnected',failed);session.once('error',failed);
  try{send();}catch{failed();}
 });
}
async function connect():Promise<SteamUser>{
 if(connecting)return connecting;
 if(client?.steamID)return client;
 if(Date.now()<retryAfter)throw new Error('OBSERVER_COOLDOWN');
 connecting=(async()=>{
  const data=process.env.DATA_DIR||'data';
  const token=(await readFile(process.env.STEAM_OBSERVER_TOKEN_FILE||join(data,'steam-observer/refresh-token'),'utf8')).trim();
  const primary=(await readFile(process.env.STEAM_REFRESH_TOKEN_FILE||join(data,'steam/refresh-token'),'utf8')).trim();
  const subject=(value:string)=>JSON.parse(Buffer.from(value.split('.')[1],'base64url').toString()).sub;
  if(!subject(token)||subject(token)===subject(primary))throw new Error('SEPARATE_ACCOUNT_REQUIRED');
  const session=new SteamUser({autoRelogin:false,dataDirectory:null,webCompatibilityMode:true,renewRefreshTokens:false});
  const stop=()=>{if(client===session)client=undefined;retryAfter=Date.now()+60_000;};
  session.on('error',stop);session.on('disconnected',stop);
  // If this dedicated account is opened elsewhere, yield instead of taking its game session.
  session.on('playingState',(blocked:boolean)=>{if(blocked){stop();session.logOff();}});
  let helloTimer:ReturnType<typeof setInterval>|undefined;
  try{
   const ready=new Promise<void>((resolve,reject)=>{session.once('loggedOn',()=>resolve());session.once('error',()=>reject(new Error('OBSERVER_LOGIN_FAILED')));});
   session.logOn({refreshToken:token,logonID:randomInt(1,0x7fffffff),machineName:'Pesiki DotaTV'});
   await withTimeout(ready,15_000);
   await new Promise(resolve=>setTimeout(resolve,500));
   if(!session.steamID||(session as unknown as {playingState:{blocked:boolean}}).playingState.blocked)throw new Error('OBSERVER_ACCOUNT_BUSY');
   const hello=()=>session.sendToGC(570,4006,{},Buffer.from([0x08,0x01,0x38,0x01]));
   await gc(session,4004,()=>{session.gamesPlayed([570]);hello();helloTimer=setInterval(hello,3000);});
   client=session;
   console.log('[DOTA OBSERVER] Connected');
   return session;
  }catch{session.logOff();throw new Error('OBSERVER_UNAVAILABLE');}
  finally{clearInterval(helloTimer);}
 })();
 try{return await connecting;}catch{retryAfter=Date.now()+60_000;throw new Error('OBSERVER_UNAVAILABLE');}finally{connecting=undefined;}
}
export interface TVGame{
 lobby_id:string;server_steam_id?:string;match_id?:string;game_time?:number;delay?:number;
 last_update_time?:number;deactivate_time?:number;radiant_score?:number;dire_score?:number;league_id?:number;is_watch_eligible?:boolean;
 players?:Array<{account_id?:number;hero_id?:number;team?:number}>;
}
export async function findObserverGames(lobbies:string[]):Promise<TVGame[]>{
 const session=await connect();
 const request=observerProtocol.lookupType('CMsgClientToGCFindTopSourceTVGames');
 const response=observerProtocol.lookupType('CMsgGCToClientFindTopSourceTVGamesResponse');
 try {
 const bytes=await gc(session,8010,()=>session.sendToGC(570,8009,{},Buffer.from(request.encode(request.fromObject(lobbies.length?{lobby_ids:lobbies}:{start_game:0})).finish())));
 const result=response.toObject(response.decode(bytes),{longs:String});
 return (result.game_list??[]) as TVGame[];
 }catch{if(client===session)client=undefined;session.logOff();retryAfter=Date.now()+60_000;throw new Error('OBSERVER_UNAVAILABLE');}
}
