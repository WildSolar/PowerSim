/**
 * The policy the simulation reads: the resolved effect channels (channels.ts) produced by
 * the measure engine (measures.ts) from every measure in force — the player's own and the
 * canton's and federal government's. Nothing here is set directly any more; enact or
 * repeal a measure instead.
 */

import { OUTREACH_MAX_MULTIPLIER_BONUS } from "../config/policy";
import type { Channels } from "./channels";
import { measures } from "./measures";

export type Policy = Channels;

export const policyStore = {
  get: (): Policy => measures.getChannels(),
  subscribe: (listener: () => void): (() => void) => measures.subscribe(listener),
};

/** Outreach turns into a hazard-rate multiplier on solarAdoption.ts's annual check — 1x at no
 * outreach, up to (1 + OUTREACH_MAX_MULTIPLIER_BONUS)x at full outreach. A multiplier rather than
 * an additive bump, so it scales the *existing* baseline/neighbor/renewal-boost hazard
 * proportionally instead of swamping them at low levels or doing nothing at high ones. */
export function outreachHazardMultiplier(policy: Policy): number {
  return 1 + (policy.solarOutreachLevel / 100) * OUTREACH_MAX_MULTIPLIER_BONUS;
}
