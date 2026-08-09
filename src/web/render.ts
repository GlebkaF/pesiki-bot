/** HTML-рендер витрины: список матчей и страница матча с разбором. */
import { PLAYERS } from "../config.js";
import type { FeedMatch } from "./feed.js";
import type { Job, StoredAnalysis } from "./jobs.js";
import type { ParsedMatch, ParsedPlayer } from "../replay.js";
import type { MatchApi } from "../opendota.js";
import { toSteam32 } from "../replay.js";

const OUR_IDS = new Set(PLAYERS.map((p) => p.steamId));

export function esc(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

function dur(sec: number): string {
  return `${Math.floor(sec / 60)}:${String(sec % 60).padStart(2, "0")}`;
}

function mmss(min: number): string {
  return `${Math.floor(min)}:${String(Math.round((min % 1) * 60)).padStart(2, "0")}`;
}

function num(n: number): string {
  return n.toLocaleString("ru-RU").replace(/ /g, " ");
}

function dateLabel(ts: number): string {
  const d = new Date(ts * 1000);
  return d.toLocaleString("ru-RU", { day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit" });
}

/** Спарклайн: площадь, нулевая линия для знакопеременных рядов, точка на конце. */
function spark(series: number[], w = 150, h = 34): string {
  if (!series.length) return "";
  const lo = Math.min(...series);
  const hi = Math.max(...series);
  const rng = hi - lo || 1;
  const step = w / Math.max(1, series.length - 1);
  const pts = series.map((v, i) => [i * step, h - ((v - lo) / rng) * h] as const);
  const d = pts.map(([x, y], i) => `${i ? "L" : "M"}${x.toFixed(1)},${y.toFixed(1)}`).join(" ");
  const zero =
    lo < 0 && hi > 0
      ? `<line x1="0" y1="${(h - ((0 - lo) / rng) * h).toFixed(1)}" x2="${w}" y2="${(h - ((0 - lo) / rng) * h).toFixed(1)}" class="spark-zero"/>`
      : "";
  const last = pts[pts.length - 1];
  return `<svg class="spark" viewBox="0 0 ${w} ${h}" width="${w}" height="${h}" aria-hidden="true">
    <path d="${d} L${w},${h} L0,${h} Z" fill="var(--accent)" opacity=".12"/>${zero}
    <path d="${d}" fill="none" stroke="var(--accent)" stroke-width="1.6"/>
    <circle cx="${last[0].toFixed(1)}" cy="${last[1].toFixed(1)}" r="2.4" fill="var(--accent)"/></svg>`;
}

const CSS = `
:root {
  --ground:#EDEFF2; --surface:#FFFFFF; --surface-2:#F6F7F9; --ink:#12161B; --muted:#68727F;
  --line:#DCE0E6; --accent:#9A6B14; --accent-soft:#C8922A;
  --radiant:#3F6B2A; --dire:#A6403A; --good:#2E7D4F; --bad:#A6403A;
}
@media (prefers-color-scheme: dark) {
  :root:not([data-theme="light"]) {
    --ground:#0D1014; --surface:#161A20; --surface-2:#1C222A; --ink:#E6E9EE; --muted:#8A94A2;
    --line:#252B34; --accent:#E0A93F; --accent-soft:#C8922A;
    --radiant:#6FA348; --dire:#CC5A50; --good:#5CB183; --bad:#CC5A50;
  }
}
:root[data-theme="dark"] {
  --ground:#0D1014; --surface:#161A20; --surface-2:#1C222A; --ink:#E6E9EE; --muted:#8A94A2;
  --line:#252B34; --accent:#E0A93F; --accent-soft:#C8922A;
  --radiant:#6FA348; --dire:#CC5A50; --good:#5CB183; --bad:#CC5A50;
}
* { box-sizing:border-box; }
body { margin:0; background:var(--ground); color:var(--ink);
  font-family:system-ui,-apple-system,"Segoe UI",Roboto,sans-serif; font-size:15px; line-height:1.5; }
a { color:inherit; }
.mono { font-family:ui-monospace,SFMono-Regular,Menlo,monospace; font-variant-numeric:tabular-nums; }
.wrap { max-width:1100px; margin:0 auto; padding:32px 20px 80px; display:flex; flex-direction:column; gap:22px; }
.top { display:flex; justify-content:space-between; align-items:flex-end; gap:16px; flex-wrap:wrap; }
h1 { font-size:28px; letter-spacing:-.02em; margin:0; }
h1 a { text-decoration:none; }
.sub, .dim { color:var(--muted); font-size:13px; margin:0; }
.label { text-transform:uppercase; font-size:10.5px; letter-spacing:.09em; color:var(--muted); }
.stats { display:grid; grid-template-columns:repeat(auto-fit,minmax(140px,1fr)); gap:1px;
  background:var(--line); border:1px solid var(--line); border-radius:10px; overflow:hidden; }
.stat { background:var(--surface); padding:13px 15px; display:flex; flex-direction:column; gap:2px; }
.stat .v { font-size:23px; font-weight:650; letter-spacing:-.02em;
  font-family:ui-monospace,SFMono-Regular,Menlo,monospace; font-variant-numeric:tabular-nums; }
.card { background:var(--surface); border:1px solid var(--line); border-radius:12px; padding:20px; }
.card h2 { margin:0 0 4px; font-size:19px; letter-spacing:-.01em; }
.card h3 { margin:22px 0 10px; font-size:12px; text-transform:uppercase; letter-spacing:.08em; color:var(--muted); }
.feed { display:flex; flex-direction:column; gap:1px; background:var(--line);
  border:1px solid var(--line); border-radius:12px; overflow:hidden; }
.row { background:var(--surface); display:grid; grid-template-columns:40px 145px 1fr auto;
  gap:14px; align-items:center; padding:10px 15px; text-decoration:none; color:inherit; }
.row:hover { background:var(--surface-2); }
.row:focus-visible { outline:2px solid var(--accent); outline-offset:-2px; }
.res-mark { display:grid; place-items:center; width:26px; height:26px; border-radius:6px;
  font-weight:700; font-size:12px; color:#fff; }
.win .res-mark { background:var(--good); }
.loss .res-mark { background:var(--bad); }
.when { font-size:13px; font-weight:550; }
.rsub { font-size:11.5px; color:var(--muted); }
.players { display:flex; flex-wrap:wrap; gap:5px 13px; font-size:12.5px; }
.hero { color:var(--muted); }
.kda { font-family:ui-monospace,monospace; font-variant-numeric:tabular-nums; color:var(--accent); }
.chip { display:inline-block; font-size:10.5px; padding:2px 7px; border-radius:999px;
  border:1px solid var(--line); color:var(--muted); background:var(--surface-2); white-space:nowrap; }
.chip-deep { border-color:var(--accent-soft); color:var(--accent); }
.filters { display:flex; flex-wrap:wrap; gap:6px; }
.filters .chip { text-decoration:none; padding:4px 10px; font-size:12px; }
.filters .chip:hover { border-color:var(--accent-soft); color:var(--accent); }
.chip-on { background:var(--accent-soft); border-color:var(--accent-soft); color:#fff; }
.chip-on:hover { color:#fff; }
.teams { display:grid; grid-template-columns:1fr 1fr; gap:16px; margin-top:14px; }
@media (max-width:760px) { .teams { grid-template-columns:1fr; } }
.tname { font-size:12px; text-transform:uppercase; letter-spacing:.07em; margin:0 0 8px; }
.tname.radiant { color:var(--radiant); } .tname.dire { color:var(--dire); }
.btn { appearance:none; border:1px solid var(--accent-soft); background:var(--accent-soft); color:#fff;
  font:inherit; font-size:14px; font-weight:600; padding:9px 18px; border-radius:8px; cursor:pointer; }
.btn:hover { filter:brightness(1.07); }
.btn:disabled { opacity:.55; cursor:default; }
.btn.ghost { background:transparent; color:var(--accent); }
.btn:focus-visible { outline:2px solid var(--accent); outline-offset:2px; }
.actions { display:flex; gap:10px; align-items:center; flex-wrap:wrap; margin-top:16px; }
.progress { display:none; gap:10px; align-items:center; margin-top:14px; font-size:13px; color:var(--muted); }
.progress.on { display:flex; }
.pbar { flex:1; height:5px; background:var(--surface-2); border-radius:3px; overflow:hidden; max-width:320px; }
.pbar i { display:block; height:100%; width:15%; background:var(--accent-soft); transition:width .4s ease; }
.spin { width:13px; height:13px; border:2px solid var(--line); border-top-color:var(--accent);
  border-radius:50%; animation:sp .8s linear infinite; }
@keyframes sp { to { transform:rotate(360deg); } }
@media (prefers-reduced-motion:reduce) { .spin { animation:none; } .pbar i { transition:none; } }
.tablewrap { overflow-x:auto; margin-top:14px; }
table { width:100%; border-collapse:collapse; font-size:13px; }
th { text-align:left; font-size:10.5px; text-transform:uppercase; letter-spacing:.07em;
  color:var(--muted); font-weight:600; padding:0 10px 8px 0; border-bottom:1px solid var(--line); }
td { padding:7px 10px 7px 0; border-bottom:1px solid var(--line); white-space:nowrap; }
td.mono { font-family:ui-monospace,monospace; font-variant-numeric:tabular-nums; }
tr.ours td { background:color-mix(in srgb, var(--accent) 8%, transparent); }
.dot { display:inline-block; width:7px; height:7px; border-radius:2px; margin-right:7px; }
.dot.radiant { background:var(--radiant); }
.dot.dire { background:var(--dire); }
.pname { color:var(--muted); font-size:12px; margin-left:6px; }
td .sm { color:var(--muted); font-size:11px; }
.fights { list-style:none; margin:0; padding:0; display:flex; flex-direction:column; gap:4px; }
.fights li { display:grid; grid-template-columns:46px 86px 88px 1fr; gap:12px; align-items:center;
  font-size:12.5px; padding:4px 0; border-bottom:1px solid var(--line); }
.fights .t { color:var(--muted); }
.fbar { height:5px; background:var(--surface-2); border-radius:3px; overflow:hidden; }
.fbar i { display:block; height:100%; background:var(--accent-soft); }
.good { color:var(--good); } .bad { color:var(--bad); }
.analysis { background:var(--surface-2); border:1px solid var(--line); border-left:3px solid var(--accent-soft);
  border-radius:8px; padding:16px 18px; font-size:14px; line-height:1.6; white-space:pre-wrap; }
.spark-zero { stroke:var(--line); stroke-width:1; stroke-dasharray:2 3; }
.err { color:var(--bad); font-size:13px; }
.note { background:var(--surface-2); border:1px solid var(--line); border-radius:8px;
  padding:12px 14px; font-size:12.5px; color:var(--muted); }
footer { color:var(--muted); font-size:12px; text-align:center; padding-top:8px; }
@media (max-width:760px) {
  .row { grid-template-columns:34px 1fr; row-gap:8px; }
  .row .players, .row .tail { grid-column:1/-1; }
}
`;

export function layout(title: string, body: string, script = ""): string {
  return `<!doctype html><html lang="ru"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>${esc(title)}</title>
<link rel="icon" href="data:image/svg+xml,<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 100 100'><text y='.9em' font-size='90'>🐕</text></svg>">
<style>${CSS}</style></head><body><div class="wrap">${body}</div>${script ? `<script>${script}</script>` : ""}</body></html>`;
}

export function renderFeed(
  matches: FeedMatch[],
  updatedAt: number,
  analyzed: Set<number>,
  filter?: string,
): string {
  const all = matches;
  if (filter) matches = matches.filter((m) => m.ours.some((o) => o.name === filter));
  const names = [...new Set(all.flatMap((m) => m.ours.map((o) => o.name)))].sort();
  const chips =
    '<div class="filters"><a class="chip' + (filter ? "" : " chip-on") + '" href="/">все</a>' +
    names
      .map(
        (n) =>
          '<a class="chip' + (filter === n ? " chip-on" : "") + '" href="/?player=' +
          encodeURIComponent(n) + '">' + esc(n) + "</a>",
      )
      .join("") + "</div>";
  const wins = matches.filter((m) => m.win).length;
  const hours = matches.reduce((s, m) => s + m.duration, 0) / 3600;

  const rows = matches
    .map((m) => {
      const ours = m.ours
        .map(
          (o) =>
            `<span><b>${esc(o.name)}</b> <span class="hero">${esc(o.hero)}</span> <span class="kda">${o.kills}/${o.deaths}/${o.assists}</span></span>`,
        )
        .join("");
      return `<a class="row ${m.win ? "win" : "loss"}" href="/match/${m.matchId}">
      <span class="res-mark">${m.win ? "W" : "L"}</span>
      <span><span class="when">${esc(dateLabel(m.startTime))}</span><br><span class="rsub mono">${dur(m.duration)}</span> <span class="rsub">· ${m.matchId}</span></span>
      <span class="players">${ours}</span>
      <span class="tail">${analyzed.has(m.matchId) ? '<span class="chip chip-deep">разобран</span>' : '<span class="chip">открыть</span>'}</span>
    </a>`;
    })
    .join("");

  return layout(
    "Песики · матчи стака",
    `<div class="top">
      <div><h1>Песики</h1><p class="sub">Матчи стака и разбор по реплеям</p></div>
      <form method="post" action="/refresh"><button class="btn ghost" type="submit">Обновить ленту</button></form>
    </div>
    <div class="stats">
      <div class="stat"><span class="label">матчей</span><span class="v">${matches.length}</span></div>
      <div class="stat"><span class="label">побед</span><span class="v">${wins}/${matches.length}</span></div>
      <div class="stat"><span class="label">винрейт</span><span class="v">${matches.length ? Math.round((wins / matches.length) * 100) : 0}%</span></div>
      <div class="stat"><span class="label">часов</span><span class="v">${hours.toFixed(0)}</span></div>
      <div class="stat"><span class="label">разобрано</span><span class="v">${analyzed.size}</span></div>
    </div>
    ${chips}
    <div class="feed">${rows || '<div class="row"><span class="dim">Матчей не найдено</span></div>'}</div>
    <footer>Обновлено ${esc(new Date(updatedAt).toLocaleString("ru-RU"))} · данные: OpenDota + реплеи Valve</footer>`,
  );
}

function playerRow(p: ParsedPlayer, ourTeam: string): string {
  const isOur = OUR_IDS.has(toSteam32(p.steam_id));
  return `<tr class="${isOur ? "ours" : ""}">
    <td><span class="dot ${p.team}"></span>${esc(p.hero)}<span class="pname">${esc(p.name)}</span>${isOur ? ' <span class="chip chip-deep">наш</span>' : ""}</td>
    <td class="mono">${esc(p.lane)}/${esc(p.lane_role.slice(0, 4))}</td>
    <td class="mono">${p.kills}/${p.deaths}/${p.assists}</td>
    <td class="mono">${p.last_hits}<span class="sm">+${p.denies}</span></td>
    <td class="mono">${p.cs_at_10}</td>
    <td class="mono">${num(p.networth_final)}</td>
    <td class="mono">${num(p.hero_damage)}</td>
    <td>${spark(p.networth_by_minute ?? [], 110, 24)}</td>
  </tr>`;
}

function parsedBlock(parsed: ParsedMatch): string {
  const ourTeam =
    parsed.players.find((p) => OUR_IDS.has(toSteam32(p.steam_id)))?.team ?? "radiant";
  const minutes = Math.min(...parsed.players.map((p) => (p.networth_by_minute ?? []).length));
  const adv: number[] = [];
  for (let i = 0; i < minutes; i++) {
    const a = parsed.players.filter((p) => p.team === ourTeam).reduce((s, p) => s + (p.networth_by_minute?.[i] ?? 0), 0);
    const b = parsed.players.filter((p) => p.team !== ourTeam).reduce((s, p) => s + (p.networth_by_minute?.[i] ?? 0), 0);
    adv.push(a - b);
  }

  const rows = [...parsed.players]
    .sort((a, b) => (a.team === ourTeam ? -1 : 1) - (b.team === ourTeam ? -1 : 1) || b.networth_final - a.networth_final)
    .map((p) => playerRow(p, ourTeam))
    .join("");

  const fights = (parsed.teamfights ?? [])
    .slice(0, 12)
    .map((t) => {
      const weLost = ourTeam === "radiant" ? t.radiant_died : t.dire_died;
      const theyLost = ourTeam === "radiant" ? t.dire_died : t.radiant_died;
      return `<li><span class="mono t">${mmss(t.start_min)}</span>
        <span class="fbar"><i style="width:${Math.min(100, t.deaths * 14)}%"></i></span>
        <span class="${weLost < theyLost ? "good" : "bad"}">мы −${weLost}, они −${theyLost}</span>
        <span class="dim">${esc(t.heroes_died.slice(0, 5).join(", "))}</span></li>`;
    })
    .join("");

  return `<div class="card">
    <div class="top">
      <div><h2>Данные реплея</h2><p class="dim">${parsed.duration_min} мин · играли за ${ourTeam} · ${parsed.kills?.length ?? 0} убийств</p></div>
      <div style="text-align:right"><span class="label">преимущество по золоту</span><br>${spark(adv, 220, 44)}
        <br><span class="mono" style="color:var(--accent);font-weight:600">${adv.length && adv[adv.length - 1] > 0 ? "+" : ""}${adv.length ? num(adv[adv.length - 1]) : "—"}</span></div>
    </div>
    <div class="tablewrap"><table>
      <thead><tr><th>игрок</th><th>линия</th><th>K/D/A</th><th>CS</th><th>CS@10</th><th>нетворс</th><th>урон</th><th>экономика</th></tr></thead>
      <tbody>${rows}</tbody></table></div>
    <h3>Тимфайты</h3><ul class="fights">${fights || '<li class="dim">крупных замесов не было</li>'}</ul>
  </div>`;
}

export interface ApiSidePlayer {
  hero: string;
  name: string;
  kills: number;
  deaths: number;
  assists: number;
  gpm: number;
  netWorth: number;
  damage: number;
  lastHits: number;
  isOur: boolean;
}

export interface ApiOverview {
  radiant: ApiSidePlayer[];
  dire: ApiSidePlayer[];
  radiantWin: boolean;
  radiantScore: number;
  direScore: number;
  replayAvailable: boolean;
}

function sideTable(title: string, side: "radiant" | "dire", players: ApiSidePlayer[], won: boolean): string {
  const rows = players
    .map(
      (p) => `<tr class="${p.isOur ? "ours" : ""}">
      <td>${esc(p.hero)}<span class="pname">${esc(p.name)}</span></td>
      <td class="mono">${p.kills}/${p.deaths}/${p.assists}</td>
      <td class="mono">${p.lastHits}</td>
      <td class="mono">${p.gpm}</td>
      <td class="mono">${num(p.netWorth)}</td>
      <td class="mono">${num(p.damage)}</td></tr>`,
    )
    .join("");
  return `<div><p class="tname ${side}">${esc(title)} ${won ? "· победа" : ""}</p>
    <div class="tablewrap" style="margin-top:0"><table>
    <thead><tr><th>игрок</th><th>K/D/A</th><th>CS</th><th>GPM</th><th>нетворс</th><th>урон</th></tr></thead>
    <tbody>${rows}</tbody></table></div></div>`;
}

export function renderMatch(
  matchId: number,
  feedMatch: FeedMatch | undefined,
  stored: StoredAnalysis | null,
  job: Job | undefined,
  api?: ApiOverview | null,
): string {
  const head = feedMatch
    ? `<p class="sub">${esc(dateLabel(feedMatch.startTime))} · <span class="mono">${dur(feedMatch.duration)}</span> · ${feedMatch.win ? '<span class="good">победа</span>' : '<span class="bad">поражение</span>'} · наши: ${esc(feedMatch.ours.map((o) => o.name).join(", "))}</p>`
    : `<p class="sub">Матча нет в ленте — можно разобрать по номеру</p>`;

  const analysisBlock = stored
    ? `<div class="card"><h2>Разбор</h2><p class="dim">формат: ${esc(stored.format)} · ${esc(new Date(stored.createdAt).toLocaleString("ru-RU"))}</p>
       <div class="analysis" style="margin-top:14px">${esc(stored.text)}</div>
       <div class="actions">
         <button class="btn" id="post" data-match="${matchId}">Запостить в чат</button>
         <button class="btn ghost" id="go" data-match="${matchId}">Разобрать заново</button>
         <span id="postmsg" class="dim">${stored.postedAt ? `Уже отправляли ${esc(new Date(stored.postedAt).toLocaleString("ru-RU"))}` : ""}</span>
       </div></div>`
    : `<div class="card"><h2>Разбор ещё не сделан</h2>
       <p class="dim">Бот скачает реплей с серверов Valve, разберёт его своим парсером и напишет разбор. Обычно 1–2 минуты.</p>
       <p style="margin-top:14px"><button class="btn" id="go" data-match="${matchId}">Разобрать матч</button></p>
       <div class="progress" id="prog"><span class="spin"></span><span id="pmsg">Запускаю…</span><span class="pbar"><i id="pbar"></i></span></div>
       <p class="err" id="err"></p></div>`;

  const body = `<div class="top">
      <div><h1><a href="/">Песики</a> <span class="dim">/ матч ${matchId}</span></h1>${head}</div>
      <a class="btn ghost" href="https://www.opendota.com/matches/${matchId}" target="_blank" rel="noopener">OpenDota</a>
    </div>
    ${analysisBlock}
    ${stored ? parsedBlock(stored.parsed) : ""}
    ${
      api
        ? `<div class="card"><h2>Составы и итоги</h2>
           <p class="dim">Счёт ${api.radiantScore} : ${api.direScore} · данные OpenDota</p>
           <div class="teams">
             ${sideTable("Radiant", "radiant", api.radiant, api.radiantWin)}
             ${sideTable("Dire", "dire", api.dire, !api.radiantWin)}
           </div></div>`
        : ""
    }
    ${
      !stored
        ? api && !api.replayAvailable
          ? '<div class="note">Ссылки на реплей пока нет — при разборе бот сам попросит её у Valve, это добавит около минуты. Для совсем старых матчей может не сработать: Valve хранит реплеи ограниченное время.</div>'
          : '<div class="note">Реплей уже доступен — разбор пойдёт сразу.</div>'
        : ""
    }`;

  const script = `
const postBtn = document.getElementById('post');
if (postBtn) postBtn.addEventListener('click', async () => {
  const out = document.getElementById('postmsg');
  postBtn.disabled = true;
  if (out) { out.textContent = 'Отправляю…'; out.className = 'dim'; }
  try {
    const r = await fetch('/api/post/' + postBtn.dataset.match, {method:'POST'}).then(x => x.json());
    if (r.ok) {
      if (out) { out.textContent = 'Отправлено в чат'; out.className = 'good'; }
      postBtn.textContent = 'Отправить ещё раз';
    } else {
      if (out) { out.textContent = r.error || 'Не отправилось'; out.className = 'err'; }
    }
  } catch (e) {
    if (out) { out.textContent = 'Сеть не ответила'; out.className = 'err'; }
  }
  postBtn.disabled = false;
});

const stages = {queued:8, locating:14, requesting:28, downloading:52, unpacking:64, parsing:80, writing:92, done:100};
const btn = document.getElementById('go');
if (btn) btn.addEventListener('click', async () => {
  const id = btn.dataset.match;
  btn.disabled = true;
  const prog = document.getElementById('prog'), msg = document.getElementById('pmsg'),
        bar = document.getElementById('pbar'), err = document.getElementById('err');
  if (prog) prog.classList.add('on');
  try {
    await fetch('/api/analyze/' + id, {method:'POST'});
  } catch (e) {
    if (err) err.textContent = 'Не удалось запустить разбор';
    btn.disabled = false; return;
  }
  const tick = setInterval(async () => {
    const r = await fetch('/api/job/' + id).then(x => x.json()).catch(() => null);
    if (!r) return;
    if (msg) msg.textContent = r.message || '';
    if (bar) bar.style.width = (stages[r.stage] || 10) + '%';
    if (r.stage === 'done') { clearInterval(tick); location.reload(); }
    if (r.stage === 'error') {
      clearInterval(tick);
      if (prog) prog.classList.remove('on');
      if (err) err.textContent = r.error || 'Ошибка разбора';
      btn.disabled = false;
    }
  }, 1500);
});`;

  return layout(`Матч ${matchId} · Песики`, body, script);
}
