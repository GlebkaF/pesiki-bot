import assert from "node:assert/strict";
import { mkdtemp, readFile, readdir, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

const root = await mkdtemp(path.join(os.tmpdir(), "pesiki-web-jobs-"));
process.env.DATA_DIR = root;
const analysisDir = path.join(root, "analysis");
await import("node:fs/promises").then((fs) => fs.mkdir(analysisDir, { recursive: true }));

const jobs = await import("./web/jobs.js");
await writeFile(path.join(analysisDir, "111.json"), JSON.stringify({ matchId: 111, format: "старый" }));
await writeFile(path.join(analysisDir, "222.json"), JSON.stringify({
  matchId: 222,
  engine: jobs.CURRENT_ANALYSIS_ENGINE,
  format: "Песик сбоку",
}));

assert.equal(await jobs.purgeLegacyAnalyses(), 1);
assert.equal(await jobs.getStoredAnalysis(111), null);
assert.equal(JSON.parse(await readFile(path.join(analysisDir, "222.json"), "utf8")).engine, jobs.CURRENT_ANALYSIS_ENGINE);
const archived=await readdir(path.join(root,"analysis-archive"));
assert.equal(archived.length,1);
assert.equal(JSON.parse(await readFile(path.join(root,"analysis-archive",archived[0]),"utf8")).matchId,111);
console.log("✓ web jobs: legacy analyses archived without losing their text");
