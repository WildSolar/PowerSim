/**
 * Anchors simulated time (which SimClock counts up from 0) to a real calendar date,
 * so seasonal effects (weather, and later heat pump load / PV generation) have an
 * actual month to key off rather than an arbitrary "Day N". The game starts "today"
 * — Day 1 00:00 is today's UTC midnight — matching the design decision that the
 * world begins from a real present-day snapshot. Everything here uses UTC
 * uniformly (not the player's local timezone) purely to keep the math simple and
 * deterministic; the game's calendar doesn't need to match the player's wall clock.
 */

const DAY_MS = 24 * 60 * 60_000;

export const EPOCH_MS = Math.floor(Date.now() / DAY_MS) * DAY_MS;

export function toDateMs(simTimeMs: number): number {
  return EPOCH_MS + simTimeMs;
}

const MONTH_NAMES = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

export function formatDate(simTimeMs: number): string {
  const d = new Date(toDateMs(simTimeMs));
  return `${d.getUTCDate()} ${MONTH_NAMES[d.getUTCMonth()]} ${d.getUTCFullYear()}`;
}

export function formatTime(simTimeMs: number): string {
  const d = new Date(toDateMs(simTimeMs));
  return `${String(d.getUTCHours()).padStart(2, "0")}:${String(d.getUTCMinutes()).padStart(2, "0")}`;
}
