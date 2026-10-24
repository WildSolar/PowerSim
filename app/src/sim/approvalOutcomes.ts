/**
 * How the town is doing, as people notice it over time — two slow, diffuse pulls on approval, next
 * to the decisions themselves (approval.ts):
 *
 *  - Energy self-sufficiency: how much of the electricity it uses the town makes itself (rooftop
 *    solar, car-park canopies, Agri-PV fields, wind) over the last twelve months.
 *  - Public charging: how good charging is around the households without a wallbox, on average
 *    (publicCharging.ts) — falling as electric cars outgrow the chargers, rising as chargers are built.
 *
 * Both are measured against how things stood when the player took office, so the change is what
 * counts, either way: each bloc that cares leans toward approval (or away) in proportion, through
 * the level it drifts toward, like a measure in force. Read off the month records (monthRecords.ts)
 * as each month is counted, so they lag a month or so. Nothing to save: the records are.
 */

import { OUTCOME_CHARGING_STANCE, OUTCOME_SELF_SUFFICIENCY_STANCE, type Bloc } from "../config/approval";
import { setLocalStances, type Stances } from "./approval";
import { toDateMs } from "./calendar";
import { monthRecords, type MonthRecord } from "./monthRecords";

export type Outcome = "selfSufficiency" | "charging";

/** How each outcome has changed since the start (shares, -1 to 1). */
export interface OutcomeChanges {
  selfSufficiency: number;
  charging: number;
}

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
  const key = `${monthRecords.getVersion()}:${month}`;
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

  const changes = { selfSufficiency, charging };
  memo = { key, changes };
  return changes;
}

/** How each bloc leans because of them, as of `atMs`. */
export function outcomeStances(atMs: number): Stances {
  const c = outcomeChanges(atMs);
  const out: Stances = {};
  for (const [bloc, k] of Object.entries(OUTCOME_SELF_SUFFICIENCY_STANCE) as [Bloc, number][]) out[bloc] = (out[bloc] ?? 0) + k * c.selfSufficiency;
  for (const [bloc, k] of Object.entries(OUTCOME_CHARGING_STANCE) as [Bloc, number][]) out[bloc] = (out[bloc] ?? 0) + k * c.charging;
  return out;
}

/** The outcome a bloc feels most strongly about, in the direction given (+1 pleased, -1 annoyed), with
 * its stance; null if neither moves it noticeably. */
export function strongestOutcome(bloc: Bloc, sign: 1 | -1, atMs: number): { outcome: Outcome; stance: number } | null {
  const c = outcomeChanges(atMs);
  const candidates: { outcome: Outcome; stance: number }[] = [
    { outcome: "selfSufficiency", stance: (OUTCOME_SELF_SUFFICIENCY_STANCE[bloc] ?? 0) * c.selfSufficiency },
    { outcome: "charging", stance: (OUTCOME_CHARGING_STANCE[bloc] ?? 0) * c.charging },
  ];
  let best: { outcome: Outcome; stance: number } | null = null;
  for (const x of candidates) if (x.stance * sign > 0.02 && (!best || x.stance * sign > best.stance * sign)) best = x;
  return best;
}

/** Wires the outcomes into approval for a game (after approval.init). */
export function initOutcomeApproval(): void {
  memo = null;
  setLocalStances("outcomes", outcomeStances);
}
