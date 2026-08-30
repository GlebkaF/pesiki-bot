/**
 * Исследовательский отчёт по архетипам последних матчей стака.
 *
 * Берёт актуальную ленту с витрины, обогащает официальными итогами OpenDota,
 * добавляет сохранённые deep-факты реплея и строит автономный HTML.
 */
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { getAppFetch } from "../src/proxy.js";

const FEED_URL = process.env.CLASSIFIER_FEED_URL || "https://pesiki.nxrig.com/api/feed";
const OUT_DIR = process.env.CLASSIFIER_OUT_DIR || "data/classifier-eval";
const DETAILS_DIR = path.join(OUT_DIR, "details");
const LIMIT = Number(process.env.CLASSIFIER_LIMIT) || 20;
const OFFSET = Number(process.env.CLASSIFIER_OFFSET) || 0;

interface FeedPlayer {
  name: string;
  steamId: number;
  hero: string;
  kills: number;
  deaths: number;
  assists: number;
}

interface FeedMatch {
  matchId: number;
  startTime: number;
  duration: number;
  win: boolean;
  ours: FeedPlayer[];
}

interface ApiPlayer {
  account_id?: number;
  player_slot: number;
  kills: number;
  deaths: number;
  assists: number;
  hero_damage?: number;
  tower_damage?: number;
  net_worth?: number;
}

interface ApiMatch {
  match_id: number;
  duration: number;
  start_time: number;
  radiant_win: boolean;
  radiant_score: number;
  dire_score: number;
  game_mode: number;
  players: ApiPlayer[];
}

interface DeepFacts {
  match: { shape: string; storySignals?: string[] };
  economy?: {
    worst?: { minute: number; advantage: number };
    best?: { minute: number; advantage: number };
    final?: { minute: number; advantage: number };
    leadChanges?: number;
  };
  ourPlayers?: Array<{
    name: string;
    hero: string;
    role: string;
    unusualRole: boolean;
    kda: string;
    history?: { currentHeroInLast20: number };
  }>;
  history?: {
    stackEnteringStreak?: string;
    recentStackRecord?: string;
  };
}

interface Classification {
  id: string;
  title: string;
  icon: string;
  kind: "match" | "series" | "player";
  evidence: string;
  strength: number;
  confidence: "high" | "medium";
  source: "scoreboard" | "replay" | "history" | "profile";
}

interface Row {
  feed: FeedMatch;
  api: ApiMatch;
  ourSide: "radiant" | "dire";
  ourScore: number;
  enemyScore: number;
  ourTeamDeaths: number;
  ourKnown: Array<FeedPlayer & { participation: number }>;
  deep?: DeepFacts;
  scope: "solo" | "partial" | "stack";
  previous?: Row;
  queueGapMin?: number;
  classifications: Classification[];
  selectedClassifications: Classification[];
}

function esc(value: unknown): string {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

function fmtDuration(seconds: number): string {
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`;
}

function result(row: Row): "win" | "loss" {
  return row.feed.win ? "win" : "loss";
}

function sharedPlayers(a: FeedMatch, b: FeedMatch): FeedPlayer[] {
  const ids = new Set(b.ours.map((p) => p.steamId));
  return a.ours.filter((p) => ids.has(p.steamId));
}

async function fetchJson<T>(url: string): Promise<T> {
  const fetchFn = await getAppFetch();
  const res = await fetchFn(url);
  if (!res.ok) throw new Error(`${url}: ${res.status}`);
  return res.json() as Promise<T>;
}

async function apiDetails(matchId: number): Promise<ApiMatch> {
  const cachePath = path.join(DETAILS_DIR, `${matchId}.json`);
  try {
    return JSON.parse(await readFile(cachePath, "utf8")) as ApiMatch;
  } catch {
    const details = await fetchJson<ApiMatch>(`https://api.opendota.com/api/matches/${matchId}`);
    await writeFile(cachePath, JSON.stringify(details));
    await new Promise((resolve) => setTimeout(resolve, 1100));
    return details;
  }
}

