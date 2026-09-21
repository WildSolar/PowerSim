/**
 * Measures the canton and the federal government enact on their own schedule — the
 * player has no say and bears no cost, but lives with the consequences. They write to the
 * same effect channels as the player's own measures. The difficulty setting decides how
 * early they happen (null = not within the game). Each is announced some years ahead, so a
 * player watching the outlook can plan around it: no point building municipal fast chargers
 * for a fleet a federal ban is about to convert anyway.
 */

import type { Channels } from "../sim/channels";
import type { Difficulty } from "./difficulty";

export interface ExternalMeasureDef {
  id: string;
  source: "cantonal" | "federal";
  title: string;
  summary: string;
  /** Calendar year it takes effect, per difficulty; null = it doesn't within the game. */
  startYear: Record<Difficulty, number | null>;
  /** How many years before it takes effect it is announced (and appears in the outlook). */
  announcedYearsBefore: number;
  effects: Partial<Channels>;
}

export const EXTERNAL_MEASURES: ExternalMeasureDef[] = [
  {
    id: "cantonal-fossil-heating-ban",
    source: "cantonal",
    title: "Cantonal ban on new fossil heating",
    summary: "Replacing a heating system with a gas or oil one is no longer permitted anywhere in the canton.",
    startYear: { easy: 2030, normal: 2035, hard: 2040 },
    announcedYearsBefore: 4,
    effects: { fossilHeatingInstallBanned: true },
  },
  {
    id: "federal-ice-sales-ban",
    source: "federal",
    title: "Federal ban on new petrol and diesel car sales",
    summary: "From this year, only electric (or other zero-emission) new cars may be sold in Switzerland.",
    startYear: { easy: 2033, normal: 2038, hard: null },
    announcedYearsBefore: 5,
    effects: { iceCarPurchaseBanned: true },
  },
  {
    id: "cantonal-renovation-standard",
    source: "cantonal",
    title: "Cantonal minimum standard for renovations",
    summary: "A building envelope that is renovated must reach at least the current standard.",
    startYear: { easy: 2031, normal: 2036, hard: 2042 },
    announcedYearsBefore: 3,
    effects: { retrofitMinClass: "standard" },
  },
];
