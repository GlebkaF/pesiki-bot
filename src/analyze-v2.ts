/**
 * /analyze v2 — разбор матча по данным собственного парсера реплеев.
 *
 * Отличия от v1 (analyze.ts):
 *  - игроки опознаются по steam_id из реплея, а не по account_id из API (приватные профили больше не Anonymous);
 *  - в контексте есть лейнинг, экономика по минутам, тимфайты и тайминги предметов, а не только итоговый счёт;
 *  - MVP/LVP и перелом матча считаются кодом, а не на глаз языковой моделью;
 *  - основной голос получает компактный детерминированный пакет фактов.
 */
import { getAppFetch } from "./proxy.js";
import { fetchHeroes } from "./heroes.js";
import { PLAYERS, PLAYER_IDS, type Player } from "./config.js";
import { fetchPlayerProfile, fetchRecentMatches } from "./opendota.js";
import { fetchAndParseReplay, toSteam32, type ParsedMatch, type ParsedPlayer, type ParseProgress } from "./replay.js";
import { escapeHtml } from "./telegram-html.js";
import { generateMainVoiceAnalysis } from "./analyze-main-voice.js";
import { collectMatchFacts, renderFactPacket } from "./match-facts.js";

/** Адрес витрины. Пустой — значит ссылку в пост не добавляем. */
const SITE_URL = (process.env.SITE_URL || "").replace(/\/$/, "");

/** Формат выпуска. Один и тот же матч в разных рамках читается как разный текст. */
export interface OurPlayer {
  parsed: ParsedPlayer;
  config: Player;
}

export interface MatchAnalysis {
  parsed: ParsedMatch;
  ours: OurPlayer[];
  weWon: boolean;
  ourTeam: "radiant" | "dire";
  mvp: ParsedPlayer | null;
  lvp: ParsedPlayer | null;
  turningPoint: string;
  laneReport: string[];
}

const bySteam32 = new Map<number, Player>(PLAYERS.map((p) => [p.steamId, p]));

function sum(nums: number[]): number {
  return nums.reduce((a, b) => a + b, 0);
}

/**
 * Вклад игрока: доля в уроне и убийствах команды, экономика и цена смертей.
 * Считаем кодом — иначе модель раздаёт MVP по одному лишь KDA.
 */
function impactScore(p: ParsedPlayer, team: ParsedPlayer[], deathCostAvailable: boolean): number {
  const teamDamage = Math.max(1, sum(team.map((t) => t.hero_damage)));
  const teamKills = Math.max(1, sum(team.map((t) => t.kills)));
  const teamNW = Math.max(1, sum(team.map((t) => t.networth_final)));
  const damageShare = p.hero_damage / teamDamage;
  const killShare = (p.kills + p.assists * 0.5) / (teamKills * 1.5);
  const economyShare = p.networth_final / teamNW;

  // В части матчей (замечено во всех турбо) поле с потерянным на смертях золотом
  // не приходит вовсе. Считать его нулём — значит молча снять штраф за смерти,
  // поэтому в таких матчах берём сами смерти и перенормируем веса.
  if (!deathCostAvailable) {
    const teamDeaths = Math.max(1, sum(team.map((t) => t.deaths)));
    const deathShare = p.deaths / teamDeaths;
    return (damageShare * 0.35 + killShare * 0.3 + economyShare * 0.2) / 0.85 * 0.85 - deathShare * 0.4;
  }

  const deathCost = p.gold_lost_to_death / Math.max(1, p.networth_final);
  return damageShare * 0.35 + killShare * 0.3 + economyShare * 0.2 - deathCost * 0.4;
}

