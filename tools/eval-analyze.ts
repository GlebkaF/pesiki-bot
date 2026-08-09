/**
 * Сравнение старого и нового разбора матча на одном наборе матчей.
 * Запуск: npx tsx tools/eval-analyze.ts <match_id> [<match_id> ...]
 */
import { writeFile, mkdir } from "node:fs/promises";
import { analyzeMatch } from "../src/analyze.js";
import { analyzeMatchV2 } from "../src/analyze-v2.js";

const OUT_DIR = "data/eval";

const STOCK_PHRASES = [
  /проиграли,? потому что/i,
  /вы затащили/i,
  /совет[: ]/i,
  /\bbkb\b|бкб/i,
  /позиционк/i,
  /ставь варды|мало вардов/i,
  /что хорошо|что плохо/i,
];

function strip(html: string): string {
  return html.replace(/<[^>]*>/g, "");
}

function metrics(text: string) {
  const plain = strip(text);
  return {
    chars: plain.length,
    words: plain.split(/\s+/).filter(Boolean).length,
    anonymous: (plain.match(/Anonymous/g) || []).length,
    timestamps: (plain.match(/\b\d{1,2}:\d{2}\b/g) || []).length,
    numbers: (plain.match(/\b\d{3,}\b/g) || []).length,
    stockPhrases: STOCK_PHRASES.filter((r) => r.test(plain)).map((r) => String(r)),
  };
}

async function main() {
  const ids = process.argv.slice(2).map(Number).filter(Boolean);
  if (!ids.length) {
    console.error("укажи match_id");
    process.exit(1);
  }
  await mkdir(OUT_DIR, { recursive: true });

  const rows: Record<string, unknown>[] = [];
  for (const id of ids) {
    console.log(`\n=== матч ${id} ===`);

    let v1 = "";
    try {
      v1 = await analyzeMatch(id);
    } catch (e) {
      v1 = `ОШИБКА v1: ${(e as Error).message}`;
    }
    let v2 = "";
    try {
      v2 = await analyzeMatchV2(id, (s) => process.stdout.write(`  v2:${s}\n`));
    } catch (e) {
      v2 = `ОШИБКА v2: ${(e as Error).message}`;
    }

    await writeFile(`${OUT_DIR}/${id}.v1.txt`, strip(v1));
    await writeFile(`${OUT_DIR}/${id}.v2.txt`, strip(v2));

    const m1 = metrics(v1);
    const m2 = metrics(v2);
    rows.push({ id, version: "v1", ...m1 });
    rows.push({ id, version: "v2", ...m2 });

    console.log(`  v1: ${m1.words} слов, таймингов ${m1.timestamps}, Anonymous ${m1.anonymous}, штампов ${m1.stockPhrases.length}`);
    console.log(`  v2: ${m2.words} слов, таймингов ${m2.timestamps}, Anonymous ${m2.anonymous}, штампов ${m2.stockPhrases.length}`);
  }

  await writeFile(`${OUT_DIR}/summary.json`, JSON.stringify(rows, null, 2));

  const agg = (v: string, k: string) =>
    rows.filter((r) => r.version === v).reduce((s, r) => s + (r[k] as number), 0);
  console.log("\n=== ИТОГО ===");
  console.log(`таймингов в тексте: v1 ${agg("v1", "timestamps")} -> v2 ${agg("v2", "timestamps")}`);
  console.log(`конкретных чисел:   v1 ${agg("v1", "numbers")} -> v2 ${agg("v2", "numbers")}`);
  console.log(`Anonymous:          v1 ${agg("v1", "anonymous")} -> v2 ${agg("v2", "anonymous")}`);
  console.log(`штампов:            v1 ${agg("v1", "stockPhrases")} -> v2 ${agg("v2", "stockPhrases")}`);
  console.log(`\nтексты: ${OUT_DIR}/`);
}

main();
