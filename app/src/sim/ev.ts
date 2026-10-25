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

import { CONTROLLED_EARLIEST_HOUR } from "../config/chargingTariff";
import { ANNUAL_CAR_KM, EV_CAR_KWH_PER_100KM } from "../config/mobility";
import type { ChargingMeter } from "./chargingTariff";
import { HOME_WEEKDAY_SHARE } from "../config/townSurplus";
import { dayOfWeek, toDateMs } from "./calendar";
import { townSurplus } from "./townSurplus";
import { hashSeed, hashSeedFrom, mulberry32 } from "./rng";
import type { Tariff } from "./tariff";
import { smartChargeStartMs } from "./dynamicTariff";
import { policyStore } from "./policy";

const DAY_MS = 24 * 60 * 60_000;
export const CHARGING_POWER_KW = 7.4; // typical home wallbox
export const RESPONSIVE_FRACTION = 0.3;
// Nobody plugs in every night: about three nights a week, each time putting back the days since.
export const PLUG_IN_NIGHT_SHARE = 0.45;
// A day's driving, on average (kWh): what the car's year at the usual mileage takes.
const DAILY_KWH = ((ANNUAL_CAR_KM / 100) * EV_CAR_KWH_PER_100KM) / 365;

/** A car's fixed draw against the share of households who charge off-peak. */
export function responsiveDraw(egid: string, sessionKey: string): number {
  return mulberry32(hashSeed(egid, sessionKey, "ev-responsive"))();
}

/** The share of households who charge off-peak: some always do, and a smart charging programme
 * signs up a share of the rest. */
export function responsiveShare(): number {
  return RESPONSIVE_FRACTION + policyStore.get().smartChargingShare * (1 - RESPONSIVE_FRACTION);
}

export function isResponsive(egid: string, sessionKey: string): boolean {
  return responsiveDraw(egid, sessionKey) < responsiveShare();
}

export interface EvSession {
  /** Whether the car is plugged in that night at all (on other nights the session is empty). */
  plugsIn: boolean;
  startMs: number;
  endMs: number;
}

/** The charging session for a given calendar day (dayIndex = floor(simTimeMs / dayMs)),
 * exported for inspection UI that wants to show "tonight's session" rather than just
 * an instantaneous on/off reading. */
export function evDailySession(egid: string, sessionKey: string, dayIndex: number, responsive: boolean, tariff: Tariff, smart = false, meter: ChargingMeter | null = null): EvSession {
  return evDailySessionFrom(evSessionSeed(egid, sessionKey), dayIndex, responsive, tariff, smart, meter);
}

/** A car's session seed, for the *From variants — hashed once per car rather than per call. */
export function evSessionSeed(egid: string, sessionKey: string): number {
  return hashSeed(egid, sessionKey, "ev-session");
}

/** `smart`: the household is on the dynamic tariff, and the car charges in the night's cheapest hours.
 * `meter`: the car is on the charging tariff's own meter (chargingTariff.ts), which decides instead. */
function evDailySessionFrom(seed: number, dayIndex: number, responsive: boolean, tariff: Tariff, smart: boolean, meter: ChargingMeter | null = null): EvSession {
  const rng = mulberry32(hashSeedFrom(seed, String(dayIndex)));
  const plugInHour = 18.5 + (rng() - 0.5) * 3; // arrive home ~17:00-20:00
  const deadlineHour = 7 + (rng() - 0.5) * 1; // need to leave ~06:30-07:30 next morning
  const plugsIn = rng() < PLUG_IN_NIGHT_SHARE;
  // The days' driving since it last charged: on average a day's over the share of nights it plugs in.
  const energyNeededKWh = (DAILY_KWH / PLUG_IN_NIGHT_SHARE) * (0.6 + 0.8 * rng());
  const durationMs = plugsIn ? (energyNeededKWh / CHARGING_POWER_KW) * 3_600_000 : 0;

  const dayStartMs = dayIndex * DAY_MS;
  const plugInMs = dayStartMs + plugInHour * 3_600_000;
  const deadlineMs = dayStartMs + DAY_MS + deadlineHour * 3_600_000;
  if (!plugsIn) return { plugsIn, startMs: plugInMs, endMs: plugInMs };

  if (meter === "controlled") {
    // Under the utility's control, a car that is at home in the day's solar hours — at weekends, and
    // on weekdays for some (home office, part-time, retired) — charges in them, while the town's own
    // solar and wind have power to spare.
    const weekend = [0, 6].includes(dayOfWeek(toDateMs(dayStartMs)));
    const atHome = rng() < (weekend ? 1 : HOME_WEEKDAY_SHARE);
    const sun = atHome ? townSurplus.windowOf(dayIndex) : null;
    if (sun) {
      const startMs = sun.startMs + rng() * Math.max(0, sun.endMs - sun.startMs - durationMs);
      return { plugsIn, startMs, endMs: startMs + durationMs };
    }
  }
  if (meter) {
    // On the charging meter: power only in the night rate, the charge starting some time in it that
    // still has the car full when it ends — or, under the utility's control, in the night's quietest
    // hours, most of the cars around the middle of the night.
    const nightStartMs = dayStartMs + tariff.offPeakStartHour * 3_600_000;
    const nightEndMs = dayStartMs + DAY_MS + tariff.offPeakEndHour * 3_600_000;
    const earliestStart = Math.max(plugInMs, meter === "controlled" ? dayStartMs + CONTROLLED_EARLIEST_HOUR * 3_600_000 : nightStartMs);
    const latestStart = Math.max(earliestStart, (meter === "night" ? Math.min(deadlineMs, nightEndMs) : deadlineMs) - durationMs);
    const draw = meter === "controlled" ? (rng() + rng()) / 2 : rng();
    const startMs = earliestStart + draw * (latestStart - earliestStart);
    return { plugsIn, startMs, endMs: startMs + durationMs };
  }

  if (smart) {
    const startMs = smartChargeStartMs(dayIndex, plugInMs, Math.max(plugInMs, deadlineMs - durationMs), durationMs, rng());
    return { plugsIn, startMs, endMs: startMs + durationMs };
  }

  // Only worth shifting if off-peak is actually cheaper — a household isn't
  // "responsive" in the abstract, it responds to the real price signal. If the
  // player sets off-peak >= peak, there's nothing to gain by waiting.
  const offPeakIsCheaper = tariff.offPeakPriceRpKWh < tariff.peakPriceRpKWh;
  if (!responsive || !offPeakIsCheaper) {
    return { plugsIn, startMs: plugInMs, endMs: plugInMs + durationMs };
  }

  // Responsive: a timer starts the charge some time in the off-peak hours — from when they begin
  // (or the car is plugged in) until the latest start that still finishes by the morning — so the
  // town's off-peak charging spreads over the night rather than all starting at once.
  const offPeakStartMs = dayStartMs + tariff.offPeakStartHour * 3_600_000;
  const earliestStart = Math.max(plugInMs, offPeakStartMs);
  const latestStart = Math.max(plugInMs, deadlineMs - durationMs);
  const startMs = earliestStart >= latestStart ? latestStart : earliestStart + rng() * (latestStart - earliestStart);
  return { plugsIn, startMs, endMs: startMs + durationMs };
}

