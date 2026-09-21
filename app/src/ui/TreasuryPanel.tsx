import type { MunicipalityDataset } from "../data/types";
import { formatCHF } from "./format";
import { useLiveTreasury } from "./useLiveTreasury";
import "./timeControl.css";

/** The municipal treasury at a glance, always on screen: what is in it now, this year's
 * allocation from the overall government, and what has been paid out in subsidies so far. */
export function TreasuryPanel({ dataset }: { dataset: MunicipalityDataset }) {
  const { balanceRp, budgetRp, paidOutRp } = useLiveTreasury(dataset);

  return (
    <div className="time-control" title="Money leaves the treasury only when a subsidised decision actually happens">
      <h3 className="panel-title">Treasury</h3>
      <div className="clock-readout" style={{ fontWeight: 700, color: balanceRp !== null && balanceRp < 0 ? "#b23a2e" : "#1a1a1a" }}>
        {balanceRp === null ? "…" : formatCHF(balanceRp)}
      </div>
      <div className="info-row">
        <span>Budget this year</span>
        <span className="info-value" style={{ color: "#1baf7a" }}>
          +{formatCHF(budgetRp)}
        </span>
      </div>
      <div className="info-row">
        <span>Paid out so far</span>
        <span className="info-value" style={{ color: paidOutRp > 0 ? "#b23a2e" : undefined }}>
          −{formatCHF(paidOutRp)}
        </span>
      </div>
    </div>
  );
}
