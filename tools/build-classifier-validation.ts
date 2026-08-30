/**
 * Scope-aware проверка deterministic classifier.
 * Частота срабатывания не называется качеством: без независимой ручной разметки
 * класс может быть только observed, а не validated.
 */
import { createHash } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";

const DISCOVERY_DIR = process.env.CLASSIFIER_DISCOVERY_DIR || "data/classifier-eval";
const HOLDOUT_DIR = process.env.CLASSIFIER_HOLDOUT_DIR || "data/classifier-holdout";
const STACK_SMOKE_DIR = process.env.CLASSIFIER_STACK_SMOKE_DIR || "data/classifier-stack-smoke";
const OUTPUT = process.env.CLASSIFIER_VALIDATION_OUTPUT || "data/classifier-validation.html";

interface Classification {
  id: string;
  title: string;
  kind: "match" | "player" | "series";
  source: "scoreboard" | "replay" | "history" | "profile";
  strength: number;
  confidence: "high" | "medium";
}

interface DeepFacts {
  version?: number;
  match: { shape: string; storySignals?: string[] };
}

interface SavedRow {
  matchId: number;
  win: boolean;
  score: string;
  duration: number;
  previousMatchId?: number;
  queueGapMin?: number;
  scope: "solo" | "partial" | "stack";
  deep?: DeepFacts;
  classifications: Classification[];
  selectedClassifications: Classification[];
}

interface Manifest {
  classifierVersion: string;
  materializedAt: string;
  generatedAt: string;
  gitSha: string;
  gitDirty: boolean;
  rulesSourceSha256: string;
  matchCount: number;
  matchIdsSha256: string;
  oldestStartTime: number;
  newestStartTime: number;
  factsVersions: number[];
  scope: Record<SavedRow["scope"], number>;
  preRegisteredBeforeTuning: boolean;
}

interface Dataset {
  name: "discovery" | "holdout" | "stack-smoke";
  dir: string;
  rows: SavedRow[];
  manifest: Manifest;
  failures: Array<{ matchId: number; error: string }>;
}

interface ProxyMetrics {
  id: "fast-stomp" | "fast-stomp-loss";
  title: string;
  tp: number;
  fp: number;
  fn: number;
  tn: number;
  precision: number | null;
  recall: number | null;
  positiveSupport: number;
  falsePositiveIds: number[];
  falseNegativeIds: number[];
}

type Status = "observed" | "new_observation" | "hypothesis" | "rework" | "unvalidated_scope";

function esc(value: unknown): string {
  return String(value ?? "").replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;");
}

async function requiredJson<T>(file: string): Promise<T> {
  try {
    return JSON.parse(await readFile(file, "utf8")) as T;
  } catch (error) {
    throw new Error(`Validation input missing or invalid: ${file}`, { cause: error });
  }
}

function idsHash(rows: SavedRow[]): string {
  return createHash("sha256").update(rows.map((row) => row.matchId).sort((a, b) => a - b).join(",")).digest("hex");
}

async function dataset(name: Dataset["name"], dir: string): Promise<Dataset> {
  const rows = await requiredJson<SavedRow[]>(path.join(dir, "matches.json"));
  const manifest = await requiredJson<Manifest>(path.join(dir, "manifest.json"));
  const failures = await requiredJson<Array<{ matchId: number; error: string }>>(path.join(dir, "deep", "failures.json"));
  if (manifest.matchCount !== rows.length) throw new Error(`${name}: manifest count ${manifest.matchCount} != ${rows.length}`);
  if (manifest.matchIdsSha256 !== idsHash(rows)) throw new Error(`${name}: match ID hash mismatch`);
  const actualScope = {
    solo: rows.filter((row) => row.scope === "solo").length,
    partial: rows.filter((row) => row.scope === "partial").length,
    stack: rows.filter((row) => row.scope === "stack").length,
  };
  if (JSON.stringify(actualScope) !== JSON.stringify(manifest.scope)) throw new Error(`${name}: scope summary mismatch`);
  const actualFactsVersions = [...new Set(rows.flatMap((row) => row.deep?.version === undefined ? [] : [row.deep.version]))].sort();
  if (JSON.stringify(actualFactsVersions) !== JSON.stringify(manifest.factsVersions)) {
    throw new Error(`${name}: facts versions ${actualFactsVersions} != manifest ${manifest.factsVersions}`);
  }
  return { name, dir, rows, manifest, failures };
}