async function deepFacts(matchId: number): Promise<DeepFacts | undefined> {
  try {
    return JSON.parse(
      await readFile(path.join(OUT_DIR, "deep", `${matchId}.facts.json`), "utf8"),
    ) as DeepFacts;
  } catch {
    // Старые три eval-матча пока также доступны в main-voice-eval.
  }
  try {
    const files = await import("node:fs/promises").then((fs) => fs.readdir("data/main-voice-eval"));
    const name = files.find((file) => file.startsWith(`${matchId}.`) && file.endsWith(".facts.json"));
    if (!name) return undefined;
    return JSON.parse(await readFile(path.join("data/main-voice-eval", name), "utf8")) as DeepFacts;
  } catch {
    return undefined;
  }
}

function tag(
  id: string,
  title: string,
  icon: string,
  kind: Classification["kind"],
  evidence: string,
  strength = 1,
  confidence: Classification["confidence"] = "high",
  source: Classification["source"] = "scoreboard",
): Classification {
  return { id, title, icon, kind, evidence, strength, confidence, source };
}

function classifyMatch(row: Row): Classification[] {
  const tags: Classification[] = [];
  const durationMin = row.api.duration / 60;
  const margin = row.ourScore - row.enemyScore;
  const totalKills = row.api.radiant_score + row.api.dire_score;
  const killsPerMin = totalKills / durationMin;
  const deepFinal = row.deep?.economy?.final?.advantage;

  if (row.feed.win && durationMin < 22 && margin >= 25 && (deepFinal === undefined || deepFinal >= 30_000)) {
    tags.push(tag("fast-stomp", "Выдали автоботов", "🤖", "match", `${fmtDuration(row.api.duration)}, счёт ${row.ourScore}:${row.enemyScore}${deepFinal === undefined ? "" : `, финал +${deepFinal}`}`, 3, deepFinal === undefined ? "medium" : "high", deepFinal === undefined ? "scoreboard" : "replay"));
  }
  if (!row.feed.win && durationMin < 22 && margin <= -20 && (deepFinal === undefined || deepFinal <= -30_000)) {
    tags.push(tag("fast-stomp-loss", "Ритуальное унижение", "🧎", "match", `${fmtDuration(row.api.duration)}, счёт ${row.ourScore}:${row.enemyScore}${deepFinal === undefined ? "" : `, финал ${deepFinal}`}`, 3, deepFinal === undefined ? "medium" : "high", deepFinal === undefined ? "scoreboard" : "replay"));
  }
  if (row.feed.win && row.deep?.match.shape === "big-comeback") {
    const worst = row.deep.economy?.worst;
    tags.push(tag("deep-comeback", "Выплыли с полным ртом", "🌊", "match", worst ? `на ${Math.floor(worst.minute)}-й минуте было ${worst.advantage}` : "глубокий камбек", 3, "high", "replay"));
  }
  if (!row.feed.win && row.deep?.match.shape === "throw") {
    const best = row.deep.economy?.best;
    tags.push(tag("lost-large-lead", "Сами завернули и подарили", "🎁", "match", best ? `вели ${best.advantage} на ${Math.floor(best.minute)}-й минуте` : "отдали выигранную игру", 3, "high", "replay"));
  }
  if ((row.deep?.economy?.leadChanges ?? 0) >= 3) {
    tags.push(tag("multiple-lead-changes", "Кардиограмма Габена", "〽️", "match", `${row.deep?.economy?.leadChanges} смены лидера по голде`, 2, "medium", "replay"));
  }
  if (durationMin >= 38 && (totalKills >= 75 || killsPerMin >= 2.2)) {
    tags.push(tag("meat-grinder", "Мясорубка без тормозов", "🥩", "match", `${fmtDuration(row.api.duration)}, ${totalKills} убийств (${killsPerMin.toFixed(1)}/мин)`, 2));
  }
  if (row.feed.win && row.ourTeamDeaths >= 35) {
    tags.push(tag("high-death-win", "Насосали, но правильно", "🏆", "match", `победили, умерев командой ${row.ourTeamDeaths} раз`, 2));
  }
  if (!row.feed.win && durationMin >= 45 && Math.abs(margin) <= 12) {
    tags.push(tag("hour-for-nothing", "Час сосали зря", "⌛", "match", `${fmtDuration(row.api.duration)}, счёт ${row.ourScore}:${row.enemyScore}`, 2));
  }
  if (row.feed.win && margin < 0) {
    tags.push(tag("win-with-kill-deficit", "Проиграли табло, выиграли трон", "🧮", "match", `победа при счёте ${row.ourScore}:${row.enemyScore}`, 2));
  }

  const ourTeamPlayers = row.api.players.filter((p) => (p.player_slot < 128 ? "radiant" : "dire") === row.ourSide);
  const byDeaths = [...ourTeamPlayers].sort((a, b) => b.deaths - a.deaths);
  const designatedApi = byDeaths[0];
  const designated = row.feed.ours.find((p) => p.steamId === designatedApi?.account_id);
  if (designated && designated.deaths >= 10 && designated.deaths - (byDeaths[1]?.deaths ?? 0) >= 3) {
    tags.push(tag("clear-death-outlier", "Назначенный терпила", "🧽", "player", `${designated.name}: ${designated.deaths} смертей, следующий в команде — ${byDeaths[1]?.deaths ?? 0}`, 2));
  }
  const byKills = [...ourTeamPlayers].sort((a, b) => b.kills - a.kills);
  const carryApi = byKills[0];
  const carry = row.ourKnown.find((p) => p.steamId === carryApi?.account_id);
  if (carry && carry.kills >= 15 && carry.kills - (byKills[1]?.kills ?? 0) >= 5) {
    tags.push(tag("clear-kill-outlier", "Один принёс нож", "🔪", "player", `${carry.name}: ${carry.kills} убийств, следующий в команде — ${byKills[1]?.kills ?? 0}`, 2));
  }
  if (!row.feed.win && carry && carry.kills >= 18 && carry.participation >= 0.6) {
    tags.push(tag("heroic-loss", "Героически проиграл", "🫡", "player", `${carry.name}: ${carry.kills} убийств и ${Math.round(carry.participation * 100)}% участия — всё равно луз`, 2));
  }
  const immortals = row.feed.ours.filter((player) => player.deaths === 0);
  if (row.feed.win && row.feed.ours.length >= 2 && immortals.length >= 2) {
    tags.push(tag("tavern-closed", "Таверна была закрыта", "🚪", "player", `${immortals.map((p) => p.name).join(" и ")} не умерли ни разу`, 2));
  }
  const roleTourists = row.deep?.ourPlayers?.filter((player) => player.unusualRole) ?? [];
  if (roleTourists.length) {
    tags.push(tag("unusual-role", "Турист на чужой позиции", "🧳", "player", roleTourists.map((p) => `${p.name}: ${p.hero}, роль ${p.role}, KDA ${p.kda}`).join("; "), 3, "high", "profile"));
  }
  const signatureAddicts = row.deep?.ourPlayers?.filter((player) => (player.history?.currentHeroInLast20 ?? 0) >= 5) ?? [];
  if (signatureAddicts.length) {
    tags.push(tag("frequent-hero", "Сигнатурная зависимость", "💉", "player", signatureAddicts.map((p) => `${p.name}: ${p.hero} ${(p.history?.currentHeroInLast20 ?? 0) + 1}-й раз за 20 игр с текущей`).join("; "), 2, "high", "history"));
  }
  const atticHeroes = row.deep?.ourPlayers?.filter((player) => {
    const [kills, deaths, assists] = player.kda.split("/").map(Number);
    return player.history?.currentHeroInLast20 === 0 && kills >= 10 && deaths <= 3 && kills + assists >= 20;
  }) ?? [];
  if (atticHeroes.length) {
    tags.push(tag("rare-hero-popoff", "Достал героя из чулана и разъебал", "🗄️", "player", atticHeroes.map((p) => `${p.name}: не пикал ${p.hero} в предыдущих 19 играх, KDA ${p.kda}`).join("; "), 3, "high", "history"));
  }
  const recentRecord = row.deep?.history?.recentStackRecord?.match(/^(\d+)-(\d+)/);
  if (
    !row.feed.win &&
    row.deep?.history?.stackEnteringStreak === "первый матч сессии" &&
    recentRecord && Number(recentRecord[1]) >= 7
  ) {
    tags.push(tag("session-opener-loss-after-good-record", "Разминка сняла корону", "👑", "series", `первая общая катка сессии после серии ${row.deep.history.recentStackRecord}`, 2, "high", "history"));
  }

  return tags;
}

