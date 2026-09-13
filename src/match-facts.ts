import { isOpenDotaLimited } from "./proxy.js";
/**
 * Детерминированная редакторская фактура матча.
 *
 * Здесь нет языковой модели и оценочных формулировок: только вычисленные события,
 * сравнения и история. Голос получает этот пакет вместо сырого дампа реплея.
 */
import { fetchMatchApi, fetchRecentMatches, type RecentMatch } from "./opendota.js";
import { fetchHeroes } from "./heroes.js";
import type { MatchAnalysis, OurPlayer } from "./analyze-v2.js";
import type { ParsedPlayer } from "./replay.js";

export type MatchShape = "big-comeback" | "comeback" | "throw" | "stomp" | "stomped" | "win" | "loss";
export const MATCH_FACT_VERSION = 10 as const;

export interface EconomyPoint {
  minute: number;
  advantage: number;
}

interface KeyMoment {
  startMinute: number;
  endMinute: number;
  ourDeaths: number;
  enemyDeaths: number;
  /** Дельта ближайшего поминутного интервала, не экономика самой драки. */
  nearbyMinuteDelta: number | null;
  buildingsNearby: string[];
  roshanNearby: boolean;
}

interface PlayerHistory {
  previousGames: number;
  recentRecord: string;
  enteringStreak: string;
  currentHeroInLast20: number;
  recentHeroes: string[];
}

interface OurPlayerFacts {
  name: string;
  grammaticalGender?: "masculine" | "feminine";
  hero: string;
  lane: string;
  role: string;
  unusualRole: boolean;
  profileNotes: string[];
  kda: string;
  kdaSource?: ParsedPlayer["kda_source"];
  apm?: number;
  csAt10: number;
  networthAt10: number;
  networthAt20: number;
  networthFinal: number;
  heroDamage: number;
  towerDamage: number;
  damageTaken: number;
  /** Only recipient-verified replay detail; absent for legacy aggregate HEAL. */
  healing_self?: number;
  healing_allies?: number;
  observer_wards_placed?:number;
  sentry_wards_placed?:number;
  teamfightParticipationPct?: number;
  deathsAt: number[];
  deathTimelineReliable: boolean;
  worstDeathCluster?: { deaths: number; fromMinute: number; toMinute: number };
  mostKilled?: string;
  mostKilledBy?: string;
  teamRanks: string[];
  history?: PlayerHistory;
}

interface EnemyPlayerFacts {
  /** Ник из реплея. Голос обязан воспроизводить его без изменений. */
  name: string;
  hero: string;
  kda: string;
  kdaSource?: ParsedPlayer["kda_source"];
}

interface PreviousStackMatch {
  matchId: number;
  scope: "solo" | "partial" | "stack";
  /** Разница между началами игр — только для порядка, не называй её перерывом. */
  startGapMin: number | null;
  /** Время от конца предыдущей игры до старта текущей. */
  queueGapMin: number | null;
  result: "win" | "loss";
  players: string[];
  picks: string[];
}

export interface MatchFactPacket {
  version: typeof MATCH_FACT_VERSION;
  match: {
    id: number;
    durationMin: number;
    result: "win" | "loss";
    ourSide: "radiant" | "dire";
    score?: string;
    shape: MatchShape;
    storySignals: string[];
  };
  economy: {
    at10?: EconomyPoint;
    at20?: EconomyPoint;
    worst?: EconomyPoint;
    best?: EconomyPoint;
    final?: EconomyPoint;
    leadChanges: number;
  };
  lanes: string[];
  keyMoments: KeyMoment[];
  objectives: {
    roshanAt: number[];
    finalBuildings: Array<{ minute: number; building: string; takenByUs: boolean }>;
  };
  ourPlayers: OurPlayerFacts[];
  enemyPlayers: EnemyPlayerFacts[];
  awards: { mvp?: string; enemyMostDeaths?: string; knownPlayersMostDeaths?: string };
  history: {
    available: boolean;
    previousStackMatches: PreviousStackMatch[];
    stackEnteringStreak: string;
    recentStackRecord: string;
  };
}

function sum(values: number[]): number {
  return values.reduce((total, value) => total + value, 0);
}

function isWin(match: RecentMatch): boolean {
  return (match.player_slot < 128) === match.radiant_win;
}

