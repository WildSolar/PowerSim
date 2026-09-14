/**
 * The first (deliberately minimal) piece of the long-promised "Policy" tab:
 * player-controlled levers that cost money or shift behavior without being a
 * price consumers see, unlike tariff.ts. Two levers for now, both feeding
 * solarAdoption.ts — outreach (how hard the municipality pushes information
 * events, raising the chance a building's owner seriously considers solar)
 * and a municipal top-up subsidy (a real cost on finances.ts's ledger,
 * stacked on top of the federal Einmalvergütung baseline every installation
 * already gets — see solarSystems.ts). More levers land here as the rest of
 * the policy layer gets built.
 */

export interface Policy {
  solarOutreachLevel: number; // 0-100 — "how much the municipality promotes solar", drives solarAdoption.ts's hazard multiplier
  solarSubsidyRpPerKwp: number; // player-set top-up subsidy, on top of the federal baseline
}

export const DEFAULT_POLICY: Policy = {
  solarOutreachLevel: 0,
  solarSubsidyRpPerKwp: 0,
};

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
 * check — 1x at no outreach, up to 3x at full outreach. A multiplier rather
 * than an additive bump, so it scales the *existing* baseline/neighbor/
 * renewal-boost hazard proportionally instead of swamping them at low levels
 * or doing nothing at high ones. */
export function outreachHazardMultiplier(policy: Policy): number {
  return 1 + (policy.solarOutreachLevel / 100) * 2;
}
