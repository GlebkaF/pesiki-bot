import assert from 'node:assert/strict';
import { mkdtemp, writeFile, utimes, symlink, mkdir, readdir, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { pruneReplayArchives, REPLAY_ARCHIVE_TTL_MS } from './replay-retention.js';
const dir = await mkdtemp(path.join(os.tmpdir(), 'replay-retention-'));
const now = Date.now();
try {
  for (const name of ['1.dem.archive', '2.dem.archive', '3.download', '4.dem', '5.json', 'stats.sqlite']) {
    const file = path.join(dir, name);
    await writeFile(file, 'fixture');
    const time = new Date(now - (name === '2.dem.archive' ? 1000 : REPLAY_ARCHIVE_TTL_MS + 1000));
    await utimes(file, time, time);
  }
  await symlink(path.join(dir, 'stats.sqlite'), path.join(dir, '6.dem.archive'));
  await mkdir(path.join(dir, '7.dem.archive'));
  assert.deepEqual(await pruneReplayArchives(dir, now), { removed: 1, bytes: 7 });
  assert.deepEqual((await readdir(dir)).sort(), ['2.dem.archive','3.download','4.dem','5.json','6.dem.archive','7.dem.archive','stats.sqlite']);
  assert.deepEqual(await pruneReplayArchives(dir, now), { removed: 0, bytes: 0 });
  assert.deepEqual(await pruneReplayArchives(path.join(dir, 'missing'), now), { removed: 0, bytes: 0 });
  console.log('Replay retention: expired only, recent archives, DB/JSON/scratch/symlinks preserved, idempotence passed');
} finally { await rm(dir, { recursive: true, force: true }); }