export function economyTimeline(a: MatchAnalysis): EconomyPoint[] {
  const ours = a.parsed.players.filter((p) => p.team === a.ourTeam);
  const enemies = a.parsed.players.filter((p) => p.team !== a.ourTeam);
  const lengths = a.parsed.players.map((p) => p.networth_by_minute?.length ?? 0).filter(Boolean);
  if (!lengths.length) return [];

  const points: EconomyPoint[] = [];
  for (let minute = 0; minute < Math.min(...lengths); minute++) {
    const ourGold = sum(ours.map((p) => p.networth_by_minute?.[minute] ?? 0));
    const enemyGold = sum(enemies.map((p) => p.networth_by_minute?.[minute] ?? 0));
    points.push({ minute:minute+1, advantage: ourGold - enemyGold });
  }
  // Поминутная кривая заканчивается перед фактическим финалом. Итоговые
  // networth_final добавляем отдельной точкой, иначе best/worst/final занижены.
  const finalAdvantage = sum(ours.map((p) => p.networth_final)) - sum(enemies.map((p) => p.networth_final));
  points.push({ minute: a.parsed.duration_min, advantage: finalAdvantage });
  return points;
}

export function classifyEconomyShape(input: {
  won: boolean;
  durationMin: number;
  points: EconomyPoint[];
}): MatchShape {
  const { won, durationMin, points } = input;
  if (!points.length) return won ? "win" : "loss";
  const worst = Math.min(...points.map((p) => p.advantage));
  const best = Math.max(...points.map((p) => p.advantage));
  const final = points.at(-1)?.advantage ?? 0;

  if (won && worst <= -12_000 && final > 0) return "big-comeback";
  if (won && worst <= -5_000 && final > 0) return "comeback";
  // Пять тысяч в Turbo часто живут одну минуту. Между ложными и явными
  // throw в red-team выборке был чистый зазор: 7k против 16k.
  if (!won && best >= 12_000 && final < 0) return "throw";
  // Долгая мясорубка с поздним преимуществом — не stomp всего матча.
  if (won && durationMin <= 30 && worst >= -3_000 && best >= 15_000) return "stomp";
  const at20 = pointAt(points, 20)?.advantage;
  // Поздний развал равной 40-минутной игры не должен переписывать всю игру
  // в stomped. Для длинной игры требуем заметное отставание уже к 20-й.
  if (!won && best <= 3_000 && worst <= -15_000 && (durationMin <= 30 || (at20 ?? 0) <= -10_000)) {
    return "stomped";
  }
  return won ? "win" : "loss";
}

function classifyMatch(a: MatchAnalysis, points: EconomyPoint[]): MatchShape {
  return classifyEconomyShape({ won: a.weWon, durationMin: a.parsed.duration_min, points });
}

function storySignals(a: MatchAnalysis, points: EconomyPoint[], shape: MatchShape): string[] {
  const final = points.at(-1)?.advantage ?? 0;
  const scoreDiff = Math.abs((a.parsed.radiant_score ?? 0) - (a.parsed.dire_score ?? 0));
  const changes = leadChanges(points);
  const signals: string[] = [];
  if (shape === "big-comeback") signals.push("deep_comeback");
  if (shape === "big-comeback" && changes >= 2) signals.push("double_reversal");
  if (!a.weWon && a.parsed.duration_min <= 20.5 && final <= -30_000) {
    signals.push("short_lopsided_loss");
  }
  if (shape === "stomp" && a.parsed.duration_min < 22 && final >= 30_000 && scoreDiff >= 25) {
    signals.push("short_lopsided_win");
  }
  return signals;
}

function pointAt(points: EconomyPoint[], minute: number): EconomyPoint | undefined {
  // Финальная точка добавляется в конец отдельно и у короткого матча может
  // оказаться на индексе 20 со временем 20.01. Индекс массива — не минута.
  return points.find((point) => point.minute === minute);
}

export function nearbyEconomyDelta(points: EconomyPoint[], startMinute: number, endMinute: number): number | null {
  // Берём реальные соседние snapshots. Финальная дробная точка подходит как
  // after для последней драки; отсутствие данных остаётся null, а не ложным 0.
  const before = [...points].reverse().find((point) => point.minute <= startMinute);
  const after = points.find((point) => point.minute >= endMinute);
  return after && before ? after.advantage - before.advantage : null;
}

