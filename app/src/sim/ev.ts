/**
 * EV charging session physics — the daily plug-in/responsive-charging model,
 * kept independent of *who* owns an EV (that's now mobility.ts's job, via the
 * mode/vehicle-type renewal chains) so this stays a pure function of an
 * opaque `sessionKey` identifying whichever car is charging. A dwelling can
 * hold up to two independent mobility slots (see mobility.ts), so the key is
 * generally `${ewid}:${slotIndex}` rather than just the dwelling's own id —
 * two cars in the same dwelling must draw independent sessions, not the same
 * one twice.
 *
 * The daily charging session (plug-in time, energy needed, and — for a
 * responsive household — when within the window to actually charge) is
 * redrawn each day, mirroring how devices.ts's lighting resamples per
 * time-bucket: nothing is "remembered" between evaluations, a session is
 * just recomputed from (seed, day).
 *
 * Responsiveness is a flat 30% of EV owners for now — a placeholder for what
 * the design calls for eventually (owning a "smart charger" device that
 * itself spreads through stock-renewal/adoption dynamics, itself
 * subsidy-able). That system doesn't exist yet, so this is a simple stand-in
 * that still demonstrates the real mechanic: a responsive household reacts
 * to the tariff, a naive one just plugs in and charges.
 */

import { hashSeed, mulberry32 } from "./rng";
import type { Tariff } from "./tariff";

const DAY_MS = 24 * 60 * 60_000;
export const CHARGING_POWER_KW = 7.4; // typical home wallbox
export const RESPONSIVE_FRACTION = 0.3;

export function isResponsive(egid: string, sessionKey: string): boolean {
  return mulberry32(hashSeed(egid, sessionKey, "ev-responsive"))() < RESPONSIVE_FRACTION;
}

export interface EvSession {
  startMs: number;
  endMs: number;
}

/** The charging session for a given calendar day (dayIndex = floor(simTimeMs / dayMs)),
 * exported for inspection UI that wants to show "tonight's session" rather than just
 * an instantaneous on/off reading. */
export function evDailySession(egid: string, sessionKey: string, dayIndex: number, responsive: boolean, tariff: Tariff): EvSession {
  const rng = mulberry32(hashSeed(egid, sessionKey, "ev-session", String(dayIndex)));
  const plugInHour = 18.5 + (rng() - 0.5) * 3; // arrive home ~17:00-20:00
  const deadlineHour = 7 + (rng() - 0.5) * 1; // need to leave ~06:30-07:30 next morning
  const energyNeededKWh = 6 + rng() * 10; // a day's driving, roughly
  const durationMs = (energyNeededKWh / CHARGING_POWER_KW) * 3_600_000;

  const dayStartMs = dayIndex * DAY_MS;
  const plugInMs = dayStartMs + plugInHour * 3_600_000;
  const deadlineMs = dayStartMs + DAY_MS + deadlineHour * 3_600_000;

  // Only worth shifting if off-peak is actually cheaper — a household isn't
  // "responsive" in the abstract, it responds to the real price signal. If the
  // player sets off-peak >= peak, there's nothing to gain by waiting.
  const offPeakIsCheaper = tariff.offPeakPriceRpKWh < tariff.peakPriceRpKWh;
  if (!responsive || !offPeakIsCheaper) {
    return { startMs: plugInMs, endMs: plugInMs + durationMs };
  }

  // Responsive: charge starting at the later of "plugged in" and "off-peak begins",
  // but no later than needed to still finish by the deadline — the cheapest
  // contiguous window a flat two-rate tariff can offer.
  const offPeakStartMs = dayStartMs + tariff.offPeakStartHour * 3_600_000;
  const latestStart = Math.max(plugInMs, deadlineMs - durationMs);
  const startMs = Math.min(Math.max(plugInMs, offPeakStartMs), latestStart);
  return { startMs, endMs: startMs + durationMs };
}

/** Zero unless `simTimeMs` falls inside that car's session for today or
 * yesterday evening (a session can run past midnight, so a query time can
 * belong to either day's session — check both rather than assuming). */
export function evChargingPowerW(egid: string, sessionKey: string, simTimeMs: number, tariff: Tariff): number {
  const responsive = isResponsive(egid, sessionKey);
  const dayIndex = Math.floor(simTimeMs / DAY_MS);
  for (const d of [dayIndex - 1, dayIndex]) {
    const session = evDailySession(egid, sessionKey, d, responsive, tariff);
    if (simTimeMs >= session.startMs && simTimeMs < session.endMs) {
      return CHARGING_POWER_KW * 1000;
    }
  }
  return 0;
}
