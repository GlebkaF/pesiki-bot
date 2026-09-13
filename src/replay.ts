/**
 * Работа с реплеями Dota 2: получение ссылки, скачивание, распаковка и разбор
 * собственным парсером (tools/replay-parser). Даёт данные, которых нет в базовом
 * ответе OpenDota: лейнинг, экономику по минутам, тимфайты, тайминги предметов.
 */
import { execFile } from "node:child_process";
import { createWriteStream } from "node:fs";
import { mkdir, readFile, writeFile, rm, stat, rename } from "node:fs/promises";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import { promisify } from "node:util";
import path from "node:path";
import { getApmStore, APM_VERSION } from "./apm-store.js";
import { getAppFetch } from "./proxy.js";

const execFileAsync = promisify(execFile);

const OPENDOTA_API_BASE = "https://api.opendota.com/api";
const CACHE_DIR = process.env.REPLAY_CACHE_DIR || path.join(process.env.DATA_DIR || "data", "replays");
const ARCHIVE_DIR = process.env.REPLAY_ARCHIVE_DIR || path.join(process.env.DATA_DIR || "data", "replay-archives");
const PARSER_BIN = process.env.REPLAY_PARSER_BIN || "tools/replay-parser/replay-parser";
const DOWNLOAD_TIMEOUT_MS = 5 * 60 * 1000;
const PARSE_TIMEOUT_MS = 3 * 60 * 1000;
/** Разобранный JSON заметно меньше реплея, поэтому храним его долго. */
const PARSED_TTL_MS = 30 * 24 * 60 * 60 * 1000;
/** Сколько ждём, пока OpenDota добудет ссылку на реплей у Valve. */
const SALT_POLL_ATTEMPTS = 12;
const SALT_POLL_INTERVAL_MS = 10_000;

export interface WardEvent {
 min:number; kind:"observer"|"sentry"|"other"; event:"purchase"|"destroy"|"place";
 x?:number; y?:number; coordinates_source?:"ward_entity";
 destroy_kind?:"enemy_deward"|"allied_deny"|"unknown";
 attacker?:string; attacker_hero?:string; attacker_team?:"radiant"|"dire";
 target_team?:"radiant"|"dire"; target_owner_hero?:string;
 source_controlled?:boolean; source_illusion?:boolean;
}
/** Explicit combat-log observations. Optional on older retained parses. */
export interface CombatDetails {
  version: "combat-log-v1" | "combat-log-v2" | "combat-log-v3";
  coverage: { ultimate_classification:boolean; death_positions:boolean; xp:boolean; ward_placements:boolean; healing_target_identity?:boolean; ward_destroy_semantics?:boolean };
  healing: { self:number; other_heroes:number; units:number; by_target:Record<string,number>; by_ability?:Record<string,number> };
  /** Real hero targets, excluding attacker/target illusions. Raw damage type codes. */
  damage: { by_ability:Record<string,number>; by_target:Record<string,number>; by_type:Record<string,number> };
  casts: { min:number; ability:string; target?:string; ultimate?:boolean; item?:boolean }[];
  deaths: { min:number; killer:string; x?:number; y?:number; coordinates_source?:"hero_entity"; incoming?:{window_seconds:number;total:number;by_attacker:Record<string,number>;by_ability:Record<string,number>;complete:boolean} }[];
  /** Purchase is not placement. Destroy coordinates only when explicitly present. */
  wards: WardEvent[];
  buybacks: { min:number; x?:number; y?:number }[];
  gold: { min:number; value:number; reason?:number }[];
  /** Cumulative sampled values; index 0 is minute 1. XP unavailable when coverage.xp=false. */
  xp_by_minute:number[];
  last_hits_by_minute:number[];
  denies_by_minute:number[];
  /** Modifier removals; durations overlap and are not unique seconds of control. */
  modifiers: { min:number; target:string; modifier:string; stun?:number; slow?:number; elapsed?:number; silence?:boolean; root?:boolean }[];
  dropped_events:number;
  xp_events:number;
}