function leadChanges(points: EconomyPoint[]): number {
  let changes = 0;
  let previousSign = 0;
  let candidateSign = 0;
  let candidateRun = 0;
  for (const point of points) {
    // Мелкие колебания около нуля — не смена лидера. Новый знак должен
    // продержаться две точки подряд за пределами мёртвой зоны.
    const sign = point.advantage >= 2_500 ? 1 : point.advantage <= -2_500 ? -1 : 0;
    if (!sign) {
      candidateSign = 0;
      candidateRun = 0;
      continue;
    }
    if (sign === candidateSign) candidateRun++;
    else {
      candidateSign = sign;
      candidateRun = 1;
    }
    if (candidateRun < 2 || sign === previousSign) continue;
    if (previousSign) changes++;
    previousSign = sign;
  }
  return changes;
}

function buildingName(raw: string): string {
  return raw
    .replace("npc_dota_", "")
    .replace("goodguys_", "radiant ")
    .replace("badguys_", "dire ")
    .replace("fort", "трон")
    .replace("_melee_rax", " барак ближнего боя")
    .replace("_range_rax", " дальний барак");
}

function selectKeyMoments(a: MatchAnalysis, points: EconomyPoint[]): KeyMoment[] {
  return (a.parsed.teamfights ?? [])
    .map((fight) => {
      const ourDeaths = a.ourTeam === "radiant" ? fight.radiant_died : fight.dire_died;
      const enemyDeaths = a.ourTeam === "radiant" ? fight.dire_died : fight.radiant_died;
      // Реплей хранит экономику только целыми минутами. Это контекст вокруг
      // драки, а не её точный swing: короткая драка может целиком лежать между
      // двумя snapshots. Имя поля обязано не провоцировать голос на ложную причинность.
      const nearbyMinuteDelta = nearbyEconomyDelta(points, fight.start_min, fight.end_min);
      const nearby = (a.parsed.buildings ?? [])
        .filter((b) => b.name.includes("tower") || b.name.includes("rax") || b.name.includes("fort"))
        .filter((b) => b.min >= fight.start_min - 0.5 && b.min <= fight.end_min + 1.5)
        .map((b) => `${b.min.toFixed(1)} ${buildingName(b.name)} (${b.killed_by_team === a.ourTeam ? "мы" : "они"})`);
      const roshanNearby = (a.parsed.roshan_kills_min ?? []).some(
        (minute) => minute >= fight.start_min - 0.5 && minute <= fight.end_min + 1.5,
      );
      const score = (ourDeaths + enemyDeaths) * 3 + Math.abs(ourDeaths - enemyDeaths) * 4 + Math.abs(nearbyMinuteDelta ?? 0) / 1000 + nearby.length * 4;
      return {
        moment: {
          startMinute: fight.start_min,
          endMinute: fight.end_min,
          ourDeaths,
          enemyDeaths,
          nearbyMinuteDelta,
          buildingsNearby: nearby,
          roshanNearby,
        },
        score,
      };
    })
    .filter(({ moment }) => moment.ourDeaths + moment.enemyDeaths >= 3)
    .sort((a, b) => b.score - a.score)
    .slice(0, 5)
    .map(({ moment }) => moment)
    .sort((a, b) => a.startMinute - b.startMinute);
}

function deathCluster(times: number[]): OurPlayerFacts["worstDeathCluster"] {
  if (times.length < 2) return undefined;
  let best = { deaths: 1, fromMinute: times[0], toMinute: times[0] };
  for (let left = 0; left < times.length; left++) {
    let right = left;
    while (right + 1 < times.length && times[right + 1] - times[left] <= 5) right++;
    if (right - left + 1 > best.deaths) {
      best = { deaths: right - left + 1, fromMinute: times[left], toMinute: times[right] };
    }
  }
  return best.deaths >= 2 ? best : undefined;
}

function topRelation(values?: Record<string, number>): string | undefined {
  if (!values) return undefined;
  const first = Object.entries(values).sort((a, b) => b[1] - a[1])[0];
  return first ? `${first[0]} x${first[1]}` : undefined;
}

