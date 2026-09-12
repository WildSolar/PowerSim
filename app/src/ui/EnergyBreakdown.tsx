import type { CategoryEnergyKWh } from "../sim/energy";
import { DEVICE_CATEGORIES } from "./deviceCategories";
import { formatKWh } from "./format";
import "./energyBreakdown.css";

export interface EnergyBreakdownProps {
  energy: CategoryEnergyKWh;
  /** Categories below this are hidden — filters out near-zero noise rather than
   * cluttering the list with devices that barely ran (or don't exist here at all,
   * e.g. a building with no heat pump reads as ~0 rather than needing its own flag). */
  minKWh?: number;
}

export function EnergyBreakdown({ energy, minKWh = 0.01 }: EnergyBreakdownProps) {
  const rows = DEVICE_CATEGORIES.filter((c) => energy[c.key] >= minKWh);
  if (rows.length === 0) {
    return <p style={{ fontSize: 12, color: "#888", margin: "4px 0" }}>No measurable draw over the last 24h.</p>;
  }

  const maxKWh = Math.max(...rows.map((c) => energy[c.key]));
  const consumptionKWh = DEVICE_CATEGORIES.filter((c) => c.key !== "solar").reduce((sum, c) => sum + energy[c.key], 0);
  const netKWh = consumptionKWh - energy.solar;

  return (
    <div className="energy-breakdown">
      {rows.map((c) => {
        const value = energy[c.key];
        const isSolar = c.key === "solar";
        return (
          <div className="energy-row" key={c.key}>
            <div className="energy-row-header">
              <span className="energy-label">
                {c.icon} {c.label}
              </span>
              <span className={`energy-value${isSolar ? " energy-credit" : ""}`}>
                {isSolar ? "-" : ""}
                {formatKWh(value)}
              </span>
            </div>
            <div className="energy-bar-track">
              <div className="energy-bar-fill" style={{ width: `${(value / maxKWh) * 100}%`, background: c.color }} />
            </div>
          </div>
        );
      })}
      <div className="total-row">
        <span>Net total — last 24h</span>
        <span>{formatKWh(netKWh)}</span>
      </div>
    </div>
  );
}