/** Final replicated Valve scoreboard, attached only after end state and exact roster identity verification. */
export interface ReplayScoreboard {
 version:"player-resource-v1"; source:"CDOTA_PlayerResource";
 resource_slot:number; team_slot:number; hero_id:number; kills:number; deaths:number; assists:number;
 complete:true; end_state_observed:true;
}
export interface ParsedPlayer {
 replay_scoreboard?: ReplayScoreboard;
 kda_source?: "replay-scoreboard" | "opendota";
  combat_details?: CombatDetails;
  action_counts?: Record<string, number>;
  actions?: number;
  actions_per_min?: number;
  steam_id: string;
  name: string;
  hero: string;
  team: "radiant" | "dire";
  slot: number;
  lane: string;
  lane_role: string;
  kills: number;
  deaths: number;
  assists: number;
  last_hits: number;
  denies: number;
  cs_at_10: number;
  cs_at_20: number;
  networth_at_10: number;
  networth_at_20: number;
  networth_final: number;
  gpm: number;
  xpm: number;
  networth_by_minute: number[];
  hero_damage: number;
  damage_taken: number;
  /** Сумма HEAL от героя без разделения получателей, включая себя. Не лечение союзников. */
  healing: number;
  tower_damage: number;
  gold_lost_to_death: number;
  gold_spent_on_support: number;
  level_final: number;
  buybacks: number;
  max_killstreak: number;
  multikills?: Record<string, number>;
  obs_wards_placed: number;
  sentry_wards_placed: number;
  wards_killed: number;
  enemy_half_pct: number;
  avg_ally_distance: number;
  death_isolation: number;
  distance_run: number;

  /** Заполняется из OpenDota поверх данных реплея, см. mergeOfficialStats. */
  teamfight_participation?: number;
  stuns?: number;
  pings?: number;
  item_uses?: Record<string, number>;

  item_timings: { item: string; min: number }[];
  death_times_min: number[];
  killed_by?: Record<string, number>;
  killed?: Record<string, number>;
  top_spells?: Record<string, number>;
}

/** One-second observed amounts. Row flags bit 0 marks attacker illusions. */
export type CombatTimelineRow=[second:number,sourceIndex:number,ownerHeroIndex:number,targetHeroIndex:number,abilityIndex:number,damageType:number,flags:number,amount:number];
export interface CombatTimeline {
  version:"combat-timeline-v1"; bucket_seconds:1;
  /** Matches parsed.players order; owner -1 means no explicit owner in the roster. */
  heroes:string[]; sources:string[]; abilities:string[];
  damage:CombatTimelineRow[]; healing:CombatTimelineRow[];
  coverage:{target_scope:"real-heroes";damage_events:number;healing_events:number;stored_damage_events:number;stored_healing_events:number;owner_known_damage_events:number;damage_rows:number;healing_rows:number;dropped_events:number;truncated:boolean;
    /** Exclusive end of complete prefix; null means no dropped buckets. */
    complete_until_second:number|null;row_limit:number;byte_limit:number};
}

export interface ParsedMatch {
  /** Ward destructions without an explicitly identified hero owner; never duplicated in player wards. */
  ward_events?: WardEvent[];
  combat_timeline?:CombatTimeline;
  analytics_version?: "combat-log-v1" | "combat-log-v2" | "combat-log-v3";
  parser_version?: string;
  apm_version?: string;
  apm_duration_seconds?: number;
  match_id: number;
  /** Заполняются из OpenDota в mergeOfficialStats. */
  start_time?: number;
  radiant_score?: number;
  dire_score?: number;
  duration_min: number;
  winner: "radiant" | "dire";
  game_mode: string;
  players: ParsedPlayer[];
  first_blood: { min: number; killer: string; victim: string } | null;
  kills: { min: number; killer: string; victim: string; assists: number }[];
  teamfights: {
    start_min: number;
    end_min: number;
    deaths: number;
    radiant_died: number;
    dire_died: number;
    winner: string;
    heroes_died: string[];
  }[];
  buildings: { min: number; name: string; killed_by_team: string }[];
  roshan_kills_min: number[];
}