/** Перелом матча — момент, где преимущество команды по нетворсу максимально меняет знак. */
function findTurningPoint(parsed: ParsedMatch, ourTeam: "radiant" | "dire"): string {
  const ours = parsed.players.filter((p) => p.team === ourTeam);
  const theirs = parsed.players.filter((p) => p.team !== ourTeam);
  const minutes = Math.min(...parsed.players.map((p) => (p.networth_by_minute ?? []).length));
  if (minutes < 5) return "нет данных по экономике";

  const adv: number[] = [];
  for (let i = 0; i < minutes; i++) {
    adv.push(sum(ours.map((p) => (p.networth_by_minute ?? [])[i] ?? 0)) - sum(theirs.map((p) => (p.networth_by_minute ?? [])[i] ?? 0)));
  }

  let bestIdx = 0;
  let bestSwing = 0;
  for (let i = 1; i < adv.length; i++) {
    const swing = Math.abs(adv[i] - adv[i - 1]);
    if (swing > bestSwing) {
      bestSwing = swing;
      bestIdx = i;
    }
  }
  const peak = adv.indexOf(Math.max(...adv));
  const trough = adv.indexOf(Math.min(...adv));
  return [
    `(плюс = впереди МЫ, минус = впереди ОНИ)`,
    `на ${bestIdx} мин самый резкий сдвиг: ${adv[bestIdx] > 0 ? "+" : ""}${adv[bestIdx]} золота (за минуту качнуло на ${bestSwing})`,
    `пик преимущества нас: ${peak} мин (${adv[peak] > 0 ? "+" : ""}${adv[peak]})`,
    `худший момент: ${trough} мин (${adv[trough]})`,
    `на конец: ${adv[adv.length - 1] > 0 ? "+" : ""}${adv[adv.length - 1]}`,
  ].join("; ");
}

/**
 * Кто выиграл линию — по CS и нетворсу на 10-й минуте.
 * Всё формулируем от лица нашей команды: модель иначе путает, кто есть кто.
 */
function buildLaneReport(parsed: ParsedMatch, ourTeam: "radiant" | "dire"): string[] {
  const lanes = ["top", "mid", "bot"] as const;
  const report: string[] = [];
  for (const lane of lanes) {
    const ours = parsed.players.filter((p) => p.team === ourTeam && p.lane === lane);
    const theirs = parsed.players.filter((p) => p.team !== ourTeam && p.lane === lane);
    if (!ours.length || !theirs.length) continue;
    const diff = sum(ours.map((p) => p.networth_at_10)) - sum(theirs.map((p) => p.networth_at_10));
    report.push(
      `${lane}: МЫ ${ours.map((p) => `${p.hero} ${p.cs_at_10}cs`).join(" + ")} против ` +
        `ОНИ ${theirs.map((p) => `${p.hero} ${p.cs_at_10}cs`).join(" + ")} -> ` +
        `к 10 мин ${diff > 0 ? "МЫ выиграли линию" : "МЫ проиграли линию"} на ${Math.abs(diff)} золота`,
    );
  }
  return report;
}

/**
 * Счёт из combat log расходится с официальным (ассисты в логе считаются шире),
 * а игроки видели свой KDA своими глазами. Поэтому базовые числа берём из API,
 * а из реплея оставляем то, чего в API нет: линии, тимфайты, тайминги, кривые.
 */
export async function mergeOfficialStats(parsed: ParsedMatch): Promise<ParsedMatch> {
  try {
    const fetchFn = await getAppFetch();
    const res = await fetchFn(`https://api.opendota.com/api/matches/${parsed.match_id}`);
    if (!res.ok) return parsed;
    const api = (await res.json()) as {
      start_time?: number;
      radiant_score?: number;
      dire_score?: number;
      players?: {
        hero_id: number;
        kills: number;
        deaths: number;
        assists: number;
        last_hits?: number;
        denies?: number;
        gold_per_min?: number;
        xp_per_min?: number;
        hero_damage?: number;
        teamfight_participation?: number;
        stuns?: number;
        pings?: number;
        item_uses?: Record<string, number>;
      }[];
    };
    parsed.start_time = api.start_time;
    parsed.radiant_score = api.radiant_score;
    parsed.dire_score = api.dire_score;
    if (!api.players?.length) return parsed;

    const heroes = await fetchHeroes();
    const nameById = new Map<number, string>();
    for (const [id, h] of heroes) nameById.set(id, h.name.replace("npc_dota_hero_", ""));

    for (const ap of api.players) {
      const heroName = nameById.get(ap.hero_id);
      const target = parsed.players.find((p) => p.hero === heroName);
      if (!target) continue;
      target.kills = ap.kills;
      target.deaths = ap.deaths;
      target.assists = ap.assists;
      if (ap.last_hits !== undefined) target.last_hits = ap.last_hits;
      if (ap.denies !== undefined) target.denies = ap.denies;
      if (ap.gold_per_min) target.gpm = ap.gold_per_min;
      if (ap.xp_per_min) target.xpm = ap.xp_per_min;
      if (ap.hero_damage) target.hero_damage = ap.hero_damage;
      // Эти метрики считает OpenDota, в реплее их нет — забираем из того же ответа.
      if (ap.teamfight_participation !== undefined) target.teamfight_participation = ap.teamfight_participation;
      if (ap.stuns !== undefined) target.stuns = ap.stuns;
      if (ap.pings !== undefined) target.pings = ap.pings;
      if (ap.item_uses) target.item_uses = ap.item_uses;
    }
  } catch {
    // API недоступно — работаем на данных реплея, они самодостаточны
  }
  return parsed;
}

