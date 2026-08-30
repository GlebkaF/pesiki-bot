/**
 * Вкусовой eval основного голоса на трёх эталонных сюжетах.
 * Запуск: npx tsx tools/eval-main-voice.ts
 */
import { mkdir, writeFile } from "node:fs/promises";
import { analyseParsedMatch, mergeOfficialStats } from "../src/analyze-v2.js";
import { generateMainVoiceAnalysis } from "../src/analyze-main-voice.js";
import { collectMatchFacts, renderFactPacket } from "../src/match-facts.js";
import { fetchAndParseReplay } from "../src/replay.js";

const OUT = "data/main-voice-eval";

const CASES = [
  {
    matchId: 8973735117,
    slug: "comeback",
    expectedStory:
      "В начале стак превозмогал, затем долго и ощутимо сосал, но не развалился и в итоге затащил. " +
      "Нужен комментарий Песика сбоку о заслуженном камбеке через страдание, а не сухая констатация победы.",
  },
  {
    matchId: 8973704266,
    slug: "warmup-stomp",
    expectedStory:
      "Стак назвал это разминочным матчем, после чего его жёстко трахнули и обоссали. " +
      "Смешное здесь — добровольность похода на эту разминку и масштаб унижения, а не попытка найти полезный урок.",
  },
  {
    matchId: 8973789729,
    slug: "autobots",
    expectedStory:
      "Против стака будто закинуло автоботов, чтобы ребята без сопротивления разъебали их в салат. " +
      "Победа должна ощущаться подозрительно лёгкой, как компенсационная выдача Габена, но без отдельной ролевой маски Габена.",
  },
] as const;

async function main(): Promise<void> {
  await mkdir(OUT, { recursive: true });
  const factsOnly = process.argv.includes("--facts-only");
  const sections: string[] = ["# Main voice eval", ""];

  for (const testCase of CASES) {
    process.stdout.write(`${testCase.matchId} (${testCase.slug})... `);
    const parsed = await mergeOfficialStats(await fetchAndParseReplay(testCase.matchId));
    const analysis = analyseParsedMatch(parsed);
    const facts = await collectMatchFacts(analysis);
    await writeFile(`${OUT}/${testCase.matchId}.${testCase.slug}.facts.json`, JSON.stringify(facts, null, 2) + "\n");
    if (factsOnly) {
      console.log(`${facts.match.shape}, фактура готова`);
      continue;
    }
    const text = await generateMainVoiceAnalysis(renderFactPacket(facts), testCase.expectedStory);

    await writeFile(`${OUT}/${testCase.matchId}.${testCase.slug}.txt`, text + "\n");
    sections.push(
      `## ${testCase.matchId} · ${testCase.slug}`,
      "",
      `Ожидаемый сюжет: ${testCase.expectedStory}`,
      "",
      text,
      "",
    );
    console.log(`${text.split(/\s+/).length} слов`);
  }

  await writeFile(`${OUT}/report.md`, sections.join("\n"));
  console.log(`Готово: ${OUT}/report.md`);
}

main();
