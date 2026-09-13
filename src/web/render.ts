import {renderReplayInsights} from "./match-render.js";
import {MATCH_SCRIPT} from "./match-script.js";
import {MATCH_CSS} from "./match-style.js";
import {PROFILE_CSS} from "./profile-style.js";
import {PROFILE_SCRIPT} from "./profile-script.js";
/** HTML-рендер витрины: список матчей и страница матча с разбором. */
import type { FeedMatch } from "./feed.js";
import type { Job, StoredAnalysis } from "./jobs.js";
import type { ParsedMatch } from "../replay.js";
import type { MatchApi } from "../opendota.js";


export function esc(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

function dur(sec: number): string {
  return `${Math.floor(sec / 60)}:${String(sec % 60).padStart(2, "0")}`;
}

function num(n: number): string {
  return n.toLocaleString("ru-RU").replace(/ /g, " ");
}

function dateLabel(ts: number): string {
  const d = new Date(ts * 1000);
  return d.toLocaleString("ru-RU", { day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit" });
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
    --radiant:#6FA348; --dire:#CC5A50; --good:#5CB183; --bad:#DC7066;
  }
}
:root[data-theme="dark"] {
  --ground:#0D1014; --surface:#161A20; --surface-2:#1C222A; --ink:#E6E9EE; --muted:#8A94A2;
  --line:#252B34; --accent:#E0A93F; --accent-soft:#C8922A;
  --radiant:#6FA348; --dire:#CC5A50; --good:#5CB183; --bad:#DC7066;
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

export function layout(title: string, body: string, script = "", extraCss = "", preview?: {description:string;image?:string}): string {
  return `<!doctype html><html lang="ru"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>${esc(title)}</title><script>try{const t=localStorage.getItem('pesikiTheme');if(t==='dark'||t==='light')document.documentElement.dataset.theme=t;}catch{}</script>
${preview?`<meta name="description" content="${esc(preview.description)}"><meta property="og:type" content="website"><meta property="og:site_name" content="Пёсики"><meta property="og:title" content="${esc(title)}"><meta property="og:description" content="${esc(preview.description)}">${preview.image?`<meta property="og:image" content="${esc(preview.image)}">`:""}`:""}
<link rel="icon" href="data:image/svg+xml,<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 100 100'><text y='.9em' font-size='90'>🐕</text></svg>">
<style>${CSS}
.site-nav{display:flex;gap:22px;align-items:center;padding-bottom:18px;border-bottom:1px solid var(--line);font-size:13px}.site-nav a{text-decoration:none}.site-nav .brand{font-weight:800;letter-spacing:.13em;margin-right:auto}
${extraCss||PROFILE_CSS}
.theme-toggle{width:44px;height:44px;flex:0 0 44px;border:1px solid var(--line);border-radius:4px;background:var(--surface);color:var(--ink);font-size:21px;cursor:pointer}.theme-toggle:focus-visible{outline:2px solid var(--accent);outline-offset:2px}
</style></head><body><div class="wrap"><nav class="site-nav" aria-label="Навигация"><a class="brand" href="/">ПЁСИКИ</a><a href="/">Матчи</a><a href="/players">Игроки</a><button id="theme-toggle" class="theme-toggle" type="button" aria-label="Сменить цветовую тему">◐</button></nav>${body}</div><script>{const b=document.getElementById('theme-toggle');const update=()=>{const t=document.documentElement.dataset.theme;b.title=b.ariaLabel='Тема: '+(t==='dark'?'тёмная':t==='light'?'светлая':'системная')+'. Нажми, чтобы сменить';};b.addEventListener('click',()=>{const current=document.documentElement.dataset.theme,next=current==='dark'?'light':current==='light'?'auto':'dark';if(next==='auto')delete document.documentElement.dataset.theme;else document.documentElement.dataset.theme=next;try{localStorage.setItem('pesikiTheme',next);}catch{}update();});update();}</script>${script ? `<script>${script}</script>` : ""}</body></html>`;
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
      <span class="tail">${analyzed.has(m.matchId) ? '<span class="chip chip-deep">сводка</span>' : '<span class="chip">открыть</span>'}</span>
    </a>`;
    })
    .join("");

  return layout(
    "Песики · матчи стака",
    `<main class="feed-view"><div class="top">
      <div><h1>Песики</h1><p class="sub">Матчи стака и разбор по реплеям</p></div>
      <form method="post" action="/refresh"><button class="btn ghost" type="submit">Обновить ленту</button></form>
    </div>
    <div class="stats">
      <div class="stat"><span class="label">матчей</span><span class="v">${matches.length}</span></div>
      <div class="stat"><span class="label">побед</span><span class="v">${wins}/${matches.length}</span></div>
      <div class="stat"><span class="label">винрейт</span><span class="v">${matches.length ? Math.round((wins / matches.length) * 100) : 0}%</span></div>
      <div class="stat"><span class="label">часов</span><span class="v">${hours.toFixed(0)}</span></div>
      <div class="stat"><span class="label">сводок</span><span class="v">${matches.filter(m=>analyzed.has(m.matchId)).length}</span></div>
    </div>
    ${chips}
    <div class="feed">${rows || '<div class="row"><span class="dim">Матчей не найдено</span></div>'}</div>
    <footer>Обновлено ${esc(new Date(updatedAt).toLocaleString("ru-RU"))} · данные: OpenDota + реплеи Valve</footer></main>`,
    "{const f=document.querySelector('.filters'),c=f?.querySelector('.chip-on');if(f&&c)f.scrollLeft=Math.max(0,c.offsetLeft-f.offsetLeft-8);}",
  );
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
  savedParsed?: ParsedMatch,
  options?:{player?:string;official?:MatchApi},
): string {
  const parsed = savedParsed ?? stored?.parsed;
  const head = feedMatch
    ? `<p class="sub">${esc(dateLabel(feedMatch.startTime))} · <span class="mono">${dur(feedMatch.duration)}</span> · ${feedMatch.win ? '<span class="good">победа</span>' : '<span class="bad">поражение</span>'} · наши: ${esc(feedMatch.ours.map((o) => o.name).join(", "))}</p>`
    : parsed?`<p class="sub">${parsed.start_time?esc(dateLabel(parsed.start_time))+" · ":""}${dur(Math.round(parsed.duration_min*60))} · ${parsed.winner==="radiant"?"Победа Radiant":parsed.winner==="dire"?"Победа Dire":"Исход неизвестен"}</p>`:`<p class="sub">Матча нет в ленте — можно разобрать по номеру</p>`;

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

  const body = `<main class="match-view"><div class="top match-head">
      <div><h1>Матч <span class="mono">${matchId}</span></h1>${head}</div>
      <a class="btn ghost" href="https://www.opendota.com/matches/${matchId}" target="_blank" rel="noopener">OpenDota</a>
    </div>
    ${parsed ? renderReplayInsights(parsed,options?.player,options?.official) : ""}
    <section id="analysis" class="insight-panel"><div class="section-head"><h2><a href="#analysis">Сводка бота</a></h2><button class="share-section" type="button" data-share-section="analysis" aria-label="Скопировать ссылку на сводку">↗</button></div>${analysisBlock}</section>
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
          ? '<div class="note">Ссылки на реплей пока нет. У свежих матчей она обычно просто ещё не появилась: бот попросит её у Valve и подождёт до двух минут. У старых матчей файл уже мог быть удалён.</div>'
          : parsed ? '<div class="note">Данные реплея уже сохранены.</div>' : '<div class="note">Доступность реплея проверится при запуске разбора.</div>'
        : ""
    }</main>`;

  const script = `

// Действия закрыты basic-авторизацией на уровне Caddy. Браузер не показывает
// диалог для fetch, поэтому спрашиваем логин сами и запоминаем на устройстве.
async function authFetch(url, opts) {
  opts = opts || {};
  const send = (creds) => fetch(url, Object.assign({}, opts, {
    headers: Object.assign({}, opts.headers || {}, creds ? {Authorization: 'Basic ' + creds} : {})
  }));
  let creds = localStorage.getItem('pesikiAuth');
  let res = await send(creds);
  if (res.status !== 401) return res;

  const login = prompt('Логин'); if (login === null) return res;
  const pass = prompt('Пароль'); if (pass === null) return res;
  creds = btoa(login + ':' + pass);
  res = await send(creds);
  if (res.status !== 401) localStorage.setItem('pesikiAuth', creds);
  else localStorage.removeItem('pesikiAuth');
  return res;
}

const postBtn = document.getElementById('post');
if (postBtn) postBtn.addEventListener('click', async () => {
  const out = document.getElementById('postmsg');
  postBtn.disabled = true;
  if (out) { out.textContent = 'Отправляю…'; out.className = 'dim'; }
  try {
    const resp = await authFetch('/api/post/' + postBtn.dataset.match, {method:'POST'});
    if (resp.status === 401) { if (out) { out.textContent = 'Нужен пароль'; out.className = 'err'; } postBtn.disabled = false; return; }
    const r = await resp.json();
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
    const resp = await authFetch('/api/analyze/' + id, {method:'POST'});
    if (resp.status === 401) {
      if (err) err.textContent = 'Нужен пароль, чтобы запускать разбор';
      if (prog) prog.classList.remove('on');
      btn.disabled = false; return;
    }
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

  return layout(`Матч ${matchId} · Песики`, body, script+(parsed?PROFILE_SCRIPT+MATCH_SCRIPT:""),PROFILE_CSS+MATCH_CSS);
}
