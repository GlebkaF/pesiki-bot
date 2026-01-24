/**
 * Test script to verify formatter output without Telegram
 * Run with: npx tsx src/test-formatter.ts
 */

import { formatStatsMessage, stripHtml } from "./formatter.js";
import type { PlayerStats } from "./stats.js";

// Mock data to test formatting
const mockStats: PlayerStats[] = [
  { playerId: 93921511, wins: 5, losses: 1, totalMatches: 6, winRate: 83 },
  { playerId: 167818283, wins: 3, losses: 3, totalMatches: 6, winRate: 50 },
  { playerId: 94014640, wins: 1, losses: 4, totalMatches: 5, winRate: 20 },
  { playerId: 1869377945, wins: 0, losses: 0, totalMatches: 0, winRate: 0 },
  { playerId: 126449680, wins: 2, losses: 1, totalMatches: 3, winRate: 67 },
  { playerId: 92126977, wins: 0, losses: 2, totalMatches: 2, winRate: 0 },
  { playerId: 40087920, wins: 0, losses: 0, totalMatches: 0, winRate: 0 },
];

console.log("=== Testing Formatter ===\n");

const message = formatStatsMessage(mockStats);
const plainMessage = stripHtml(message);

console.log("HTML Message (for Telegram):");
console.log("---");
console.log(message);
console.log("---\n");

console.log("Plain Message (console):");
console.log("---");
console.log(plainMessage);
console.log("---\n");

// Verify expected content
const checks = [
  { name: "Has date header", pass: message.includes("Dota Stats for") },
  { name: "Has fire emoji for 75%+", pass: message.includes("🔥") },
  { name: "Has check emoji for 50%+", pass: message.includes("✅") },
  { name: "Has skull emoji for low rate", pass: message.includes("💀") },
  { name: "Has sleep emoji for inactive", pass: message.includes("😴") },
  { name: "Has team summary", pass: message.includes("Team Summary") },
  { name: "Has total matches", pass: message.includes("Matches: 22") },
  { name: "Has win rate", pass: message.includes("Win Rate:") },
  { name: "Has active players count", pass: message.includes("5/7") },
  { name: "Players sorted by activity", pass: message.indexOf("93921511") < message.indexOf("1869377945") },
];

console.log("Verification checks:");
let allPassed = true;
for (const check of checks) {
  const status = check.pass ? "✅" : "❌";
  console.log(`  ${status} ${check.name}`);
  if (!check.pass) allPassed = false;
}

console.log("");
if (allPassed) {
  console.log("✅ All checks passed!");
  process.exit(0);
} else {
  console.log("❌ Some checks failed!");
  process.exit(1);
}