function classifySeries(row: Row, allRows: Row[]): Classification[] {
  const tags: Classification[] = [];
  const prev = row.previous;
  if (!prev || row.queueGapMin === undefined) return tags;
  const shared = sharedPlayers(row.feed, prev.feed);
  const samePicks = shared.filter((player) => {
    const before = prev.feed.ours.find((p) => p.steamId === player.steamId);
    return before?.hero === player.hero;
  });
  const improvedSamePicks = samePicks.filter((player) => {
    const before = prev.feed.ours.find((p) => p.steamId === player.steamId);
    return before !== undefined && (player.kills >= before.kills + 5 || player.deaths <= before.deaths - 3);
  });

  if (row.queueGapMin <= 10) {
    tags.push(tag("short-queue-gap", "Сразу обратно в очередь", "🔁", "series", `${Math.max(0, row.queueGapMin).toFixed(1)} мин после прошлой катки; вместе: ${shared.map((p) => p.name).join(", ")}`, 1, "high", "history"));
  }
  if (result(prev) === "loss" && result(row) === "win" && row.queueGapMin <= 15 && shared.length >= 2) {
    tags.push(tag("immediate-bounceback", "Смыли позор без перекура", "😤", "series", `после поражения ${shared.length} общих игрока вернулись через ${row.queueGapMin.toFixed(1)} мин`, 3, "high", "history"));
  }
  if (result(prev) === "loss" && result(row) === "win" && improvedSamePicks.length >= 1 && row.queueGapMin <= 20) {
    tags.push(tag("same-hero-improved-after-loss", "Тот же герой, но руки вернули", "♻️", "series", improvedSamePicks.map((p) => `${p.name} снова на ${p.hero}`).join("; "), 2, "high", "history"));
  }
  if (samePicks.length >= 2 && row.queueGapMin <= 20) {
    tags.push(tag("repeat-pick-package", "Запустили тот же эксперимент", "🧪", "series", samePicks.map((p) => `${p.name}=${p.hero}`).join(", "), 2, "high", "history"));
  }

  const currentIndex = allRows.indexOf(row);
  const humiliation = allRows.slice(currentIndex + 1).find((candidate) =>
    candidate.classifications.some((x) => x.id === "fast-stomp-loss") &&
    sharedPlayers(row.feed, candidate.feed).length >= 3 &&
    row.feed.startTime - (candidate.feed.startTime + candidate.feed.duration) <= 2 * 60 * 60,
  );
  if (result(row) === "win" && row.classifications.some((x) => x.id === "fast-stomp") && humiliation) {
    const relevantBetween = allRows.slice(currentIndex + 1, allRows.indexOf(humiliation)).filter(
      (candidate) => sharedPlayers(row.feed, candidate.feed).length >= 3,
    ).length;
    tags.push(tag("stomp-after-recent-humiliation", "Компенсация Габена дошла", "⚖️", "series", `${relevantBetween ? `через ${relevantBetween} пати-катку` : "сразу"} после матча ${humiliation.feed.matchId}, где автоботами были мы`, 3, "high", "history"));
  }
  return tags;
}

