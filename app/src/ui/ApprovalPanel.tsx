import { useSyncExternalStore } from "react";
import { formatDate } from "../sim/calendar";
import { approval } from "../sim/approval";
import "./timeControl.css";

const MONTH_MS = (365.25 * 24 * 60 * 60_000) / 12;
const TREND_MONTHS = 6;

/** Public approval at a glance: the one number, where it is heading, and when the next election is. */
export function ApprovalPanel() {
  useSyncExternalStore(
    (listener) => approval.subscribe(listener),
    () => approval.getVersion(),
  );
  const current = approval.getApproval();
  const history = approval.getHistory();
  const latest = history[history.length - 1];
  const past = latest ? ([...history].reverse().find((p) => p.atMs <= latest.atMs - TREND_MONTHS * MONTH_MS) ?? history[0]) : undefined;
  const delta = past ? current - past.approval : 0;
  const election = approval.nextElectionMs();

  const color = current >= 60 ? "#1baf7a" : current >= 40 ? "#1a1a1a" : "#b23a2e";
  const trend = Math.abs(delta) < 1 ? "steady" : `${delta > 0 ? "▲" : "▼"} ${Math.abs(Math.round(delta))} pts`;

  return (
    <div className="time-control" title="Public approval of the municipality's energy policy. Very low approval ends the game.">
      <h3 className="panel-title">Approval</h3>
      <div className="clock-readout" style={{ fontWeight: 700, color }}>
        {Math.round(current)}%
        <span style={{ marginLeft: 8, fontWeight: 400, fontSize: 12, color: delta < -1 ? "#b23a2e" : delta > 1 ? "#1baf7a" : "#898781" }}>{trend}</span>
      </div>
      {election !== null && (
        <div className="info-row">
          <span>Next election</span>
          <span className="info-value">{formatDate(election).replace(/^\w+, \d+ /, "")}</span>
        </div>
      )}
    </div>
  );
}
