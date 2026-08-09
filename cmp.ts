import "dotenv/config";
import { readFileSync, writeFileSync } from "node:fs";
import OpenAI from "openai";
import { buildPrompt, FORMATS } from "./src/analyze-v2.js";
import { lintAnalysis } from "./src/lexicon.js";

const d = JSON.parse(readFileSync("data/eval-set/8936739966.coach.json", "utf8"));
const fmt = FORMATS.find((f) => f.id === "coach")!;
const o = new OpenAI({ apiKey: process.env.OPENAI_API_KEY, baseURL: process.env.OPENAI_BASE_URL });

const MODELS = ["gpt-5.2", "gpt-5.5", "gpt-5.6-luna", "gpt-5.6-sol", "gpt-5.6-terra"];
const out: Record<string, string> = {};

for (const model of MODELS) {
  const t0 = Date.now();
  try {
    const r = await o.chat.completions.create({
      model,
      messages: [
        { role: "system", content: buildPrompt(fmt) },
        { role: "user", content: d.context },
      ],
      max_completion_tokens: 4000,
    });
    const text = r.choices[0]?.message?.content || "";
    out[model] = text;
    const banned = lintAnalysis(text);
    const words = text.split(/\s+/).length;
    const times = (text.match(/\b\d{1,2}:\d{2}\b/g) || []).length;
    const nums = (text.match(/\b\d{3,}\b/g) || []).length;
    console.log(
      `${model.padEnd(14)} ${((Date.now() - t0) / 1000).toFixed(0).padStart(3)}s  ${String(words).padStart(4)} слов  таймингов ${String(times).padStart(2)}  чисел ${String(nums).padStart(2)}  запрещённых: ${banned.length ? banned.join(",") : "нет"}`,
    );
  } catch (e) {
    console.log(`${model.padEnd(14)} ОШИБКА: ${(e as Error).message.slice(0, 80)}`);
  }
}
writeFileSync("/tmp/model-cmp.json", JSON.stringify(out, null, 1));
