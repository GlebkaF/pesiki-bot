import assert from "node:assert/strict";
import { classifyEconomyShape, inferEffectiveRole, nearbyEconomyDelta, type EconomyPoint } from "./match-facts.js";

function points(values: Array<[number, number]>): EconomyPoint[] {
  return values.map(([minute, advantage]) => ({ minute, advantage }));
}

const cases: Array<{ name: string; actual: unknown; expected: unknown }> = [
  {
    name: "маленький краткий лид не считается throw",
    actual: classifyEconomyShape({ won: false, durationMin: 28, points: points([[7, 7_000], [20, -20_000], [28, -35_000]]) }),
    expected: "loss",
  },
  {
    name: "содержательный лид считается throw",
    actual: classifyEconomyShape({ won: false, durationMin: 35, points: points([[10, 16_000], [20, 5_000], [35, -20_000]]) }),
    expected: "throw",
  },
  {
    name: "40-минутная мясорубка не считается stomp",
    actual: classifyEconomyShape({ won: true, durationMin: 40, points: points([[10, 1_000], [20, 29_000], [40, 17_000]]) }),
    expected: "win",
  },
  {
    name: "поздний развал равной игры не считается stomped",
    actual: classifyEconomyShape({ won: false, durationMin: 42, points: points([[10, 2_000], [20, -800], [42, -60_000]]) }),
    expected: "loss",
  },
  {
    name: "короткий односторонний проигрыш считается stomped",
    actual: classifyEconomyShape({ won: false, durationMin: 19, points: points([[10, -15_000], [19, -45_000]]) }),
    expected: "stomped",
  },
  {
    name: "дельта вокруг драки не захватывает предыдущую минуту",
    actual: nearbyEconomyDelta(points([[18, -9_000], [19, 500], [20, 3_000]]), 19.16, 19.25),
    expected: 2_500,
  },
  { name: "роумер с четырьмя крипами не core", actual: inferEffectiveRole("core", 4), expected: "support" },
  { name: "фармящий игрок исходной core-линии остаётся core", actual: inferEffectiveRole("core", 15), expected: "core" },
  { name: "очевидный carry исправляет ошибочный parser support", actual: inferEffectiveRole("support", 25), expected: "core" },
  { name: "саппорт с умеренным добиванием остаётся support", actual: inferEffectiveRole("support", 15), expected: "support" },
];

for (const testCase of cases) assert.equal(testCase.actual, testCase.expected, testCase.name);
console.log(`✓ match facts: ${cases.length} regression cases`);