/** Zero unless `simTimeMs` falls inside that car's session for today or
 * yesterday evening (a session can run past midnight, so a query time can
 * belong to either day's session — check both rather than assuming). */
export function evChargingPowerW(egid: string, sessionKey: string, simTimeMs: number, tariff: Tariff, smart = false, meter: ChargingMeter | null = null): number {
  return evChargingPowerWFrom(evSessionSeed(egid, sessionKey), isResponsive(egid, sessionKey), simTimeMs, tariff, smart, meter);
}

/** A car's sessions of the last few days asked for, under the conditions they were drawn under
 * (mobility.ts keeps one per car): a pass over the town asks about every car at instant after
 * instant of the same day, and the day's session is the same draw each time. */
export interface EvSessionMemo {
  tariff: Tariff | null;
  responsive: boolean;
  smart: boolean;
  meter: ChargingMeter | null;
  days: { day: number; session: EvSession }[];
}

export function newEvSessionMemo(): EvSessionMemo {
  return { tariff: null, responsive: false, smart: false, meter: null, days: [] };
}

function rememberedSession(memo: EvSessionMemo, seed: number, day: number, responsive: boolean, tariff: Tariff, smart: boolean, meter: ChargingMeter | null): EvSession {
  // Under the utility's control the session follows the town's solar surplus of the day: drawn fresh.
  if (meter === "controlled") return evDailySessionFrom(seed, day, responsive, tariff, smart, meter);
  if (memo.tariff !== tariff || memo.responsive !== responsive || memo.smart !== smart || memo.meter !== meter) {
    memo.tariff = tariff;
    memo.responsive = responsive;
    memo.smart = smart;
    memo.meter = meter;
    memo.days = [];
  }
  for (const d of memo.days) if (d.day === day) return d.session;
  const session = evDailySessionFrom(seed, day, responsive, tariff, smart, meter);
  memo.days.push({ day, session });
  if (memo.days.length > 3) memo.days.shift();
  return session;
}

/** evChargingPowerWFrom with the car's sessions remembered in `memo` — the same result. */
export function evChargingPowerWMemo(memo: EvSessionMemo, sessionSeed: number, responsive: boolean, simTimeMs: number, tariff: Tariff, smart = false, meter: ChargingMeter | null = null): number {
  const dayIndex = Math.floor(simTimeMs / DAY_MS);
  for (let d = dayIndex - 1; d <= dayIndex; d++) {
    const session = rememberedSession(memo, sessionSeed, d, responsive, tariff, smart, meter);
    if (simTimeMs >= session.startMs && simTimeMs < session.endMs) return CHARGING_POWER_KW * 1000;
  }
  return 0;
}

/** The same, for a caller that keeps the car's session seed and (seeded, fixed) responsiveness. */
export function evChargingPowerWFrom(sessionSeed: number, responsive: boolean, simTimeMs: number, tariff: Tariff, smart = false, meter: ChargingMeter | null = null): number {
  const dayIndex = Math.floor(simTimeMs / DAY_MS);
  for (let d = dayIndex - 1; d <= dayIndex; d++) {
    const session = evDailySessionFrom(sessionSeed, d, responsive, tariff, smart, meter);
    if (simTimeMs >= session.startMs && simTimeMs < session.endMs) {
      return CHARGING_POWER_KW * 1000;
    }
  }
  return 0;
}
