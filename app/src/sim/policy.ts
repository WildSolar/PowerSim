/**
 * The first (deliberately minimal) piece of the long-promised "Policy" tab:
 * player-controlled levers that cost money or shift behavior without being a
 * price consumers see, unlike tariff.ts. Two levers for now, both feeding
 * solarAdoption.ts — outreach (how hard the municipality pushes information
 * events, raising the chance a building's owner seriously considers solar)
 * and a municipal top-up subsidy (a real cost on finances.ts's ledger,
 * stacked on top of the federal Einmalvergütung baseline every installation
 * already gets — see solarSystems.ts). More levers land here as the rest of
 * the policy layer gets built. Starting values live in config/policy.ts —
 * edit that file to recalibrate, not this one.
 */

import { DEFAULT_POLICY, OUTREACH_MAX_MULTIPLIER_BONUS } from "../config/policy";
import type { EnergyClassId } from "./energyClass";

export interface Policy {
  solarOutreachLevel: number; // 0-100 — "how much the municipality promotes solar", drives solarAdoption.ts's hazard multiplier
  solarSubsidyRpPerKwp: number; // player-set top-up subsidy, on top of the federal baseline

  // Levers on town growth and building renewal (sim/stock.ts, via constructionRules.ts).
  // Applied to a project when its permit is decided, so they take effect with a lag.
  newBuildSolarMandatePct: number; // 0-100 — share of a new roof's usable capacity it must carry (the code minimum still applies below this)
  newBuildInsulationLevel: number; // 0-100 — 0 = code standard, 100 = passive-house-grade envelope
  newBuildFossilHeatingAllowed: boolean; // the building code forbids fossil heating in new builds by default
  growthMultiplier: number; // scales the municipality's historic growth rate (zoning ambition); 1 = as before
  renewalRateMultiplier: number; // scales how often old buildings are replaced (replacement incentives); 1 = as before

  // Levers on insulation retrofits of existing buildings (sim/retrofit.ts, via constructionRules.ts).
  retrofitSubsidyRpPerM2: number; // municipal top-up per m2 of envelope on an upgrade, on top of the federal building-program grant
  retrofitMinClass: EnergyClassId | "none"; // an envelope renovation must reach at least this class (no half-measures)

  // Municipal grants on top of the federal/cantonal ones, paid from the treasury when a decision happens.
  heatPumpSubsidyRp: number; // flat, per heat pump installed (air or ground)
  evSubsidyRp: number; // flat, per electric car bought
}

export { DEFAULT_POLICY };

class PolicyStore {
  private policy: Policy = { ...DEFAULT_POLICY };
  private readonly listeners = new Set<() => void>();

  get(): Policy {
    return this.policy;
  }

  set(patch: Partial<Policy>): void {
    this.policy = { ...this.policy, ...patch };
    this.listeners.forEach((listener) => listener());
  }

  subscribe(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }
}

export const policyStore = new PolicyStore();

/** Outreach turns into a hazard-rate multiplier on solarAdoption.ts's annual
 * check — 1x at no outreach, up to (1 + OUTREACH_MAX_MULTIPLIER_BONUS)x at
 * full outreach. A multiplier rather than an additive bump, so it scales the
 * *existing* baseline/neighbor/renewal-boost hazard proportionally instead
 * of swamping them at low levels or doing nothing at high ones. */
export function outreachHazardMultiplier(policy: Policy): number {
  return 1 + (policy.solarOutreachLevel / 100) * OUTREACH_MAX_MULTIPLIER_BONUS;
}
