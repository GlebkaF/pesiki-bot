/** Проверяет структурные инварианты сохранённых MatchFactPacket без LLM. */
import { readdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

const DIRS = (process.env.FACT_AUDIT_DIRS || "data/classifier-eval/deep,data/classifier-holdout/deep,data/classifier-stack-smoke/deep")
  .split(",")
  .map((item) => item.trim())
  .filter(Boolean);
const OUTPUT = process.env.FACT_AUDIT_OUTPUT || "data/fact-audit.json";

interface FactPacket {
  version: number;
  match: {
    id: number;
    durationMin: number;
    result: "win" | "loss";
    shape: "big-comeback" | "comeback" | "throw" | "stomp" | "stomped" | "win" | "loss";
    storySignals: string[];
  };
  economy: {
    at10?: { minute: number; advantage: number };
    at20?: { minute: number; advantage: number };
    worst?: { minute: number; advantage: number };
    best?: { minute: number; advantage: number };
    final?: { minute: number; advantage: number };
    leadChanges: number;
  };
  keyMoments: Array<{
    startMinute: number;
    endMinute: number;
    ourDeaths: number;
    enemyDeaths: number;
    nearbyMinuteDelta?: number | null;
    goldSwing?: number;
  }>;
  ourPlayers: Array<{
    name: string;
    role?: string;
    csAt10?: number;
    kda: string;
    deathsAt: number[];
    deathTimelineReliable: boolean;
    unusualRole: boolean;
    profileNotes: string[];
  }>;
  history: {
    available?: boolean;
    previousStackMatches: Array<{
      scope?: "solo" | "partial" | "stack";
      players?: string[];
      startGapMin: number | null;
      queueGapMin: number | null;
    }>;
  };
}

interface Finding {
  severity: "error" | "warning";
  matchId: number;
  code: string;
  detail: string;
}

function expectedShape(packet: FactPacket): FactPacket["match"]["shape"] | undefined {
  const { worst, best, final } = packet.economy;
  if (!worst || !best || !final) return undefined;
  const won = packet.match.result === "win";
  if (won && worst.advantage <= -12_000 && final.advantage > 0) return "big-comeback";
  if (won && worst.advantage <= -5_000 && final.advantage > 0) return "comeback";
  if (!won && best.advantage >= 12_000 && final.advantage < 0) return "throw";
  if (won && packet.match.durationMin <= 30 && worst.advantage >= -3_000 && best.advantage >= 15_000) return "stomp";
  if (
    !won && best.advantage <= 3_000 && worst.advantage <= -15_000 &&
    (packet.match.durationMin <= 30 || (packet.economy.at20?.advantage ?? 0) <= -10_000)
  ) return "stomped";
  return won ? "win" : "loss";
}

function findings(packet: FactPacket): Finding[] {
  const out: Finding[] = [];
  const add = (severity: Finding["severity"], code: string, detail: string) =>
    out.push({ severity, matchId: packet.match.id, code, detail });
  const winShapes = new Set(["big-comeback", "comeback", "stomp", "win"]);
  if (winShapes.has(packet.match.shape) !== (packet.match.result === "win")) {
    add("error", "shape_result_mismatch", `${packet.match.result} + ${packet.match.shape}`);
  }
  const expected = expectedShape(packet);
  if (expected && expected !== packet.match.shape) {
    add("error", "shape_threshold_mismatch", `ожидался ${expected}, записан ${packet.match.shape}`);
  }
  if (packet.economy.final && Math.abs(packet.economy.final.minute - packet.match.durationMin) > 0.02) {
    add("error", "final_time_mismatch", `${packet.economy.final.minute} != ${packet.match.durationMin}`);
  }
  if (packet.economy.worst && packet.economy.best && packet.economy.worst.advantage > packet.economy.best.advantage) {
    add("error", "economy_extrema_reversed", `${packet.economy.worst.advantage} > ${packet.economy.best.advantage}`);
  }
  if (packet.economy.at10 && packet.economy.at10.minute !== 10) add("error", "at10_wrong_minute", String(packet.economy.at10.minute));
  if (packet.economy.at20 && packet.economy.at20.minute !== 20) add("error", "at20_wrong_minute", String(packet.economy.at20.minute));

  const signals = new Set(packet.match.storySignals);
  if (signals.has("deep_comeback") !== (packet.match.shape === "big-comeback")) {
    add("error", "deep_comeback_signal", `shape=${packet.match.shape}, signal=${signals.has("deep_comeback")}`);
  }
  if (signals.has("double_reversal") && (packet.match.shape !== "big-comeback" || packet.economy.leadChanges < 2)) {
    add("error", "double_reversal_signal", `shape=${packet.match.shape}, changes=${packet.economy.leadChanges}`);
  }
  if (signals.has("short_lopsided_win") && (packet.match.result !== "win" || packet.match.durationMin >= 22)) {
    add("error", "short_win_signal", `${packet.match.result}, ${packet.match.durationMin}`);
  }
  if (signals.has("short_lopsided_loss") && (packet.match.result !== "loss" || packet.match.durationMin > 20.5)) {
    add("error", "short_loss_signal", `${packet.match.result}, ${packet.match.durationMin}`);
  }

  for (let index = 0; index < packet.keyMoments.length; index++) {
    const moment = packet.keyMoments[index];
    if (moment.startMinute > moment.endMinute) add("error", "fight_time_reversed", `${moment.startMinute} > ${moment.endMinute}`);
    if (moment.ourDeaths + moment.enemyDeaths < 3) add("error", "small_key_moment", `${moment.ourDeaths}+${moment.enemyDeaths}`);
    if (packet.version >= 6 && (moment.goldSwing !== undefined || moment.nearbyMinuteDelta === undefined)) {
      add("error", "ambiguous_fight_economy", `moment ${index}`);
    }
    if (index && packet.keyMoments[index - 1].startMinute > moment.startMinute) add("error", "fights_unsorted", String(index));
  }

  for (const player of packet.ourPlayers) {
    const deaths = Number(player.kda.split("/")[1]);
    if (player.deathTimelineReliable && player.deathsAt.length !== deaths) {
      add("error", "reliable_death_count", `${player.name}: ${player.deathsAt.length} != ${deaths}`);
    }
    if (!player.deathTimelineReliable && player.deathsAt.length) {
      add("error", "unreliable_deaths_exposed", `${player.name}: ${player.deathsAt.length}`);
    }
    if (player.unusualRole && !player.profileNotes.length) {
      add("warning", "unusual_role_without_profile", player.name);
    }
    if (player.name === "Marinad" && player.role === "core" && (player.csAt10 ?? 0) < 15) {
      add("error", "weak_core_evidence", `${player.name}: ${player.csAt10} cs`);
    }
    if (player.role === "support" && (player.csAt10 ?? 0) >= 25) {
      add("error", "high_cs_support", `${player.name}: ${player.csAt10} cs`);
    }
  }
  if (packet.version >= 6 && packet.history.available === undefined) {
    add("error", "history_availability_missing", "v6 packet");
  }
  for (const previous of packet.history.previousStackMatches) {
    if (previous.startGapMin !== null && previous.startGapMin < 0) add("error", "negative_start_gap", String(previous.startGapMin));
    if (previous.queueGapMin !== null && previous.queueGapMin < 0) add("error", "negative_queue_gap", String(previous.queueGapMin));
    if (
      previous.startGapMin !== null && previous.queueGapMin !== null &&
      previous.queueGapMin > previous.startGapMin
    ) add("error", "queue_gap_exceeds_start_gap", `${previous.queueGapMin} > ${previous.startGapMin}`);
    const shared = previous.players?.length ?? 0;
    const expectedScope = shared >= 3 ? "stack" : shared === 2 ? "partial" : "solo";
    if (previous.scope !== expectedScope) add("error", "history_scope_mismatch", `${previous.scope} != ${expectedScope}`);
    if (packet.ourPlayers.length >= 3 && shared < 3) {
      add("error", "stack_history_thin_overlap", `${shared}/${packet.ourPlayers.length}`);
    }
    if (packet.history.available && (previous.startGapMin === null || previous.queueGapMin === null)) {
      add("error", "history_gap_missing", "history available but gap is null");
    }
  }
  if (packet.version < 7) add("warning", "old_packet_version", `v${packet.version}`);
  return out;
}

async function main(): Promise<void> {
  const packets: FactPacket[] = [];
  for (const dir of DIRS) {
    let files: string[] = [];
    try {
      files = await readdir(dir);
    } catch {
      continue;
    }
    for (const file of files.filter((name) => name.endsWith(".facts.json"))) {
      packets.push(JSON.parse(await readFile(path.join(dir, file), "utf8")) as FactPacket);
    }
  }
  const issues = packets.flatMap(findings);
  const errors = issues.filter((issue) => issue.severity === "error");
  const warnings = issues.filter((issue) => issue.severity === "warning");
  await writeFile(OUTPUT, JSON.stringify({
    generatedAt: new Date().toISOString(),
    packets: packets.length,
    versions: Object.fromEntries([...new Set(packets.map((packet) => packet.version))].sort().map((version) => [version, packets.filter((packet) => packet.version === version).length])),
    errors,
    warnings,
  }, null, 2));
  console.log(`Fact audit: ${packets.length} packets, ${errors.length} errors, ${warnings.length} warnings`);
  if (errors.length) process.exitCode = 1;
}

main();
