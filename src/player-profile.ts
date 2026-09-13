import { readFileSync, statSync } from "node:fs";
import path from "node:path";
import { PLAYERS } from "./config.js";
import { ApmStore, getApmStore, type ApmRecord } from "./apm-store.js";
import { HERO_CATALOG } from "./hero-catalog.js";
import { groupActions } from "./action-counts.js";
import type { FeedMatch } from "./web/feed.js";
export type Period = "7" | "30" | "all";
export const periodOf = (s: string | null): Period => s === "7" || s === "30" ? s : "all";
export const heroName = (name: string) => HERO_CATALOG.find(h => h.name.replace(/_/g, "") === (name.startsWith("npc_dota_hero_") ? name : "npc_dota_hero_"+name).replace(/_/g, ""))?.localized_name ?? name;
export interface ProfileMatch {
  id:number; start:number|null; duration:number; hero:string; win:boolean|null;
  kda?:[number,number,number]; kdaSource?:string; apm?:ApmRecord; teammates:number[]; allyHeroes?:string[]; enemyHeroes?:string[];
}
export function importFeed(store: ApmStore, matches: FeedMatch[]) {
  for (const player of PLAYERS) {
    store.saveResults(player.steamId, matches.flatMap(m => {
      const p = m.ours.find(p => p.steamId === player.steamId);
      return p ? [{match_id:m.matchId, start_time:m.startTime, duration:m.duration, hero_id:p.heroId,
        kills:p.kills, deaths:p.deaths, assists:p.assists, radiant_win:p.win, player_slot:0}] : [];
    }), "feed");
  }
}
export function buildProfile(store:ApmStore, account:number, period:Period, now=Date.now(), replays=store.profileRosters()) {
  const rows = new Map<number, ProfileMatch>();
  const validDate=(value:number|null|undefined):number|null=>typeof value === "number" && Number.isFinite(value) && value>0 ? value : null;
  const isSide=(value:string|undefined)=>value === "radiant" || value === "dire";
  const steam = String(BigInt(account)+76561197960265728n);
  const ours = new Map(PLAYERS.map(p => [String(BigInt(p.steamId)+76561197960265728n),p.steamId]));
  for (const m of replays) {
    const p = m.players.find(p => p.steam_id === steam);
    if (!p) continue;
    rows.set(m.match_id, {id:m.match_id,start:validDate(m.start_time),duration:m.duration_min*60,hero:heroName(p.hero),
      win:isSide(p.team) && isSide(m.winner) ? p.team === m.winner : null,
      allyHeroes:isSide(p.team)?m.players.filter(x=>x.team===p.team&&x.steam_id!==steam).map(x=>heroName(x.hero)):undefined,
      enemyHeroes:isSide(p.team)?m.players.filter(x=>isSide(x.team)&&x.team!==p.team).map(x=>heroName(x.hero)):undefined,
      teammates:isSide(p.team)?[...new Set(m.players.filter(x=>x.team===p.team&&x.steam_id!==steam&&ours.has(x.steam_id)).map(x=>ours.get(x.steam_id)!))]:[]});
  }
  const results = store.results(account);
  for (const m of results) {
    const old = rows.get(m.match_id);
    // Feed snapshots encode own result, not actual side. Use them only for outcome/KDA.
    rows.set(m.match_id, {...old, id:m.match_id,start:validDate(m.start_time)??old?.start??null,duration:m.duration,
      hero:HERO_CATALOG.find(h=>h.id===m.hero_id)?.localized_name ?? old?.hero ?? "Неизвестный герой",
      win:(m.player_slot<128)===m.radiant_win,kda:[m.kills,m.deaths,m.assists],
      kdaSource:m.result_source === "opendota" ? "OpenDota" : "сохранённая сводка", teammates:old?.teammates ?? []});
  }
  for (const a of store.history(account)) {
    const old=rows.get(a.match_id);
    rows.set(a.match_id,{...old,id:a.match_id,start:old?.start??validDate(a.start_time),duration:old?.duration??a.duration_seconds,
      hero:old?.hero??heroName(a.hero),win:old?.win??null,teammates:old?.teammates??[],apm:a});
  }
  const cutoff=period==="all"?0:now/1000-Number(period)*86400;
  const matches=[...rows.values()].filter(m=>period==="all" || (m.start!==null && m.start>=cutoff && m.start<=now/1000))
    .sort((a,b)=>(b.start??0)-(a.start??0)||b.id-a.id);
  const measured=matches.filter(m=>m.apm!==undefined);
  const detailed=measured.filter(m=>m.apm?.action_counts!==undefined);
  const raw:Record<string,number>={};
  for (const m of detailed) for (const [k,n] of Object.entries(m.apm!.action_counts!)) raw[k]=(raw[k]??0)+n;
  const groups=groupActions(raw), total=groups.reduce((s,g)=>s+g.count,0);
  const known=matches.filter(m=>m.win!==null), wins=known.filter(m=>m.win).length;
  const heroes=[...new Set(matches.map(m=>m.hero))].map(hero=> {
    const ms=matches.filter(m=>m.hero===hero), a=ms.filter(m=>m.apm);
    return {hero,games:ms.length,wins:ms.filter(m=>m.win).length,known:ms.filter(m=>m.win!==null).length,
      apm:a.length?Math.round(a.reduce((s,m)=>s+m.apm!.apm,0)/a.length):null,apmGames:a.length};
  }).sort((a,b)=>b.games-a.games||b.wins-a.wins||a.hero.localeCompare(b.hero));
  const partners=PLAYERS.filter(p=>p.steamId!==account).map(p=>{
    const ms=matches.filter(m=>m.teammates.includes(p.steamId));
    return {id:p.steamId,name:p.dotaName,games:ms.length,wins:ms.filter(m=>m.win).length,known:ms.filter(m=>m.win!==null).length};
  }).filter(p=>p.games).sort((a,b)=>b.games-a.games||a.id-b.id);
  const hours=[0,0,0,0];
  for (const m of matches) if(m.start!==null) hours[Math.floor(new Date((m.start+3*3600)*1000).getUTCHours()/6)]++;
  const values=measured.map(m=>m.apm!.apm).sort((a,b)=>a-b);
  const median=values.length ? Math.round((values[Math.floor((values.length-1)/2)]+values[Math.floor(values.length/2)])/2) : null;
  return {account,period,matches,known:known.length,wins,measured,detailed,raw,groups,total,heroes,partners,hours,median,
    avgApm:measured.length?Math.round(measured.reduce((s,m)=>s+m.apm!.apm,0)/measured.length):null,
    hoursPlayed:matches.reduce((s,m)=>s+m.duration,0)/3600,
    peak:measured.reduce<ProfileMatch|undefined>((best,m)=>!best||m.apm!.apm>best.apm!.apm?m:best,undefined),
    longest:matches.reduce<ProfileMatch|undefined>((best,m)=>!best||m.duration>best.duration?m:best,undefined),
    dated:matches.filter(m=>m.start!==null).length,
    teammateCoverage:matches.filter(m=>m.allyHeroes!==undefined).length,
  };
}
export type PlayerProfile = ReturnType<typeof buildProfile>;
let cached:{at:number;period:Period;profiles:PlayerProfile[]}|undefined;
let feedMtime=0;
export function loadProfiles(period:Period): PlayerProfile[] {
  if(cached && cached.period===period && Date.now()-cached.at<15000) return cached.profiles;
  const store=getApmStore();
  const file=path.join(process.env.DATA_DIR||"data","feed.json");
  try { const mt=statSync(file).mtimeMs; if(mt!==feedMtime) {
    const feed=JSON.parse(readFileSync(file,"utf8")); if(Array.isArray(feed.matches)) importFeed(store,feed.matches); feedMtime=mt;
  }} catch { /* Profiles still work from SQLite when the feed file is absent. */ }
  const replays=store.profileRosters();
  const profiles=PLAYERS.map(p=>buildProfile(store,p.steamId,period,Date.now(),replays));
  cached={at:Date.now(),period,profiles}; return profiles;
}
