import type { ApmStore } from "./apm-store.js";
import { heroName } from "./player-profile.js";

// Local labels keep profile rendering independent of the network-only items API.
const KEY_ITEMS: Record<string,string> = {
  power_treads:"Power Treads", phase_boots:"Phase Boots", arcane_boots:"Arcane Boots", tranquil_boots:"Tranquil Boots", travel_boots:"Boots of Travel", travel_boots_2:"Boots of Travel 2", boots_of_bearing:"Boots of Bearing", guardian_greaves:"Guardian Greaves",
  blink:"Blink Dagger", overwhelming_blink:"Overwhelming Blink", swift_blink:"Swift Blink", arcane_blink:"Arcane Blink", force_staff:"Force Staff", hurricane_pike:"Hurricane Pike", glimmer_cape:"Glimmer Cape", black_king_bar:"Black King Bar", ultimate_scepter:"Aghanim’s Scepter", ultimate_scepter_2:"Aghanim’s Blessing", aghanims_shard:"Aghanim’s Shard",
  manta:"Manta Style", bfury:"Battle Fury", radiance:"Radiance", butterfly:"Butterfly", satanic:"Satanic", skadi:"Eye of Skadi", refresher:"Refresher Orb", sheepstick:"Scythe of Vyse", heart:"Heart of Tarrasque", greater_crit:"Daedalus", lesser_crit:"Crystalys", desolator:"Desolator", monkey_king_bar:"Monkey King Bar", mjollnir:"Mjollnir", maelstrom:"Maelstrom", gleipnir:"Gleipnir", bloodthorn:"Bloodthorn", orchid:"Orchid Malevolence", nullifier:"Nullifier", abyssal_blade:"Abyssal Blade", basher:"Skull Basher",
  cyclone:"Eul’s Scepter", wind_waker:"Wind Waker", aeon_disk:"Aeon Disk", lotus_orb:"Lotus Orb", sphere:"Linken’s Sphere", pipe:"Pipe of Insight", crimson_guard:"Crimson Guard", assault:"Assault Cuirass", shivas_guard:"Shiva’s Guard", vladmir:"Vladmir’s Offering", mekansm:"Mekansm", holy_locket:"Holy Locket", solar_crest:"Solar Crest", pavise:"Pavise", aether_lens:"Aether Lens", octarine_core:"Octarine Core", bloodstone:"Bloodstone", ethereal_blade:"Ethereal Blade", kaya_and_sange:"Kaya and Sange", sange_and_yasha:"Sange and Yasha", yasha_and_kaya:"Yasha and Kaya", silver_edge:"Silver Edge", invis_sword:"Shadow Blade", armlet:"Armlet of Mordiggian", echo_sabre:"Echo Sabre", harpoon:"Harpoon", falcon_blade:"Falcon Blade", meteor_hammer:"Meteor Hammer", dragon_lance:"Dragon Lance", rod_of_atos:"Rod of Atos", rapier:"Divine Rapier", moon_shard:"Moon Shard", dagon:"Dagon", dagon_2:"Dagon 2", dagon_3:"Dagon 3", dagon_4:"Dagon 4", dagon_5:"Dagon 5"
};
export interface EconomyPurchase { item:string; label:string; seconds:number; key:boolean }
export interface ProfileEconomy {
  matchId:number; account:number; hero:string; durationSeconds:number;
  networth:{minute:number;value:number}[];
  checkpoints:{minute:number;value:number|null}[];
  purchases:EconomyPurchase[];
}
export function buildEconomy(store:ApmStore,account:number,matchId:number):ProfileEconomy|null {
  if(!Number.isSafeInteger(account)||account<=0||!Number.isSafeInteger(matchId)||matchId<=0)return null;
  const match=store.replay(matchId);
  const player=match?.players.find(p=>p.steam_id===String(BigInt(account)+76561197960265728n));
  if(!match||!player)return null;
  const durationSeconds=Number.isFinite(match.duration_min)?Math.max(0,Math.round(match.duration_min*60)):0;
  const networth=(Array.isArray(player.networth_by_minute)?player.networth_by_minute:[])
    .flatMap((value,i)=>Number.isFinite(value)&&value>=0&&(i+1)*60<=durationSeconds?[{minute:i+1,value}]:[]);
  const purchases=(Array.isArray(player.item_timings)?player.item_timings:[]).flatMap(p=>{
    if(typeof p.item!=="string"||!Number.isFinite(p.min)||p.min<0||p.min*60>durationSeconds)return [];
    const item=p.item.replace(/^item_/,"");
    return [{item,label:Object.hasOwn(KEY_ITEMS,item)?KEY_ITEMS[item]:item.replace(/_/g," ").replace(/^./,c=>c.toUpperCase()),seconds:Math.round(p.min*60),key:Object.hasOwn(KEY_ITEMS,item)}];
  }).sort((a,b)=>a.seconds-b.seconds);
  return {matchId,account,hero:heroName(player.hero),durationSeconds,networth,
    checkpoints:[10,20,30].map(minute=>({minute,value:networth.find(p=>p.minute===minute)?.value??null})),purchases};
}
