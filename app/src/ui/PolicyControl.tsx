import { policyStore } from "../sim/policy";
import { usePolicy } from "../sim/store";
import "./tariffControl.css";

/** The first real lever in the long-promised Policy tab (see solarAdoption.ts):
 * outreach (info events, campaigns — raises how often a building's owner
 * seriously considers solar) and a municipal top-up subsidy (a real cost on
 * the treasury, see finances.ts, stacked on the federal baseline every
 * installation already gets). Deliberately just these two for now — the
 * rest of "bans, regulations, direct infrastructure funding" from the
 * gameplay design stays a placeholder below until it's actually built. */
export function PolicyControl() {
  const policy = usePolicy();

  return (
    <div className="tariff-control">
      <div className="tariff-title">Solar adoption</div>
      <div className="tariff-row">
        <span className="tariff-label">
          Outreach
          <span className="tariff-window">info events, campaigns</span>
        </span>
        <input
          type="number"
          min={0}
          max={100}
          step={5}
          value={policy.solarOutreachLevel}
          onChange={(e) => policyStore.set({ solarOutreachLevel: Number(e.target.value) })}
        />
        <span className="tariff-unit">%</span>
      </div>
      <p style={{ fontSize: 11, color: "#898781", margin: "0 0 10px" }}>
        Raises how often a building's owner seriously considers solar — from no push (0%) to as much as the municipality can
        realistically manage (100%, roughly 3x more often).
      </p>
      <div className="tariff-row">
        <span className="tariff-label">Municipal subsidy top-up</span>
        <input
          type="number"
          min={0}
          max={2000}
          step={50}
          value={policy.solarSubsidyRpPerKwp / 100}
          onChange={(e) => policyStore.set({ solarSubsidyRpPerKwp: Number(e.target.value) * 100 })}
        />
        <span className="tariff-unit">CHF/kWp</span>
      </div>
      <p style={{ fontSize: 11, color: "#898781", margin: "0 0 10px" }}>
        On top of the federal one-time subsidy every installation already gets — paid out of the municipal treasury (see
        Control → City stats and the Year in Review report) whenever a building actually adopts.
      </p>

      <div className="tariff-divider" />
      <div className="tariff-title">Other subsidies</div>
      <div className="tariff-row">
        <span className="tariff-label">Heat pump grant</span>
        <input
          type="number"
          min={0}
          max={20000}
          step={500}
          value={policy.heatPumpSubsidyRp / 100}
          onChange={(e) => policyStore.set({ heatPumpSubsidyRp: Number(e.target.value) * 100 })}
        />
        <span className="tariff-unit">CHF each</span>
      </div>
      <div className="tariff-row">
        <span className="tariff-label">Electric car grant</span>
        <input
          type="number"
          min={0}
          max={10000}
          step={500}
          value={policy.evSubsidyRp / 100}
          onChange={(e) => policyStore.set({ evSubsidyRp: Number(e.target.value) * 100 })}
        />
        <span className="tariff-unit">CHF each</span>
      </div>
      <div className="tariff-row">
        <span className="tariff-label">Insulation retrofit top-up</span>
        <input
          type="number"
          min={0}
          max={200}
          step={5}
          value={policy.retrofitSubsidyRpPerM2 / 100}
          onChange={(e) => policyStore.set({ retrofitSubsidyRpPerM2: Number(e.target.value) * 100 })}
        />
        <span className="tariff-unit">CHF/m²</span>
      </div>
      <p style={{ fontSize: 11, color: "#898781", margin: "0 0 10px" }}>
        Paid from the treasury each time a household actually decides — so a grant also goes to everyone who would have decided the
        same way anyway. Aim for enough to tip the marginal cases without paying for the rest. Applies to replacements and retrofits,
        not to new buildings (whose heating and insulation the building code already governs).
      </p>

      <div className="tariff-divider" />
      <p style={{ fontSize: 12, color: "#898781" }}>
        Bans, regulations, and direct infrastructure funding aren't implemented yet — this tab will grow into the rest of the
        policy layer described in the game's design.
      </p>
    </div>
  );
}
