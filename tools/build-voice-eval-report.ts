import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";

const ROOT = "data/main-voice-eval";
const OUTPUT = path.join(ROOT, "voice-report.html");

interface Version {
  id: "v4" | "v7" | "v8";
  title: string;
  file: string;
}

interface MatchSpec {
  id: number;
  slug: string;
  label: string;
  verdict: string;
  quote: string;
}

const versions: Version[] = [
  { id: "v4", title: "V4 · голос изнутри стака", file: "v4" },
  { id: "v7", title: "V7 · первый roster tail", file: "v7" },
  { id: "v8", title: "V8 · компактный 👤 НАШИ", file: "current" },
];

const matches: MatchSpec[] = [
  {
    id: 8973704266,
    slug: "warmup-stomp",
    label: "Разминочная мясорубка",
    verdict: "V8 оставляет разгром и персональную Дровку в прозе, а roster tail отдаёт каждому только новый факт. Четыре короткие строки расширяют матч, не пересказывая семь смертей Shootema второй раз.",
    quote: "Marinad — Фена не брала предыдущие 15 игр, но сделала четыре фрага.",
  },
  {
    id: 8973735117,
    slug: "comeback",
    label: "Камбек со дна",
    verdict: "V8 держит камбек вокруг Кентавра и zladey, но в хвосте не повторяет их KDA и смерти. Пять строк добавляют башни, ассисты, ЦМ, личную жертву Жана и контекст Aoba.",
    quote: "Твердости Жана — KittyCap на Рубике убит четыре раза; Жан доволен.",
  },
  {
    id: 8973789729,
    slug: "autobots",
    label: "Автоботы по другую сторону",
    verdict: "V8 оставляет счёт, автоботов и необычный мид Marinad в главной истории. Roster tail добавляет только профиль урона, лечения и башен — без повторения KDA и семи убийств Рубика.",
    quote: "Marinad — вылечила 29 428, ни разу не умерла; кора прошла.",
  },
];

