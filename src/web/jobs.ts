/**
 * Очередь разборов матчей. Разбор идёт минуты (скачать реплей, распарсить, сходить в LLM),
 * поэтому HTTP-запрос его только ставит в очередь, а страница опрашивает прогресс.
 * Одновременно выполняется один разбор — качать несколько реплеев параллельно смысла нет.
 */
import { mkdir, readFile, readdir, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { analyseParsedMatch, mergeOfficialStats } from "../analyze-v2.js";
import { generateMainVoiceAnalysis } from "../analyze-main-voice.js";
import { collectMatchFacts, renderFactPacket } from "../match-facts.js";
import { fetchAndParseReplay, type ParsedMatch } from "../replay.js";

const ANALYSIS_DIR = path.join(process.env.DATA_DIR || "data", "analysis");
export const CURRENT_ANALYSIS_ENGINE = "main-voice-facts-v7";

export type JobStage = "queued" | "locating" | "requesting" | "downloading" | "unpacking" | "parsing" | "writing" | "done" | "error";

export interface Job {
  matchId: number;
  stage: JobStage;
  message: string;
  startedAt: number;
  finishedAt?: number;
  error?: string;
}

export interface StoredAnalysis {
  matchId: number;
  createdAt: number;
  engine: typeof CURRENT_ANALYSIS_ENGINE;
  format: string;
  text: string;
  parsed: ParsedMatch;
  /** Когда разбор ушёл в Telegram; пусто — ещё не отправляли. */
  postedAt?: number;
}

/** Помечает разбор как отправленный в чат. */
export async function markPosted(matchId: number): Promise<void> {
  const stored = await getStoredAnalysis(matchId);
  if (!stored) return;
  stored.postedAt = Date.now();
  await writeFile(path.join(ANALYSIS_DIR, `${matchId}.json`), JSON.stringify(stored));
}

const STAGE_TEXT: Record<JobStage, string> = {
  queued: "В очереди",
  locating: "Ищу реплей",
  requesting: "Прошу Valve отдать реплей (это до минуты)",
  downloading: "Качаю реплей с серверов Valve",
  unpacking: "Распаковываю",
  parsing: "Разбираю реплей: линии, тимфайты, тайминги",
  writing: "Пишу разбор",
  done: "Готово",
  error: "Ошибка",
};

const jobs = new Map<number, Job>();
let running = false;
const queue: number[] = [];

export function getJob(matchId: number): Job | undefined {
  return jobs.get(matchId);
}

export async function getStoredAnalysis(matchId: number): Promise<StoredAnalysis | null> {
  const file = path.join(ANALYSIS_DIR, `${matchId}.json`);
  try {
    const stored = JSON.parse(await readFile(file, "utf8")) as Partial<StoredAnalysis>;
    if (stored.engine !== CURRENT_ANALYSIS_ENGINE) {
      await rm(file, { force: true });
      return null;
    }
    return stored as StoredAnalysis;
  } catch {
    return null;
  }
}

/** Удаляет сохранённые разборы прежнего генератора при старте новой версии. */
export async function purgeLegacyAnalyses(): Promise<number> {
  let files: string[];
  try {
    files = await readdir(ANALYSIS_DIR);
  } catch {
    return 0;
  }
  let removed = 0;
  for (const file of files.filter((name) => name.endsWith(".json"))) {
    const fullPath = path.join(ANALYSIS_DIR, file);
    try {
      const stored = JSON.parse(await readFile(fullPath, "utf8")) as Partial<StoredAnalysis>;
      if (stored.engine === CURRENT_ANALYSIS_ENGINE) continue;
    } catch {
      // Повреждённый результат тоже не должен считаться актуальным.
    }
    await rm(fullPath, { force: true });
    removed++;
  }
  return removed;
}

function setStage(matchId: number, stage: JobStage, error?: string): void {
  const job = jobs.get(matchId);
  if (!job) return;
  job.stage = stage;
  job.message = STAGE_TEXT[stage];
  if (error) job.error = error;
  if (stage === "done" || stage === "error") job.finishedAt = Date.now();
}

async function runJob(matchId: number): Promise<void> {
  try {
    const parsed = await mergeOfficialStats(
      await fetchAndParseReplay(matchId, (stage) => {
        if (stage !== "done") setStage(matchId, stage as JobStage);
      }),
    );
    setStage(matchId, "writing");

    const facts = await collectMatchFacts(analyseParsedMatch(parsed));
    const text = await generateMainVoiceAnalysis(renderFactPacket(facts));

    await mkdir(ANALYSIS_DIR, { recursive: true });
    await writeFile(
      path.join(ANALYSIS_DIR, `${matchId}.json`),
      JSON.stringify({
        matchId,
        createdAt: Date.now(),
        engine: CURRENT_ANALYSIS_ENGINE,
        format: "Песик сбоку",
        text,
        parsed,
      } satisfies StoredAnalysis),
    );
    setStage(matchId, "done");
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    console.error(`[JOB] матч ${matchId}:`, msg);
    setStage(matchId, "error", msg);
  }
}

async function pump(): Promise<void> {
  if (running) return;
  running = true;
  while (queue.length) {
    const matchId = queue.shift() as number;
    await runJob(matchId);
  }
  running = false;
}

/** Ставит матч в очередь. Повторный запрос на уже идущий разбор просто вернёт текущий статус. */
export function enqueue(matchId: number): Job {
  const existing = jobs.get(matchId);
  if (existing && existing.stage !== "error" && existing.stage !== "done") return existing;

  const job: Job = { matchId, stage: "queued", message: STAGE_TEXT.queued, startedAt: Date.now() };
  jobs.set(matchId, job);
  queue.push(matchId);
  void pump();
  return job;
}
