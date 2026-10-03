import { useSyncExternalStore } from "react";
import type { MunicipalityDataset } from "../data/types";
import { debt } from "../sim/debt";
import { simClock } from "../sim/engine";
import { formatCHF } from "./format";
import { useLiveTreasury } from "./useLiveTreasury";
import "./timeControl.css";

/** The municipal treasury at a glance, always on screen: what is in it now, this year's
 * allocation from the overall government, and what has been paid out in subsidies so far. */
export function TreasuryPanel({ dataset }: { dataset: MunicipalityDataset }) {
  const { balanceRp, budgetRp, paidOutRp, receivedRp, borrowedRp } = useLiveTreasury(dataset);
  useSyncExternalStore(
    (l) => debt.subscribe(l),
    () => debt.getVersion(),
  );
  const now = simClock.getSimTimeMs();
  const owedRp = debt.getLoans().reduce((sum, l) => sum + (l.status === "active" ? l.outstandingRp : 0), 0);

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
      {borrowedRp > 0 && (
        <div className="info-row">
          <span>Borrowed this year</span>
          <span className="info-value">+{formatCHF(borrowedRp)}</span>
        </div>
      )}
      {owedRp > 0 && (
        <div className="info-row" title="Loans and bonds outstanding (Control → Borrowing)">
          <span>Debt · {debt.rating(now).label}</span>
          <span className="info-value" style={{ color: debt.isSupervised() ? "#b23a2e" : undefined }}>
            {formatCHF(owedRp)}
          </span>
        </div>
      )}
      {receivedRp > 0 && (
        <div className="info-row" title="Value-capture levy on projects that gained from a zoning change">
          <span>Zoning levy so far</span>
          <span className="info-value" style={{ color: "#1baf7a" }}>
            +{formatCHF(receivedRp)}
          </span>
        </div>
      )}
    </div>
  );
}
