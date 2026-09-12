import assert from "node:assert/strict";
import { mkdtemp, mkdir, writeFile, access, rm, chmod } from "node:fs/promises";
import { execFileSync } from "node:child_process";
import os from "node:os";
import path from "node:path";

const dir = await mkdtemp(path.join(os.tmpdir(), "pesiki-archive-"));
process.env.DATA_DIR = dir;
process.env.REPLAY_CACHE_DIR = path.join(dir, "scratch");
process.env.REPLAY_ARCHIVE_DIR = path.join(dir, "archives");
process.env.APM_DB_PATH = path.join(dir, "stats.sqlite");
process.env.REPLAY_PARSER_BIN = path.join(dir, "parser");
const { fetchAndParseReplay } = await import("./replay.js");
const { getApmStore } = await import("./apm-store.js");
const savedFetch = globalThis.fetch;
globalThis.fetch = async () => { throw new Error("Existing archive must not need the network"); };
try {
  await mkdir(process.env.REPLAY_ARCHIVE_DIR, { recursive:true });
  const demo = path.join(dir, "source.dem");
  const archive = path.join(process.env.REPLAY_ARCHIVE_DIR, "42.dem.archive");
  await writeFile(demo, "test demo");
  execFileSync("zstd", ["-q", demo, "-o", archive]);
  const parsed = { match_id:42, duration_min:2, players:[{steam_id:"76561197960265729",hero:"pudge",kills:4}] };
  await writeFile(process.env.REPLAY_PARSER_BIN, `#!/bin/sh\ncat <<'JSON'\n${JSON.stringify(parsed)}\nJSON\n`);
  await chmod(process.env.REPLAY_PARSER_BIN, 0o755);
  assert.deepEqual(await fetchAndParseReplay(42), parsed);
  await access(archive);
  await assert.rejects(access(path.join(process.env.REPLAY_CACHE_DIR, "42.dem")));
  await rm(process.env.REPLAY_CACHE_DIR, {recursive:true});
  await rm(process.env.REPLAY_PARSER_BIN);
  assert.deepEqual(await fetchAndParseReplay(42), parsed, "permanent DB serves replay without scratch cache or parser");
  console.log("✓ replay storage: reuse original archive offline, keep compressed file, remove scratch, load full parse from DB");
} finally {
  globalThis.fetch = savedFetch;
  getApmStore().close();
  await rm(dir, {recursive:true,force:true});
}