export class ReplayUnavailableError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ReplayUnavailableError";
  }
}

const FRESH_MATCH_WINDOW_SEC = 24 * 60 * 60;

/** Не ставит диагноз «удалён», если свежий реплей просто ещё готовится. */
export function replayUnavailableError(
  matchId: number,
  startTime?: number,
  locationAlreadyKnown = false,
  nowSec = Math.floor(Date.now() / 1000),
): ReplayUnavailableError {
  const fresh = startTime !== undefined && nowSec - startTime <= FRESH_MATCH_WINDOW_SEC;
  if (fresh && locationAlreadyKnown) {
    return new ReplayUnavailableError(
      `Ссылка на реплей матча ${matchId} уже появилась, но сам файл ещё не доступен на CDN Valve. ` +
      "Попробуй снова через 1–2 минуты.",
    );
  }
  if (fresh) {
    return new ReplayUnavailableError(
      `Реплей матча ${matchId} ещё не появился у Valve. Для свежего матча это нормально — ` +
      "попробуй снова через 2–3 минуты.",
    );
  }
  if (startTime !== undefined) {
    return new ReplayUnavailableError(
      `Реплей матча ${matchId} сейчас недоступен. Матч уже не свежий, поэтому Valve могла удалить файл.`,
    );
  }
  return new ReplayUnavailableError(
    `Реплей матча ${matchId} сейчас недоступен: он мог ещё не появиться, ` +
    "а у старого матча файл мог быть удалён.",
  );
}

interface ReplayLocation {
  cluster: number;
  salt: number;
  startTime?: number;
}

interface ReplayState {
  location: ReplayLocation | null;
  startTime?: number;
}

// /matches и /request делят бесплатный лимит OpenDota с остальным приложением.
// Сериализуем только эти короткие запросы; Valve CDN и парсер продолжают работать параллельно.
const LOCATION_REQUEST_GAP_MS = 1_250;
const LOCATION_RATE_RETRIES = 5;
let locationQueue: Promise<void> = Promise.resolve();
let lastLocationRequestAt = 0;

async function openDotaReplayRequest(url: string, init?: RequestInit): Promise<Response> {
  for (let attempt = 0; attempt < LOCATION_RATE_RETRIES; attempt++) {
    let release = () => {};
    const previous = locationQueue;
    locationQueue = new Promise<void>((resolve) => { release = resolve; });
    await previous;
    const wait = LOCATION_REQUEST_GAP_MS - (Date.now() - lastLocationRequestAt);
    if (wait > 0) await new Promise((resolve) => setTimeout(resolve, wait));
    let response: Response;
    try {
      const fetchFn = await getAppFetch();
      response = await fetchFn(url, init);
      lastLocationRequestAt = Date.now();
    } finally {
      release();
    }
    if (response.status !== 429) return response;
    throw new Error("OpenDota временно ограничивает запросы (429). Сохранённые матчи доступны; новые появятся после восстановления API.");
  }
  throw new Error("OpenDota продолжает отвечать 429 после повторов");
}

async function readReplayState(matchId: number): Promise<ReplayState> {
  const res = await openDotaReplayRequest(`${OPENDOTA_API_BASE}/matches/${matchId}`);
  if (!res.ok) throw new Error(`OpenDota вернула ${res.status} для матча ${matchId}`);
  const data = (await res.json()) as import("./opendota.js").MatchApi;
  getApmStore().saveMatchApi(data);
  if (!data.cluster || !data.replay_salt) return { location: null, startTime: data.start_time };
  return {
    location: { cluster: data.cluster, salt: data.replay_salt, startTime: data.start_time },
    startTime: data.start_time,
  };
}

