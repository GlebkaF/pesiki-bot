import {sendText} from "./http-response.js";
import {readPlayerAvatar} from "../player-avatars.js";
import {buildPlayerProgress} from "../player-progress.js";
import { loadProfiles, periodOf } from "../player-profile.js";
import { buildEconomy } from "../profile-economy.js";
import { renderPlayers, renderPlayer } from "./player-render.js";
import { getApmStore } from "../apm-store.js";
/**
 * HTTP-витрина матчей стака. Работает рядом с ботом в том же процессе.
 * Никаких фреймворков: маршрутов мало, а лишняя зависимость на сервере — лишний риск.
 */
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { readdir,readFile } from "node:fs/promises";
import path from "node:path";
import { getFeed, rebuildFeed, startFeedSync, type FeedMatch } from "./feed.js";
import { enqueue, getJob, getStoredAnalysis, markPosted, purgeLegacyAnalyses } from "./jobs.js";
import { formatForTelegram } from "../analyze-v2.js";
import { createBot, sendMessage } from "../bot.js";
import { config } from "../config.js";
import { renderFeed, renderMatch, layout, type ApiOverview, type ApiSidePlayer } from "./render.js";
import { fetchMatchApi } from "../opendota.js";
import { getHeroNames } from "../heroes.js";
import { PLAYERS } from "../config.js";

const ANALYSIS_DIR = path.join(process.env.DATA_DIR || "data", "analysis");

async function analyzedIds(): Promise<Set<number>> {
  try {
    const files = await readdir(ANALYSIS_DIR);
    return new Set(files.filter((f) => f.endsWith(".json")).map((f) => Number(f.replace(".json", ""))));
  } catch {
    return new Set();
  }
}

const OUR_STEAM = new Set(PLAYERS.map((x) => x.steamId));

/** Составы и итоги матча из API — показываем даже когда реплея нет. */
async function matchOverview(matchId: number): Promise<ApiOverview | null> {
  try {
    const api = await fetchMatchApi(matchId);
    if (!api.players?.length) return null;
    const names = await getHeroNames(api.players.map((x) => x.hero_id));
    const toSide = (radiant: boolean): ApiSidePlayer[] =>
      api.players
        .filter((x) => x.player_slot < 128 === radiant)
        .map((x, i) => ({
          hero: names[api.players.indexOf(x)] ?? String(x.hero_id),
          name: x.personaname ?? "аноним",
          kills: x.kills,
          deaths: x.deaths,
          assists: x.assists,
          gpm: x.gold_per_min ?? 0,
          netWorth: x.net_worth ?? 0,
          damage: x.hero_damage ?? 0,
          lastHits: x.last_hits ?? 0,
          isOur: !!x.account_id && OUR_STEAM.has(x.account_id),
        }));
    return {
      radiant: toSide(true),
      dire: toSide(false),
      radiantWin: api.radiant_win,
      radiantScore: api.radiant_score,
      direScore: api.dire_score,
      replayAvailable: !!api.replay_salt && !!api.cluster,
    };
  } catch (error) {
    console.warn(`[WEB] нет данных матча ${matchId}:`, (error as Error).message);
    return null;
  }
}

function send(res: ServerResponse, status: number, body: string, type = "text/html; charset=utf-8"): void {
  void sendText(res,status,body,type).catch(()=>{if(!res.destroyed)res.destroy();});
}

function sendJson(res: ServerResponse, status: number, data: unknown): void {
  send(res, status, JSON.stringify(data), "application/json; charset=utf-8");
}

