import type { ApmRecord } from "./apm-store.js";
import type { RecentMatch } from "./opendota.js";

/** Arithmetic mean of match APM, over exactly the matches in the selected period.
 * Missing replays are not zero; no all-time OpenDota fallback. */
export function summarizeApm(history: ApmRecord[], matches: Pick<RecentMatch, "match_id">[]): { avgApm?: number; apmMatches: number } {
  const ids = new Set(matches.map(m => m.match_id));
  const values = new Map(history.filter(r => ids.has(r.match_id)).map(r => [r.match_id, r.apm]));
  return { avgApm: values.size ? Math.round([...values.values()].reduce((a, b) => a + b, 0) / values.size) : undefined,
    apmMatches: values.size };
}