function classificationCatalog(rows: Row[]): Array<Classification & { matches: number[] }> {
  const byId = new Map<string, Classification & { matches: number[] }>();
  for (const row of rows) {
    for (const item of row.classifications) {
      const existing = byId.get(item.id);
      if (existing) existing.matches.push(row.feed.matchId);
      else byId.set(item.id, { ...item, matches: [row.feed.matchId] });
    }
  }
  return [...byId.values()].sort((a, b) => b.strength - a.strength || a.title.localeCompare(b.title, "ru"));
}

/** Один сюжет матча + один персональный поворот + один контекст серии. */
function selectClassifications(row: Row): Classification[] {
  let candidates = row.classifications.filter((item) => item.strength >= 2);
  const ids = new Set(candidates.map((item) => item.id));
  if (ids.has("deep-comeback")) {
    candidates = candidates.filter((item) => !["high-death-win", "win-with-kill-deficit"].includes(item.id));
  }
  if (ids.has("immediate-bounceback")) {
    candidates = candidates.filter((item) => item.id !== "short-queue-gap");
  }
  if (ids.has("same-hero-improved-after-loss")) {
    candidates = candidates.filter((item) => item.id !== "repeat-pick-package");
  }
  const sorted = [...candidates].sort((a, b) => b.strength - a.strength);
  const primary = sorted.find((item) => item.kind === "match") ?? sorted[0];
  const player = sorted.find((item) => item.kind === "player" && item !== primary);
  const series = sorted.find((item) => item.kind === "series" && item !== primary);
  return [primary, player, series].filter((item): item is Classification => Boolean(item)).slice(0, 3);
}

