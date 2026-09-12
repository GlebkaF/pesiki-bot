/** Permanent APM history, independent of the replay JSON cache and its TTL. */
import Database from "better-sqlite3";
import { mkdirSync } from "node:fs";
import path from "node:path";
import type { ParsedMatch } from "./replay.js";

export const APM_VERSION = "spectator-orders-v1";
export interface ApmRecord {
  match_id: number; account_id: number; hero: string; start_time: number | null;
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
    );`);
  }
  saveReplay(match: ParsedMatch): void {
    if (!Number.isSafeInteger(match.match_id) || match.match_id <= 0 || !Array.isArray(match.players) || !match.players.length) return;
    const existing = this.replay(match.match_id);
    // A legacy cache must not overwrite a newer, richer parse.
    if (existing?.apm_version && !match.apm_version) return;
    const stored = {...match, start_time: match.start_time ?? existing?.start_time};
    this.db.prepare(`INSERT INTO parsed_replays(match_id,start_time,parsed_at,payload_json) VALUES(?,?,?,?)
      ON CONFLICT(match_id) DO UPDATE SET start_time=excluded.start_time, parsed_at=excluded.parsed_at, payload_json=excluded.payload_json
      WHERE parsed_replays.payload_json != excluded.payload_json`)
      .run(match.match_id, stored.start_time ?? null, Date.now(), JSON.stringify(stored));
  }
  replay(matchId: number): ParsedMatch | undefined {
    const row = this.db.prepare("SELECT payload_json FROM parsed_replays WHERE match_id = ?").get(matchId) as {payload_json:string} | undefined;
    return row ? JSON.parse(row.payload_json) as ParsedMatch : undefined;
  }
  save(match: ParsedMatch): void {
    this.saveReplay(match);
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
      }
    })();
  }
  history(accountId: number): ApmRecord[] {
    return this.db.prepare("SELECT * FROM player_match_apm WHERE account_id = ? AND version = ? ORDER BY start_time DESC, match_id DESC")
      .all(accountId, APM_VERSION) as ApmRecord[];
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
