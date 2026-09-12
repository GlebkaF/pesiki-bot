import type { ParsedMatch } from "./replay.js";
import { PLAYERS } from "./config.js";

/** Keep exact numbers in our-player lines deterministic, including cached analyses. */
export function withAnalysisApm(text: string, parsed: ParsedMatch): string {
  const ours = PLAYERS.flatMap(config => {
    const player = parsed.players.find(p => p.steam_id === String(BigInt(config.steamId) + 76561197960265728n));
    return player ? [{ name: config.dotaName, player }] : [];
  });
  if (!ours.length) return text;
  const split = text.split(/\n*👤\s*НАШИ\s*\n/iu);
  const previous = (split[1] ?? "").split("\n");
  const lines = ours.map(({ name, player: p }) => {
    const old = previous.find(line => line.startsWith(`${name} ·`));
    const hero = old?.split(" · ")[1] || p.hero.replaceAll("_", " ");
    const comment = old?.match(/\d+\/\d+\/\d+(?: · APM (?:\d+|—))?( — .*)?$/u)?.[1] ?? "";
    return `${name} · ${hero} · ${p.kills}/${p.deaths}/${p.assists} · APM ${p.actions_per_min ?? "—"}${comment}`;
  });
  return `${split[0].trimEnd()}\n\n👤 НАШИ\n${lines.join("\n")}`;
}