function html(rows: Row[], catalog: ReturnType<typeof classificationCatalog>): string {
  const classified = rows.filter((row) => row.selectedClassifications.length).length;
  const wins = rows.filter((row) => row.feed.win).length;
  const deepCount = rows.filter((row) => row.deep).length;
  const kindName = { match: "матч", player: "игрок", series: "серия" } as const;
  const sourceName = { scoreboard: "табло", replay: "реплей", history: "история", profile: "профиль" } as const;
  const catalogHtml = catalog
    .map((item) => `<article class="idea s${item.strength}">
      <div class="idea-title"><span>${item.icon}</span><strong>${esc(item.title)}</strong><em>${kindName[item.kind]}</em></div>
      <p>${esc(item.evidence)}</p>
      <p class="matches">источник: ${sourceName[item.source]} · уверенность: ${item.confidence === "high" ? "высокая" : "средняя"} · поймано: ${item.matches.map((id) => `<a href="#m${id}">${id}</a>`).join(", ")}</p>
    </article>`)
    .join("");
  const cards = rows
    .map((row, index) => {
      const tags = row.selectedClassifications.length
        ? row.selectedClassifications.map((item) => `<span class="tag s${item.strength}">${item.icon} ${esc(item.title)}</span>`).join("")
        : '<span class="tag muted">пока без яркого архетипа</span>';
      const players = row.feed.ours
        .map((p) => `<span><b>${esc(p.name)}</b> ${esc(p.hero)} <i>${p.kills}/${p.deaths}/${p.assists}</i></span>`)
        .join("");
      const evidence = row.selectedClassifications.map((item) => `<li>${item.icon} <b>${esc(item.title)}:</b> ${esc(item.evidence)} <small>(${sourceName[item.source]}, ${item.confidence === "high" ? "высокая" : "средняя"} уверенность)</small></li>`).join("");
      const scope = row.scope === "stack" ? "стак" : row.scope === "partial" ? "часть стака" : "соло";
      const playedAt = new Date(row.feed.startTime * 1000).toLocaleString("ru-RU", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" });
      return `<article class="match ${row.feed.win ? "win" : "loss"}" id="m${row.feed.matchId}">
        <div class="match-head"><div><span class="num">${String(index + 1).padStart(2, "0")}</span>
          <a href="https://pesiki.nxrig.com/match/${row.feed.matchId}" target="_blank">${row.feed.matchId}</a></div>
          <strong>${row.feed.win ? "ПОБЕДА" : "ПОРАЖЕНИЕ"}</strong></div>
        <div class="score"><b>${row.ourScore}:${row.enemyScore}</b><span>${fmtDuration(row.api.duration)}</span><span>${scope}</span><span>${playedAt}</span></div>
        <div class="tags">${tags}</div>
        <div class="players">${players}</div>
        ${evidence ? `<ul>${evidence}</ul>` : ""}
      </article>`;
    })
    .join("");

  return `<!doctype html><html lang="ru"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
  <title>Классификатор Песиков · ${rows.length} матчей</title><style>
  :root{--bg:#0c0d10;--panel:#15171c;--panel2:#1b1e24;--text:#f3f0e9;--dim:#9da3ad;--line:#2a2e36;--win:#91d36e;--loss:#ff716c;--hot:#ffc857;--accent:#bba6ff}
  *{box-sizing:border-box}body{margin:0;background:radial-gradient(circle at 15% -10%,#26213b 0,transparent 34%),var(--bg);color:var(--text);font:15px/1.5 Inter,ui-sans-serif,system-ui,sans-serif}
  a{color:inherit}.wrap{max-width:1320px;margin:auto;padding:42px 24px 80px}.eyebrow{color:var(--accent);text-transform:uppercase;letter-spacing:.13em;font-size:12px;font-weight:800}
  h1{font-size:clamp(34px,5vw,68px);line-height:.95;max-width:900px;margin:12px 0 18px;letter-spacing:-.045em}.lead{font-size:18px;color:#c6c8ce;max-width:820px}
  .stats{display:grid;grid-template-columns:repeat(4,1fr);gap:12px;margin:30px 0}.stat{background:var(--panel);border:1px solid var(--line);padding:18px;border-radius:14px}.stat b{display:block;font-size:28px}.stat span{color:var(--dim)}
  h2{margin:44px 0 14px;font-size:25px}.ideas{display:grid;grid-template-columns:repeat(3,1fr);gap:12px}.idea{background:var(--panel);border:1px solid var(--line);border-radius:14px;padding:16px}.idea.s3{border-color:#765f32;background:linear-gradient(145deg,#221f18,var(--panel))}.idea-title{display:flex;flex-wrap:wrap;gap:8px;align-items:center}.idea-title span{font-size:21px}.idea-title strong{font-size:16px}.idea-title em{margin-left:auto;color:var(--dim);font-size:12px;font-style:normal;text-transform:uppercase}.idea p{color:#c5c7cc;margin:10px 0 0}.idea .matches{font-size:13px;color:var(--dim)}
  .matches-grid{display:grid;grid-template-columns:repeat(2,1fr);gap:14px}.match{background:var(--panel);border:1px solid var(--line);border-left:4px solid var(--loss);border-radius:14px;padding:18px}.match.win{border-left-color:var(--win)}
  .match-head,.score,.tags,.players{display:flex;flex-wrap:wrap;align-items:center;gap:9px}.match-head{justify-content:space-between;font-size:17px}.match-head strong{font-size:11px;letter-spacing:.1em;color:var(--loss)}.win .match-head strong{color:var(--win)}.num{color:#60656e;margin-right:10px}.score{margin:12px 0;color:var(--dim)}.score b{font-size:26px;color:var(--text);margin-right:5px}
  .tag{font-size:12px;background:#242832;border:1px solid #353a45;border-radius:999px;padding:5px 9px}.tag.s3{background:#372e19;border-color:#6d5726;color:#ffe09a}.tag.s2{color:#d8d0ff}.tag.muted{color:#9ba0a9}.players{margin-top:13px}.players span{background:var(--panel2);border-radius:7px;padding:5px 8px;font-size:12px}.players i{color:var(--dim);font-style:normal}.match ul{margin:14px 0 0;padding-left:19px;color:#b9bdc5;font-size:13px}.match small{color:var(--dim)}
  .note{background:#171923;border:1px dashed #3b4050;border-radius:14px;padding:18px;color:#b7bbc4}.hot{color:var(--hot)}
  @media(max-width:900px){.ideas{grid-template-columns:1fr 1fr}.matches-grid{grid-template-columns:1fr}.stats{grid-template-columns:1fr 1fr}}@media(max-width:560px){.ideas{grid-template-columns:1fr}.wrap{padding:28px 14px}.stats{grid-template-columns:1fr 1fr}}
  </style></head><body><main class="wrap">
  <div class="eyebrow">research / deterministic story layer</div><h1>Какие катки у Песиков вообще бывают</h1>
  <p class="lead">Выборка из ${rows.length} матчей ленты${OFFSET ? `, начиная с позиции ${OFFSET + 1}` : ""}. Категории ищут не «хорошо/плохо», а сюжет, который можно отдать голосу: кто сегодня был автоботом, зачем стак добровольно вернулся в очередь и каким способом опять насосали.</p>
  <section class="stats"><div class="stat"><b>${rows.length}</b><span>строк ленты, включая соло</span></div><div class="stat"><b>${wins}–${rows.length - wins}</b><span>исходы всех строк</span></div><div class="stat"><b>${catalog.length}</b><span>гипотез архетипов</span></div><div class="stat"><b>${classified}/${rows.length}</b><span>с выбранным сюжетом</span></div></section>
  <div class="note"><b class="hot">Покрытие фактурой:</b> replay-пакет есть у ${deepCount} из ${rows.length} матчей; ещё ${rows.length - deepCount} пока проверяют только категории по табло, KDA и истории. Соло, часть стака и стак явно разделены.</div>
  <div class="note"><b class="hot">Главная находка:</b> самые интересные категории живут между матчами. «Реванш без перекура», повтор того же героя после позора и компенсация через одну игру дают голосу память и делают разбор частью вечера, а не изолированной карточкой.</div>
  <h2>Кандидаты в словарь классификатора</h2><section class="ideas">${catalogHtml}</section>
  <h2>Все 20 матчей</h2><section class="matches-grid">${cards}</section>
  <h2>Что пока нельзя честно определить</h2><div class="note">Пороги подобраны на этой же маленькой выборке, поэтому это галерея проверяемых гипотез. Следующий шаг — прогнать ещё 30–50 replay-матчей как holdout, измерить ложные срабатывания и только потом переносить классы в production.</div>
  </main></body></html>`;
}

async function main(): Promise<void> {
  await mkdir(DETAILS_DIR, { recursive: true });
  const feed = await fetchJson<{ matches: FeedMatch[] }>(FEED_URL);
  const recent = feed.matches.slice(OFFSET, OFFSET + LIMIT);
  const rows: Row[] = [];

  for (const [index, match] of recent.entries()) {
    process.stdout.write(`[${index + 1}/${recent.length}] ${match.matchId}... `);
    const api = await apiDetails(match.matchId);
    const sample = api.players.find((p) => match.ours.some((our) => our.steamId === p.account_id));
    if (!sample) throw new Error(`Не нашли ни одного нашего игрока в API матча ${match.matchId}`);
    const ourSide = sample.player_slot < 128 ? "radiant" as const : "dire" as const;
    const sides = new Set(
      api.players
        .filter((p) => match.ours.some((our) => our.steamId === p.account_id))
        .map((p) => (p.player_slot < 128 ? "radiant" : "dire")),
    );
    if (sides.size !== 1) throw new Error(`Наши игроки оказались на разных сторонах в матче ${match.matchId}`);
    const ourScore = ourSide === "radiant" ? api.radiant_score : api.dire_score;
    const enemyScore = ourSide === "radiant" ? api.dire_score : api.radiant_score;
    const computedWin = ourSide === "radiant" ? api.radiant_win : !api.radiant_win;
    if (computedWin !== match.win) throw new Error(`Исход ленты не совпал с API в матче ${match.matchId}`);
    const knownById = new Map(match.ours.map((p) => [p.steamId, p]));
    const ourKnown = api.players
      .filter((p) => p.account_id !== undefined && knownById.has(p.account_id))
      .map((p) => ({
        ...(knownById.get(p.account_id as number) as FeedPlayer),
        participation: (p.kills + p.assists) / Math.max(1, ourScore),
      }));
    const row: Row = {
      feed: match,
      api,
      ourSide,
      ourScore,
      enemyScore,
      ourTeamDeaths: api.players
        .filter((p) => (p.player_slot < 128 ? "radiant" : "dire") === ourSide)
        .reduce((sum, p) => sum + p.deaths, 0),
      ourKnown,
      deep: await deepFacts(match.matchId),
      scope: match.ours.length >= 3 ? "stack" : match.ours.length === 2 ? "partial" : "solo",
      classifications: [],
      selectedClassifications: [],
    };
    rows.push(row);
    console.log(`${ourScore}:${enemyScore}`);
  }

  for (let index = 0; index < rows.length; index++) {
    const row = rows[index];
    row.previous = row.scope === "solo"
      ? undefined
      : rows.slice(index + 1).find((candidate) => {
          const shared = sharedPlayers(row.feed, candidate.feed).length;
          const smallerParty = Math.min(row.feed.ours.length, candidate.feed.ours.length);
          return shared >= 2 && shared / smallerParty >= 2 / 3;
        });
    if (row.previous) {
      row.queueGapMin = (row.feed.startTime - row.previous.feed.startTime - row.previous.feed.duration) / 60;
    }
    row.classifications = classifyMatch(row);
  }
  for (const row of rows) row.classifications.push(...classifySeries(row, rows));
  for (const row of rows) row.selectedClassifications = selectClassifications(row);

  const catalog = classificationCatalog(rows);
  await writeFile(path.join(OUT_DIR, "matches.json"), JSON.stringify(rows.map((row) => ({
    matchId: row.feed.matchId,
    win: row.feed.win,
    score: `${row.ourScore}:${row.enemyScore}`,
    duration: row.api.duration,
    ours: row.feed.ours,
    previousMatchId: row.previous?.feed.matchId,
    queueGapMin: row.queueGapMin,
    scope: row.scope,
    deep: row.deep,
    classifications: row.classifications,
    selectedClassifications: row.selectedClassifications,
  })), null, 2));
  await writeFile(path.join(OUT_DIR, "report.html"), html(rows, catalog));
  console.log(`\n${catalog.length} архетипов, отчёт: ${OUT_DIR}/report.html`);
}

main();