function ranksFor(player: ParsedPlayer, team: ParsedPlayer[]): string[] {
  // healing смешивает получателей (включая себя), поэтому не даём голосу ни
  // сумму, ни лидерство: из них нельзя вывести лечение союзников или самолечение.
  const metrics: Array<[string, (p: ParsedPlayer) => number]> = [
    ["урон по героям", (p) => p.hero_damage],
    ["урон по башням", (p) => p.tower_damage],
    ["итоговая голда", (p) => p.networth_final],
    ["крипы", (p) => p.last_hits],
    ["полученный урон", (p) => p.damage_taken],
    ["смерти", (p) => p.deaths],
  ];
  return metrics
    .filter(([, value]) => value(player) > 0 && Math.max(...team.map(value)) === value(player))
    .map(([label]) => `первый в команде: ${label}`);
}

function mostDeaths(players: ParsedPlayer[]): ParsedPlayer | undefined {
  return [...players].sort((a, b) => b.deaths - a.deaths || a.kills + a.assists - (b.kills + b.assists))[0];
}

export function inferEffectiveRole(laneRole: string, csAt10: number): "core" | "support" {
  // Parser core требует хотя бы минимальной фарм-фактуры. В обратную сторону
  // 25+ CS достаточно, чтобы исправить очевидных Drow/SF/Muerta, которых
  // lane clustering ошибочно оставил support.
  return (laneRole === "core" && csAt10 >= 15) || csAt10 >= 25 ? "core" : "support";
}

export function compactHealingFacts(player:ParsedPlayer,team:ParsedPlayer[]):{healing_self?:number;healing_allies?:number} {
  const d=player.combat_details;
  if(!d||!["combat-log-v1","combat-log-v2"].includes(d.version))return {};
  const valid=(n:unknown):n is number=>typeof n==="number"&&Number.isFinite(n)&&n>=0;
  const normalize=(hero:string)=>hero.replace(/^npc_dota_hero_/,"").replace(/_/g,"");
  const self=normalize(player.hero);
  const allies=new Set(team.filter(p=>p.team===player.team&&normalize(p.hero)!==self).map(p=>normalize(p.hero)));
  const targets=d.healing?.by_target;
  const identitiesKnown=d.healing?.units===0||(d.coverage as {healing_target_identity?:boolean}|undefined)?.healing_target_identity===true;
  const canSplit=identitiesKnown&&targets&&typeof targets==="object"&&!Array.isArray(targets)&&Object.values(targets).every(valid)&&(player.team==="radiant"||player.team==="dire");
  return {healing_self:valid(d.healing?.self)?d.healing.self:undefined,
    healing_allies:canSplit?Object.entries(targets).filter(([hero])=>allies.has(normalize(hero))).reduce((sum,[,value])=>sum+value,0):undefined};
}

export function compactWardFacts(player:ParsedPlayer):{observer_wards_placed?:number;sentry_wards_placed?:number} {
  const d=player.combat_details;
  if(!d||!["combat-log-v1","combat-log-v2"].includes(d.version)||d.coverage?.ward_placements!==true||!Array.isArray(d.wards))return {};
  const placements=d.wards.filter(w=>w.event==="place");
  return {observer_wards_placed:placements.filter(w=>w.kind==="observer").length,sentry_wards_placed:placements.filter(w=>w.kind==="sentry").length};
}

