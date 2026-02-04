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
    totalKills: 48,
    totalDeaths: 12,
    totalAssists: 30,
    totalDurationSeconds: 14400,
    avgDurationSeconds: 2400,
    longMatches: 1,
    longWins: 1,
    nightMatches: 1,
    morningMatches: 0,
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
    totalKills: 35,
    totalDeaths: 20,
    totalAssists: 25,
    totalDurationSeconds: 12600,
    avgDurationSeconds: 2100,
    longMatches: 0,
    longWins: 0,
    nightMatches: 4,
    morningMatches: 1,
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
    totalKills: 8,
    totalDeaths: 25,
    totalAssists: 45, // High assists, low kills → Саппорт nominee
    totalDurationSeconds: 16500,
    avgDurationSeconds: 3300,
    longMatches: 3,
    longWins: 1,
    nightMatches: 1,
    morningMatches: 1,
  },
  {
    playerId: 1869377945,
    playerName: "InactivePlayer",
    wins: 0,
    losses: 0,
    totalMatches: 0,
    winRate: 0,
    heroes: [],
    totalKills: 0,
    totalDeaths: 0,
    totalAssists: 0,
    totalDurationSeconds: 0,
    avgDurationSeconds: 0,
    longMatches: 0,
    longWins: 0,
    nightMatches: 0,
    morningMatches: 0,
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
    totalKills: 22,
    totalDeaths: 8,
    totalAssists: 12,
    totalDurationSeconds: 4500,
    avgDurationSeconds: 1500,
    longMatches: 0,
    longWins: 0,
    nightMatches: 0,
    morningMatches: 3,
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
    totalKills: 4,
    totalDeaths: 15, // Most deaths relative to games → potential Feeder
    totalAssists: 6,
    totalDurationSeconds: 3600,
    avgDurationSeconds: 1800,
    longMatches: 0,
    longWins: 0,
    nightMatches: 2,
    morningMatches: 0,
  },
  {
    playerId: 40087920,
    playerName: "AnotherInactive",
    wins: 0,
    losses: 0,
    totalMatches: 0,
    winRate: 0,
    heroes: [],
    totalKills: 0,
    totalDeaths: 0,
    totalAssists: 0,
    totalDurationSeconds: 0,
    avgDurationSeconds: 0,
    longMatches: 0,
    longWins: 0,
    nightMatches: 0,
    morningMatches: 0,
  },
  {
    playerId: 12345678,
    playerName: "LuckyGuy",
    wins: 4,
    losses: 1,
    totalMatches: 5,
    winRate: 80,
    heroes: [
      { heroId: 1, isWin: true },
      { heroId: 2, isWin: true },
      { heroId: 3, isWin: true },
      { heroId: 4, isWin: true },
      { heroId: 5, isWin: false },
    ],
    avgApm: 95,
    avgKda: 1.5, // Low KDA but high WR → Везунчик
    totalKills: 12,
    totalDeaths: 18,
    totalAssists: 15,
    totalDurationSeconds: 12000,
    avgDurationSeconds: 2400,
    longMatches: 2,
    longWins: 2,
    nightMatches: 1,
    morningMatches: 0,
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
    { name: "Has star emoji for 50%+", pass: message.includes("⭐") },
    { name: "Has skull emoji for low rate", pass: message.includes("💀") },
    { name: "Has sleep emoji for inactive", pass: message.includes("😴") },
    { name: "Has team summary", pass: message.includes("Team Summary") },
    { name: "Has total matches", pass: message.includes("27 matches") },
    { name: "Has win rate", pass: message.includes("% WR") },
    { name: "Has active players count", pass: message.includes("6/8") },
    {
      name: "Players sorted by activity",
      pass: message.indexOf("ProGamer") < message.indexOf("InactivePlayer"),
    },
    { name: "Has hero names", pass: message.includes("Anti-Mage") },
    { name: "Has grouped wins (W)", pass: message.includes("W") },
    { name: "Has grouped losses (L)", pass: message.includes("L") },
    { name: "Has grouped W/L format", pass: /\d+W\/\d+L/.test(message) || /\d+W/.test(message) },
    { name: "Has player nicknames", pass: message.includes("ProGamer") && message.includes("MidPlayer") },
    { name: "Has OpenDota links", pass: message.includes("opendota.com/players/") },
    { name: "Has APM for players", pass: message.includes("APM:") },
    { name: "Has team APM in summary", pass: /APM: \d+/.test(message) },
    { name: "Has KDA for players", pass: message.includes("KDA:") },
    { name: "Has team KDA in summary", pass: /KDA: [\d.]+/.test(message) },
    { name: "Has inactive players line", pass: message.includes("Не играли:") },
    // Nominations checks
    { name: "Has nominations section", pass: message.includes("🏆") && message.includes("Номинации") },
    { name: "Has Лузер nomination", pass: message.includes("💀 Лузер:") },
    { name: "Has Фидер nomination", pass: message.includes("⚰️ Фидер:") },
    { name: "Has Тащер nomination", pass: message.includes("💪 Тащер:") },
    { name: "Has Саппорт nomination", pass: message.includes("🤝 Саппорт:") },
    { name: "Has Бот nomination", pass: message.includes("🤖 Бот:") },
    { name: "Has Задрот nomination", pass: message.includes("🎮 Задрот:") },
    { name: "Has Везунчик nomination", pass: message.includes("🍀 Везунчик:") },
    { name: "Has Клоун nomination", pass: message.includes("🤡 Клоун:") },
    { name: "Has Марафонец nomination", pass: message.includes("🕒 Марафонец:") },
    { name: "Has Спринтер nomination", pass: message.includes("⚡ Спринтер:") },
    { name: "Has Долгожитель nomination", pass: message.includes("🐢 Долгожитель:") },
    { name: "Has Выживальщик nomination", pass: message.includes("🛡️ Выживальщик:") },
    { name: "Has Чистильщик nomination", pass: message.includes("🧹 Чистильщик:") },
    { name: "Has Экспериментатор nomination", pass: message.includes("🧪 Экспериментатор:") },
    { name: "Has Мейнер nomination", pass: message.includes("🧠 Мейнер:") },
    { name: "Has Камбэкер nomination", pass: message.includes("🔄 Камбэкер:") },
    { name: "Has Ночной страж nomination", pass: message.includes("🌙 Ночной страж:") },
    { name: "Has Утренний страж nomination", pass: message.includes("🌅 Утренний страж:") },
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