function truth(row: SavedRow, id: ProxyMetrics["id"]): boolean {
  const signal = id === "fast-stomp" ? "short_lopsided_win" : "short_lopsided_loss";
  return row.deep?.match.storySignals?.includes(signal) ?? false;
}

function scoreboardPrediction(row: SavedRow, id: ProxyMetrics["id"]): boolean {
  const [ourScore, enemyScore] = row.score.split(":").map(Number);
  const margin = ourScore - enemyScore;
  const durationMin = row.duration / 60;
  return id === "fast-stomp"
    ? row.win && durationMin < 22 && margin >= 25
    : !row.win && durationMin < 22 && margin <= -20;
}

function proxyMetrics(rows: SavedRow[], id: ProxyMetrics["id"], title: string): ProxyMetrics {
  let tp = 0; let fp = 0; let fn = 0; let tn = 0;
  const falsePositiveIds: number[] = []; const falseNegativeIds: number[] = [];
  for (const row of rows.filter((item) => item.deep)) {
    const predicted = scoreboardPrediction(row, id);
    const actual = truth(row, id);
    if (predicted && actual) tp++;
    else if (predicted) { fp++; falsePositiveIds.push(row.matchId); }
    else if (actual) { fn++; falseNegativeIds.push(row.matchId); }
    else tn++;
  }
  return {
    id, title, tp, fp, fn, tn,
    precision: tp + fp ? tp / (tp + fp) : null,
    recall: tp + fn ? tp / (tp + fn) : null,
    positiveSupport: tp + fn,
    falsePositiveIds, falseNegativeIds,
  };
}

function counts(rows: SavedRow[]): Map<string, { item: Classification; matches: number[]; selected: number }> {
  const result = new Map<string, { item: Classification; matches: number[]; selected: number }>();
  for (const row of rows) {
    const selected = new Set(row.selectedClassifications.map((item) => item.id));
    for (const item of row.classifications) {
      const current = result.get(item.id) ?? { item, matches: [], selected: 0 };
      if (!current.matches.includes(row.matchId)) current.matches.push(row.matchId);
      if (selected.has(item.id)) current.selected++;
      result.set(item.id, current);
    }
  }
  return result;
}

function pct(value: number | null): string { return value === null ? "—" : `${Math.round(value * 100)}%`; }
function links(ids: number[]): string {
  return ids.length ? ids.map((id) => `<a href="https://pesiki.nxrig.com/match/${id}" target="_blank">${id}</a>`).join(", ") : "—";
}

function decision(item: Classification, discoveryCount: number, holdoutCount: number, stackHoldout: number): { status: Status; reason: string } {
  if (item.kind === "series" && stackHoldout === 0) {
    return { status: "unvalidated_scope", reason: "в holdout нет ни одного stack-матча; отсутствие/частота ничего не доказывает" };
  }
  if (item.id.endsWith("scoreboard-candidate")) {
    return { status: "rework", reason: "scoreboard-only кандидат запрещён для голоса; требуется replay" };
  }
  if (holdoutCount > 0 && discoveryCount === 0) {
    return { status: "new_observation", reason: `${holdoutCount} новых наблюдений; это не проверка discovery-гипотезы` };
  }
  if (holdoutCount > 0) {
    return { status: "observed", reason: `${holdoutCount} срабатываний; precision и интересность без ручной разметки неизвестны` };
  }
  return { status: "hypothesis", reason: "на доступном scope не наблюдался повторно" };
}