export function playerFacts(our: OurPlayer, team: ParsedPlayer[], history?: PlayerHistory): OurPlayerFacts {
  const p = our.parsed;
  const profile = our.config.analysisProfile;
  const rawDeathTimes = p.death_times_min ?? [];
  const deathTimelineReliable = rawDeathTimes.length === p.deaths;
  const deathTimes = deathTimelineReliable ? rawDeathTimes : [];
  // Парсер назначает «core» самому богатому игроку каждой обнаруженной линии.
  // Одинокий роумер из-за этого иногда становился кором с 4 крипами. Для
  // персональных профилей считаем core только при минимальной фарм-фактуре.
  const effectiveRole = inferEffectiveRole(p.lane_role, p.cs_at_10);
  return {
    name: our.config.dotaName,
    grammaticalGender: profile?.grammaticalGender,
    hero: p.hero,
    lane: p.lane,
    role: effectiveRole,
    unusualRole: Boolean(profile?.usualRoles?.length && !profile.usualRoles.includes(effectiveRole)),
    profileNotes: profile?.notes ?? [],
    kda: `${p.kills}/${p.deaths}/${p.assists}`,
    kdaSource:p.kda_source,
    apm: p.actions_per_min,
    csAt10: p.cs_at_10,
    networthAt10: p.networth_at_10,
    networthAt20: p.networth_at_20,
    networthFinal: p.networth_final,
    heroDamage: p.hero_damage,
    towerDamage: p.tower_damage,
    damageTaken: p.damage_taken,
    ...compactHealingFacts(p,team),
    ...compactWardFacts(p),
    teamfightParticipationPct:
      p.teamfight_participation === undefined ? undefined : Math.round(p.teamfight_participation * 100),
    deathsAt: deathTimes,
    deathTimelineReliable,
    worstDeathCluster: deathCluster(deathTimes),
    mostKilled: topRelation(p.killed),
    mostKilledBy: topRelation(p.killed_by),
    teamRanks: ranksFor(p, team),
    history,
  };
}

function streak(matches: RecentMatch[]): string {
  if (!matches.length) return "нет предыдущих матчей";
  const won = isWin(matches[0]);
  let count = 0;
  for (const match of matches) {
    if (isWin(match) !== won) break;
    count++;
  }
  return `${won ? "винстрик" : "лузстрик"} ${count}`;
}

async function collectHistory(a: MatchAnalysis): Promise<{
  available: boolean;
  players: Map<number, PlayerHistory>;
  previousStackMatches: PreviousStackMatch[];
  stackEnteringStreak: string;
  recentStackRecord: string;
}> {
  const unavailable = {available:false,players:new Map<number, PlayerHistory>(),previousStackMatches:[] as PreviousStackMatch[],stackEnteringStreak:"история недоступна",recentStackRecord:"история недоступна"};
  if (isOpenDotaLimited()) return unavailable;
  let targetStart = a.parsed.start_time;
  if (!targetStart) {
    try {
      targetStart = (await fetchMatchApi(a.parsed.match_id)).start_time;
      a.parsed.start_time = targetStart;
    } catch {
      // Без времени матча нельзя отличить прошлое от будущего. Лучше честно
      // убрать историю, чем подсунуть голосу future leakage.
      return {
        available: false,
        players: new Map(),
        previousStackMatches: [],
        stackEnteringStreak: "история недоступна",
        recentStackRecord: "история недоступна",
      };
    }
  }
  const rawByPlayer = new Map<number, RecentMatch[]>();
  for (const our of a.ours) {
    const previous = (await fetchRecentMatches(our.config.steamId))
      .filter((m) => m.match_id !== a.parsed.match_id && m.start_time < targetStart)
      .slice(0, 20);
    if (isOpenDotaLimited()) return unavailable;
    rawByPlayer.set(our.config.steamId, previous);
  }

  const heroes = await fetchHeroes();
  const heroById = new Map([...heroes].map(([id, hero]) => [id, hero.localized_name]));
  const heroIdByInternalName = new Map(
    [...heroes].map(([id, hero]) => [hero.name.replace("npc_dota_hero_", ""), id]),
  );
  const players = new Map<number, PlayerHistory>();

  for (const our of a.ours) {
    const matches = rawByPlayer.get(our.config.steamId) ?? [];
    const last10 = matches.slice(0, 10);
    const wins = last10.filter(isWin).length;
    const currentHeroId = heroIdByInternalName.get(our.parsed.hero);
    players.set(our.config.steamId, {
      previousGames: matches.length,
      recentRecord: `${wins}-${last10.length - wins} за последние ${last10.length}`,
      enteringStreak: streak(matches),
      currentHeroInLast20: currentHeroId === undefined ? 0 : matches.filter((m) => m.hero_id === currentHeroId).length,
      recentHeroes: matches.slice(0, 5).map((m) => heroById.get(m.hero_id) ?? String(m.hero_id)),
    });
  }

  const grouped = new Map<number, Array<{ our: OurPlayer; match: RecentMatch }>>();
  for (const our of a.ours) {
    for (const match of rawByPlayer.get(our.config.steamId) ?? []) {
      const entries = grouped.get(match.match_id) ?? [];
      entries.push({ our, match });
      grouped.set(match.match_id, entries);
    }
  }
  // Серия стака не должна склеиваться по двум людям из четверых/пятерых.
  // Для полноценного стака требуем минимум трёх общих игроков; duo и solo
  // остаются валидной историей только когда текущий матч сам duo/solo.
  const minimumPartySize = a.ours.length >= 3 ? 3 : a.ours.length;
  const groups = [...grouped.entries()]
    .filter(([, entries]) => entries.length >= minimumPartySize)
    .sort((a, b) => b[1][0].match.start_time - a[1][0].match.start_time);
  const previousStackMatches = groups.slice(0, 5).map(([matchId, entries]) => ({
    matchId,
    scope: entries.length >= 3 ? "stack" as const : entries.length === 2 ? "partial" as const : "solo" as const,
    startGapMin: a.parsed.start_time ? Math.round((a.parsed.start_time - entries[0].match.start_time) / 60) : null,
    queueGapMin: a.parsed.start_time
      ? Math.max(0, Math.round((a.parsed.start_time - entries[0].match.start_time - entries[0].match.duration) / 60))
      : null,
    result: isWin(entries[0].match) ? "win" as const : "loss" as const,
    players: entries.map((entry) => entry.our.config.dotaName),
    picks: entries.map((entry) => `${entry.our.config.dotaName}=${heroById.get(entry.match.hero_id) ?? entry.match.hero_id}`),
  }));
  const pseudoMatches = groups.map(([, entries]) => entries[0].match);
  const sessionMatches = pseudoMatches.filter((match) => targetStart - match.start_time <= 3 * 60 * 60);
  const recent = pseudoMatches.slice(0, 10);
  const recentWins = recent.filter(isWin).length;

  return {
    available: true,
    players,
    previousStackMatches,
    stackEnteringStreak: sessionMatches.length ? streak(sessionMatches) : "первый матч сессии",
    recentStackRecord: `${recentWins}-${recent.length - recentWins} за последние ${recent.length} совместных матчей`,
  };
}

