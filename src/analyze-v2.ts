/**
 * /analyze v2 — разбор матча по данным собственного парсера реплеев.
 *
 * Отличия от v1 (analyze.ts):
 *  - игроки опознаются по steam_id из реплея, а не по account_id из API (приватные профили больше не Anonymous);
 *  - в контексте есть лейнинг, экономика по минутам, тимфайты и тайминги предметов, а не только итоговый счёт;
 *  - MVP/LVP и перелом матча считаются кодом, а не на глаз языковой моделью;
 *  - формат выпуска ротируется, а дежурные советы запрещены промптом.
 */
import OpenAI from "openai";
import { getAppFetch, getOpenAIFetch } from "./proxy.js";
import { fetchHeroes } from "./heroes.js";
import { PLAYERS, getBotAttitude, type Player } from "./config.js";
import { fetchAndParseReplay, toSteam32, type ParsedMatch, type ParsedPlayer, type ParseProgress } from "./replay.js";
import { escapeHtml } from "./telegram-html.js";
import { CHAT_SLANG, BANNED_WORDS, TONE_EXAMPLES, sanitizeAnalysis, lintAnalysis } from "./lexicon.js";

const OPENAI_MODEL = process.env.OPENAI_MODEL_V2 || process.env.OPENAI_MODEL || "gpt-5.6-sol";
/** Адрес витрины. Пустой — значит ссылку в пост не добавляем. */
const SITE_URL = (process.env.SITE_URL || "").replace(/\/$/, "");

/** Формат выпуска. Один и тот же матч в разных рамках читается как разный текст. */
export const FORMATS = [
  {
    id: "coach",
    title: "разбор тренера",
    brief:
      "Ты тренер, который отсматривает катку с командой. Спокойно, по делу, с конкретными таймингами. " +
      "Не жалеешь никого, но и не унижаешь.",
  },
  {
    id: "commentator",
    title: "комментатор",
    brief:
      "Ты комментатор, ведущий репортаж по записи. Эмоции, нарастание, кульминация на переломе. " +
      "Настоящее время, будто всё происходит сейчас.",
  },
  {
    id: "enemy",
    title: "взгляд с той стороны",
    brief:
      "Ты саппорт вражеской команды, который после игры пишет своим в дискорд про соперников. " +
      "Кого боялись, кого фармили, кто был бесплатным золотом. " +
      "ВАЖНО: про команду чата говори только в третьем лице — «эти», «они», по именам. " +
      "Про свою сторону не рассказывай вообще и не пиши «у нас»: все цифры в данных описывают " +
      "команду чата, и если приписать их себе, знаки перевернутся и текст будет врать.",
  },
  {
    id: "gaben",
    title: "весточка от Габена",
    brief:
      "В чате Габен — капризное божество матчмейкинга, которое мстит и благословляет. " +
      "Пиши от его лица: кому он сегодня подсылал агентов, кому выдал стрик, кто ещё не отработал карму. " +
      "Снисходительно, будто разговариваешь со смертными.",
  },
  {
    id: "chatter",
    title: "как свой в чате",
    brief:
      "Пиши так, будто ты просто один из пацанов в чате, который посмотрел катку. " +
      "Короткие рубленые фразы, без структуры и заголовков, как обычное сообщение в телеге. " +
      "Можно начать с середины мысли.",
  },
  {
    id: "court",
    title: "разбор полётов",
    brief:
      "Строгий разбор по пунктам: кто что натворил и что ему за это. " +
      "Без канцелярита и без слов «улики», «приговор», «подозреваемый» — просто жёстко и по делу.",
  },
] as const;

export type FormatId = (typeof FORMATS)[number]["id"];

interface OurPlayer {
  parsed: ParsedPlayer;
  config: Player;
}

