import {verifiedReplayScoreboard} from "../replay-scoreboard.js";
import type {ParsedMatch} from '../replay.js';
import type {MatchPlayerInsights} from '../match-insights.js';
import type {MatchApi,MatchApiPlayer} from '../opendota.js';
import {HERO_CATALOG} from '../hero-catalog.js';
export function rosterAccount(steam:string):number|null{try{const id=Number(BigInt(steam)-76561197960265728n);return Number.isSafeInteger(id)&&id>0&&id<=4294967295?id:null;}catch{return null;}}
/** Official KDA only, matched by hero, side and known public account. */
export function resolveOfficialRosterPlayer(m:ParsedMatch,p:MatchPlayerInsights,api?:MatchApi,partial?:MatchApiPlayer[]):MatchApiPlayer|undefined{
 const raw=m.players.filter(q=>q.steam_id===p.steamId&&q.hero===p.hero&&q.team===p.team);
 if(raw.length===1){const s=verifiedReplayScoreboard(raw[0]);if(s)return {account_id:rosterAccount(p.steamId)??undefined,hero_id:s.hero_id,player_slot:(p.team==='radiant'?0:128)+s.team_slot,kills:s.kills,deaths:s.deaths,assists:s.assists,kda_source:'replay-scoreboard'} as MatchApiPlayer&{kda_source:'replay-scoreboard'};}
 const account=rosterAccount(p.steamId),candidates=(partial??(api?.match_id===m.match_id?api.players:[])).filter(q=>HERO_CATALOG.find(h=>h.id===q.hero_id)?.localized_name===p.heroLabel&&Number.isInteger(q.player_slot)&&(q.player_slot<128)===(p.team==='radiant')&&(!q.account_id||q.account_id===4294967295||account===null||q.account_id===account)&&[q.kills,q.deaths,q.assists].every(v=>Number.isInteger(v)&&v>=0));
 return candidates.length===1?candidates[0]:undefined;
}