export async function collectMatchFacts(a: MatchAnalysis): Promise<MatchFactPacket> {
  const points = economyTimeline(a);
  const shape = classifyMatch(a, points);
  const team = a.parsed.players.filter((p) => p.team === a.ourTeam);
  const enemies = a.parsed.players.filter((p) => p.team !== a.ourTeam);
  const history = await collectHistory(a);
  const worst = points.length ? points.reduce((x, y) => (x.advantage < y.advantage ? x : y)) : undefined;
  const best = points.length ? points.reduce((x, y) => (x.advantage > y.advantage ? x : y)) : undefined;

  return {
    version: MATCH_FACT_VERSION,
    match: {
      id: a.parsed.match_id,
      durationMin: a.parsed.duration_min,
      result: a.weWon ? "win" : "loss",
      ourSide: a.ourTeam,
      score:
        a.parsed.radiant_score !== undefined && a.parsed.dire_score !== undefined
          ? a.ourTeam === "radiant"
            ? `${a.parsed.radiant_score}:${a.parsed.dire_score}`
            : `${a.parsed.dire_score}:${a.parsed.radiant_score}`
          : undefined,
      shape,
      storySignals: storySignals(a, points, shape),
    },
    economy: {
      at10: pointAt(points, 10),
      at20: pointAt(points, 20),
      worst,
      best,
      final: points.at(-1),
      leadChanges: leadChanges(points),
    },
    lanes: a.laneReport,
    keyMoments: selectKeyMoments(a, points),
    objectives: {
      roshanAt: a.parsed.roshan_kills_min ?? [],
      finalBuildings: (a.parsed.buildings ?? [])
        .filter((b) => b.name.includes("rax") || b.name.includes("fort") || b.name.includes("tower4"))
        .map((b) => ({ minute: b.min, building: buildingName(b.name), takenByUs: b.killed_by_team === a.ourTeam })),
    },
    ourPlayers: a.ours.map((our) => playerFacts(our, team, history.players.get(our.config.steamId))),
    enemyPlayers: enemies.map((enemy) => ({
      name: enemy.name,
      hero: enemy.hero,
      kda: `${enemy.kills}/${enemy.deaths}/${enemy.assists}`,
      kdaSource:enemy.kda_source,
    })),
    awards: {
      mvp: a.mvp ? `${a.mvp.name} (${a.mvp.hero})` : undefined,
      enemyMostDeaths: mostDeaths(enemies)
        ? `${mostDeaths(enemies)?.name} (${mostDeaths(enemies)?.hero}) — ${mostDeaths(enemies)?.deaths} смертей`
        : undefined,
      knownPlayersMostDeaths: mostDeaths(a.ours.map((our) => our.parsed))
        ? `${mostDeaths(a.ours.map((our) => our.parsed))?.name} (${mostDeaths(a.ours.map((our) => our.parsed))?.hero}) — ${mostDeaths(a.ours.map((our) => our.parsed))?.deaths} смертей`
        : undefined,
    },
    history: {
      available: history.available,
      previousStackMatches: history.previousStackMatches,
      stackEnteringStreak: history.stackEnteringStreak,
      recentStackRecord: history.recentStackRecord,
    },
  };
}

