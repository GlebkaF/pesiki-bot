/**
 * Генерирует набор разборов для оценки качества текста.
 * Разные матчи и разные форматы выпуска, чтобы проверить не один шаблон, а все.
 * Запуск: npx tsx tools/gen-eval-set.ts
 */
import { mkdir, writeFile } from "node:fs/promises";
import { fetchAndParseReplay } from "../src/replay.js";
import {
  analyseParsedMatch,
  buildContext,
  generateAnalysis,
  mergeOfficialStats,
  FORMATS,
  type FormatId,
} from "../src/analyze-v2.js";

const OUT = "data/eval-set";

const CASES: { matchId: number; format: FormatId }[] = [
  { matchId: 8936739966, format: "coach" },
  { matchId: 8936782091, format: "gaben" },
  { matchId: 8936090479, format: "chatter" },
  { matchId: 8895443601, format: "enemy" },
  { matchId: 8936009381, format: "commentator" },
];

async function main() {
  await mkdir(OUT, { recursive: true });

  for (const { matchId, format } of CASES) {
    const fmt = FORMATS.find((f) => f.id === format);
    if (!fmt) continue;
    process.stdout.write(`${matchId} (${fmt.title})... `);

    const parsed = await mergeOfficialStats(await fetchAndParseReplay(matchId));
    const analysis = analyseParsedMatch(parsed);
    const context = buildContext(analysis);
    const text = await generateAnalysis(context, fmt);

    await writeFile(
      `${OUT}/${matchId}.${format}.json`,
      JSON.stringify(
        {
          matchId,
          format: fmt.id,
          formatTitle: fmt.title,
          ourPlayers: analysis.ours.map((o) => ({ name: o.config.dotaName, hero: o.parsed.hero })),
          weWon: analysis.weWon,
          contextChars: context.length,
          text,
          context,
        },
        null,
        1,
      ),
    );
    console.log(`${text.length} симв`);
  }
  console.log(`\nготово: ${OUT}/`);
}

main();
