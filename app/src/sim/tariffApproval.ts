/**
 * How people take the utility's prices (approval.ts). They judge the typical household's bill against
 * what households pay elsewhere in Switzerland (config/tariff.ts's benchmark, which moves with the
 * wholesale price): a dear tariff weighs on approval for as long as it lasts, a cheap one helps a
 * little — people resent price rises more than they reward cuts. The day a new tariff is published,
 * the change itself lands as a jolt, like a decision. Homeowners also care what their panels earn,
 * and district heating customers what their heat costs.
 */

import {
  BENCHMARK_DISTRICT_HEAT_RP_KWH,
  BENCHMARK_FEED_IN_RP_KWH,
  BENCHMARK_HOUSEHOLD_RP_KWH,
  BENCHMARK_WHOLESALE_RP_KWH,
  HOUSEHOLD_OFF_PEAK_SHARE,
  REFERENCE_HOUSEHOLD_KWH,
} from "../config/tariff";
import { approval, setPriceStances, type Stances } from "./approval";
import { toDateMs } from "./calendar";
import { market } from "./market";
import type { TariffSheet } from "./tariff";
import { tariffStore, type TariffPublication } from "./tariffStore";

// A tariff 10% dearer than elsewhere is a stance of -0.25 among households; the most a cheap
// tariff can win is a stance of +0.25 (loss aversion).
const STANCE_PER_SHARE = 2.5;
const MAX_GOODWILL = 0.25;
// How much each group weighs the electricity bill.
const BILL_WEIGHT = { tenants: 0.8, homeowners: 0.8, business: 0.6, drivers: 0.2 } as const;
// District heat matters to the few on it; feed-in to homeowners with panels.
const DISTRICT_HEAT_WEIGHT = 0.15;
const FEED_IN_WEIGHT = 0.3;

/** What the typical household pays per kWh on a sheet: its time-of-use rates, weighted by when it uses power. */
export function householdRpKWh(sheet: TariffSheet): number {
  return HOUSEHOLD_OFF_PEAK_SHARE * sheet.offPeakPriceRpKWh + (1 - HOUSEHOLD_OFF_PEAK_SHARE) * sheet.peakPriceRpKWh;
}

/** The typical household's yearly electricity bill (CHF). */
export function householdBillChf(sheet: TariffSheet): number {
  return (householdRpKWh(sheet) * REFERENCE_HOUSEHOLD_KWH) / 100;
}

/** What households pay elsewhere in Switzerland in a year (Rp/kWh). */
export function benchmarkRpKWh(year: number): number {
  return BENCHMARK_HOUSEHOLD_RP_KWH + (market.yearAverage("wholesale", year) - BENCHMARK_WHOLESALE_RP_KWH);
}

/** What the typical household pays elsewhere in Switzerland in a year (CHF). */
export function benchmarkBillChf(year: number): number {
  return (benchmarkRpKWh(year) * REFERENCE_HOUSEHOLD_KWH) / 100;
}

function feeling(ratio: number): number {
  return ratio > 1 ? -Math.min(1, (ratio - 1) * STANCE_PER_SHARE) : Math.min(MAX_GOODWILL, (1 - ratio) * STANCE_PER_SHARE);
}

/** How each group feels about a sheet in a year. */
export function stancesFor(sheet: TariffSheet, year: number): Stances {
  const bill = feeling(householdRpKWh(sheet) / benchmarkRpKWh(year));
  const heat = feeling(sheet.districtHeatingPriceRpKWh / BENCHMARK_DISTRICT_HEAT_RP_KWH) * DISTRICT_HEAT_WEIGHT;
  const feedIn = Math.max(-FEED_IN_WEIGHT, Math.min(FEED_IN_WEIGHT, (sheet.feedInPriceRpKWh / BENCHMARK_FEED_IN_RP_KWH - 1) * FEED_IN_WEIGHT));
  return {
    tenants: bill * BILL_WEIGHT.tenants + heat,
    homeowners: bill * BILL_WEIGHT.homeowners + heat + feedIn,
    business: bill * BILL_WEIGHT.business,
    drivers: bill * BILL_WEIGHT.drivers,
  };
}

/** The change from one sheet to another, as people feel it (for the jolt at publication). */
function changeStances(previous: TariffSheet, next: TariffSheet, year: number): Stances {
  const before = stancesFor(previous, year);
  const after = stancesFor(next, year);
  const out: Stances = {};
  for (const bloc of Object.keys(after) as (keyof Stances)[]) out[bloc] = (after[bloc] ?? 0) - (before[bloc] ?? 0);
  return out;
}

function yearOf(atMs: number): number {
  return new Date(toDateMs(atMs)).getUTCFullYear();
}

function onPublish(p: TariffPublication): void {
  const change = changeStances(p.previous, p.sheet, p.year);
  approval.decide({ key: `tariff:${p.year}:${Math.round(p.atMs)}`, title: `The ${p.year} tariff`, stances: change, leadTimeMonths: 4, atMs: p.atMs });
  const before = householdBillChf(p.previous);
  const after = householdBillChf(p.sheet);
  const pct = before > 0 ? Math.round((after / before - 1) * 100) : 0;
  approval.note(
    p.atMs,
    `Tariff for ${p.year} published: a typical household pays CHF ${Math.round(after).toLocaleString("en-GB")} a year${pct === 0 ? ", the same as before" : `, ${Math.abs(pct)}% ${pct > 0 ? "more" : "less"}`}.`,
  );
}

let unsubscribe: (() => void) | null = null;

/** Wires prices into approval for a new game (after approval.init). */
export function initTariffApproval(): void {
  setPriceStances((atMs) => stancesFor(tariffStore.sheetFor(yearOf(atMs)), yearOf(atMs)));
  unsubscribe?.();
  unsubscribe = tariffStore.onPublish(onPublish);
}

/** For the price page: how a sheet published now for `year` would land — the bill against the one
 * it replaces and against the Swiss average, and the reaction to the change. */
export function previewReaction(sheet: TariffSheet, year: number): { billChf: number; previousBillChf: number; benchmarkChf: number; change: Stances; lasting: Stances } {
  const previous = tariffStore.sheetFor(year);
  return {
    billChf: householdBillChf(sheet),
    previousBillChf: householdBillChf(previous),
    benchmarkChf: benchmarkBillChf(year),
    change: changeStances(previous, sheet, year),
    lasting: stancesFor(sheet, year),
  };
}
