import type {LiveMatch} from './live-match.js';

/** Steam can return HTTP 400 temporarily even for an ongoing valid match. */
export async function fetchRealtimeDetails(server:string,matchId:string,key:string,request:typeof fetch=fetch,pause:(ms:number)=>Promise<void>=ms=>new Promise(resolve=>setTimeout(resolve,ms))):Promise<unknown>{
 const url=new URL('https://api.steampowered.com/IDOTA2MatchStats_570/GetRealtimeStats/v1/');
 url.searchParams.set('key',key);url.searchParams.set('server_steam_id',server);
 let status:number|undefined;
 for(let attempt=0;attempt<3;attempt++){
  if(attempt)await pause(attempt*750);
  try{
   const response=await request(url,{signal:AbortSignal.timeout(8000)});status=response.status;
   if(response.ok){
    const data=await response.json() as {match?:{match_id?:unknown};teams?:unknown[]};
    if(String(data.match?.match_id)===matchId&&Array.isArray(data.teams)&&data.teams.length===2)return data;
   }else{
    await response.body?.cancel();
    if(![400,408,429].includes(status)&&status<500)break;
   }
  }catch{/* Do not log request URLs, API keys or transport exceptions. */}
 }
 console.warn('[LIVE MATCH] Realtime details unavailable',JSON.stringify({match:matchId,http:status}));
 return undefined;
}
/** Keep all fields from one timestamp; never combine old KDA with a newer score. */
export function preferDetailedSnapshot(current:LiveMatch|null,previous:LiveMatch|null,now=Date.now()):LiveMatch|null{
 if(current&&!current.detailed&&previous?.detailed&&previous.matchId===current.matchId&&now-previous.updatedAt<90_000){
  return {...previous,kind:current.kind,stackCount:current.stackCount};
 }
 return current;
}
