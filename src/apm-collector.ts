import { fetchAndParseReplay } from "./replay.js";
import { getApmStore } from "./apm-store.js";

// Re-discovered by feed sync after restart. Fresh unavailable replays retry on the
// next cycle after two minutes; old demos are not endlessly requested from Valve.
const retryAfter = new Map<number, number>();
const pending = new Map<number, number>();
let running = false;
export function collectApm(matches: { matchId: number; startTime: number }[]): void {
  const now = Date.now();
  for (const m of matches) {
    if (m.startTime < now / 1000 - 7 * 86400 || m.startTime > now / 1000 ||
        (retryAfter.get(m.matchId) ?? 0) > now || getApmStore().hasMatch(m.matchId)) continue;
    pending.set(m.matchId, m.startTime);
  }
  void pump().catch(error => console.error("[APM] collection failed:", error));
}
async function pump(): Promise<void> {
  if (running) return;
  running = true;
  try {
    while (pending.size) {
      const [matchId, startTime] = [...pending].sort((a, b) => b[1] - a[1])[0];
      pending.delete(matchId);
      if (getApmStore().hasMatch(matchId)) continue;
      retryAfter.set(matchId, Date.now() + (startTime > Date.now()/1000 - 86400 ? 2 : 10) * 60_000);
      try {
        const parsed = await fetchAndParseReplay(matchId, () => {}, true);
        parsed.start_time ??= startTime;
        getApmStore().save(parsed);
        if (!getApmStore().hasMatch(matchId)) retryAfter.set(matchId, Date.now() + 24 * 3600_000);
      } catch (error) {
        console.warn(`[APM] ${matchId}:`, (error as Error).message);
      }
    }
  } finally { running = false; }
}
