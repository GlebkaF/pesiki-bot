import { PLAYER_IDS } from "./config.js";
import { getSteamPresence, stopSteamPresence } from "./steam-presence.js";

try {
  const entries = await getSteamPresence(PLAYER_IDS);
  for (const [id, entry] of entries) {
    // Only expose game status, never connection strings or party join tokens.
    console.log(JSON.stringify({ id, keys: Object.keys(entry.richPresence), text: entry.localizedString,
      fields: Object.fromEntries(Object.entries(entry.richPresence).filter(([key]) =>
        /^(status|steam_display|hero|hero_id|hero_level|level|game_time|time|param\d+)$/i.test(key))),
    }));
  }
  console.log(`Presence entries: ${entries.size}`);
} catch {
  console.error("Steam presence check failed; authenticate with node tools/steam-login.mjs first.");
  process.exitCode = 1;
} finally {
  stopSteamPresence();
  setTimeout(() => process.exit(process.exitCode || 0), 1000);
}