interface MatchAnalysis {
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

function fmtTime(min: number): string {
  const m = Math.floor(min);
  const s = Math.round((min - m) * 60);
  return `${m}:${String(s).padStart(2, "0")}`;
}

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

function describePlayer(p: ParsedPlayer, cfg?: Player): string {
  const tag = cfg ? `[НАШ: ${cfg.dotaName}]` : "";
  // Ники в Dota меняются; в тексте зовём человека так, как его знают в чате.
  const shownName = cfg
    ? cfg.dotaName + (p.name && p.name !== cfg.dotaName ? ` (в игре сейчас ${p.name})` : "")
    : p.name;
  const items = (p.item_timings ?? []).slice(0, 8).map((i) => `${i.item}@${fmtTime(i.min)}`).join(", ");
  const deathTimes = p.death_times_min ?? [];
  const deaths = deathTimes.length ? deathTimes.map((d) => fmtTime(d)).join(", ") : "не умирал";
  // Официальный счётчик и список таймингов иногда расходятся на одну смерть.
  const deathNote =
    deathTimes.length && deathTimes.length !== p.deaths
      ? ` (официально смертей ${p.deaths}, таймингов известно ${deathTimes.length} — считай по официальному)`
      : "";
  const MULTI_NAMES: Record<string, string> = { x2: "дабл-килл", x3: "трипл-килл", x4: "квадра", x5: "рампейдж" };
  const multi = p.multikills
    ? Object.entries(p.multikills)
        .map(([size, times]) => `${MULTI_NAMES[size] ?? size} x${times}`)
        .join(", ")
    : "";
  const killedBy = p.killed_by
    ? Object.entries(p.killed_by).sort((a, b) => b[1] - a[1]).slice(0, 3).map(([k, v]) => `${k}x${v}`).join(", ")
    : "";

  return [
    `${tag} ${shownName} (${p.hero}) ${p.lane}/${p.lane_role} ур.${p.level_final}`,
    `  KDA ${p.kills}/${p.deaths}/${p.assists} (официальный) | CS ${p.last_hits}(+${p.denies} денаев) | CS@10 ${p.cs_at_10} | CS@20 ${p.cs_at_20}`,
    `  NW: 10мин ${p.networth_at_10} -> 20мин ${p.networth_at_20} -> итог ${p.networth_final} | GPM ${p.gpm} | XPM ${p.xpm}`,
    `  урон по героям ${p.hero_damage} | получил ${p.damage_taken} | лечение ${p.healing} | по башням ${p.tower_damage}`,
    `  потерял на смертях ${p.gold_lost_to_death} зол | на саппорт-предметы ${p.gold_spent_on_support} зол`,
    p.buybacks || p.max_killstreak || multi
      ? `  выкупы ${p.buybacks} | макс.серия ${p.max_killstreak}${multi ? ` | мультикиллы ${multi}` : ""}`
      : "",
    p.obs_wards_placed || p.wards_killed
      ? `  варды ${p.obs_wards_placed}обс/${p.sentry_wards_placed}сент | снёс вардов ${p.wards_killed}`
      : "",
    `  предметы: ${items || "нет данных"}`,
    `  умирал в: ${deaths}${deathNote}${killedBy ? ` | чаще убивал его: ${killedBy}` : ""}`,
    p.killed && Object.keys(p.killed).length
      ? `  сам убивал: ${Object.entries(p.killed).sort((a, b) => b[1] - a[1]).slice(0, 3).map(([k, v]) => `${k}x${v}`).join(", ")}`
      : "",
    p.top_spells && Object.keys(p.top_spells).length
      ? `  чаще всего жал: ${Object.entries(p.top_spells).sort((a, b) => b[1] - a[1]).slice(0, 3).map(([k, v]) => `${k.replace(/^[a-z_]+?_/, "")} x${v}`).join(", ")}`
      : "",
    p.item_uses && Object.keys(p.item_uses).length
      ? `  жал предметы: ${Object.entries(p.item_uses).sort((a, b) => b[1] - a[1]).slice(0, 5).map(([k, v]) => `${k} x${v}`).join(", ")}`
      : "",
    [
      p.teamfight_participation !== undefined ? `участие в драках ${Math.round(p.teamfight_participation * 100)}%` : "",
      p.stuns ? `контроля ${Math.round(p.stuns)} сек` : "",
      p.pings !== undefined ? `пингов ${p.pings}` : "",
    ].filter(Boolean).length
      ? `  ${[
          p.teamfight_participation !== undefined ? `участие в драках ${Math.round(p.teamfight_participation * 100)}%` : "",
          p.stuns ? `контроля ${Math.round(p.stuns)} сек` : "",
          p.pings !== undefined ? `пингов за игру ${p.pings}` : "",
        ].filter(Boolean).join(" | ")}`
      : "",
    p.enemy_half_pct
      ? `  по карте: ${p.enemy_half_pct}% времени на чужой половине | в среднем ${p.avg_ally_distance} от ближайшего своего` +
        (p.death_isolation ? ` | умирал в среднем в ${p.death_isolation} от своих` : "")
      : "",
  ]
    .filter(Boolean)
    .join("\n");
}

/** Лидеры по метрикам, посчитанные кодом: модель на сравнении чисел ошибается. */
function buildLeaders(parsed: ParsedMatch, ourTeam: "radiant" | "dire"): string {
  const ours = parsed.players.filter((p) => p.team === ourTeam);
  const top = (label: string, pick: (p: ParsedPlayer) => number, unit = "") => {
    const sorted = [...ours].sort((a, b) => pick(b) - pick(a)).filter((p) => pick(p) > 0);
    if (!sorted.length) return "";
    return `  ${label}: ` + sorted.slice(0, 3).map((p) => `${p.hero} ${pick(p)}${unit}`).join(" > ");
  };
  return [
    top("урон по героям", (p) => p.hero_damage),
    top("нетворс", (p) => p.networth_final),
    top("крипы", (p) => p.last_hits),
    top("смерти", (p) => p.deaths),
    top("обсы", (p) => p.obs_wards_placed),
    top("сентри", (p) => p.sentry_wards_placed),
    top("урон по башням", (p) => p.tower_damage),
  ].filter(Boolean).join("\n");
}

export function buildContext(a: MatchAnalysis): string {
  const { parsed } = a;
  const ourSteamIds = new Set(a.ours.map((o) => o.parsed.steam_id));

  const teamBlock = (team: "radiant" | "dire") =>
    parsed.players
      .filter((p) => p.team === team)
      .map((p) => describePlayer(p, ourSteamIds.has(p.steam_id) ? bySteam32.get(toSteam32(p.steam_id)) : undefined))
      .join("\n\n");

  const ourHeroes = new Set(parsed.players.filter((p) => p.team === a.ourTeam).map((p) => p.hero));
  const fights = (parsed.teamfights ?? [])
    .slice(0, 8)
    .map((t) => {
      const weLost = a.ourTeam === "radiant" ? t.radiant_died : t.dire_died;
      const theyLost = a.ourTeam === "radiant" ? t.dire_died : t.radiant_died;
      const verdict = weLost < theyLost ? "замес за НАМИ" : weLost > theyLost ? "замес за НИМИ" : "разменялись";
      const died = t.heroes_died.map((h) => (ourHeroes.has(h) ? `${h}(наш)` : h)).join(", ");
      return `  ${fmtTime(t.start_min)}-${fmtTime(t.end_min)}: мы -${weLost}, они -${theyLost} -> ${verdict}; полегли: ${died}`;
    })
    .join("\n");

  const towers = (parsed.buildings ?? [])
    .filter((b) => b.name.includes("tower") || b.name.includes("rax") || b.name.includes("fort"))
    .slice(0, 14)
    .map((b) => {
      const oursKilled = b.killed_by_team === a.ourTeam;
      const short = b.name
        .replace("npc_dota_", "")
        .replace("goodguys_", "radiant ")
        .replace("badguys_", "dire ")
        .replace("fort", "ТРОН")
        .replace("_melee_rax", " казармы ближнего боя")
        .replace("_range_rax", " казармы дальнего боя");
      return `${fmtTime(b.min)} ${short} (${oursKilled ? "снесли МЫ" : "снесли ОНИ"})`;
    })
    .join(", ");

  const attitudes = a.ours
    .map((o) => `  ${o.config.dotaName}: ${getBotAttitude(o.config.steamId) ?? "нейтрально"}`)
    .join("\n");

  return `МАТЧ ${parsed.match_id}
Длительность: ${parsed.duration_min} мин | МЫ играли за ${a.ourTeam} и ${a.weWon ? "ВЫИГРАЛИ" : "ПРОИГРАЛИ"}\nВНИМАНИЕ: ниже всё описано от лица НАШЕЙ команды. "МЫ" = ${a.ourTeam}, "ОНИ" = ${a.ourTeam === "radiant" ? "dire" : "radiant"}.
Первая кровь: ${parsed.first_blood ? `${fmtTime(parsed.first_blood.min)} ${parsed.first_blood.killer} убил ${parsed.first_blood.victim}` : "нет данных"}
Рошан взят: ${(parsed.roshan_kills_min ?? []).length ? (parsed.roshan_kills_min ?? []).map(fmtTime).join(", ") : "не брали"}

ЛИНИИ (итог к 10 минуте):
${a.laneReport.map((l) => `  ${l}`).join("\n") || "  нет данных"}

ДИНАМИКА ЗОЛОТА:
  ${a.turningPoint}

ТИМФАЙТЫ:
${fights || "  крупных замесов не было"}

БАШНИ: ${towers || "нет данных"}

ЛИДЕРЫ В НАШЕЙ КОМАНДЕ (посчитано кодом, порядок от большего к меньшему —
пользуйся этим вместо того, чтобы сравнивать числа самому):
${buildLeaders(parsed, a.ourTeam)}

ПОСЧИТАНО КОДОМ (не пересматривай, используй как факт):
  MVP матча: ${a.mvp ? `${a.mvp.name} (${a.mvp.hero})` : "н/д"}
  LVP матча: ${a.lvp ? `${a.lvp.name} (${a.lvp.hero})` : "н/д"}

НАША КОМАНДА (${a.ourTeam})${a.weWon ? " — ПОБЕДИЛИ" : " — ПРОИГРАЛИ"}:
${teamBlock(a.ourTeam)}

ПРОТИВНИКИ (${a.ourTeam === "radiant" ? "dire" : "radiant"}):
${teamBlock(a.ourTeam === "radiant" ? "dire" : "radiant")}

ТВОЁ ОТНОШЕНИЕ К НАШИМ (подсказка тона, вслух не проговаривать):
${attitudes || "  наших в матче не опознано"}`;
}

const BASE_RULES = `ЖЁСТКИЕ ПРАВИЛА:
• ГЛАВНОЕ: разбери ПЕРСОНАЛЬНО каждого игрока с меткой [НАШ] — минимум по 2 конкретных факта с цифрами
  на каждого. Остальные девять — только фон. Если наших в матче нет, скажи об этом одной строкой
  и разбери матч целиком.
• Каждое утверждение опирается на цифру или тайминг ИЗ ДАННЫХ. Нет цифры — нет утверждения.
• ЗАПРЕЩЕНО советовать «купи BKB», «ставь варды», «работай над позиционкой» и прочие дежурные фразы,
  если в данных нет прямого доказательства именно этой проблемы. Лучше промолчать, чем выдать банальность.
• ЗАПРЕЩЕНО начинать со слов «Проиграли потому что» и «Вы затащили потому что» — это уже приелось.
• Не пиши «Хорошо / Плохо / Косяки / Совет» списком — это шаблон прошлой версии бота.
• MVP и LVP уже посчитаны кодом — просто объясни их выбор, не переназначай.
• У тебя есть отношение к каждому нашему. Никогда не называй его вслух: оно проявляется только
  в интонации, объёме внимания и жёсткости формулировок.
• НИКОГДА не переноси в текст служебные пометки из данных: [НАШ], (наш), МЫ/ОНИ капсом,
  «нетворс/мин», «посчитано кодом». Пиши имена людей и героев обычным текстом.
• Русский разговорный, дотерский сленг уместен. Мат — по вкусу, но не через слово.
• ПОСЛЕДНЕЙ СТРОКОЙ на каждого [НАШ] дай короткий вывод на следующую катку — но ТОЛЬКО если
  для него есть конкретная цифра-основание в данных. Одна строка на человека, максимум фраза.
  Если у игрока нет ничего, кроме обычных цифр, — про него в этом блоке молчи. Лучше две строки
  на пятерых, чем пять пустых советов. Не пиши слово «совет» и не нумеруй.
• Telegram-текст без Markdown. Эмодзи — точечно, максимум 5 штук на весь разбор.
• 150-250 слов. Плотно, без вступлений и без воды.
• Не выдумывай метрику, которой нет в данных: если написано «нетворс/мин», это не GPM.
• Прежде чем написать «топ в команде», «больше всех», «единственный, кто», «он один работал» —
  сверься с блоком ЛИДЕРЫ. Если игрок не первый в нужной строке, превосходную степень не пиши.
• Числительное словом («дважды», «трижды», «оба раза») должно совпадать с количеством фактов,
  которые ты сам перечисляешь рядом. Пересчитай, прежде чем писать.
• Мультикиллы уже расписаны словами. «дабл-килл x3» значит три дабл-килла, а не три убийства
  за раз и не трипл-килл.`;

export function buildPrompt(format: (typeof FORMATS)[number]): string {
  return `Ты — Песик, бот дотерского чата. Разбираешь катку своего стака.

ФОРМАТ ЭТОГО ВЫПУСКА — ${format.title}:
${format.brief}

${BASE_RULES}

ЯЗЫК ЭТОГО ЧАТА (так говорят живые люди в нём — пользуйся):
${CHAT_SLANG.map((w) => `• ${w}`).join("\n")}

ТАК В ЭТОМ ЧАТЕ НЕ ГОВОРЯТ НИКОГДА — не употребляй ни разу:
${BANNED_WORDS.map((w) => `• ${w}`).join("\n")}

ПРИМЕРЫ ЖИВЫХ РЕПЛИК ИЗ ЧАТА (для тона, не для копирования):
${TONE_EXAMPLES.map((q) => `• ${q}`).join("\n")}`;
}

/** Формат выбирается детерминированно по матчу: один и тот же матч всегда в одной рамке. */
export function pickFormat(matchId: number, override?: FormatId): (typeof FORMATS)[number] {
  if (override) {
    const f = FORMATS.find((x) => x.id === override);
    if (f) return f;
  }
  return FORMATS[matchId % FORMATS.length];
}

export async function generateAnalysis(
  context: string,
  format: (typeof FORMATS)[number],
): Promise<string> {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) throw new Error("OPENAI_API_KEY not configured");
  const fetch = await getOpenAIFetch();
  const openai = new OpenAI({ apiKey, baseURL: process.env.OPENAI_BASE_URL, fetch });

