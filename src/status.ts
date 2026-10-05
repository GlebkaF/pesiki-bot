import { config, PLAYERS, type Player } from "./config.js";
import { HERO_CATALOG } from "./hero-catalog.js";
import { getAppFetch, getDirectFetch } from "./proxy.js";
import { getPlayerSummaries, isPlayingDota, type SteamPlayer } from "./steam.js";
import { escapeHtml } from "./telegram-html.js";

interface LiveGame {
  server_steam_id?: string;
  last_update_time?: number;
  deactivate_time?: number;
  game_time?: number;
  players?: Array<{ account_id: number; hero_id?: number }>;
}

export interface LiveStatus {
  heroId?: number;
  level?: number;
  gameTime?: number;
}

const finite = (value: unknown): value is number => typeof value === "number" && Number.isFinite(value);
const heroes = new Map(HERO_CATALOG.map(hero => [hero.id, hero.localized_name]));

/** OpenDota retains old entries: only accept recently updated, active matches. */
export function freshLiveGames(data: unknown, now = Date.now()): LiveGame[] {
  if (!Array.isArray(data)) throw new Error("Invalid live games response");
  return data.filter((game): game is LiveGame => game &&
    finite(game.last_update_time) && game.last_update_time <= now / 1000 + 60 &&
    game.last_update_time >= now / 1000 - 180 && !game.deactivate_time &&
    Array.isArray(game.players));
}

async function fetchLiveStatuses(ids: Set<number>): Promise<Map<number, LiveStatus>> {
  const fetchFn = await getAppFetch();
  const response = await fetchFn("https://api.opendota.com/api/live", { signal: AbortSignal.timeout(6000) });
  if (!response.ok) throw new Error(`Live API: ${response.status}`);
  const games = freshLiveGames(await response.json());
  const statuses = new Map<number, LiveStatus>();
  await Promise.all(games.filter(game => game.players!.some(p => p && ids.has(p.account_id))).map(async game => {
    for (const player of game.players!) {
      if (player && ids.has(player.account_id)) {
        statuses.set(player.account_id, { heroId: player.hero_id, gameTime: game.game_time });
      }
    }
    // 64-bit server IDs must remain strings; rounded JSON numbers are unsafe.
    if (typeof game.server_steam_id !== "string" || !/^\d+$/.test(game.server_steam_id)) return;
    try {
      const url = new URL("https://api.steampowered.com/IDOTA2MatchStats_570/GetRealtimeStats/v1/");
      url.searchParams.set("key", config.steamApiKey);
      url.searchParams.set("server_steam_id", game.server_steam_id);
      const details = await getDirectFetch()(url, { signal: AbortSignal.timeout(5000) });
      if (!details.ok) return;
      const data = await details.json() as {
        match?: { game_time?: number; game_state?: number };
        teams?: Array<{ players?: Array<{ accountid: number; heroid?: number; level?: number }> }>;
      };
      if (data.match?.game_state !== undefined && data.match.game_state >= 6) {
        for (const player of game.players!) statuses.delete(player.account_id);
        return;
      }
      for (const team of data.teams ?? []) {
        for (const player of team.players ?? []) {
          const status = statuses.get(player.accountid);
          if (!status) continue;
          if (finite(player.heroid) && player.heroid > 0) status.heroId = player.heroid;
          if (finite(player.level) && player.level > 0) status.level = player.level;
          if (finite(data.match?.game_time)) status.gameTime = data.match.game_time;
        }
      }
    } catch {
      // Hero and clock from the live list remain useful when detailed stats fail.
    }
  }));
  return statuses;
}

function clock(seconds: number): string {
  const absolute = Math.floor(Math.abs(seconds));
  return `${seconds < 0 ? "−" : ""}${Math.floor(absolute / 60)}:${String(absolute % 60).padStart(2, "0")}`;
}

export function formatStackStatus(
  roster: readonly Player[], summaries: Map<number, SteamPlayer>, live = new Map<number, LiveStatus>(),
  liveUnavailable = false,
): string {
  const online: string[] = [];
  const offline: string[] = [];
  const unknown: string[] = [];
  let inDota = false;
  let hasLive = false;
  for (const member of roster) {
    const player = summaries.get(member.steamId);
    const name = escapeHtml((member.displayName || player?.personaname || member.dotaName).slice(0, 80));
    if (!player) { unknown.push(name); continue; }
    if (isPlayingDota(player)) {
      inDota = true;
      const match = live.get(member.steamId);
      if (!match) {
        online.push(`🎮 <b>${name}</b> — Dota 2 запущена; статус матча неизвестен`);
        continue;
      }
      hasLive = true;
      const parts = ["в матче"];
      if (finite(match.heroId) && match.heroId > 0) parts.push(heroes.get(match.heroId) ?? `герой #${match.heroId}`);
      if (finite(match.level) && match.level > 0) parts.push(`ур. ${match.level}`);
      if (finite(match.gameTime)) parts.push(`⏱ ${clock(match.gameTime)}`);
      online.push(`🎮 <b>${name}</b> — ${parts.join(" · ")}`);
    } else if (player.gameid) {
      online.push(`🕹 <b>${name}</b> — ${escapeHtml((player.gameextrainfo || "другая игра").slice(0, 80))}`);
    } else if (player.personastate > 0) {
      const state = ({ 2: "занят", 3: "отошёл", 4: "нет на месте" } as Record<number, string>)[player.personastate] ?? "онлайн";
      online.push(`🟢 <b>${name}</b> — ${state}, игра не запущена`);
    } else {
      offline.push(name);
    }
  }
  const lines = ["🐕 <b>Статус стака</b>", "", ...online];
  if (!online.length) lines.push("Сейчас никто из стака не виден онлайн.");
  if (offline.length) lines.push("", `⚫ Не в сети / невидимка: ${offline.join(", ")}`);
  if (unknown.length) lines.push("", `❔ Нет данных: ${unknown.join(", ")}`);
  if (inDota) lines.push("", liveUnavailable
    ? "Данные матчей сейчас недоступны."
    : "Герой, уровень и таймер — только если доступны. Публичный список охватывает не все матчи.");
  if (hasLive) lines.push("Таймер по последним live-данным, возможна задержка.");
  return lines.join("\n");
}

// Coalesce simultaneous chat requests and avoid hammering upstream services.
let pending: Promise<string> | undefined;
let cached: { text: string; until: number } | undefined;
export async function getStackStatus(): Promise<string> {
  if (!config.steamApiKey) return "Статус недоступен: не настроен Steam API key.";
  if (cached && cached.until > Date.now()) return cached.text;
  if (pending) return pending;
  pending = (async () => {
    const summaries = await getPlayerSummaries(PLAYERS.map(p => p.steamId), config.steamApiKey);
    const dotaIds = new Set([...summaries].filter(([, player]) => isPlayingDota(player)).map(([id]) => id));
    let live = new Map<number, LiveStatus>();
    let unavailable = false;
    if (dotaIds.size) {
      try { live = await fetchLiveStatuses(dotaIds); }
      catch { unavailable = true; }
    }
    const text = formatStackStatus(PLAYERS, summaries, live, unavailable);
    cached = { text, until: Date.now() + 15_000 };
    return text;
  })();
  try { return await pending; }
  finally { pending = undefined; }
}
