import { FLEET_CATALOG, type FleetVehicleId } from "../config/fleet";
import type { Building } from "../data/types";
import { fleets } from "../sim/fleet";
import { publicCharging } from "../sim/publicCharging";
import { formatWatts } from "./format";
import { RenewalLogSection } from "./RenewalLogSection";

const ICON: Record<FleetVehicleId, string> = { vanDiesel: "🚐", vanEV: "🚐", truckDiesel: "🚚", truckEV: "🚚" };
const LOG_LIMIT = 12;

function article(word: string): string {
  return /^[aeiou]/i.test(word) ? "an" : "a";
}

/** A building's businesses' vans and lorries (fleet.ts): what they run on and where the electric
 * ones charge, grouped; the depot's charging draw right now; and the latest replacements. */
export function FleetSection({ building, simTimeMs }: { building: Building; simTimeMs: number }) {
  const vehicles = fleets.vehiclesOf(building);
  if (vehicles.length === 0) return null;

  const groups = new Map<string, { id: FleetVehicleId; where: string; count: number }>();
  for (const v of vehicles) {
    const id = fleets.typeAt(v, simTimeMs);
    const charging = fleets.chargingAt(v, simTimeMs);
    const where =
      charging?.kind === "depot"
        ? "charges at its own yard"
        : charging?.kind === "public"
          ? `charges at ${publicCharging.getSite(charging.siteId)?.name ?? "a public charger"}`
          : v.depot
            ? "has a yard to charge in"
            : "no yard to charge in";
    const key = `${id}|${where}`;
    const group = groups.get(key) ?? { id, where, count: 0 };
    group.count++;
    groups.set(key, group);
  }
  const rows = [...groups.values()].sort((a, b) => a.id.localeCompare(b.id) || b.count - a.count);
  const depotW = fleets.depotPowerW(building, simTimeMs);
  const anyDepotEv = vehicles.some((v) => fleets.chargingAt(v, simTimeMs)?.kind === "depot");

  const log = vehicles
    .flatMap((v) =>
      fleets
        .history(v, simTimeMs)
        .filter((e) => e.previousSystem !== null)
        .map((e) => ({
          installedAtMs: e.installedAtMs,
          note:
            e.system === e.previousSystem
              ? `${FLEET_CATALOG[e.system].label} ${v.index + 1} replaced with another.`
              : `${FLEET_CATALOG[e.previousSystem as FleetVehicleId].label} ${v.index + 1} replaced with ${article(FLEET_CATALOG[e.system].label)} ${FLEET_CATALOG[e.system].label.toLowerCase()}.`,
        })),
    )
    .sort((a, b) => a.installedAtMs - b.installedAtMs)
    .slice(-LOG_LIMIT);

  return (
    <>
      <h2 style={{ fontSize: 14, marginTop: 14 }}>Vans &amp; lorries ({vehicles.length})</h2>
      {rows.map((r) => (
        <div className="device-row" key={`${r.id}|${r.where}`}>
          <span className="device-name">
            {ICON[r.id]} {r.count} × {FLEET_CATALOG[r.id].label.toLowerCase()}
          </span>
          <span className="device-status">{r.where}</span>
        </div>
      ))}
      {anyDepotEv && (
        <div className="device-row">
          <span className="device-name">🔌 Charging at the yard</span>
          <span className={`device-watts${depotW === 0 ? " off" : ""}`}>{formatWatts(depotW)}</span>
        </div>
      )}
      <RenewalLogSection title="Vans & lorries history" entries={log} />
    </>
  );
}
