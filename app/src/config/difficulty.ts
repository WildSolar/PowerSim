/**
 * The difficulty setting: chosen on the start menu, fixed for the run. It shapes how
 * much help the player gets from the outside world — how early the canton and federal
 * government act on their own (see config/externalMeasures.ts) — and how much money the
 * wider government hands over. Further knobs (approval sensitivity, how conservative
 * households are) join here as those systems land.
 */

export type Difficulty = "easy" | "normal" | "hard";

export interface DifficultySpec {
  label: string;
  description: string;
  /** Scales the treasury's starting cash. */
  openingTreasuryMultiplier: number;
  /** Scales the annual allocation from the overall government. */
  governmentAllocationMultiplier: number;
}

export const DIFFICULTY_ORDER: Difficulty[] = ["easy", "normal", "hard"];

export const DIFFICULTY_SPECS: Record<Difficulty, DifficultySpec> = {
  easy: {
    label: "Easy",
    description: "Canton and federal government act early, and the budget is generous.",
    openingTreasuryMultiplier: 1.5,
    governmentAllocationMultiplier: 1.25,
  },
  normal: {
    label: "Normal",
    description: "Higher levels of government act on a realistic schedule.",
    openingTreasuryMultiplier: 1,
    governmentAllocationMultiplier: 1,
  },
  hard: {
    label: "Hard",
    description: "Little outside help: most of the work, and the cost, is yours.",
    openingTreasuryMultiplier: 0.6,
    governmentAllocationMultiplier: 0.8,
  },
};

export const DEFAULT_DIFFICULTY: Difficulty = "normal";