function esc(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

function wordCount(value: string): number {
  return value.trim() ? value.trim().split(/\s+/u).length : 0;
}

function paragraphs(value: string): string {
  return value
    .trim()
    .split(/\n\s*\n/u)
    .map((paragraph) => `<p>${esc(paragraph).replaceAll("\n", "<br>")}</p>`)
    .join("");
}

function fileName(match: MatchSpec, version: Version): string {
  const base = `${match.id}.${match.slug}`;
  return version.file === "current" ? `${base}.txt` : `${base}.${version.file}.txt`;
}

async function main(): Promise<void> {
  const cards: string[] = [];

  for (const match of matches) {
    const renderedVersions: string[] = [];
    for (const version of versions) {
      const name = fileName(match, version);
      const text = await readFile(path.join(ROOT, name), "utf8");
      renderedVersions.push(`<article class="version ${version.id === "v8" ? "winner" : ""}">
        <header>
          <div><span class="version-name">${esc(version.title)}</span>${version.id === "v8" ? '<span class="badge">финальный</span>' : ""}</div>
          <span class="count">${wordCount(text)} слов</span>
        </header>
        <div class="copy">${paragraphs(text)}</div>
      </article>`);
    }

    cards.push(`<section class="match" id="match-${match.id}">
      <div class="match-heading">
        <div><span class="match-number">${match.id}</span><h2>${esc(match.label)}</h2></div>
        <a href="https://pesiki.nxrig.com/match/${match.id}" target="_blank" rel="noreferrer">открыть матч ↗</a>
      </div>
      <div class="verdict"><strong>Red-team:</strong> ${esc(match.verdict)} <q>${esc(match.quote)}</q></div>
      <div class="versions">${renderedVersions.join("")}</div>
    </section>`);
  }

  const html = `<!doctype html>
<html lang="ru">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <title>Main voice eval · v4 vs v7 vs v8</title>
  <style>
    :root{--bg:#0b0c10;--panel:#14161c;--panel2:#191c23;--line:#2a2e37;--text:#f5f1e9;--dim:#9fa5af;--hot:#ffca62;--accent:#b9a7ff;--win:#80db9d}
    *{box-sizing:border-box}body{margin:0;background:radial-gradient(circle at 10% -5%,#29213d 0,transparent 29%),var(--bg);color:var(--text);font:15px/1.55 Inter,ui-sans-serif,system-ui,sans-serif}
    main{max-width:1500px;margin:auto;padding:42px 24px 80px}.eyebrow{color:var(--accent);font-size:12px;font-weight:800;letter-spacing:.14em;text-transform:uppercase}
    h1{font-size:clamp(38px,6vw,76px);line-height:.92;letter-spacing:-.055em;margin:12px 0 18px;max-width:1050px}.lead{max-width:840px;color:#c6c9d0;font-size:18px;margin-bottom:26px}
    .summary{display:grid;grid-template-columns:1fr 1fr;gap:14px;margin:28px 0 54px}.note{background:var(--panel);border:1px solid var(--line);border-radius:16px;padding:20px}.note h3{margin:0 0 10px;font-size:16px}.note ol,.note ul{margin:0;padding-left:20px;color:#c4c7ce}.note li+li{margin-top:6px}
    .match{margin-top:56px}.match-heading{display:flex;align-items:end;justify-content:space-between;gap:18px;border-bottom:1px solid var(--line);padding-bottom:13px}.match-heading h2{font-size:29px;margin:3px 0 0}.match-number{font-size:12px;color:var(--accent);letter-spacing:.08em}.match-heading a{color:var(--dim);text-decoration:none;font-size:13px}.match-heading a:hover{color:var(--text)}
    .verdict{margin:14px 0 18px;color:#c5c8cf}.verdict strong{color:var(--hot)}.verdict q{display:block;color:var(--text);font-size:17px;font-weight:650;margin-top:7px}.versions{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:14px;align-items:start}
    .version{background:var(--panel);border:1px solid var(--line);border-radius:16px;overflow:hidden}.version.winner{border-color:#39734b;box-shadow:0 0 0 1px #285438,0 20px 60px #07120b}.version header{display:flex;justify-content:space-between;align-items:center;gap:10px;background:var(--panel2);border-bottom:1px solid var(--line);padding:12px 15px}.version-name{font-size:13px;font-weight:800}.badge{display:inline-block;margin-left:8px;padding:2px 7px;border-radius:999px;background:#183b24;color:var(--win);font-size:10px;font-weight:800;text-transform:uppercase}.count{white-space:nowrap;color:var(--dim);font-size:12px}.copy{padding:7px 17px 15px}.copy p{margin:12px 0;color:#d5d3ce}.winner .copy p{color:#f1ede5}
    @media(max-width:1050px){.versions{grid-template-columns:1fr}.version{max-width:820px}.summary{grid-template-columns:1fr}}@media(max-width:620px){main{padding:28px 14px 60px}.match-heading{align-items:start;flex-direction:column}.match-heading h2{font-size:24px}.verdict q{font-size:15px}}
  </style>
</head>
<body><main>
  <div class="eyebrow">main voice / taste eval</div>
  <h1>Как Песик вышел из стака, но не потерял право всех обосрать</h1>
  <p class="lead">Три реплея и три поздние версии голоса: V4 ещё говорит от лица команды, V7 впервые добавляет roster tail, V8 ужимает <b>👤 НАШИ</b> до самостоятельных панчей без повтора главной прозы.</p>
  <section class="summary">
    <div class="note"><h3>Контракт финального V8</h3><ol>
      <li>Первая строка сразу даёт исход матча и смешную завязку.</li>
      <li>Песик говорит о стаке в третьем лице; наши идут под точными никами.</li>
      <li>При первом упоминании врага рядом стоят его ник и герой.</li>
      <li><b>👤 НАШИ</b> — 6–14 слов на игрока: один новый факт или панч без повтора прозы.</li>
    </ol></div>
    <div class="note"><h3>Что сказал red-team</h3><ul>
      <li>V4 уже держал внимание, но «мы» делало Песика участником матча, а не ехидным свидетелем.</li>
      <li>V7 вернул весь состав через сканируемый roster tail, но местами повторил уже рассказанные факты.</li>
      <li>V8 сохраняет один сюжет в прозе, а хвост использует как отдельный слой новой персональной фактуры.</li>
      <li>Лимит 6–14 слов не даёт roster tail снова превратиться в обязательный мини-отчёт.</li>
    </ul></div>
  </section>
  ${cards.join("\n")}
</main></body></html>`;

  await writeFile(OUTPUT, html);
  console.log(`Voice eval report: ${OUTPUT}`);
}

main();
