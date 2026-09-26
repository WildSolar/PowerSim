import { useMemo, useState } from "react";
import type { MunicipalityDataset } from "../data/types";
import { formatDate } from "../sim/calendar";
import { clearDecisionLog, getDecisionLog, type DecisionLogEntry, type DecisionLogKind } from "../sim/decisionLog";
import { formatCHF } from "./format";
import "./decisionLogTab.css";

export interface DecisionLogTabProps {
  dataset: MunicipalityDataset;
}

const KIND_LABEL: Record<DecisionLogKind, string> = {
  heating: "Heating",
  "mobility-mode": "Mobility (mode)",
  "mobility-vehicle-car": "Mobility (car)",
  "mobility-vehicle-bike": "Mobility (bike)",
  "fleet-van": "Business van",
  "fleet-truck": "Business lorry",
  solar: "Solar",
  construction: "New construction",
  retrofit: "Insulation retrofit",
};

const KIND_FILTERS: (DecisionLogKind | "all")[] = ["all", "heating", "mobility-mode", "mobility-vehicle-car", "mobility-vehicle-bike", "fleet-van", "fleet-truck", "solar", "construction", "retrofit"];

const DISPLAY_LIMIT = 300;

function extraValue(key: string, v: number | string | boolean): string {
  if (typeof v === "number") {
    if (key.endsWith("Rp")) return formatCHF(v);
    return Number.isInteger(v) ? String(v) : v.toFixed(3);
  }
  return String(v);
}