  const res = await openai.chat.completions.create({
    model: OPENAI_MODEL,
    messages: [
      { role: "system", content: buildPrompt(format) },
      { role: "user", content: context },
    ],
    max_completion_tokens: 4000,
  });
  const raw = res.choices[0]?.message?.content || "Не удалось получить разбор";
  // Служебные метки протекают в текст даже при прямом запрете в промпте — чистим отдельно.
  const text = sanitizeAnalysis(raw);

  const banned = lintAnalysis(text);
  if (banned.length) {
    console.warn(`[ANALYZE-V2] в тексте проскочили запрещённые слова: ${banned.join(", ")}`);
  }
  return text;
}

/** Разбор матча по реплею. Прогресс отдаётся наружу, чтобы бот мог обновлять сообщение. */
export async function analyzeMatchV2(
  matchId: number,
  onProgress: ParseProgress = () => {},
  formatOverride?: FormatId,
): Promise<string> {
  const parsed = await mergeOfficialStats(await fetchAndParseReplay(matchId, onProgress));
  const analysis = analyseParsedMatch(parsed);
  const format = pickFormat(matchId, formatOverride);
  const text = await generateAnalysis(buildContext(analysis), format);

  return formatForTelegram(matchId, parsed, text, format.title);
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
  const header = [
    `🔬 <b>Разбор матча</b> <a href="https://www.opendota.com/matches/${matchId}">#${matchId}</a>`,
    `${analysis.weWon ? "🏆 Победа" : "💀 Поражение"} · ${parsed.duration_min} мин · ${analysis.ours.length ? `наши: ${escapeHtml(ourNames)}` : "наших не опознано"}`,
    `<i>формат: ${formatTitle} · данные из реплея</i>`,
    "",
    "",
  ].join("\n");

  const footer = SITE_URL
    ? `\n\n📊 <a href="${SITE_URL}/match/${matchId}">Разбор целиком: линии, тимфайты, экономика</a>`
    : "";

  return header + escapeHtml(text) + footer;
}
