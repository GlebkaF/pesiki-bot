/** Permanent APM history, independent of the replay JSON cache and its TTL. */
import { validActionCounts } from "./action-counts.js";
import type { RecentMatch, MatchApi, MatchApiPlayer } from "./opendota.js";
import Database from "better-sqlite3";
import { mkdirSync } from "node:fs";
import path from "node:path";
import type { ParsedMatch } from "./replay.js";
import { HERO_CATALOG } from "./hero-catalog.js";

export const APM_VERSION = "spectator-orders-v1";
const analyticsRank=(v:unknown)=>v==="combat-log-v2"?2:v==="combat-log-v1"?1:0;
const parserRank=(v:unknown)=>typeof v==="string"?Number(/^pesiki-replay-v(\d+)$/.exec(v)?.[1]??0):0;
export interface ProfileRoster {
  match_id:number; start_time?:number; duration_min:number; winner:string;
  players:{steam_id:string;hero:string;team:string}[];
}
export type SavedResult = RecentMatch & { result_source: "opendota" | "feed" };
export interface ApmRecord {
  match_id: number; account_id: number; hero: string; start_time: number | null;
  action_counts?: Record<string, number>;
  actions: number; duration_seconds: number; apm: number; version: string;
}
export class ApmStore {
  private db: Database.Database;
  constructor(filename: string) {
    if (filename !== ":memory:") mkdirSync(path.dirname(filename), { recursive: true });
    this.db = new Database(filename);
    this.db.pragma("journal_mode = WAL");
    this.db.pragma("busy_timeout = 5000");
    this.db.exec(`CREATE TABLE IF NOT EXISTS player_match_apm (
      match_id INTEGER NOT NULL, account_id INTEGER NOT NULL, hero TEXT NOT NULL,
      start_time INTEGER, actions INTEGER NOT NULL CHECK(actions >= 0),
      duration_seconds REAL NOT NULL CHECK(duration_seconds > 0),
      apm INTEGER NOT NULL CHECK(apm >= 0), version TEXT NOT NULL,
      parsed_at INTEGER NOT NULL,
      PRIMARY KEY(match_id, account_id, version)
    );
    CREATE INDEX IF NOT EXISTS apm_player_time ON player_match_apm(account_id, start_time);
    CREATE TABLE IF NOT EXISTS parsed_replays (
      match_id INTEGER PRIMARY KEY, start_time INTEGER, parsed_at INTEGER NOT NULL, payload_json TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS match_api_snapshots (match_id INTEGER PRIMARY KEY, fetched_at INTEGER NOT NULL, payload_json TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS profile_rosters (match_id INTEGER PRIMARY KEY, payload_json TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS player_match_actions (match_id INTEGER, account_id INTEGER, version TEXT, counts_json TEXT NOT NULL, PRIMARY KEY(match_id,account_id,version));
    CREATE TABLE IF NOT EXISTS player_match_results (match_id INTEGER, account_id INTEGER, payload_json TEXT NOT NULL, PRIMARY KEY(match_id,account_id));`);
    // One-time compact projection of existing parses; opening a profile never loads combat logs.
    this.db.exec(`INSERT OR IGNORE INTO profile_rosters(match_id,payload_json)
      SELECT r.match_id, json_object('match_id',r.match_id,'start_time',r.start_time,
        'duration_min',json_extract(r.payload_json,'$.duration_min'),'winner',json_extract(r.payload_json,'$.winner'),
        'players',json_group_array(json_object('steam_id',json_extract(p.value,'$.steam_id'),
          'hero',json_extract(p.value,'$.hero'),'team',json_extract(p.value,'$.team'))))
      FROM parsed_replays r, json_each(r.payload_json,'$.players') p
      WHERE NOT EXISTS (SELECT 1 FROM profile_rosters s WHERE s.match_id=r.match_id) GROUP BY r.match_id`);
  }
  saveReplay(match: ParsedMatch): boolean {
    return this.db.transaction(()=>{
    if (!Number.isSafeInteger(match.match_id) || match.match_id <= 0 || !Array.isArray(match.players) || !match.players.length) return false;
    const existing = this.replay(match.match_id);
    // A legacy cache must not overwrite a newer, richer parse.
    if (existing?.apm_version && !match.apm_version) return false;
    if (existing && (analyticsRank(existing.analytics_version)>analyticsRank(match.analytics_version) || parserRank(existing.parser_version)>parserRank(match.parser_version))) return false;
    const stored = {...match, analytics_version:match.analytics_version??existing?.analytics_version, start_time: match.start_time ?? existing?.start_time, players: match.players.map(p => {
      const old = existing?.players.find(x => x.steam_id === p.steam_id && x.hero===p.hero && x.team===p.team);
      const counts = validActionCounts(p.action_counts, p.actions ?? -1) ? p.action_counts :
        old?.actions === p.actions && validActionCounts(old?.action_counts,p.actions ?? -1) ? old!.action_counts : undefined;
      return {...p,action_counts:counts,combat_details:p.combat_details??old?.combat_details};
    })};
    this.db.prepare(`INSERT INTO parsed_replays(match_id,start_time,parsed_at,payload_json) VALUES(?,?,?,?)
      ON CONFLICT(match_id) DO UPDATE SET start_time=excluded.start_time, parsed_at=excluded.parsed_at, payload_json=excluded.payload_json
      WHERE parsed_replays.payload_json != excluded.payload_json`)
      .run(match.match_id, stored.start_time ?? null, Date.now(), JSON.stringify(stored));
    const roster:ProfileRoster={match_id:stored.match_id,start_time:stored.start_time,duration_min:stored.duration_min,winner:stored.winner,
      players:stored.players.map(p=>({steam_id:p.steam_id,hero:p.hero,team:p.team}))};
    this.db.prepare(`INSERT INTO profile_rosters VALUES(?,?) ON CONFLICT(match_id) DO UPDATE SET payload_json=excluded.payload_json
      WHERE profile_rosters.payload_json != excluded.payload_json`).run(match.match_id,JSON.stringify(roster));
    return true;
    }).immediate();
  }
  replay(matchId: number): ParsedMatch | undefined {
    const row = this.db.prepare("SELECT payload_json FROM parsed_replays WHERE match_id = ?").get(matchId) as {payload_json:string} | undefined;
    return row ? JSON.parse(row.payload_json) as ParsedMatch : undefined;
  }
  save(match: ParsedMatch): void {
    this.db.transaction(()=>{
    if(!this.saveReplay(match))return;
    if (match.apm_version !== APM_VERSION || !Number.isSafeInteger(match.match_id) || match.match_id <= 0) return;
    const duration = match.apm_duration_seconds;
    if (!duration || !Number.isFinite(duration) || duration <= 0) return;
    const insert = this.db.prepare(`INSERT INTO player_match_apm
      (match_id, account_id, hero, start_time, actions, duration_seconds, apm, version, parsed_at)
      VALUES (@match_id, @account_id, @hero, @start_time, @actions, @duration_seconds, @apm, @version, @parsed_at)
      ON CONFLICT(match_id, account_id, version) DO UPDATE SET
      hero=excluded.hero, start_time=COALESCE(excluded.start_time, player_match_apm.start_time),
      actions=excluded.actions, duration_seconds=excluded.duration_seconds, apm=excluded.apm, parsed_at=excluded.parsed_at
      WHERE player_match_apm.actions != excluded.actions OR player_match_apm.apm != excluded.apm
      OR player_match_apm.duration_seconds != excluded.duration_seconds OR player_match_apm.hero != excluded.hero
      OR (excluded.start_time IS NOT NULL AND player_match_apm.start_time IS NOT excluded.start_time)`);
    this.db.transaction(() => {
      for (const p of match.players) {
        if (!/^\d+$/.test(p.steam_id)) continue;
        const account = Number(BigInt(p.steam_id) - 76561197960265728n);
        if (!Number.isSafeInteger(account) || account <= 0 || account > 4294967295) continue;
        if (!Number.isSafeInteger(p.actions) || p.actions! < 0 || !Number.isSafeInteger(p.actions_per_min) ||
            p.actions_per_min !== Math.floor(p.actions! * 60 / duration)) continue;
        insert.run({ match_id: match.match_id, account_id: account, hero: p.hero,
          start_time: match.start_time && match.start_time > 0 ? match.start_time : null,
          actions: p.actions, duration_seconds: duration, apm: p.actions_per_min,
          version: APM_VERSION, parsed_at: Date.now() });
        if (validActionCounts(p.action_counts, p.actions!)) this.db.prepare(`INSERT INTO player_match_actions VALUES(?,?,?,?)
          ON CONFLICT(match_id,account_id,version) DO UPDATE SET counts_json=excluded.counts_json`).run(match.match_id, account, APM_VERSION, JSON.stringify(p.action_counts));
      }
    })();
    }).immediate();
  }
  /** Add offline parser detail without overwriting concurrent official-stat enrichment. */
  mergeReplayActions(parsed: ParsedMatch): void {
    if (!Number.isSafeInteger(parsed.match_id) || parsed.match_id<=0 || !Array.isArray(parsed.players) || !parsed.players.length || parsed.apm_version !== APM_VERSION || !Number.isFinite(parsed.apm_duration_seconds) || !parsed.apm_duration_seconds || parsed.apm_duration_seconds <= 0 || !parsed.players.every(p =>
      Number.isSafeInteger(p.actions) && p.actions_per_min === Math.floor(p.actions! * 60 / parsed.apm_duration_seconds!) && validActionCounts(p.action_counts,p.actions!))) throw Error("Invalid action breakdown");
    this.db.transaction(() => {
      const latest=this.replay(parsed.match_id);
      if (!latest) { this.save(parsed); return; }
      if (latest.players.length !== parsed.players.length) throw Error("Roster changed");
      if (latest.apm_version === APM_VERSION && latest.apm_duration_seconds !== undefined && latest.apm_duration_seconds !== parsed.apm_duration_seconds)
        throw Error("APM duration changed; manual inspection required");
      const used=new Set<number>();
      const players=latest.players.map(p => {
        const index=parsed.players.findIndex((n,i)=>!used.has(i) && n.steam_id===p.steam_id && n.hero===p.hero && n.team===p.team);
        if (index<0) throw Error("Roster changed");
        used.add(index);
        const next=parsed.players[index];
        if (p.actions!==undefined && (p.actions!==next.actions || p.actions_per_min!==next.actions_per_min))
          throw Error("APM changed; manual inspection required");
        return {...p,actions:next.actions,actions_per_min:next.actions_per_min,action_counts:next.action_counts};
      });
      this.save({...latest,players,start_time:latest.start_time ?? parsed.start_time,apm_version:parsed.apm_version,apm_duration_seconds:parsed.apm_duration_seconds});
    }).immediate();
  }
  /** Upgrade analytics while preserving the latest official enrichment and all APM values. */
  mergeReplayAnalytics(parsed: ParsedMatch): void {
    if (!analyticsRank(parsed.analytics_version) || !Array.isArray(parsed.players) || !parsed.players.length || !parsed.players.every(p=>p.combat_details?.version===parsed.analytics_version)) throw Error("Missing replay analytics");
    this.db.transaction(()=>{
      const previous=this.replay(parsed.match_id);
      if(previous&&(analyticsRank(previous.analytics_version)>analyticsRank(parsed.analytics_version)||parserRank(previous.parser_version)>parserRank(parsed.parser_version)))throw Error("Analytics downgrade rejected");
      this.mergeReplayActions(parsed);
      const latest=this.replay(parsed.match_id)!;
      this.saveReplay({...latest,analytics_version:parsed.analytics_version,parser_version:parsed.parser_version,
        players:latest.players.map(p=>({...p,combat_details:parsed.players.find(q=>q.steam_id===p.steam_id&&q.hero===p.hero&&q.team===p.team)!.combat_details}))});
    }).immediate();
  }
  economyHistory(accountId:number): {matchId:number;start:number|null;hero:string;mode:string;duration:number;items:string;networth10:number|null;networth20:number|null}[] {
    const steam=String(BigInt(accountId)+76561197960265728n);
    return this.db.prepare(`SELECT r.match_id matchId,r.start_time start,json_extract(p.value,'$.hero') hero,
      json_extract(r.payload_json,'$.game_mode') mode,json_extract(r.payload_json,'$.duration_min') duration,
      coalesce(json_extract(p.value,'$.item_timings'),'[]') items,
      json_extract(p.value,'$.networth_by_minute[9]') networth10,json_extract(p.value,'$.networth_by_minute[19]') networth20
      FROM parsed_replays r,json_each(r.payload_json,'$.players') p WHERE json_extract(p.value,'$.steam_id')=?
      ORDER BY r.start_time DESC,r.match_id DESC LIMIT 250`).all(steam) as ReturnType<ApmStore["economyHistory"]>;
  }
  saveResults(accountId: number, matches: RecentMatch[], source: "opendota" | "feed" = "opendota"): void {
    const insert = this.db.prepare(`INSERT INTO player_match_results VALUES(?,?,?) ON CONFLICT(match_id,account_id) DO UPDATE SET payload_json=excluded.payload_json
      WHERE player_match_results.payload_json != excluded.payload_json AND (json_extract(excluded.payload_json, '$.result_source') = 'opendota' OR json_extract(player_match_results.payload_json, '$.result_source') != 'opendota')`);
    this.db.transaction(() => {
      for (const m of matches) {
        if (!Number.isSafeInteger(m.match_id) || m.match_id <= 0 || !Number.isFinite(m.start_time) || m.start_time <= 0 ||
            !Number.isFinite(m.duration) || m.duration <= 0 || typeof m.radiant_win !== "boolean" ||
            ![m.kills,m.deaths,m.assists,m.hero_id,m.player_slot].every(n => Number.isSafeInteger(n) && n >= 0)) continue;
        insert.run(m.match_id,accountId,JSON.stringify({...m,result_source:source}));
      }
    })();
  }
  results(accountId: number): SavedResult[] {
    return (this.db.prepare("SELECT payload_json FROM player_match_results WHERE account_id=?").all(accountId) as {payload_json:string}[]).map(r => JSON.parse(r.payload_json));
  }
  saveMatchApi(data: MatchApi): void {
    if (!Number.isSafeInteger(data.match_id) || data.match_id<=0 || !Array.isArray(data.players) || !data.players.length) return;
    this.db.prepare(`INSERT INTO match_api_snapshots VALUES(?,?,?) ON CONFLICT(match_id) DO UPDATE SET fetched_at=excluded.fetched_at,payload_json=excluded.payload_json`)
      .run(data.match_id,Date.now(),JSON.stringify(data));
    if (Number.isFinite(data.start_time) && data.start_time>0) this.db.transaction(()=>{
      const old=this.replay(data.match_id);
      if(old && !old.start_time) this.save({...old,start_time:data.start_time});
    }).immediate();
  }
  matchApi(id:number): MatchApi | undefined {
    const row=this.db.prepare("SELECT payload_json FROM match_api_snapshots WHERE match_id=?").get(id) as {payload_json:string}|undefined;
    return row?JSON.parse(row.payload_json):undefined;
  }
  /** Official rows only; a missing full snapshot never becomes a fabricated full match. */
  officialPlayers(matchId:number):MatchApiPlayer[] {
    if(!Number.isSafeInteger(matchId)||matchId<=0)return [];
    const valid=(p:MatchApiPlayer)=>p&&typeof p==="object"&&(p.account_id==null||Number.isSafeInteger(p.account_id)&&p.account_id>=0&&p.account_id<=4294967295)&&[p.kills,p.deaths,p.assists,p.hero_id,p.player_slot].every(v=>Number.isSafeInteger(v)&&v>=0)&&p.hero_id>0&&((p.player_slot<=4)||(p.player_slot>=128&&p.player_slot<=132));
    const api=this.matchApi(matchId),bySlot=new Map<number,MatchApiPlayer>();
    for(const p of api?.match_id===matchId&&Array.isArray(api.players)?api.players:[])if(valid(p))bySlot.set(p.player_slot,{...p});
    const rows=this.db.prepare("SELECT account_id,payload_json FROM player_match_results WHERE match_id=? ORDER BY account_id").all(matchId) as {account_id:number;payload_json:string}[];
    for(const row of rows){
      const p=JSON.parse(row.payload_json) as SavedResult;
      if(p.result_source!=="opendota"||p.match_id!==matchId||!valid(p)||bySlot.has(p.player_slot))continue;
      bySlot.set(p.player_slot,{...p,account_id:row.account_id});
    }
    return [...bySlot.values()].sort((a,b)=>a.player_slot-b.player_slot);
  }
  /** Apply saved official facts against the latest row under the same write lock. */
  enrichReplayFromOfficial(matchId:number):ParsedMatch|undefined {
    return this.db.transaction(()=>{
      const current=this.replay(matchId);if(!current)return undefined;
      const api=this.matchApi(matchId),official=this.officialPlayers(matchId);
      const numeric=(v:unknown):v is number=>typeof v==="number"&&Number.isFinite(v)&&v>=0;
      const normalize=(v:string)=>v.replace(/^npc_dota_hero_/,"").replace(/_/g,"");
      const players=current.players.map(player=>{
        const matches=official.filter(p=>{
          const hero=HERO_CATALOG.find(h=>h.id===p.hero_id)?.name;
          if(!hero||normalize(hero)!==normalize(player.hero)||(p.player_slot<128)!==(player.team==="radiant"))return false;
          return !p.account_id||p.account_id===4294967295||player.steam_id==="0"||String(BigInt(p.account_id)+76561197960265728n)===player.steam_id;
        });
        if(matches.length!==1)return player;
        const p=matches[0],next={...player,kills:p.kills,deaths:p.deaths,assists:p.assists};
        if(numeric(p.last_hits))next.last_hits=p.last_hits;if(numeric(p.denies))next.denies=p.denies;
        if(numeric(p.gold_per_min))next.gpm=p.gold_per_min;if(numeric(p.xp_per_min))next.xpm=p.xp_per_min;
        if(numeric(p.hero_damage))next.hero_damage=p.hero_damage;
        if(numeric(p.teamfight_participation))next.teamfight_participation=p.teamfight_participation;
        if(numeric(p.stuns))next.stuns=p.stuns;if(numeric(p.pings))next.pings=p.pings;
        if(p.item_uses&&typeof p.item_uses==="object"&&!Array.isArray(p.item_uses)&&Object.values(p.item_uses).every(numeric))next.item_uses={...p.item_uses};
        return next;
      });
      const next={...current,players};
      if(api?.match_id===matchId){
        if(numeric(api.radiant_score)&&Number.isInteger(api.radiant_score))next.radiant_score=api.radiant_score;
        if(numeric(api.dire_score)&&Number.isInteger(api.dire_score))next.dire_score=api.dire_score;
        if(numeric(api.start_time)&&api.start_time>0)next.start_time=api.start_time;
      }
      this.saveReplay(next);return this.replay(matchId);
    }).immediate();
  }
  profileRosters(): ProfileRoster[] {
    return (this.db.prepare("SELECT payload_json FROM profile_rosters").all() as {payload_json:string}[]).map(r=>JSON.parse(r.payload_json));
  }
  allReplays(): ParsedMatch[] {
    return (this.db.prepare("SELECT payload_json FROM parsed_replays ORDER BY start_time DESC").all() as {payload_json:string}[]).map(r=>JSON.parse(r.payload_json));
  }
  history(accountId: number): ApmRecord[] {
    return (this.db.prepare(`SELECT a.*, c.counts_json FROM player_match_apm a LEFT JOIN player_match_actions c
      ON a.match_id=c.match_id AND a.account_id=c.account_id AND a.version=c.version
      WHERE a.account_id = ? AND a.version = ? ORDER BY a.start_time DESC, a.match_id DESC`)
      .all(accountId, APM_VERSION) as (ApmRecord & {counts_json?:string})[]).map(({counts_json,...r}) => {
        const counts = counts_json ? JSON.parse(counts_json) : undefined;
        return {...r, action_counts:validActionCounts(counts,r.actions) ? counts : undefined};
      });
  }
  hydrate(match: ParsedMatch): void {
    const rows = this.db.prepare("SELECT * FROM player_match_apm WHERE match_id = ? AND version = ?").all(match.match_id, APM_VERSION) as ApmRecord[];
    for (const row of rows) {
      const p = match.players.find(p => p.steam_id === String(BigInt(row.account_id) + 76561197960265728n));
      if (p) { p.actions = row.actions; p.actions_per_min = row.apm; }
    }
  }
  hasMatch(matchId: number): boolean {
    return !!this.db.prepare("SELECT 1 FROM player_match_apm WHERE match_id = ? AND version = ? LIMIT 1").get(matchId, APM_VERSION);
  }
  close(): void { this.db.close(); }
}
let store: ApmStore | undefined;
export function getApmStore(): ApmStore {
  return store ??= new ApmStore(process.env.APM_DB_PATH || path.join(process.env.DATA_DIR || "data", "stats.sqlite"));
}
