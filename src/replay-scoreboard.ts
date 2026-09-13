import type {ParsedMatch,ParsedPlayer,ReplayScoreboard} from './replay.js';
import {HERO_CATALOG} from './hero-catalog.js';
/** Validate optional persisted data again at the trust boundary; zero is a valid score. */
export function verifiedReplayScoreboard(p:ParsedPlayer):ReplayScoreboard|undefined {
 try{const account=BigInt(p.steam_id)-76561197960265728n;if(account<=0n||account>4294967295n)return;}catch{return;}
 const s=p.replay_scoreboard;if(!s||s.version!=='player-resource-v1'||s.source!=='CDOTA_PlayerResource'||s.complete!==true||s.end_state_observed!==true)return;
 if(![s.resource_slot,s.team_slot,s.hero_id,s.kills,s.deaths,s.assists].every(v=>Number.isSafeInteger(v)&&v>=0)||s.resource_slot>=64||s.team_slot>4||s.hero_id===0)return;
 const normalize=(s:string)=>s.replace(/^npc_dota_hero_/,'').replace(/_/g,'');
 if(!HERO_CATALOG.some(h=>h.id===s.hero_id&&normalize(h.name)===normalize(p.hero))||!['radiant','dire'].includes(p.team))return;
 return s;
}
/** Display/analysis projection only: stored combat-log counters remain untouched. */
export function withReplayScoreboards(m:ParsedMatch):ParsedMatch {
 return {...m,players:m.players.map(p=>{const s=verifiedReplayScoreboard(p);return s?{...p,kills:s.kills,deaths:s.deaths,assists:s.assists,kda_source:'replay-scoreboard' as const}:p;})};
}
/** Final KDA requires an explicit trusted source; a combat recount is not a fallback. */
export function finalPlayerKda(p:ParsedPlayer):[number,number,number]|undefined {
 const s=verifiedReplayScoreboard(p);if(s)return [s.kills,s.deaths,s.assists];
 if(p.kda_source==='opendota'&&[p.kills,p.deaths,p.assists].every(v=>Number.isSafeInteger(v)&&v>=0))return [p.kills,p.deaths,p.assists];
}
