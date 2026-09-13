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

// New replay detail must stay out of LLM input; only verified healing totals pass.
const {compactHealingFacts,playerFacts,renderFactPacket,MATCH_FACT_VERSION}=await import("./match-facts.js");
const {PLAYERS}=await import("./config.js");
const config=PLAYERS.find(p=>p.steamId===94014640)!;
const {MAIN_VOICE_PROMPT}=await import("./analyze-main-voice.js");
const caster={steam_id:"1",hero:"warlock",kda_source:"opendota",team:"radiant",healing:22000,kills:2,deaths:1,assists:14,actions_per_min:320,lane_role:"support",cs_at_10:4,death_times_min:[8],combat_details:{version:"combat-log-v2",coverage:{healing_target_identity:true},healing:{self:19000,other_heroes:2900,units:100,by_target:{warlock:19000,lina:2000,pudge:900,npc_dota_creep:100}},casts:Array.from({length:3000},()=>({min:1,ability:"RAW_CAST_SENTINEL"})),gold:Array.from({length:3000},()=>({min:1,value:50,reason:0}))}} as unknown as import("./replay.js").ParsedPlayer;
const ally={steam_id:"2",hero:"npc_dota_hero_lina",team:"radiant"} as import("./replay.js").ParsedPlayer;
const enemy={steam_id:"3",hero:"pudge",team:"dire"} as import("./replay.js").ParsedPlayer;
assert.deepEqual(compactHealingFacts(caster,[caster,ally,enemy]),{healing_self:19000,healing_allies:2000},"self, enemy and creep healing excluded from allied total");
assert.deepEqual(compactHealingFacts({...caster,combat_details:undefined},[caster,ally]),{},"legacy 22k healing cannot be attributed");
const zero={...caster,combat_details:{...caster.combat_details!,healing:{...caster.combat_details!.healing,self:0,by_target:{warlock:0}}}};
assert.deepEqual(compactHealingFacts(zero,[zero,ally]),{healing_self:0,healing_allies:0},"measured zero remains explicit");
const facts=playerFacts({parsed:caster,config},[caster,ally]);
assert.equal(facts.kda,"2/1/14");assert.equal(playerFacts({parsed:{...caster,kda_source:undefined},config},[caster,ally]).kda,"не подтверждено","raw combat counters never become final KDA in LLM facts");assert.equal(facts.hero,"warlock");assert.equal(facts.apm,320);
const packet={version:MATCH_FACT_VERSION,match:{id:123,durationMin:20,result:"win",ourSide:"radiant",shape:"win",storySignals:[]},economy:{leadChanges:0},lanes:[],keyMoments:[],objectives:{roshanAt:[],finalBuildings:[]},ourPlayers:[{...facts,combat_details:caster.combat_details}],enemyPlayers:[],awards:{},history:{available:false,previousStackMatches:[],stackEnteringStreak:"",recentStackRecord:""},parsed:caster} as unknown as import("./match-facts.js").MatchFactPacket;
const compact=renderFactPacket(packet);
assert.ok(compact.includes('"healing_self": 19000'));
assert.ok(compact.includes('"healing_allies": 2000'));
assert.ok(!compact.includes("RAW_CAST_SENTINEL"));
assert.ok(!compact.includes("combat_details"));assert.ok(!compact.includes('"gold"'));
assert.ok(compact.length<8000,"thousands of events do not enlarge the voice packet");
assert.ok(MAIN_VOICE_PROMPT.includes("healing_self"));assert.ok(MAIN_VOICE_PROMPT.includes("healing_allies"));
assert.ok(MAIN_VOICE_PROMPT.includes("точный ник · герой · K/D/A · APM число"),"existing Our players format preserved");
console.log("✓ compact voice input and verified healing regressions");

const {economyTimeline}=await import("./match-facts.js");
const {findTurningPoint}=await import("./analyze-v2.js");
const timed={duration_min:6,players:[{team:"radiant",networth_by_minute:[0,0,500,500,500],networth_final:600},{team:"dire",networth_by_minute:[0,0,0,0,0],networth_final:0}]} as unknown as import("./replay.js").ParsedMatch;
const timeline=economyTimeline({parsed:timed,ourTeam:"radiant"} as import("./analyze-v2.js").MatchAnalysis);
assert.equal(timeline[0].minute,1,"first networth sample is minute one");
assert.equal(timeline[2].minute,3);assert.equal(timeline[2].advantage,500);
assert.ok(findTurningPoint(timed,"radiant").includes("на 3 мин самый резкий сдвиг"));
assert.ok(findTurningPoint(timed,"radiant").includes("пик преимущества нас: 3 мин"));
console.log("✓ replay minute index regression");

const ambiguousHeal={...caster,combat_details:{...caster.combat_details!,coverage:{...caster.combat_details!.coverage,healing_target_identity:undefined}}};
assert.equal(compactHealingFacts(ambiguousHeal,[ambiguousHeal,ally]).healing_allies,undefined,"ambiguous illusion healing is omitted from LLM facts");

const {compactWardFacts}=await import("./match-facts.js");
const wardPlayer={...caster,obs_wards_placed:100,sentry_wards_placed:100,combat_details:{...caster.combat_details!,coverage:{...caster.combat_details!.coverage,ward_placements:true},wards:[...Array.from({length:100},()=>({min:1,kind:"observer",event:"purchase"})),{min:2,kind:"observer",event:"place"},{min:3,kind:"observer",event:"place"},{min:4,kind:"observer",event:"destroy"}]}} as import("./replay.js").ParsedPlayer;
assert.deepEqual(compactWardFacts(wardPlayer),{observer_wards_placed:2,sentry_wards_placed:0},"100 purchases and a destroyed ward do not inflate two installations");
assert.deepEqual(compactWardFacts({...wardPlayer,combat_details:undefined}),{},"legacy purchase counters are omitted from placement facts");
assert.deepEqual(compactWardFacts({...wardPlayer,combat_details:{...wardPlayer.combat_details!,coverage:{...wardPlayer.combat_details!.coverage,ward_placements:false}}}),{},"partial attribution cannot claim a full placement count");
const wardFacts=playerFacts({parsed:wardPlayer,config},[wardPlayer]);
assert.equal(wardFacts.observer_wards_placed,2);
assert.ok(renderFactPacket({...packet,ourPlayers:[wardFacts]}).includes('"observer_wards_placed": 2'));
console.log("✓ purchases are not ward placement regressions");
