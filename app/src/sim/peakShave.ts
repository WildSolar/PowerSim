/**
 * Taking the top off a curve: the level above which a battery of a given power takes (or gives)
 * exactly a given amount of energy. How every battery that serves the grid is run — the
 * neighbourhood batteries (grid.ts, spotMarket.ts, the statistics' day) and grid-friendly home
 * batteries (homeBattery.ts): they store from the top of the surplus, the sunniest hours, and give
 * back into the top of the draw, the evening peak.
 */

/** The level L at which Σ min(maxPower, max(0, values[i] − L)) × hours[i] equals `energy` — what a
 * battery of `maxPower` takes from the part of `values` above L. 0 when even everything above zero
 * comes to less. Units are the caller's (W and Wh, or kW and kWh). */
export function topSliceLevel(values: ArrayLike<number>, hours: ArrayLike<number>, maxPower: number, energy: number): number {
  const above = (level: number) => {
    let sum = 0;
    for (let i = 0; i < values.length; i++) sum += Math.min(maxPower, Math.max(0, values[i] - level)) * hours[i];
    return sum;
  };
  let top = 0;
  for (let i = 0; i < values.length; i++) top = Math.max(top, values[i]);
  if (energy <= 0) return top;
  if (above(0) <= energy) return 0;
  let lo = 0;
  let hi = top;
  for (let k = 0; k < 30; k++) {
    const mid = (lo + hi) / 2;
    if (above(mid) > energy) lo = mid;
    else hi = mid;
  }
  return hi;
}

/** Batteries of `battery` (kW, kWh) through one day, empty at its start: they store from the top of
 * the surplus (where `residualW` — the draw less what is made, W, at each step — is below zero), as
 * much as they hold, and give back what comes of it (`roundTrip`) into the top of the draw that
 * follows. `hours[i]` is how long step i lasts (the time since the step before). In W at each step. */
export function batteriesThroughTheDay(residualW: number[], hours: number[], battery: { kw: number; kwh: number }, roundTrip: number): { chargeW: number[]; dischargeW: number[] } {
  const maxW = battery.kw * 1000;
  const capacityWh = battery.kwh * 1000;
  const chargeW = new Array<number>(residualW.length).fill(0);
  const dischargeW = new Array<number>(residualW.length).fill(0);
  if (maxW <= 0) return { chargeW, dischargeW };
  const chargeLevel = topSliceLevel(residualW.map((w) => -w), hours, maxW, capacityWh);
  let storedWh = 0;
  residualW.forEach((w, i) => {
    if (hours[i] <= 0) return;
    chargeW[i] = Math.min(maxW, Math.max(0, -w - chargeLevel), (capacityWh - storedWh) / hours[i]);
    storedWh += chargeW[i] * hours[i];
  });
  const first = chargeW.findIndex((w) => w > 0);
  if (first < 0) return { chargeW, dischargeW };
  const giveLevel = topSliceLevel(residualW.map((w, i) => (i > first ? w : 0)), hours, maxW, storedWh * roundTrip);
  let heldWh = 0;
  residualW.forEach((w, i) => {
    heldWh += chargeW[i] * hours[i];
    if (i <= first || hours[i] <= 0) return;
    dischargeW[i] = Math.min(maxW, Math.max(0, w - giveLevel), (heldWh * roundTrip) / hours[i]);
    heldWh -= (dischargeW[i] * hours[i]) / roundTrip;
  });
  return { chargeW, dischargeW };
}
