/** Скачивает и разбирает реплеи всех матчей текущего classifier eval. */
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { analyseParsedMatch, mergeOfficialStats } from "../src/analyze-v2.js";
import { collectMatchFacts } from "../src/match-facts.js";
import { fetchAndParseReplay } from "../src/replay.js";

const INPUT = process.env.CLASSIFIER_INPUT || "data/classifier-eval/matches.json";
const OUT = process.env.CLASSIFIER_DEEP_OUT || "data/classifier-eval/deep";

interface EvalRow {
  matchId: number;
}

async function main(): Promise<void> {
  const rows = JSON.parse(await readFile(INPUT, "utf8")) as EvalRow[];
  await mkdir(OUT, { recursive: true });
  const failures: Array<{ matchId: number; error: string }> = [];

  for (const [index, row] of rows.entries()) {
    const prefix = `[${index + 1}/${rows.length}] ${row.matchId}`;
    process.stdout.write(`${prefix}: `);
    try {
      const parsed = await mergeOfficialStats(
        await fetchAndParseReplay(row.matchId, (stage, detail) => {
          if (stage !== "done") process.stdout.write(`${stage}${detail ? `(${detail})` : ""} `);
        }),
      );
      const facts = await collectMatchFacts(analyseParsedMatch(parsed));
      await writeFile(path.join(OUT, `${row.matchId}.facts.json`), JSON.stringify(facts, null, 2) + "\n");
      console.log(`${facts.match.shape}, готово`);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      failures.push({ matchId: row.matchId, error: message });
      console.log(`ОШИБКА: ${message}`);
    }
  }

  await writeFile(path.join(OUT, "failures.json"), JSON.stringify(failures, null, 2) + "\n");
  console.log(`\nГотово: ${rows.length - failures.length}/${rows.length}; ошибок ${failures.length}`);
  if (failures.length) process.exitCode = 2;
}

main();