/**
 * Ищет cluster и replay_salt. Valve свой WebAPI для матчей отключил, поэтому идём через OpenDota.
 * Для свежих матчей ссылки обычно ещё нет — тогда просим OpenDota сходить за ней к Valve
 * (POST /request) и ждём: обычно управляется за 20-40 секунд.
 */
export async function getReplayLocation(
  matchId: number,
  onWait: (attempt: number) => void = () => {},
): Promise<ReplayLocation> {
  let state = await readReplayState(matchId);
  if (state.location) return state.location;

  const req = await openDotaReplayRequest(`${OPENDOTA_API_BASE}/request/${matchId}`, { method: "POST" });
  if (!req.ok) throw replayUnavailableError(matchId, state.startTime);

  for (let attempt = 1; attempt <= SALT_POLL_ATTEMPTS; attempt++) {
    onWait(attempt);
    await new Promise((r) => setTimeout(r, SALT_POLL_INTERVAL_MS));
    state = await readReplayState(matchId);
    if (state.location) return state.location;
  }
  throw replayUnavailableError(matchId, state.startTime);
}

export function buildReplayUrl(matchId: number, loc: ReplayLocation): string {
  return `http://replay${loc.cluster}.valve.net/570/${matchId}_${loc.salt}.dem.bz2`;
}

async function fileExists(p: string): Promise<boolean> {
  try {
    await stat(p);
    return true;
  } catch {
    return false;
  }
}

/**
 * Valve отдаёт файл с расширением .bz2, но свежие реплеи внутри сжаты zstd,
 * а старые — настоящим bzip2. Формат определяем по сигнатуре.
 */
export async function decompress(archivePath: string, outPath: string): Promise<void> {
  const head = (await readFile(archivePath)).subarray(0, 4);
  const isZstd = head[0] === 0x28 && head[1] === 0xb5 && head[2] === 0x2f && head[3] === 0xfd;
  const isBzip2 = head[0] === 0x42 && head[1] === 0x5a && head[2] === 0x68;

  if (isZstd) {
    await execFileAsync("zstd", ["-d", "-f", archivePath, "-o", outPath], { maxBuffer: 1 << 26 });
    return;
  }
  if (isBzip2) {
    const out = createWriteStream(outPath);
    const proc = execFile("bzip2", ["-dc", archivePath], { maxBuffer: 1 << 30, encoding: "buffer" });
    if (!proc.stdout) throw new Error("bzip2 не отдал поток");
    await pipeline(proc.stdout, out);
    return;
  }
  throw new Error("Неизвестный формат архива реплея");
}

export interface ParseProgress {
  (stage: "locating" | "requesting" | "downloading" | "unpacking" | "parsing" | "done", detail?: string): void;
}

/**
 * Полный цикл: ссылка -> скачивание -> распаковка -> разбор. Результат кэшируется на диск.
 */
