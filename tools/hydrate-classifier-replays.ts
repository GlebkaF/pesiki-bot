/** Скачивает и разбирает реплеи всех матчей текущего classifier eval. */
import { access, mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { analyseParsedMatch, mergeOfficialStats } from "../src/analyze-v2.js";
import { collectMatchFacts, MATCH_FACT_VERSION } from "../src/match-facts.js";
import { fetchAndParseReplay } from "../src/replay.js";

const INPUT = process.env.CLASSIFIER_INPUT || "data/classifier-eval/matches.json";
const OUT = process.env.CLASSIFIER_DEEP_OUT || "data/classifier-eval/deep";
const CONCURRENCY = Math.max(1, Number(process.env.CLASSIFIER_CONCURRENCY || 3));
const FORCE = process.env.CLASSIFIER_FORCE === "1";

interface EvalRow {
  matchId: number;
}

async function main(): Promise<void> {
  const rows = JSON.parse(await readFile(INPUT, "utf8")) as EvalRow[];
  await mkdir(OUT, { recursive: true });
  const failures: Array<{ matchId: number; error: string }> = [];
  let completed = 0;
  let skipped = 0;
  let cursor = 0;

  async function worker(): Promise<void> {
    while (cursor < rows.length) {
      const index = cursor++;
      const row = rows[index];
      const prefix = `[${index + 1}/${rows.length}] ${row.matchId}`;
      const destination = path.join(OUT, `${row.matchId}.facts.json`);
      if (!FORCE) {
        try {
          await access(destination);
          const existing = JSON.parse(await readFile(destination, "utf8")) as { version?: number };
          if (existing.version === MATCH_FACT_VERSION) {
            skipped++;
            console.log(`${prefix}: уже готово (v${MATCH_FACT_VERSION})`);
            continue;
          }
          console.log(`${prefix}: устаревшая фактура v${existing.version ?? "?"}, пересобираю`);
        } catch {
          // Фактов ещё нет — скачиваем реплей.
        }
      }
      console.log(`${prefix}: начинаю`);
      try {
        const parsed = await mergeOfficialStats(
          await fetchAndParseReplay(row.matchId, (stage, detail) => {
            if (stage !== "done") console.log(`${prefix}: ${stage}${detail ? ` (${detail})` : ""}`);
          }),
        );
        const facts = await collectMatchFacts(analyseParsedMatch(parsed));
        await writeFile(destination, JSON.stringify(facts, null, 2) + "\n");
        completed++;
        console.log(`${prefix}: ${facts.match.shape}, готово`);
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        failures.push({ matchId: row.matchId, error: message });
        console.log(`${prefix}: ОШИБКА: ${message}`);
      }
    }
  }

  await Promise.all(Array.from({ length: Math.min(CONCURRENCY, rows.length) }, () => worker()));

  await writeFile(path.join(OUT, "failures.json"), JSON.stringify(failures, null, 2) + "\n");
  console.log(`\nГотово новых: ${completed}; уже было: ${skipped}; ошибок: ${failures.length}`);
  if (failures.length) process.exitCode = 2;
}

main();
