import { createRequire } from "node:module";
import protobuf from "protobufjs";
import type { Type } from "protobufjs";
import type SteamUser from "steam-user";
import type { RichPresence } from "./steam-presence.js";

const require = createRequire(import.meta.url);
const { Field, Type: MessageType } = protobuf;
// steam-user 5.3.0 still decodes the pre-September-2025 binary KV field.
// Valve's current schema uses repeated KV messages in field 3 (spelling intentional):
// https://github.com/SteamDatabase/Protobufs/blob/master/steam/steammessages_clientserver_2.proto
const schema = require("steam-user/protobufs/generated/_load.js") as { CMsgClientRichPresenceInfo: Type };
const info = schema.CMsgClientRichPresenceInfo;
const player = info.lookupType("RichPresence");
if (!player.fields.rich_presense) {
  info.add(new MessageType("KV").add(new Field("key", 1, "string")).add(new Field("value", 2, "string")));
  player.add(new Field("rich_presense", 3, ".CMsgClientRichPresenceInfo.KV", "repeated"));
}

interface PresenceResponse {
  rich_presence?: Array<{ steamid_user?: string; rich_presense?: Array<{ key?: string; value?: string }> }>;
}

export function decodePresence(body: PresenceResponse): Record<string, RichPresence> {
  const users: Record<string, RichPresence> = Object.create(null);
  for (const entry of body.rich_presence ?? []) {
    if (!entry.steamid_user || !entry.rich_presense?.length) continue;
    const values: Record<string, string> = Object.create(null);
    for (const pair of entry.rich_presense) {
      if (typeof pair.key === "string" && typeof pair.value === "string") values[pair.key] = pair.value;
    }
    if (Object.keys(values).length) users[String(entry.steamid_user)] = { richPresence: values, localizedString: null };
  }
  return users;
}

export function requestCurrentPresence(session: SteamUser, ids: string[]): Promise<Record<string, RichPresence>> {
  const internal = session as unknown as {
    _send(header: { msg: number; proto: { routing_appid: number } }, body: { steamid_request: string[] }, callback: (body: PresenceResponse) => void): void;
    _getRPLocalizedString(appid: number, tokens: Record<string, string>, language: string): Promise<string>;
  };
  const messages = require("steam-user/enums/EMsg.js") as { ClientRichPresenceRequest: number };
  return new Promise((resolve, reject) => {
    internal._send({ msg: messages.ClientRichPresenceRequest, proto: { routing_appid: 570 } }, { steamid_request: ids }, body => {
      let users: Record<string, RichPresence>;
      try { users = decodePresence(body); }
      catch { reject(new Error("Invalid Steam presence response")); return; }
      Promise.all(Object.values(users).map(async user => {
        try { user.localizedString = await internal._getRPLocalizedString(570, user.richPresence, "russian"); }
        catch { /* Preserve raw status if localization is unavailable. */ }
      })).then(() => resolve(users), reject);
    });
  });
}
