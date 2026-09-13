import type { ParsedMatch } from "./replay.js";
import type { MatchApi } from "./opendota.js";
import { HERO_CATALOG } from "./hero-catalog.js";
const normalize=(hero:string)=>hero.replace(/^npc_dota_hero_/,"").replace(/_/g,"").toLowerCase();
/** Some older demo headers have match_id=0. Require independent API roster evidence. */
export function assertReplayIdentity(parsed:ParsedMatch,id:number,api?:MatchApi):void {
  if(!Number.isSafeInteger(id)||id<=0||!Array.isArray(parsed.players)||!parsed.players.length)throw Error("Invalid replay identity");
  if(parsed.match_id===id)return;
  if(parsed.match_id!==0)throw Error(`Replay match ID mismatch: ${parsed.match_id} != ${id}`);
  if(!api||api.match_id!==id||api.players.length!==parsed.players.length)throw Error("Missing replay ID: no independent roster evidence");
  const seen=new Set<string>();
  for(const player of api.players){
    if(!Number.isSafeInteger(player.player_slot)||!((player.player_slot>=0&&player.player_slot<=4)||(player.player_slot>=128&&player.player_slot<=132)))throw Error("Ambiguous API side");
    const hero=HERO_CATALOG.find(h=>h.id===player.hero_id)?.name;
    if(!hero||seen.has(normalize(hero)))throw Error("Ambiguous API roster");
    seen.add(normalize(hero));
    const candidate=parsed.players.find(p=>normalize(p.hero)===normalize(hero));
    if(!candidate||candidate.team!==((player.player_slot<128)?"radiant":"dire"))throw Error("Missing replay ID: hero/side mismatch");
    if(player.account_id&&candidate.steam_id!==String(BigInt(player.account_id)+76561197960265728n))throw Error("Missing replay ID: account mismatch");
  }
  parsed.match_id=id;
}
