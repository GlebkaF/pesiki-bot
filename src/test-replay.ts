import assert from "node:assert/strict";
import { replayUnavailableError } from "./replay.js";

const now = 2_000_000_000;
assert.match(replayUnavailableError(1, now - 60, false, now).message, /ещё не появился.*2–3 минуты/u);
assert.match(replayUnavailableError(2, now - 60, true, now).message, /CDN Valve.*1–2 минуты/u);
assert.match(replayUnavailableError(3, now - 2 * 24 * 60 * 60, false, now).message, /могла удалить/u);
assert.doesNotMatch(replayUnavailableError(4, undefined, false, now).message, /уже удалила/u);
console.log("✓ replay availability messages");
