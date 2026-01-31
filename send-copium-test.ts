/**
 * Test script for COPIUM analysis (biased analysis that defends our stack)
 * 
 * Usage: npx tsx send-copium-test.ts [match_id]
 */

import "dotenv/config";
import { analyzeMatchCopium, analyzeLastMatchCopium, getCopiumContext } from "./src/analyze-copium.js";

async function main() {
  const matchId = process.argv[2];
  
  console.log("=".repeat(60));
  console.log("💊 COPIUM ANALYSIS TEST");
  console.log("=".repeat(60));
  
  if (process.argv.includes("--context")) {
    // Just show the context being sent to LLM
    console.log("\n📋 Raw context for LLM:\n");
    const context = await getCopiumContext();
    console.log(context);
    return;
  }
  
  let result: string;
  
  if (matchId) {
    const id = parseInt(matchId, 10);
    if (isNaN(id)) {
      console.error("❌ Invalid match ID");
      process.exit(1);
    }
    console.log(`\n🎮 Analyzing match ${id}...\n`);
    result = await analyzeMatchCopium(id);
  } else {
    console.log("\n🎮 Analyzing last party match...\n");
    result = await analyzeLastMatchCopium();
  }
  
  // Strip HTML tags for console output
  const plainResult = result
    .replace(/<[^>]+>/g, "")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&amp;/g, "&");
  
  console.log(plainResult);
  console.log("\n" + "=".repeat(60));
}

main().catch(console.error);
