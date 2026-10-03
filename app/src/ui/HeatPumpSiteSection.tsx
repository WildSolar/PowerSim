import type { Building } from "../data/types";
import { heatPumpSiting } from "../sim/heatPumpSiting";
import { formatCHF } from "./format";

const ZONE_LABEL: Record<string, string> = {
  A: "groundwater protection zone",
  B: "drinking-water aquifer",
  C: "aquifer, not for drinking water",
  D: "low-yield aquifer",
  E: "spring-water area",
  F: "outside usable groundwater",
};

/** Where a new heat pump could go on this site: the ground under it (canton's heat-use atlas) and
 * the noise an outdoor unit would make at the neighbours' windows — public information, the
 * starting point of every owner's planning. */
export function HeatPumpSiteSection({ building, simTimeMs }: { building: Building; simTimeMs: number }) {
  const ground = heatPumpSiting.groundSource(building, simTimeMs);
  const noise = heatPumpSiting.airNoise(building, simTimeMs);
  const zone = ground.zone ? `zone ${ground.zone}, ${ZONE_LABEL[ground.zone]}` : null;
  const groundText =
    ground.kind === "borehole"
      ? `boreholes${ground.conditions ? ", with conditions (casing, depth limit)" : ""}`
      : ground.kind === "groundwater"
        ? `groundwater wells, by concession (${formatCHF(ground.annualFeeRp)} a year)`
        : `not possible — ${ground.reason}`;
  const airText =
    noise.step === "notPermitted"
      ? "not permitted — too loud for the neighbours, even installed indoors"
      : noise.step === "none"
        ? "an outdoor unit is fine"
        : `needs ${noise.label} (+${formatCHF(noise.extraCostRp)} on a house)`;
  return (
    <div className="hp-site" style={{ fontSize: 12, margin: "6px 0 0" }}>
      <div style={{ fontWeight: 600, marginBottom: 2 }}>For a new heat pump</div>
      <div>
        🌍 Ground: {groundText}
        {zone && heatPumpSiting.hasHeatUseAtlas() ? <span style={{ color: "var(--ink-2)" }}> ({zone})</span> : null}
      </div>
      <div>
        🌬️ Air: {airText}
        <span style={{ color: "var(--ink-2)" }}>
          {" "}
          (neighbours ~{Math.round(noise.distanceM)} m away, noise level {noise.sensitivity}
          {noise.excessDb > 0 ? `, ${Math.round(noise.excessDb)} dB over the night limit` : ""})
        </span>
      </div>
    </div>
  );
}