async function fetchAndParseReplayInternal(
  matchId: number,
  onProgress: ParseProgress = () => {},
  requireApm = false,
): Promise<ParsedMatch> {
  const stored = getApmStore().replay(matchId);
  if (stored && (!requireApm || stored.apm_version === APM_VERSION)) {
    getApmStore().save(stored);
    onProgress("done", "из БД");
    return stored;
  }
  await mkdir(CACHE_DIR, { recursive: true });
  await mkdir(ARCHIVE_DIR, { recursive: true });
  const parsedPath = path.join(CACHE_DIR, `${matchId}.json`);

  if (await fileExists(parsedPath)) {
    const st = await stat(parsedPath);
    if (Date.now() - st.mtimeMs < PARSED_TTL_MS) {
      const cached = JSON.parse(await readFile(parsedPath, "utf8")) as ParsedMatch;
      // Keep legacy cache usable; automatic collection upgrades it while Valve still has the demo.
      if (!requireApm || cached.apm_version === APM_VERSION) {
        cached.match_id = matchId;
        getApmStore().save(cached);
        onProgress("done", "из кэша");
        return cached;
      }
    }
  }

  const archivePath = path.join(ARCHIVE_DIR, `${matchId}.dem.archive`);
  const downloadPath = path.join(ARCHIVE_DIR, `${matchId}.download`);
  const demPath = path.join(CACHE_DIR, `${matchId}.dem`);
  let startTime = stored?.start_time;

  try {
    if (!(await fileExists(archivePath))) {
      onProgress("locating");
      const loc = await getReplayLocation(matchId, () => onProgress("requesting"));
      startTime = loc.startTime;
      onProgress("downloading");
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), DOWNLOAD_TIMEOUT_MS);
      try {
        const res = await fetch(buildReplayUrl(matchId, loc), { signal: controller.signal });
        if (!res.ok || !res.body) {
          if (res.status === 502 || res.status === 404) throw replayUnavailableError(matchId, loc.startTime, true);
          throw new Error(`CDN Valve вернул ${res.status}`);
        }
        await pipeline(Readable.fromWeb(res.body as never), createWriteStream(downloadPath));
        // Only complete downloads become permanent archives.
        await rename(downloadPath, archivePath);
      } finally { clearTimeout(timer); }
    }

    onProgress("unpacking");
    await decompress(archivePath, demPath);

    onProgress("parsing");
    const { stdout } = await execFileAsync(PARSER_BIN, [demPath], {
      maxBuffer: 1 << 28,
      timeout: PARSE_TIMEOUT_MS,
    });
    const parsed = JSON.parse(stdout) as ParsedMatch;
    if (parsed.match_id && parsed.match_id !== matchId) throw new Error("Replay match ID mismatch");
    parsed.match_id = matchId;
    if (startTime !== undefined) parsed.start_time = startTime;
    getApmStore().save(parsed);

    await writeFile(parsedPath, JSON.stringify(parsed));
    onProgress("done");
    return parsed;
  } finally {
    // Keep the original compressed replay permanently; remove only scratch files.
    await rm(downloadPath, { force: true });
    await rm(demPath, { force: true });
  }
}

/** SteamID64 из реплея -> Steam32, которым оперируют OpenDota и config.ts */
export function toSteam32(steam64: string | number): number {
  return Number(BigInt(steam64) - 76561197960265728n);
}

// Share a parse across /analyze, automatic collection and /stats. Serialize downloads
// to bound CPU/disk and avoid concurrent writes/deletion of the same demo.
let parseQueue: Promise<unknown> = Promise.resolve();
const inFlight = new Map<number, Promise<ParsedMatch>>();
export function fetchAndParseReplay(matchId: number, onProgress: ParseProgress = () => {}, requireApm = false): Promise<ParsedMatch> {
  if (!Number.isSafeInteger(matchId) || matchId <= 0) return Promise.reject(new Error("Invalid match ID"));
  const existing = inFlight.get(matchId);
  if (existing) return existing.then(result => {
    if (requireApm && result.apm_version !== APM_VERSION) return fetchAndParseReplay(matchId, onProgress, true);
    return result;
  });
  const task = parseQueue.catch(() => {}).then(() => fetchAndParseReplayInternal(matchId, onProgress, requireApm));
  inFlight.set(matchId, task);
  parseQueue = task;
  void task.finally(() => { if (inFlight.get(matchId) === task) inFlight.delete(matchId); }).catch(() => {});
  return task;
}

/** Try to upgrade a legacy cached replay without losing an otherwise usable analysis. */
export async function fetchReplayForAnalysis(matchId: number, onProgress: ParseProgress = () => {}): Promise<ParsedMatch> {
  const parsed = await fetchAndParseReplay(matchId, onProgress);
  if (parsed.apm_version === APM_VERSION) return parsed;
  getApmStore().hydrate(parsed);
  if (parsed.players.some(p => p.actions_per_min !== undefined)) return parsed;
  try { return await fetchAndParseReplay(matchId, onProgress, true); }
  catch (error) {
    console.warn(`[APM] upgrade ${matchId} unavailable:`, (error as Error).message);
    return parsed;
  }
}
