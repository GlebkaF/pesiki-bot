/**
 * Работа с реплеями Dota 2: получение ссылки, скачивание, распаковка и разбор
 * собственным парсером (tools/replay-parser). Даёт данные, которых нет в базовом
 * ответе OpenDota: лейнинг, экономику по минутам, тимфайты, тайминги предметов.
 */
import { execFile } from "node:child_process";
import { createWriteStream } from "node:fs";
import { mkdir, readFile, writeFile, rm, stat } from "node:fs/promises";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import { promisify } from "node:util";
import path from "node:path";
import { getAppFetch } from "./proxy.js";

const execFileAsync = promisify(execFile);

const OPENDOTA_API_BASE = "https://api.opendota.com/api";
const CACHE_DIR = process.env.REPLAY_CACHE_DIR || "data/replays";
const PARSER_BIN = process.env.REPLAY_PARSER_BIN || "tools/replay-parser/replay-parser";
const DOWNLOAD_TIMEOUT_MS = 5 * 60 * 1000;
const PARSE_TIMEOUT_MS = 3 * 60 * 1000;
/** Разобранный JSON заметно меньше реплея, поэтому храним его долго. */
const PARSED_TTL_MS = 30 * 24 * 60 * 60 * 1000;
/** Сколько ждём, пока OpenDota добудет ссылку на реплей у Valve. */
const SALT_POLL_ATTEMPTS = 12;
const SALT_POLL_INTERVAL_MS = 10_000;

export interface ParsedPlayer {
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

export interface ParsedMatch {
  match_id: number;
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
  constructor(matchId: number) {
    super(
      `Не удалось получить ссылку на реплей матча ${matchId}. ` +
        `Обычно так бывает со старыми матчами: Valve хранит реплеи ограниченное время.`,
    );
    this.name = "ReplayUnavailableError";
  }
}

interface ReplayLocation {
  cluster: number;
  salt: number;
}

async function readLocation(matchId: number): Promise<ReplayLocation | null> {
  const fetchFn = await getAppFetch();
  const res = await fetchFn(`${OPENDOTA_API_BASE}/matches/${matchId}`);
  if (!res.ok) throw new Error(`OpenDota вернула ${res.status} для матча ${matchId}`);
  const data = (await res.json()) as { cluster?: number; replay_salt?: number };
  if (!data.cluster || !data.replay_salt) return null;
  return { cluster: data.cluster, salt: data.replay_salt };
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
  const known = await readLocation(matchId);
  if (known) return known;

  const fetchFn = await getAppFetch();
  const req = await fetchFn(`${OPENDOTA_API_BASE}/request/${matchId}`, { method: "POST" });
  if (!req.ok) throw new ReplayUnavailableError(matchId);

  for (let attempt = 1; attempt <= SALT_POLL_ATTEMPTS; attempt++) {
    onWait(attempt);
    await new Promise((r) => setTimeout(r, SALT_POLL_INTERVAL_MS));
    const loc = await readLocation(matchId);
    if (loc) return loc;
  }
  throw new ReplayUnavailableError(matchId);
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
async function decompress(archivePath: string, outPath: string): Promise<void> {
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
export async function fetchAndParseReplay(
  matchId: number,
  onProgress: ParseProgress = () => {},
): Promise<ParsedMatch> {
  await mkdir(CACHE_DIR, { recursive: true });
  const parsedPath = path.join(CACHE_DIR, `${matchId}.json`);

  if (await fileExists(parsedPath)) {
    const st = await stat(parsedPath);
    if (Date.now() - st.mtimeMs < PARSED_TTL_MS) {
      onProgress("done", "из кэша");
      return JSON.parse(await readFile(parsedPath, "utf8")) as ParsedMatch;
    }
  }

  onProgress("locating");
  const loc = await getReplayLocation(matchId, () => onProgress("requesting"));
  const url = buildReplayUrl(matchId, loc);

  const archivePath = path.join(CACHE_DIR, `${matchId}.dem.archive`);
  const demPath = path.join(CACHE_DIR, `${matchId}.dem`);

  try {
    onProgress("downloading");
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), DOWNLOAD_TIMEOUT_MS);
    // Реплеи лежат на CDN Valve и прокси для них не нужен.
    const res = await fetch(url, { signal: controller.signal });
    clearTimeout(timer);
    if (!res.ok || !res.body) {
      // 502/404 от CDN означают, что файл уже удалён: Valve хранит реплеи ограниченное время.
      throw new Error(
        res.status === 502 || res.status === 404
          ? "Valve уже удалила реплей этого матча — он слишком старый"
          : `CDN Valve вернул ${res.status}`,
      );
    }
    await pipeline(Readable.fromWeb(res.body as never), createWriteStream(archivePath));

    onProgress("unpacking");
    await decompress(archivePath, demPath);

    onProgress("parsing");
    const { stdout } = await execFileAsync(PARSER_BIN, [demPath], {
      maxBuffer: 1 << 28,
      timeout: PARSE_TIMEOUT_MS,
    });
    const parsed = JSON.parse(stdout) as ParsedMatch;

    await writeFile(parsedPath, JSON.stringify(parsed));
    onProgress("done");
    return parsed;
  } finally {
    // Сами реплеи не храним — это десятки мегабайт на матч.
    await rm(archivePath, { force: true });
    await rm(demPath, { force: true });
  }
}

/** SteamID64 из реплея -> Steam32, которым оперируют OpenDota и config.ts */
export function toSteam32(steam64: string | number): number {
  return Number(BigInt(steam64) - 76561197960265728n);
}
