import { readdir, lstat, unlink } from 'node:fs/promises';
import path from 'node:path';

export const REPLAY_ARCHIVE_TTL_MS = 3 * 24 * 60 * 60 * 1000;

/** Caller must serialize with downloads/parsing. Age is since download, not last read. */
export async function pruneReplayArchives(directory: string, now = Date.now()) {
  let files;
  try { files = await readdir(directory); }
  catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return { removed: 0, bytes: 0 }; throw error; }
  const result = { removed: 0, bytes: 0 };
  for (const name of files) {
    if (!/^\d+\.dem\.archive$/.test(name)) continue;
    const file = path.join(directory, name);
    try {
      const info = await lstat(file);
      if (!info.isFile() || now - info.mtimeMs < REPLAY_ARCHIVE_TTL_MS) continue;
      await unlink(file);
      result.removed++;
      result.bytes += info.size;
    } catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; }
  }
  return result;
}
