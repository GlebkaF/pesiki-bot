/**
 * Test script to verify formatter output without Telegram
 * Run with: npx tsx src/test-formatter.ts
 */

import assert from "node:assert/strict";

import { formatStatsMessage, stripHtml } from "./formatter.js";
import { calculateStats, type PlayerStats } from "./stats.js";
import type { RecentMatch } from "./opendota.js";

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

  const deathless = { ...mockStats[0], totalDeaths: 0 };
  const soloMessage = await formatStatsMessage([deathless]);
  assert.ok(soloMessage.includes("🥨 Сухарь: ProGamer (0 смертей за период)"));
  const multipleMessage = await formatStatsMessage([
    deathless,
    { ...mockStats[1], totalDeaths: 0 },
    mockStats[3], // An inactive player also has zero deaths, but does not qualify.
  ]);
  assert.equal((multipleMessage.match(/🥨 Сухарь:/g) ?? []).length, 2);
  assert.ok(!multipleMessage.includes("🥨 Сухарь: InactivePlayer"));
  assert.ok(!multipleMessage.includes("Фидер:"));
  assert.ok(!message.includes("Сухарь:"));
  assert.ok(!message.includes("Спринтер:"));
  assert.ok(!message.includes("Аккуратист:"));
  assert.ok(!(await formatStatsMessage([{ ...deathless, totalDeaths: 1 }])).includes("Сухарь:"));

  const luckyStats = calculateStats(123, "Lucky", [3, 6, 7, 0].map((score, index) => ({
    match_id: index + 1, start_time: Math.floor(Date.now() / 1000),
    hero_id: 1, player_slot: 0, radiant_win: true, duration: 1800,
    kills: score, deaths: score, assists: score,
  } as RecentMatch)));
  const luckyMessage = await formatStatsMessage([luckyStats]);
  assert.ok(luckyMessage.includes("🍀 Фартовый: Lucky (7/7/7)"));
  const unequalGames = { ...luckyStats, heroes: [
    { heroId: 1, isWin: true, kda: [2, 3, 4] as [number, number, number] },
    { heroId: 1, isWin: true, kda: [4, 3, 2] as [number, number, number] },
  ], totalKills: 6, totalDeaths: 6, totalAssists: 6 };
  assert.ok(!(await formatStatsMessage([unequalGames])).includes("Фартовый:"));
  assert.ok(!message.includes("Фартовый:"));

  const sixes = { ...luckyStats, heroes: luckyStats.heroes.filter(h => h.kda?.[0] !== 7) };
  assert.ok((await formatStatsMessage([sixes])).includes("Lucky (6/6/6)"));
  const otherScores = { ...luckyStats, heroes: luckyStats.heroes.filter(h => [0, 3].includes(h.kda![0])) };
  assert.match(await formatStatsMessage([otherScores]), /Фартовый: Lucky \((?:0\/0\/0|3\/3\/3)\)/);
  const sevenPlayer = { ...luckyStats, playerId: 456, playerName: "Seven" };
  assert.ok((await formatStatsMessage([sixes, sevenPlayer])).includes("Фартовый: Seven (7/7/7)"));
  const replayPlayer = { ...mockStats[0], replayNominations: {
    wardMatches: 6, observers: 30, fightMatches: 6,
    fights: 8, participated: 5, teammateParticipations: 31,
  } };
  const replayMessage = await formatStatsMessage([replayPlayer]);
  assert.ok(replayMessage.includes("Большой брат: ProGamer (5 observer-вардов/игра)"));
  assert.ok(replayMessage.includes("Фотограф: ProGamer (5/8 драк, команда 97%)"));
  const partial = { ...replayPlayer, replayNominations: { ...replayPlayer.replayNominations, wardMatches: 5, fightMatches: 5 } };
  const partialMessage = await formatStatsMessage([partial]);
  assert.ok(!partialMessage.includes("Большой брат:"));
  assert.ok(!partialMessage.includes("Фотограф:"));
  for (const changes of [{ fights: 2, participated: 0 }, { participated: 7 }, { observers: 0, participated: 8 }]) {
    const report = await formatStatsMessage([{ ...replayPlayer, replayNominations: { ...replayPlayer.replayNominations, ...changes } }]);
    assert.ok(!report.includes("Фотограф:"));
    if ('observers' in changes) assert.ok(!report.includes("Большой брат:"));
  }

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
    // Конкретная номинация зависит от данных. Требовать одновременно все
    // взаимоисключающие категории (спринтер + марафонец, утро + ночь) нельзя.
    {
      name: "Has a useful set of nominations",
      pass: plainMessage.split("\n").filter((line) => /^\p{Emoji_Presentation} .*:\s/u.test(line.trim())).length >= 8,
    },
    {
      name: "No player has more than two nominations",
      pass: (() => {
        const nominationLines = plainMessage
          .split("\n")
          .filter((line) => /^\p{Emoji_Presentation}|^[\u{1F300}-\u{1FAFF}]/u.test(line.trim()));
        const counts = new Map<string, number>();

        for (const line of nominationLines) {
          const match = line.match(/:\s([^()]+)\s\(/);
          if (!match) continue;
          const playerName = match[1].trim();
          counts.set(playerName, (counts.get(playerName) ?? 0) + 1);
        }

        return [...counts.values()].every((count) => count <= 2);
      })(),
    },
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