export function analyseParsedMatch(parsed: ParsedMatch): MatchAnalysis {
  const ours: OurPlayer[] = [];
  for (const p of parsed.players) {
    const cfg = bySteam32.get(toSteam32(p.steam_id));
    if (cfg) ours.push({ parsed: p, config: cfg });
  }

  const ourTeam = ours.length ? ours[0].parsed.team : "radiant";
  const weWon = parsed.winner === ourTeam;

  const radiant = parsed.players.filter((p) => p.team === "radiant");
  const dire = parsed.players.filter((p) => p.team === "dire");
  // Если поле пустое у всей команды разом — значит его в этом реплее просто нет.
  const deathCostAvailable = parsed.players.some((p) => p.gold_lost_to_death > 0);
  const scored = parsed.players.map((p) => ({
    p,
    score: impactScore(p, p.team === "radiant" ? radiant : dire, deathCostAvailable),
  }));
  scored.sort((a, b) => b.score - a.score);

  return {
    parsed,
    ours,
    weWon,
    ourTeam,
    mvp: scored[0]?.p ?? null,
    lvp: scored[scored.length - 1]?.p ?? null,
    turningPoint: findTurningPoint(parsed, ourTeam),
    laneReport: buildLaneReport(parsed, ourTeam),
  };
}

export async function findLastPartyMatch(): Promise<{
  matchId: number;
  playerId: number;
  playerName: string;
} | null> {
  let latest: { matchId: number; startTime: number; playerId: number } | null = null;
  for (const playerId of PLAYER_IDS) {
    try {
      const recent = (await fetchRecentMatches(playerId))[0];
      if (recent && (!latest || recent.start_time > latest.startTime)) {
        latest = { matchId: recent.match_id, startTime: recent.start_time, playerId };
      }
    } catch (error) {
      console.warn(`[ANALYZE] не загрузились матчи ${playerId}:`, (error as Error).message);
    }
  }
  if (!latest) return null;
  const profile = await fetchPlayerProfile(latest.playerId);
  return {
    matchId: latest.matchId,
    playerId: latest.playerId,
    playerName: profile.profile?.personaname || String(latest.playerId),
  };
}

/** Разбор матча по реплею. Прогресс отдаётся наружу, чтобы бот мог обновлять сообщение. */
export async function analyzeMatchV2(
  matchId: number,
  onProgress: ParseProgress = () => {},
): Promise<string> {
  const parsed = await mergeOfficialStats(await fetchAndParseReplay(matchId, onProgress));
  const analysis = analyseParsedMatch(parsed);
  const facts = await collectMatchFacts(analysis);
  const text = await generateMainVoiceAnalysis(renderFactPacket(facts));

  return formatForTelegram(matchId, parsed, text, "Песик сбоку");
}

/** Готовое HTML-сообщение для Telegram: шапка с исходом и составом + сам разбор. */
export function formatForTelegram(
  matchId: number,
  parsed: ParsedMatch,
  text: string,
  formatTitle: string,
): string {
  const analysis = analyseParsedMatch(parsed);
  const ourNames = analysis.ours.map((o) => o.config.dotaName).join(", ");
  const durationSeconds = Math.round(parsed.duration_min * 60);
  const duration = `${Math.floor(durationSeconds / 60)}:${String(durationSeconds % 60).padStart(2, "0")}`;
  const header = [
    `🔬 <b>Разбор матча</b> <a href="https://www.opendota.com/matches/${matchId}">#${matchId}</a>`,
    `${analysis.weWon ? "🏆 Победа" : "💀 Поражение"} · ${duration} · ${analysis.ours.length ? `наши: ${escapeHtml(ourNames)}` : "наших не опознано"}`,
    `<i>формат: ${formatTitle} · данные из реплея</i>`,
    "",
    "",
  ].join("\n");

  const footer = SITE_URL
    ? `\n\n📊 <a href="${SITE_URL}/match/${matchId}">Разбор целиком: линии, тимфайты, экономика</a>`
    : "";

  return header + escapeHtml(text) + footer;
}
