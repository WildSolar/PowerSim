/**
 * Whether a measure has anything left to do. Some measures work through a finite list — the
 * municipality's own buildings — and once the player (or the measure itself) has covered all of
 * them, enacting it would do nothing. The module owning that list registers a check here (App wires
 * them up at load); the Measures tab greys such a measure out and says why.
 */

type AvailabilityCheck = (atMs: number) => string | null;

const checks = new Map<string, AvailabilityCheck>();

/** `check` returns why the measure has nothing left to do, or null while it still has. */
export function setMeasureAvailability(id: string, check: AvailabilityCheck): void {
  checks.set(id, check);
}

/** Why the measure has nothing left to do at `atMs`, or null. */
export function measureUnavailableReason(id: string, atMs: number): string | null {
  return checks.get(id)?.(atMs) ?? null;
}
