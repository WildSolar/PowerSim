/**
 * How the town is doing, as people notice it over time — two slow, diffuse pulls on approval, next
 * to the decisions themselves (approval.ts):
 *
 *  - Energy self-sufficiency: how much of the electricity it uses the town makes itself (rooftop
 *    solar, car-park canopies, Agri-PV fields, wind) over the last twelve months.
 *  - Public charging: how good charging is around the households without a wallbox, on average
 *    (publicCharging.ts) — falling as electric cars outgrow the chargers, rising as chargers are built.
 *  - The grid turning people away: the share of the town's buildings where a full transformer
 *    station refuses heat pumps, wallboxes or solar (grid.ts), for as long as it lasts.
 *  - For the climate-minded, the cut in emissions per resident in the last year counted, against what
 *    doing nothing would have made of it (par.ts) — none without par for this game.
 *
 * The first two are measured against how things stood when the player took office, so the change is
 * what counts, either way. Each bloc that cares leans toward approval (or away) in proportion, through
 * the level it drifts toward, like a measure in force. Read off the month records (monthRecords.ts)
 * and the counted years as they come in, so they lag a little. Nothing to save: the records are.
 */

import {
  OUTCOME_AHEAD_OF_PAR_STANCE,
  OUTCOME_CHARGING_STANCE,
  OUTCOME_GRID_BLOCKED_STANCE,
  OUTCOME_SELF_SUFFICIENCY_STANCE,
  type Bloc,
} from "../config/approval";
import { setLocalStances, type Stances } from "./approval";
import { toDateMs } from "./calendar";
import { grid } from "./grid";
import { monthRecords, type MonthRecord } from "./monthRecords";
import { parYears } from "./par";
import { scoreSoFar } from "./score";

export type Outcome = "selfSufficiency" | "charging" | "gridBlocked" | "aheadOfPar";

/** Where each outcome stands (shares, -1 to 1): self-sufficiency and charging as changes since the
 * start, the share of buildings the grid turns away, and how far the last counted year's cut is ahead
 * of par's (points / 100). */
export type OutcomeChanges = Record<Outcome, number>;

const STANCE: Record<Outcome, Partial<Record<Bloc, number>>> = {
  selfSufficiency: OUTCOME_SELF_SUFFICIENCY_STANCE,
  charging: OUTCOME_CHARGING_STANCE,
  gridBlocked: OUTCOME_GRID_BLOCKED_STANCE,
  aheadOfPar: OUTCOME_AHEAD_OF_PAR_STANCE,
};

function monthOf(atMs: number): number {
  const d = new Date(toDateMs(atMs));
  return d.getUTCFullYear() * 12 + d.getUTCMonth();
}

/** What the town used and made in a month (kWh), from its record. */
function useAndMade(r: MonthRecord): { use: number; made: number } | null {
  const e = r.electricityKWh;
  if (!e) return null;
  let use = 0;
  for (const [k, v] of Object.entries(e)) if (k !== "solar") use += v;
  return { use, made: e.solar + (r.windKWh ?? 0) };
}

let memo: { key: string; changes: OutcomeChanges } | null = null;

/** How self-sufficiency and public charging have changed since the start, as of `atMs` (the months
 * counted before it). */
export function outcomeChanges(atMs: number): OutcomeChanges {
  const month = monthOf(atMs);
  // The grid's readings and the counted years change with the records' months; a month is close enough.
  const key = `${monthRecords.getVersion()}:${month}:${grid.getVersion()}`;
  if (memo?.key === key) return memo.changes;
  const records = monthRecords.all().filter((r) => r.month < month);

  // Self-sufficiency: the last twelve months counted, against the first time each of those calendar
  // months was counted — the same months of the year, so the seasons don't count.
  const firstByCalendarMonth = new Map<number, { use: number; made: number }>();
  const counted: { month: number; use: number; made: number }[] = [];
  for (const r of records) {
    const m = useAndMade(r);
    if (!m) continue;
    if (!firstByCalendarMonth.has(r.month % 12)) firstByCalendarMonth.set(r.month % 12, m);
    counted.push({ month: r.month, ...m });
  }
  const recent = counted.slice(-12);
  let now = { use: 0, made: 0 };
  let then = { use: 0, made: 0 };
  for (const r of recent) {
    const first = firstByCalendarMonth.get(r.month % 12)!;
    now = { use: now.use + r.use, made: now.made + r.made };
    then = { use: then.use + first.use, made: then.made + first.made };
  }
  const selfSufficiency = now.use > 0 && then.use > 0 ? now.made / now.use - then.made / then.use : 0;

  // Public charging: the latest month counted against the first.
  const withAssets = records.filter((r) => r.assets);
  const charging = withAssets.length > 1 ? withAssets[withAssets.length - 1].assets!.chargingQos - withAssets[0].assets!.chargingQos : 0;

  // The grid: where it turns people away now.
  const gridBlocked = grid.blockedShare(atMs);

  // The last year counted, against par's cut that year.
  const scored = scoreSoFar().years.filter((y) => !y.projected);
  const last = scored[scored.length - 1];
  const par = last ? parYears()?.find((p) => p.year === last.year) : undefined;
  const aheadOfPar = last && par ? (last.points - par.points) / 100 : 0;

  const changes = { selfSufficiency, charging, gridBlocked, aheadOfPar };
  memo = { key, changes };
  return changes;
}

/** How each bloc leans because of them, as of `atMs`. */
export function outcomeStances(atMs: number): Stances {
  const c = outcomeChanges(atMs);
  const out: Stances = {};
  for (const outcome of Object.keys(STANCE) as Outcome[])
    for (const [bloc, k] of Object.entries(STANCE[outcome]) as [Bloc, number][]) out[bloc] = (out[bloc] ?? 0) + k * c[outcome];
  return out;
}

/** The outcome a bloc feels most strongly about, in the direction given (+1 pleased, -1 annoyed), with
 * its stance; null if none moves it noticeably. */
export function strongestOutcome(bloc: Bloc, sign: 1 | -1, atMs: number): { outcome: Outcome; stance: number } | null {
  const c = outcomeChanges(atMs);
  let best: { outcome: Outcome; stance: number } | null = null;
  for (const outcome of Object.keys(STANCE) as Outcome[]) {
    const stance = (STANCE[outcome][bloc] ?? 0) * c[outcome];
    if (stance * sign > 0.02 && (!best || stance * sign > best.stance * sign)) best = { outcome, stance };
  }
  return best;
}

/** Wires the outcomes into approval for a game (after approval.init). */
export function initOutcomeApproval(): void {
  memo = null;
  setLocalStances("outcomes", outcomeStances);
}
