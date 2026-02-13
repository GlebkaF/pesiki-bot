/**
 * Full /copium flow test: OpenDota (direct) + OpenAI (proxy).
 * Run inside container: npx tsx test-copium-flow.ts
 */
import "./src/proxy.js";
import { fetchRecentMatches } from "./src/opendota.js";
import { analyzeLastMatchCopium } from "./src/analyze-copium.js";

async function test() {
  console.log("1. OpenDota (should go direct, no proxy)...");
  try {
    const matches = await fetchRecentMatches(92126977);
    console.log("   ✅ Matches:", matches.length);
  } catch (e: unknown) {
    console.log("   ❌", (e as Error).message);
    process.exit(1);
  }

  console.log("\n2. OpenAI /copium (via proxy)...");
  try {
    const result = await analyzeLastMatchCopium();
    console.log("   ✅ Got analysis, length:", result.length);
    console.log("   Preview:", result.slice(0, 150) + "...");
  } catch (e: unknown) {
    console.log("   ❌", (e as Error).message);
    if ((e as Error).cause) console.log("   Cause:", ((e as Error).cause as Error).message);
    process.exit(1);
  }

  console.log("\n✅ All tests passed");
}

test();
