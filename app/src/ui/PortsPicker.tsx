import { formatCHF } from "./format";
import "./evChargingPanel.css";

/** Choosing how many charge points to build, or to add to a site: a slider from `min` to `max`, with
 * what that costs (`costRp`, for the `buying` points it adds), the price per point and how long it
 * takes — then the order button, worded by the caller. */
export function PortsPicker({
  value,
  min,
  max,
  buying,
  costRp,
  months,
  onChange,
  onOrder,
  orderLabel,
}: {
  value: number;
  min: number;
  max: number;
  buying: number;
  costRp: number;
  months: number;
  onChange: (points: number) => void;
  onOrder: () => void;
  orderLabel: string;
}) {
  return (
    <div className="ports-picker">
      <label className="ports-picker-row">
        <span className="ports-picker-count">
          {value} point{value === 1 ? "" : "s"}
        </span>
        <input type="range" min={min} max={max} step={1} value={value} onChange={(e) => onChange(Number(e.target.value))} aria-label="Charge points" />
      </label>
      <span className="ev-build-detail">
        {formatCHF(costRp)} · {formatCHF(costRp / Math.max(1, buying))} a point · {months} months
      </span>
      <div className="dh-actions">
        <button className="dh-order" onClick={onOrder}>
          {orderLabel}
        </button>
      </div>
    </div>
  );
}