function downloadJSON(entries: readonly DecisionLogEntry[]): void {
  const blob = new Blob([JSON.stringify(entries, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `decision-log-${Date.now()}.json`;
  a.click();
  URL.revokeObjectURL(url);
}

function EntryRow({ entry, address }: { entry: DecisionLogEntry; address: string | null }) {
  const [expanded, setExpanded] = useState(false);
  const outcomeLabel =
    entry.reasonKind === "weighted"
      ? "drawn"
      : entry.reasonKind === "inKind"
        ? "kept"
        : entry.reasonKind === "forcedByAvailability"
          ? "forced"
          : "chosen";

  return (
    <div className="decision-log-entry">
      <button className="decision-log-summary" onClick={() => setExpanded((e) => !e)}>
        <span className="decision-log-date">{formatDate(entry.atMs)}</span>
        <span className="decision-log-kind">{KIND_LABEL[entry.kind]}</span>
        <span className="decision-log-building">
          {address ?? entry.egid} <span className="decision-log-egid">({entry.egid})</span>
        </span>
        <span className="decision-log-outcome">
          {entry.incumbent && entry.incumbent !== entry.chosen ? `${entry.incumbent} → ${entry.chosen}` : entry.chosen}
          <span className="decision-log-reason"> ({outcomeLabel})</span>
        </span>
        <span className="decision-log-expand-icon">{expanded ? "▾" : "▸"}</span>
      </button>
      {expanded && (
        <div className="decision-log-detail">
          <div className="decision-log-meta">
            entityKey: <code>{entry.entityKey}</code>
            {entry.uncertaintyFraction !== undefined && <> · uncertainty ±{(entry.uncertaintyFraction * 100).toFixed(0)}%</>}
            {entry.biasStrengthRp !== undefined && <> · bias {formatCHF(entry.biasStrengthRp)}/yr</>}
          </div>
          {entry.candidates.length > 0 && (
            <table className="decision-log-candidates">
              <thead>
                <tr>
                  <th>Option</th>
                  {entry.candidates[0].weight !== undefined && <th>Target share</th>}
                  {entry.candidates[0].annualizedCostRp !== undefined && (
                    <>
                      <th>Annualized cost</th>
                      <th>After bias</th>
                      <th>Available</th>
                    </>
                  )}
                  <th>Chosen</th>
                </tr>
              </thead>
              <tbody>
                {entry.candidates.map((c) => (
                  <tr key={c.id} className={c.id === entry.chosen ? "decision-log-chosen-row" : ""}>
                    <td>{c.label}</td>
                    {c.weight !== undefined && <td>{(c.weight * 100).toFixed(0)}%</td>}
                    {c.annualizedCostRp !== undefined && (
                      <>
                        <td>{formatCHF(c.annualizedCostRp)}/yr</td>
                        <td>{c.effectiveCostRp !== undefined ? `${formatCHF(c.effectiveCostRp)}/yr` : "—"}</td>
                        <td>{c.available === false ? "no" : "yes"}</td>
                      </>
                    )}
                    <td>{c.id === entry.chosen ? "✓" : ""}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
          {entry.extra && Object.keys(entry.extra).length > 0 && (
            <div className="decision-log-extra">
              {Object.entries(entry.extra).map(([k, v]) => (
                <span key={k} className="decision-log-extra-item">
                  {k}: <strong>{extraValue(k, v)}</strong>
                </span>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

/** A development tool for calibration — every stock-renewal/solar-adoption
 * decision actually committed, most recent first, with the full candidate
 * comparison and outcome (see sim/decisionLog.ts). Never shown to a player
 * in the normal course of play — this is the Control panel's own "Debug"
 * tab, reached the same way every other tab is. */
export function DecisionLogTab({ dataset }: DecisionLogTabProps) {
  const [kindFilter, setKindFilter] = useState<DecisionLogKind | "all">("all");
  const [search, setSearch] = useState("");
  const [refreshTick, setRefreshTick] = useState(0);

  const addressByEgid = useMemo(() => new Map(dataset.buildings.map((b) => [b.egid, b.address])), [dataset]);

  const allEntries = useMemo(() => {
    void refreshTick;
    return getDecisionLog();
  }, [refreshTick]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return allEntries
      .filter((e) => kindFilter === "all" || e.kind === kindFilter)
      .filter((e) => {
        if (!q) return true;
        const address = (addressByEgid.get(e.egid) ?? "").toLowerCase();
        return e.egid.toLowerCase().includes(q) || address.includes(q);
      })
      .slice()
      .reverse();
  }, [allEntries, kindFilter, search, addressByEgid]);

  const shown = filtered.slice(0, DISPLAY_LIMIT);

  return (
    <div className="panel-typography">
      <h2 style={{ fontSize: 14, marginTop: 0 }}>🐛 Decision log</h2>
      <p style={{ fontSize: 12, color: "#888", margin: "0 0 10px" }}>
        Every stock-renewal/solar-adoption decision actually committed — a development tool for calibration, not something players see.
      </p>

      <div className="decision-log-toolbar">
        <div className="decision-log-filters">
          {KIND_FILTERS.map((k) => (
            <button key={k} className={k === kindFilter ? "active" : ""} onClick={() => setKindFilter(k)}>
              {k === "all" ? "All" : KIND_LABEL[k]}
            </button>
          ))}
        </div>
        <input
          type="text"
          placeholder="Search address or EGID…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="decision-log-search"
        />
        <button onClick={() => setRefreshTick((t) => t + 1)}>↻ Refresh</button>
        <button onClick={() => downloadJSON(allEntries)} disabled={allEntries.length === 0}>
          ⬇ Export JSON ({allEntries.length})
        </button>
        <button
          onClick={() => {
            clearDecisionLog();
            setRefreshTick((t) => t + 1);
          }}
          disabled={allEntries.length === 0}
        >
          Clear
        </button>
      </div>

      <p style={{ fontSize: 11, color: "#898781", margin: "6px 0" }}>
        {filtered.length === 0
          ? "No matching decisions yet."
          : `Showing ${shown.length} of ${filtered.length} matching (${allEntries.length} total, most recent first)${
              filtered.length > DISPLAY_LIMIT ? " — export for the full set" : ""
            }.`}
      </p>

      <div className="decision-log-list">
        {shown.map((entry) => (
          <EntryRow key={entry.seq} entry={entry} address={addressByEgid.get(entry.egid) ?? null} />
        ))}
      </div>
    </div>
  );
}