async function main(): Promise<void> {
  const discovery = await dataset("discovery", DISCOVERY_DIR);
  const holdout = await dataset("holdout", HOLDOUT_DIR);
  const stackSmoke = await dataset("stack-smoke", STACK_SMOKE_DIR);
  if (discovery.manifest.classifierVersion !== holdout.manifest.classifierVersion) {
    throw new Error(`Classifier version mismatch: ${discovery.manifest.classifierVersion} != ${holdout.manifest.classifierVersion}`);
  }
  if (stackSmoke.manifest.classifierVersion !== holdout.manifest.classifierVersion) {
    throw new Error(`Stack smoke classifier version mismatch: ${stackSmoke.manifest.classifierVersion}`);
  }
  for (const candidate of [discovery, stackSmoke]) {
    if (candidate.manifest.rulesSourceSha256 !== holdout.manifest.rulesSourceSha256) {
      throw new Error(`${candidate.name}: rules source hash mismatch`);
    }
    if (candidate.manifest.gitSha !== holdout.manifest.gitSha) throw new Error(`${candidate.name}: git SHA mismatch`);
  }
  const overlap = discovery.rows.filter((row) => holdout.rows.some((candidate) => candidate.matchId === row.matchId)).map((row) => row.matchId);
  if (overlap.length) throw new Error(`Discovery/holdout overlap: ${overlap.join(", ")}`);
  const smokeOverlap = stackSmoke.rows.filter((row) => [...discovery.rows, ...holdout.rows].some((candidate) => candidate.matchId === row.matchId)).map((row) => row.matchId);
  if (smokeOverlap.length) throw new Error(`Stack smoke overlaps earlier sets: ${smokeOverlap.join(", ")}`);

  // Production proxy cards are holdout-only. Discovery is shown separately as diagnostics.
  const metrics = [
    proxyMetrics(holdout.rows, "fast-stomp", "Scoreboard: быстрый разгром соперника"),
    proxyMetrics(holdout.rows, "fast-stomp-loss", "Scoreboard: быстрый разгром Песиков"),
  ];
  const discoveryMetrics = [
    proxyMetrics(discovery.rows, "fast-stomp", "discovery fast-win"),
    proxyMetrics(discovery.rows, "fast-stomp-loss", "discovery fast-loss"),
  ];
  const discoveryCounts = counts(discovery.rows);
  const holdoutCounts = counts(holdout.rows);
  const ids = [...new Set([...discoveryCounts.keys(), ...holdoutCounts.keys()])];
  const decisions = ids.map((id) => {
    const d = discoveryCounts.get(id); const h = holdoutCounts.get(id); const item = h?.item ?? d?.item;
    if (!item) throw new Error(`Нет классификации ${id}`);
    return {
      id, item, discoveryCount: d?.matches.length ?? 0, holdoutCount: h?.matches.length ?? 0,
      holdoutSelected: h?.selected ?? 0,
      holdoutExamples: (h?.matches ?? []).slice(0, 5),
      discoveryExamples: (d?.matches ?? []).slice(0, 5),
      ...decision(item, d?.matches.length ?? 0, h?.matches.length ?? 0, holdout.manifest.scope.stack),
    };
  }).sort((a, b) => {
    const order: Record<Status, number> = { rework: 0, unvalidated_scope: 1, new_observation: 2, observed: 3, hypothesis: 4 };
    return order[a.status] - order[b.status] || b.holdoutCount - a.holdoutCount;
  });

  const deepDiscovery = discovery.rows.filter((row) => row.deep).length;
  const deepHoldout = holdout.rows.filter((row) => row.deep).length;
  const selectedOverflow = [...discovery.rows, ...holdout.rows].filter((row) => row.selectedClassifications.length > 3);
  const duplicateIds = [...discovery.rows, ...holdout.rows].flatMap((row) => {
    const rowIds = row.classifications.map((item) => item.id);
    return rowIds.length === new Set(rowIds).size ? [] : [row.matchId];
  });

  const metricCards = metrics.map((item) => {
    const verdict = item.id === "fast-stomp-loss" ? "REWORK — не отдавать голосу без replay" : item.positiveSupport < 5 ? "Мало положительных примеров" : "Нужна ручная разметка";
    return `<article class="metric ${item.id === "fast-stomp-loss" || item.fp || item.positiveSupport < 5 ? "warn" : "good"}"><h3>${esc(item.title)}</h3>
      <div class="big">precision ${pct(item.precision)} · recall ${pct(item.recall)}</div>
      <p>только 50 holdout: TP ${item.tp} · FP ${item.fp} · FN ${item.fn} · TN ${item.tn} · positives ${item.positiveSupport}</p>
      <p><b>${verdict}</b><br>ложные +: ${links(item.falsePositiveIds)}<br>пропуски: ${links(item.falseNegativeIds)}</p></article>`;
  }).join("");
  const statusLabel: Record<Status, string> = {
    observed: "наблюдалось", new_observation: "новое", hypothesis: "гипотеза", rework: "переделать", unvalidated_scope: "scope не проверен",
  };
  const rowsHtml = decisions.map((entry) => `<tr data-status="${entry.status}"><td><span class="pill ${entry.status}">${statusLabel[entry.status]}</span></td>
    <td><b>${esc(entry.item.title)}</b><small>${esc(entry.id)} · ${esc(entry.item.kind)} · ${esc(entry.item.source)} · надёжность источника ${esc(entry.item.confidence)}</small></td>
    <td>${entry.discoveryCount}</td><td>${entry.holdoutCount}</td><td>${entry.holdoutSelected}</td><td>${esc(entry.reason)}</td><td><small>separate</small>${links(entry.holdoutExamples)}<small>discovery</small>${links(entry.discoveryExamples)}</td></tr>`).join("");

  const html = `<!doctype html><html lang="ru"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Classifier validation</title><style>
  :root{--bg:#0c0d10;--panel:#15171c;--line:#2c3038;--text:#f2efe8;--dim:#aeb3bc;--green:#7dda95;--red:#ff7b72;--yellow:#f2c66d;--purple:#bda8ff;--blue:#75bfff}*{box-sizing:border-box}body{margin:0;background:radial-gradient(circle at 10% -10%,#2a2140 0,transparent 32%),var(--bg);color:var(--text);font:15px/1.5 Inter,system-ui,sans-serif}main{max-width:1320px;margin:auto;padding:44px 24px 80px}a{color:#d8ceff}nav{display:flex;gap:14px;margin-bottom:22px}.eyebrow{color:var(--purple);font-size:12px;font-weight:800;letter-spacing:.13em;text-transform:uppercase}h1{font-size:clamp(38px,6vw,72px);line-height:.94;letter-spacing:-.05em;max-width:1000px;margin:10px 0 18px}.lead{font-size:18px;color:#c7cad0;max-width:950px}.stats,.metrics{display:grid;grid-template-columns:repeat(4,1fr);gap:12px;margin:28px 0}.stat,.metric,.note{background:var(--panel);border:1px solid var(--line);border-radius:14px;padding:17px}.stat b,.big{display:block;font-size:25px}.stat span,.metric p,small{color:var(--dim)}.metrics{grid-template-columns:repeat(2,1fr)}.metric.good{border-color:#315c3d}.metric.warn{border-color:#735f30}.metric h3{margin:0 0 8px}.note{margin:16px 0}.danger{border-color:#6a3733}.filters{display:flex;flex-wrap:wrap;gap:7px;margin:12px 0}.filters button{background:#20232a;color:var(--text);border:1px solid var(--line);border-radius:999px;padding:6px 10px;cursor:pointer}.filters button:hover{border-color:var(--purple)}table{width:100%;border-collapse:separate;border-spacing:0 7px}th{text-align:left;color:var(--dim);font-size:12px;padding:8px;position:sticky;top:0;background:var(--bg);z-index:2}td{background:var(--panel);padding:12px 8px;vertical-align:top}td:first-child{border-radius:10px 0 0 10px}td:last-child{border-radius:0 10px 10px 0}td small{display:block;font-size:11px}.pill{display:inline-block;border-radius:999px;padding:4px 8px;font-size:11px;font-weight:800;white-space:nowrap}.observed{background:#183a24;color:var(--green)}.new_observation{background:#173047;color:var(--blue)}.rework{background:#46211f;color:var(--red)}.hypothesis{background:#3b311c;color:var(--yellow)}.unvalidated_scope{background:#392745;color:#d9a8ff}@media(max-width:850px){.stats{grid-template-columns:1fr 1fr}.metrics{grid-template-columns:1fr}.table-wrap{overflow:auto}table{min-width:950px}}</style></head><body><main>
  <nav><a href="classifier-eval/report.html">discovery gallery</a><a href="classifier-holdout/report.html">separate gallery</a><a href="classifier-stack-smoke/report.html">future stack smoke</a></nav><div class="eyebrow">deterministic classifier / scope-aware audit</div>
  <h1>Наблюдения — не зелёная печать production</h1><p class="lead">Discovery и 50 непересекающихся матчей пересобраны одной версией правил. Но выборка не была pre-registered до настройки порогов, ручной ground truth нет, а stack scope в holdout отсутствует. Ниже ровно то, что данные реально позволяют утверждать.</p>
  <section class="stats"><div class="stat"><b>${discovery.rows.length} · ${deepDiscovery} replay</b><span>discovery</span></div><div class="stat"><b>${holdout.rows.length} · ${deepHoldout} replay</b><span>отдельная выборка</span></div><div class="stat"><b>${holdout.manifest.scope.solo}/${holdout.manifest.scope.partial}/${holdout.manifest.scope.stack}</b><span>solo / partial / stack</span></div><div class="stat"><b>v${holdout.manifest.factsVersions.join(", v")}</b><span>facts · classifier ${esc(holdout.manifest.classifierVersion)}</span></div></section>
  <div class="note danger"><b>Ограничение scope:</b> holdout содержит ${holdout.manifest.scope.solo} solo, ${holdout.manifest.scope.partial} partial и ${holdout.manifest.scope.stack} stack матчей. Поэтому классы серии/стакового вечера помечены «scope не проверен», а не «не сработали».</div>
  <div class="note"><b>Future stack smoke:</b> после исходных выборок появились ${stackSmoke.rows.length} новых stack-матча (${links(stackSmoke.rows.map((row) => row.matchId))}), оба с replay v${stackSmoke.manifest.factsVersions.join(", v")}. Они проверяют wiring серии (между играми ${stackSmoke.rows.find((row) => row.queueGapMin !== undefined)?.queueGapMin?.toFixed(2) ?? "—"} мин), но относятся к одной сессии и не считаются независимой validation.</div>
  <div class="note"><b>Воспроизводимость:</b> IDs materialized ${esc(holdout.manifest.materializedAt)} · report generated ${esc(holdout.manifest.generatedAt)} · IDs sha256 ${holdout.manifest.matchIdsSha256} · rules sha256 ${holdout.manifest.rulesSourceSha256} · git ${esc(holdout.manifest.gitSha.slice(0, 12))}${holdout.manifest.gitDirty ? " (dirty)" : " (clean)"} · range ${new Date(holdout.manifest.oldestStartTime * 1000).toISOString()} — ${new Date(holdout.manifest.newestStartTime * 1000).toISOString()} · pre-registered: нет.</div>
  <div class="note"><b>Целостность:</b> overlap discovery/holdout — нет; дубликаты классов — ${duplicateIds.length ? links(duplicateIds) : "нет"}; больше трёх выбранных сюжетов — ${selectedOverflow.length ? links(selectedOverflow.map((row) => row.matchId)) : "нет"}; replay failures: ${discovery.failures.length + holdout.failures.length}.</div>
  <h2>Scoreboard-прокси против replay label — только holdout</h2><section class="metrics">${metricCards}</section>
  <div class="note">Replay exact-классы используют тот же storySignal, поэтому их срабатывание подтверждает wiring, но не precision. Discovery diagnostics: fast-win ${pct(discoveryMetrics[0].precision)}/${pct(discoveryMetrics[0].recall)}, fast-loss ${pct(discoveryMetrics[1].precision)}/${pct(discoveryMetrics[1].recall)} — в holdout-метрики не подмешаны.</div>
  <h2>Словарь: что реально известно</h2><div class="filters"><button data-filter="all">все</button>${Object.entries(statusLabel).map(([status, label]) => `<button data-filter="${status}">${label}</button>`).join("")}</div><div class="table-wrap"><table><thead><tr><th>статус</th><th>класс</th><th>discovery</th><th>separate</th><th>выбран</th><th>почему</th><th>примеры</th></tr></thead><tbody>${rowsHtml}</tbody></table></div>
  <div class="note"><b>Правило:</b> observed означает только «детерминированное правило встретилось». Manually validated классов пока ноль. Scoreboard fast-loss запрещён для голоса; series ждёт будущих полных stack-сессий; semantic precision оценивается только отдельной слепой разметкой.</div>
  </main><script>document.querySelectorAll('[data-filter]').forEach(button=>button.addEventListener('click',()=>{const filter=button.dataset.filter;document.querySelectorAll('tbody tr').forEach(row=>row.hidden=filter!=='all'&&row.dataset.status!==filter)}))</script></body></html>`;

  await writeFile(OUTPUT, html);
  await writeFile(OUTPUT.replace(/\.html$/u, ".json"), JSON.stringify({
    generatedAt: new Date().toISOString(), classifierVersion: holdout.manifest.classifierVersion,
    datasets: { discovery: discovery.manifest, holdout: holdout.manifest, stackSmoke: stackSmoke.manifest },
    coverage: { discovery: `${deepDiscovery}/${discovery.rows.length}`, holdout: `${deepHoldout}/${holdout.rows.length}` },
    overlap, smokeOverlap, integrity: { duplicateIds, selectedOverflow: selectedOverflow.map((row) => row.matchId) },
    metrics, discoveryMetrics, decisions,
  }, null, 2));
  console.log(`Validation report: ${OUTPUT}`);
}

main();
