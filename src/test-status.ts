import assert from "node:assert/strict";
import { config, PLAYERS, type Player } from "./config.js";
import { formatStackStatus, freshLiveGames, getStackStatus } from "./status.js";
import { steam32ToSteam64, type SteamPlayer } from "./steam.js";
import { presenceText, withTimeout } from "./steam-presence.js";
import { decodePresence } from "./steam-presence-protocol.js";
import { createRequire } from "node:module";

const roster: Player[] = Array.from({ length: 6 }, (_, index) => ({ steamId: index + 1, dotaName: `Player ${index + 1}` }));
function summary(id: number, fields: Partial<SteamPlayer> = {}): SteamPlayer {
  return {
    steamid: steam32ToSteam64(id), personaname: `Player ${id}`, personastate: 1,
    profileurl: "", avatar: "", avatarmedium: "", avatarfull: "", communityvisibilitystate: 3,
    ...fields,
  };
}
const summaries = new Map([
  [1, summary(1, { gameid: "570", personaname: "<Dota & player>" })],
  [2, summary(2, { gameid: "570" })],
  [3, summary(3, { gameid: "730", gameextrainfo: "Other <game>" })],
  [4, summary(4, { personastate: 3 })],
  [5, summary(5, { personastate: 0 })],
]);
const formatted = formatStackStatus(roster, summaries, new Map([[1, { heroId: 1, level: 18, gameTime: 1842 }]]));
assert.match(formatted, /&lt;Dota &amp; player&gt;.*в матче · Anti-Mage · ур. 18 · ⏱ 30:42/);
assert.match(formatted, /Player 2.*статус матча неизвестен/);
assert.match(formatted, /Other &lt;game&gt;/);
assert.match(formatted, /Player 4.*отошёл, игра не запущена/);
assert.match(formatted, /Не в сети \/ невидимка: Player 5/);
assert.match(formatted, /Нет данных: Player 6/);
assert.match(formatStackStatus(roster, new Map()), /никто из стака не виден онлайн/);
for (const [gameTime, expected] of [[0, "0:00"], [-65, "−1:05"], [3661, "61:01"]] as const) {
  const result = formatStackStatus(roster, summaries, new Map([[1, { gameTime }]]));
  assert.ok(result.includes(`⏱ ${expected}`));
  assert.ok(!result.includes("ур."));
}
assert.match(formatStackStatus(roster, summaries, new Map(), true), /Данные матчей сейчас недоступны/);
const presence = new Map([[1, { richPresence: {}, localizedString: "Играет за Axe (ур. 12) — 20:31 <test>" }]]);
const richFormatted = formatStackStatus(roster, summaries, new Map([[1, { heroId: 1 }]]), false, presence);
assert.match(richFormatted, /Играет за Axe \(ур. 12\) — 20:31 &lt;test&gt;/);
assert.ok(!richFormatted.includes("Anti-Mage"), "direct presence takes precedence over public list");
assert.equal(presenceText({ richPresence: { status: "В главном меню" }, localizedString: null }), "В главном меню");
assert.equal(presenceText({ richPresence: { status: "#Unlocalized" }, localizedString: null }), undefined);
assert.equal(presenceText(undefined), undefined);
await assert.rejects(withTimeout(new Promise(() => {}), 5), /timeout/);
assert.equal(await withTimeout(Promise.resolve(123), 5), 123);
// Wire fixture: a field-3 KV status, which steam-user 5.3.0 previously discarded.
const schema = createRequire(import.meta.url)("steam-user/protobufs/generated/_load.js");
const wire = Buffer.from("0a1d0961000010010010011a120a067374617475731208496e2067616d6521", "hex");
const decoded = schema.CMsgClientRichPresenceInfo.toObject(schema.CMsgClientRichPresenceInfo.decode(wire), { longs: String });
const users = decodePresence(decoded);
assert.equal(Object.values(users)[0].richPresence.status, "In game!");
assert.deepEqual(Object.keys(decodePresence({ rich_presence: [{ steamid_user: "123", rich_presense: [] }] })), []);

const now = Date.now();
const fresh = { last_update_time: now / 1000, players: [{ account_id: 1 }] };
assert.deepEqual(freshLiveGames([
  fresh, { ...fresh, last_update_time: now / 1000 - 181 },
  { ...fresh, deactivate_time: 1 }, { ...fresh, last_update_time: now / 1000 + 100 },
  { players: [] }, null,
], now), [fresh]);
assert.throws(() => freshLiveGames({ error: "unavailable" }));

// Exercise actual request orchestration without contacting Steam or Telegram.
const originalFetch = globalThis.fetch;
const originalKey = config.steamApiKey;
const originalNow = Date.now;
const originalTokenFile = process.env.STEAM_REFRESH_TOKEN_FILE;
// Never use a real account during mocked API tests.
process.env.STEAM_REFRESH_TOKEN_FILE = "/nonexistent/pesiki-test-steam-token";
let testNow = now;
Date.now = () => testNow;
config.steamApiKey = "test-key";
const playerId = PLAYERS[0].steamId;
let requests = 0;
let failLive = false;
let failSteam = false;
globalThis.fetch = async (input) => {
  requests++;
  const url = new URL(String(input));
  if (url.pathname.includes("GetPlayerSummaries")) {
    if (failSteam) return new Response("failure", { status: 403 });
    return Response.json({ response: { players: [summary(playerId, { gameid: "570" })] } });
  }
  if (url.pathname === "/api/live") {
    if (failLive) return new Response("failure", { status: 503 });
    return Response.json([{
      last_update_time: testNow / 1000, server_steam_id: "90277912349586453",
      game_time: 900, players: [{ account_id: playerId, hero_id: 1 }],
    }]);
  }
  assert.ok(url.pathname.includes("GetRealtimeStats"));
  assert.equal(url.searchParams.get("server_steam_id"), "90277912349586453");
  return Response.json({ match: { game_time: 920, game_state: 5 }, teams: [
    { players: [{ accountid: playerId, heroid: 1, level: 12 }] },
  ] });
};
try {
  const results = await Promise.all([getStackStatus(), getStackStatus()]);
  assert.equal(results[0], results[1]);
  assert.match(results[0], /Anti-Mage · ур. 12 · ⏱ 15:20/);
  assert.equal(requests, 3, "concurrent commands share upstream requests");
  await getStackStatus();
  assert.equal(requests, 3, "repeated command uses short cache");
  testNow += 16_000;
  failLive = true;
  const degraded = await getStackStatus();
  assert.match(degraded, /Dota 2 запущена; статус матча неизвестен/);
  assert.match(degraded, /Данные матчей сейчас недоступны/);
  assert.ok(!degraded.includes("ур. 12"), "never reuse stale match details after failure");
  testNow += 16_000;
  failSteam = true;
  await assert.rejects(getStackStatus(), /Steam API error/);
  config.steamApiKey = "";
  assert.match(await getStackStatus(), /не настроен Steam API key/);
} finally {
  globalThis.fetch = originalFetch;
  config.steamApiKey = originalKey;
  Date.now = originalNow;
  if (originalTokenFile === undefined) delete process.env.STEAM_REFRESH_TOKEN_FILE;
  else process.env.STEAM_REFRESH_TOKEN_FILE = originalTokenFile;
}
console.log("Status tests passed");
