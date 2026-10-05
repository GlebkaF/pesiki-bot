import SteamUser from "steam-user";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { steam32ToSteam64 } from "./steam.js";
import { requestCurrentPresence } from "./steam-presence-protocol.js";

export interface RichPresence {
  richPresence: Record<string, string>;
  localizedString: string | null;
}

export async function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([promise, new Promise<never>((_, reject) => {
      timer = setTimeout(() => reject(new Error("Steam presence timeout")), ms);
    })]);
  } finally { clearTimeout(timer); }
}

let client: SteamUser | undefined;
let connecting: Promise<SteamUser> | undefined;
let retryAfter = 0;

async function connect(): Promise<SteamUser> {
  if (client?.steamID) return client;
  if (connecting) return connecting;
  if (Date.now() < retryAfter) throw new Error("Steam presence reconnect cooldown");
  connecting = (async () => {
    const token = (await readFile(resolve(process.env.STEAM_REFRESH_TOKEN_FILE || "data/steam/refresh-token"), "utf8")).trim();
    const session = new SteamUser({
      autoRelogin: false, dataDirectory: null, enablePicsCache: false,
      renewRefreshTokens: false, language: "russian", webCompatibilityMode: true,
    });
    // Do not log errors from the client: auth transport errors may contain secrets.
    session.on("error", () => { retryAfter = Date.now() + 60_000; });
    session.on("disconnected", () => {
      if (client === session) client = undefined;
    });
    client = session;
    try {
      const ready = new Promise<void>((accept, reject) => {
        session.once("loggedOn", () => accept());
        session.once("error", () => reject(new Error("Steam presence login failed")));
      });
      // Never call gamesPlayed or setPersona: this session only reads presence.
      session.logOn({ refreshToken: token, logonID: 0x50455349, machineName: "Pesiki status" });
      await withTimeout(ready, 15_000);
      console.log("[STEAM PRESENCE] Connected");
      return session;
    } catch {
      session.logOff();
      if (client === session) client = undefined;
      throw new Error("Steam presence login failed");
    }
  })();
  try { return await connecting; }
  catch {
    retryAfter = Date.now() + 60_000;
    throw new Error("Steam presence unavailable");
  } finally { connecting = undefined; }
}

export async function getSteamPresence(ids: readonly number[]): Promise<Map<number, RichPresence>> {
  if (!ids.length) return new Map();
  const session = await connect();
  const users = await withTimeout(requestCurrentPresence(session, ids.map(steam32ToSteam64)), 8_000);
  const result = new Map<number, RichPresence>();
  for (const id of ids) {
    const entry = users[steam32ToSteam64(id)];
    if (entry) result.set(id, {
      richPresence: { ...entry.richPresence }, localizedString: entry.localizedString,
    });
  }
  return result;
}

export function stopSteamPresence(): void {
  client?.logOff();
  client = undefined;
}

/** Steam localizes Dota's own display template with hero/level/time when provided. */
export function presenceText(entry: RichPresence | undefined): string | undefined {
  const text = entry?.localizedString?.trim() || entry?.richPresence.status?.trim();
  if (!text || text.startsWith("#")) return undefined;
  return text.replace(/\{([^{}]+)\}/g, "$1").replace(/[\r\n\t]+/g, " ").slice(0, 160);
}