export function renderFactPacket(packet: MatchFactPacket): string {
  const timestamp = (minute: number): string => {
    const seconds = Math.max(0, Math.round(minute * 60));
    return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`;
  };
  const economyPoint = (point?: EconomyPoint) =>
    point ? { time: timestamp(point.minute), advantage: point.advantage } : undefined;
  // В коде тайминги хранятся дробными минутами (10.53 = 10:32), но модель
  // закономерно читает их как часы (10:53). Голосу отдаём только готовые mm:ss.
  const voicePacket = {
    version:packet.version,
    lanes:packet.lanes,
    enemyPlayers:packet.enemyPlayers.map(({name,hero,kda})=>({name,hero,kda})),
    awards:packet.awards,
    history:packet.history,
    match: { ...packet.match, duration: timestamp(packet.match.durationMin), durationMin: undefined },
    economy: {
      at10: economyPoint(packet.economy.at10),
      at20: economyPoint(packet.economy.at20),
      worst: economyPoint(packet.economy.worst),
      best: economyPoint(packet.economy.best),
      final: economyPoint(packet.economy.final),
      leadChanges: packet.economy.leadChanges,
    },
    keyMoments: packet.keyMoments.map((moment) => ({
      ...moment,
      startTime: timestamp(moment.startMinute),
      endTime: timestamp(moment.endMinute),
      startMinute: undefined,
      endMinute: undefined,
    })),
    objectives: {
      roshanAt: packet.objectives.roshanAt.map(timestamp),
      finalBuildings: packet.objectives.finalBuildings.map((building) => ({
        ...building,
        time: timestamp(building.minute),
        minute: undefined,
      })),
    },
    ourPlayers: packet.ourPlayers.map((player) => ({
      name:player.name,grammaticalGender:player.grammaticalGender,hero:player.hero,
      lane:player.lane,role:player.role,unusualRole:player.unusualRole,profileNotes:player.profileNotes,
      kda:player.kda,kdaSource:player.kdaSource,apm:player.apm,csAt10:player.csAt10,
      networthAt10:player.networthAt10,networthAt20:player.networthAt20,networthFinal:player.networthFinal,
      heroDamage:player.heroDamage,towerDamage:player.towerDamage,damageTaken:player.damageTaken,
      healing_self:player.healing_self,healing_allies:player.healing_allies,
      observer_wards_placed:player.observer_wards_placed,sentry_wards_placed:player.sentry_wards_placed,
      teamfightParticipationPct:player.teamfightParticipationPct,
      deathTimelineReliable:player.deathTimelineReliable,mostKilled:player.mostKilled,mostKilledBy:player.mostKilledBy,
      teamRanks:player.teamRanks,history:player.history,
      deathsAt: player.deathsAt.map(timestamp),
      worstDeathCluster: player.worstDeathCluster
        ? {
            deaths: player.worstDeathCluster.deaths,
            from: timestamp(player.worstDeathCluster.fromMinute),
            to: timestamp(player.worstDeathCluster.toMinute),
          }
        : undefined,
    })),
  };
  return `ДЕТЕРМИНИРОВАННАЯ ФАКТУРА МАТЧА. Все числа и сравнения ниже посчитаны кодом.\n${JSON.stringify(voicePacket, null, 2)}`;
}
