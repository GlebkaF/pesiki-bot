/**
 * Сверяет ники из config.ts с текущими в Dota. Люди их меняют, а расхождение
 * приводит к тому, что один и тот же человек появляется в разборе под двумя именами.
 * Запуск: npx tsx tools/check-nicks.ts
 */
import { PLAYERS } from "../src/config.js";
import { fetchPlayerProfile } from "../src/opendota.js";

async function main() {
  const stale: { steamId: number; config: string; actual: string }[] = [];

  for (const player of PLAYERS) {
    let actual = "";
    try {
      const data = await fetchPlayerProfile(player.steamId);
      actual = data.profile?.personaname ?? "";
    } catch (error) {
      console.log(`  ${player.dotaName}: не удалось проверить (${(error as Error).message})`);
      continue;
    }
    if (!actual) continue;

    const same = actual === player.dotaName;
    console.log(`  ${same ? "ок      " : "изменён "} ${player.dotaName} ${same ? "" : `-> ${actual}`}`);
    if (!same) stale.push({ steamId: player.steamId, config: player.dotaName, actual });
  }

  if (!stale.length) {
    console.log("\nВсе ники актуальны.");
    return;
  }
  console.log(`\nУстарело ников: ${stale.length}. Поправь в src/config.ts:`);
  for (const s of stale) {
    console.log(`  steamId ${s.steamId}: "${s.config}" -> "${s.actual}"`);
  }
  process.exitCode = 1;
}

main();
