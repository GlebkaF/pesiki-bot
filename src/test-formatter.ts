/**
 * Test script to verify formatter output without Telegram
 * Run with: npx tsx src/test-formatter.ts
 */

import { formatStatsMessage, stripHtml } from "./formatter.js";
import type { PlayerStats } from "./stats.js";

// Mock data to test formatting with heroes, APM, and KDA
// Hero IDs: 1=Anti-Mage, 2=Axe, 3=Bane, 4=Bloodseeker, 5=Crystal Maiden, 6=Drow Ranger
const mockStats: PlayerStats[] = [
  {
    playerId: 93921511,
    playerName: "ProGamer",
    wins: 5,
    losses: 1,
    totalMatches: 6,
    winRate: 83,
    heroes: [
      { heroId: 1, isWin: true },
      { heroId: 1, isWin: true },  // Same hero multiple times
      { heroId: 2, isWin: true },
      { heroId: 2, isWin: true },
      { heroId: 2, isWin: true },
      { heroId: 6, isWin: false },
    ],
    avgApm: 185,
    avgKda: 4.25,
  },
  {
    playerId: 167818283,
    playerName: "MidPlayer",
    wins: 3,
    losses: 3,
    totalMatches: 6,
    winRate: 50,
    heroes: [
      { heroId: 1, isWin: true },
      { heroId: 2, isWin: false },
      { heroId: 3, isWin: true },
      { heroId: 4, isWin: false },
      { heroId: 5, isWin: true },
      { heroId: 6, isWin: false },
    ],
    avgApm: 142,
    avgKda: 2.8,
  },
  {
    playerId: 94014640,
    playerName: "Support4Life",
    wins: 1,
    losses: 4,
    totalMatches: 5,
    winRate: 20,
    heroes: [
      { heroId: 5, isWin: false },
      { heroId: 5, isWin: false },
      { heroId: 5, isWin: false },
      { heroId: 5, isWin: false },
      { heroId: 5, isWin: true },
    ],
    avgApm: 98,
    avgKda: 1.95,
  },
  {
    playerId: 1869377945,
    playerName: "InactivePlayer",
    wins: 0,
    losses: 0,
    totalMatches: 0,
    winRate: 0,
    heroes: [],
  },
  {
    playerId: 126449680,
    playerName: "CarryMaster",
    wins: 2,
    losses: 1,
    totalMatches: 3,
    winRate: 67,
    heroes: [
      { heroId: 1, isWin: true },
      { heroId: 2, isWin: true },
      { heroId: 3, isWin: false },
    ],
    avgApm: 156,
    avgKda: 3.5,
  },
  {
    playerId: 92126977,
    playerName: "OfflaneKing",
    wins: 0,
    losses: 2,
    totalMatches: 2,
    winRate: 0,
    heroes: [
      { heroId: 1, isWin: false },
      { heroId: 2, isWin: false },
    ],
    avgApm: 112,
    avgKda: 1.2,
  },
  {
    playerId: 40087920,
    playerName: "AnotherInactive",
    wins: 0,
    losses: 0,
    totalMatches: 0,
    winRate: 0,
    heroes: [],
  },
];

async function runTests() {
  console.log("=== Testing Formatter ===\n");

  const message = await formatStatsMessage(mockStats);
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
    {
      name: "Players sorted by activity",
      pass: message.indexOf("ProGamer") < message.indexOf("InactivePlayer"),
    },
    { name: "Has hero names", pass: message.includes("Anti-Mage") },
    { name: "Has grouped wins (W)", pass: message.includes("W") },
    { name: "Has grouped losses (L)", pass: message.includes("L") },
    { name: "Has grouped W/L format", pass: /\d+W\/\d+L/.test(message) || /\d+W/.test(message) },
    { name: "Has player nicknames", pass: message.includes("ProGamer") && message.includes("MidPlayer") },
    { name: "Does not show player IDs", pass: !message.includes("93921511") },
    { name: "Has APM for players", pass: message.includes("APM:") },
    { name: "Has average team APM", pass: message.includes("Avg APM:") },
    { name: "Has KDA for players", pass: message.includes("KDA:") },
    { name: "Has average team KDA", pass: message.includes("Avg KDA:") },
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
}

runTests();
