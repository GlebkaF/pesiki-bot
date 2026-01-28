/**
 * Test script to send a roast message to Telegram
 * Run with: npx tsx send-roast.ts [--exclude=playerId]
 * Example: npx tsx send-roast.ts --exclude=97643532
 */

import { createBot, sendMessage } from "./src/bot.js";
import { generateRoastWithExclusion, formatRoastMessage } from "./src/roast.js";

async function main(): Promise<void> {
  // Parse --exclude argument
  const excludeArg = process.argv.find(arg => arg.startsWith("--exclude="));
  const excludeId = excludeArg ? parseInt(excludeArg.split("=")[1], 10) : null;

  if (excludeId) {
    console.log(`🔥 Generating roast (excluding player ${excludeId})...\n`);
  } else {
    console.log("🔥 Generating roast of the day...\n");
  }

  try {
    // Get roast
    const roast = await generateRoastWithExclusion(excludeId);

    // Format message
    const message = formatRoastMessage(roast);

    // Print to console
    console.log("=== Roast Preview ===");
    console.log(message.replace(/<[^>]*>/g, "")); // Strip HTML for console
    console.log("=====================\n");

    // Send to Telegram
    console.log("Sending to Telegram...");
    const bot = createBot();
    await sendMessage(bot, message);
    console.log("✅ Roast sent successfully!");

    process.exit(0);
  } catch (error) {
    console.error("❌ Failed to send roast:", error);
    process.exit(1);
  }
}

main();
