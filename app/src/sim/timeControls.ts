import { approval } from "./approval";
import { simClock } from "./engine";

// simTime advances every animation frame regardless of multiplier (see engine.ts) —
// there's no fixed-size "tick" whose cost scales with speed, so these top out where
// they do only because nobody had asked to go faster yet, not because of a cost model.
export const PAUSE_SPEED = 0;
// Glyphs with the text variation selector (U+FE0E), so they take the button's colour rather than
// rendering as coloured emoji tiles.
export const RUNNING_SPEEDS: { label: string; name: string; hint: string; value: number }[] = [
  { label: "\u25B6\uFE0E", name: "Slow", hint: "a minute a second", value: 60 },
  { label: "\u25B6\uFE0E\u25B6\uFE0E", name: "Medium", hint: "an hour a second", value: 3600 },
  { label: "\u25B6\uFE0E\u25B6\uFE0E\u25B6\uFE0E", name: "Fast", hint: "a day a second", value: 86400 },
];
export const PAUSE_LABEL = "\u23F8\uFE0E";

export const DEFAULT_RUNNING_SPEED = 3600;

// The speed to resume at after a pause, whether the pause came from the button, the
// spacebar, or the year-end watcher. Tracked here rather than read back from the
// clock because the clock itself only knows "0".
let lastRunningSpeed = DEFAULT_RUNNING_SPEED;

export function setSpeed(value: number): void {
  if (approval.getGameOver()) return;
  if (value !== PAUSE_SPEED) lastRunningSpeed = value;
  simClock.setSpeed(value);
}

export function togglePause(): void {
  if (approval.getGameOver()) return;
  if (simClock.getSpeed() === PAUSE_SPEED) {
    simClock.setSpeed(lastRunningSpeed);
  } else {
    lastRunningSpeed = simClock.getSpeed();
    simClock.setSpeed(PAUSE_SPEED);
  }
}

/** Steps to the next running speed, wrapping from the fastest back to the slowest. While
 * paused this resumes at the speed after the one that was running before the pause. */
export function cycleSpeed(): void {
  if (approval.getGameOver()) return;
  const current = simClock.getSpeed() === PAUSE_SPEED ? lastRunningSpeed : simClock.getSpeed();
  const index = RUNNING_SPEEDS.findIndex((s) => s.value === current);
  setSpeed(RUNNING_SPEEDS[(index + 1) % RUNNING_SPEEDS.length].value);
}