async function handle(req: IncomingMessage, res: ServerResponse): Promise<void> {
  const url = new URL(req.url || "/", `http://${req.headers.host || "localhost"}`);
  const p = url.pathname;
  const avatar=p.match(/^\/assets\/player-avatar\/(\d+)$/);
  if(avatar&&(req.method==='GET'||req.method==='HEAD')){
    const image=readPlayerAvatar(Number(avatar[1]));if(!image)return send(res,404,'Avatar unavailable','text/plain');
    const headers={'content-type':image.contentType,'cache-control':'public, max-age=300','etag':'"'+image.etag+'"','x-content-type-options':'nosniff'};
    if(req.headers['if-none-match']===headers.etag){res.writeHead(304,headers);res.end();return;}
    let bytes:Buffer;try{bytes=await readFile(image.path);}catch{return send(res,404,'Avatar unavailable','text/plain');}
    res.writeHead(200,{...headers,'content-length':bytes.length});res.end(req.method==='HEAD'?undefined:bytes);return;
  }


  if (req.method === "GET" && (p === "/players" || /^\/player\/\d+$/.test(p))) {
    const period = periodOf(url.searchParams.get("period"));
    const profiles = loadProfiles(period);
    if (p === "/players") return send(res,200,renderPlayers(profiles,period));
    const profile = profiles.find(x=>x.account===Number(p.split("/")[2]));
    if (!profile) return send(res,404,layout("Игрок не найден",'<h1>Игрок не найден</h1><a href="/players">Все игроки стака</a>'));
    const page = Number(url.searchParams.get("page")) || 1;
    const economyMatch=profile.matches.find(m=>m.id===Number(url.searchParams.get("economy")))??profile.measured[0];
    const economy=economyMatch?buildEconomy(getApmStore(),profile.account,economyMatch.id):null;
    return send(res,200,renderPlayer(profile,profiles,Number.isSafeInteger(page)?page:1,Number(url.searchParams.get("match"))||undefined,url.searchParams.get("hero")||undefined,economy,buildPlayerProgress(getApmStore(),profile)));
  }
  if (p === "/" && req.method === "GET") {
    const { matches, updatedAt } = await getFeed();
    const player = url.searchParams.get("player") || undefined;
    return send(res, 200, renderFeed(matches, updatedAt, await analyzedIds(), player,getApmStore().profileRosters(),Number(url.searchParams.get("page"))||1));
  }

  if (p === "/refresh" && req.method === "POST") {
    await rebuildFeed();
    res.writeHead(303, { location: "/" });
    res.end();
    return;
  }

  const matchPage = p.match(/^\/match\/(\d+)$/);
  if (matchPage && req.method === "GET") {
    const matchId = Number(matchPage[1]);
    const { matches } = await getFeed();
    const feedMatch: FeedMatch | undefined = matches.find((m) => m.matchId === matchId);
    const stored = await getStoredAnalysis(matchId);
    const parsed = getApmStore().replay(matchId) ?? stored?.parsed;
    return send(res, 200, renderMatch(matchId, feedMatch, stored, getJob(matchId), parsed ? null : await matchOverview(matchId), parsed,{player:url.searchParams.get("player")||undefined,official:getApmStore().matchApi(matchId),officialPlayers:getApmStore().officialPlayers(matchId),episode:url.searchParams.get("episode")||undefined}));
  }

  const analyzeApi = p.match(/^\/api\/analyze\/(\d+)$/);
  if (analyzeApi && req.method === "POST") {
    return sendJson(res, 202, enqueue(Number(analyzeApi[1])));
  }

  const jobApi = p.match(/^\/api\/job\/(\d+)$/);
  if (jobApi && req.method === "GET") {
    const job = getJob(Number(jobApi[1]));
    return sendJson(res, job ? 200 : 404, job ?? { stage: "unknown", message: "Задача не найдена" });
  }

  const postApi = p.match(/^\/api\/post\/(\d+)$/);
  if (postApi && req.method === "POST") {
    const matchId = Number(postApi[1]);
    const stored = await getStoredAnalysis(matchId);
    if (!stored) return sendJson(res, 404, { ok: false, error: "Разбор ещё не сделан" });
    if (!config.telegramChatId) return sendJson(res, 400, { ok: false, error: "TELEGRAM_CHAT_ID не задан" });
    try {
      const bot = await createBot();
      await sendMessage(bot, formatForTelegram(matchId, stored.parsed, stored.text, stored.format));
      await markPosted(matchId);
      return sendJson(res, 200, { ok: true, postedAt: Date.now() });
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      console.error(`[WEB] не удалось запостить матч ${matchId}:`, msg);
      return sendJson(res, 502, { ok: false, error: msg.slice(0, 200) });
    }
  }

  if (p === "/api/feed" && req.method === "GET") {
    return sendJson(res, 200, await getFeed());
  }

  send(res, 404, layout("Не найдено", '<h1>404</h1><p class="sub"><a href="/">К списку матчей</a></p>'));
}

export function startWebServer(port = Number(process.env.WEB_PORT) || 3000): void {
  const server = createServer((req, res) => {
    handle(req, res).catch((error) => {
      console.error("[WEB] ошибка запроса:", error);
      if (!res.headersSent) send(res, 500, layout("Ошибка", '<h1>500</h1><p class="sub">Что-то сломалось, смотри логи.</p>'));
    });
  });
  void purgeLegacyAnalyses()
    .then((removed) => {
      if (removed) console.log(`[WEB] удалено старых разборов: ${removed}`);
    })
    .catch((error) => console.error("[WEB] не удалось очистить старые разборы:", error))
    .finally(() => {
      server.listen(port, () => {
        console.log(`[WEB] витрина на http://localhost:${port}`);
        if (process.env.FEED_SYNC_DISABLED !== "1") startFeedSync();
      });
    });
}
