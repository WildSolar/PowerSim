import { useState } from "react";
import { toSimTimeMs } from "../sim/calendar";
import { dynamicPriceRpKWh } from "../sim/dynamicTariff";
import type { TariffSheet } from "../sim/tariff";

const W = 320;
const H = 132;
const PAD = { left: 28, right: 16, top: 8, bottom: 20 };
const STEPS = 96; // every 15 minutes
const HOUR_MS = 3_600_000;

function touPrice(sheet: TariffSheet, hour: number): number {
  return hour >= sheet.offPeakStartHour || hour < sheet.offPeakEndHour ? sheet.offPeakPriceRpKWh : sheet.peakPriceRpKWh;
}

/** A day of dynamic prices under a sheet: a winter and a summer day of `year`, against the
 * time-of-use tariff they replace. */
export function DynamicPriceChart({ sheet, year }: { sheet: TariffSheet; year: number }) {
  const [hover, setHover] = useState<number | null>(null);
  const dayStart = (month: number) => toSimTimeMs(Date.UTC(year, month, 15));
  const hours = Array.from({ length: STEPS + 1 }, (_, i) => (i * 24) / STEPS);
  const winter = hours.map((h) => dynamicPriceRpKWh(sheet, dayStart(0) + h * HOUR_MS));
  const summer = hours.map((h) => dynamicPriceRpKWh(sheet, dayStart(6) + h * HOUR_MS));
  const tou = hours.map((h) => touPrice(sheet, h % 24));

  const all = [...winter, ...summer, ...tou];
  const lo = Math.max(0, Math.floor((Math.min(...all) - 2) / 5) * 5);
  const hi = Math.ceil((Math.max(...all) + 2) / 5) * 5;
  const x = (h: number) => PAD.left + (h / 24) * (W - PAD.left - PAD.right);
  const y = (v: number) => PAD.top + (1 - (v - lo) / (hi - lo)) * (H - PAD.top - PAD.bottom);
  const path = (values: number[]) => values.map((v, i) => `${i === 0 ? "M" : "L"}${x(hours[i]).toFixed(1)},${y(v).toFixed(1)}`).join("");
  const ticks = [lo, (lo + hi) / 2, hi];

  const onMove = (e: React.PointerEvent<SVGSVGElement>) => {
    const rect = e.currentTarget.getBoundingClientRect();
    const h = (((e.clientX - rect.left) / rect.width) * W - PAD.left) / (W - PAD.left - PAD.right) * 24;
    setHover(h < 0 || h > 24 ? null : Math.round(h * 4) / 4);
  };
  const i = hover === null ? -1 : Math.round((hover / 24) * STEPS);
  const clock = (h: number) => `${String(Math.floor(h) % 24).padStart(2, "0")}:${String(Math.round((h % 1) * 60)).padStart(2, "0")}`;

  return (
    <figure className="dyn-chart">
      <div className="dyn-chart-legend" aria-hidden>
        <span>
          <i className="winter" />
          Winter day
        </span>
        <span>
          <i className="summer" />
          Summer day
        </span>
        <span>
          <i className="tou" />
          Time-of-use
        </span>
      </div>
      <div className="dyn-chart-plot">
        <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label="Dynamic electricity price over a winter and a summer day, in Rp/kWh" onPointerMove={onMove} onPointerLeave={() => setHover(null)}>
          {ticks.map((t) => (
            <g key={t}>
              <line className="grid" x1={PAD.left} x2={W - PAD.right} y1={y(t)} y2={y(t)} />
              <text className="tick" x={PAD.left - 4} y={y(t) + 3} textAnchor="end">
                {Math.round(t)}
              </text>
            </g>
          ))}
          {[0, 6, 12, 18, 24].map((h) => (
            <text key={h} className="tick" x={x(h)} y={H - 6} textAnchor={h === 24 ? "end" : "middle"}>
              {String(h).padStart(2, "0")}:00
            </text>
          ))}
          <path className="tou" d={path(tou)} />
          <path className="summer" d={path(summer)} />
          <path className="winter" d={path(winter)} />
          {i >= 0 && <line className="cross" x1={x(hours[i])} x2={x(hours[i])} y1={PAD.top} y2={H - PAD.bottom} />}
          {i >= 0 && (
            <>
              <circle className="winter-dot" cx={x(hours[i])} cy={y(winter[i])} r={3} />
              <circle className="summer-dot" cx={x(hours[i])} cy={y(summer[i])} r={3} />
            </>
          )}
        </svg>
        {i >= 0 && (
          <div className="dyn-chart-tip" style={{ left: `${(x(hours[i]) / W) * 100}%` }}>
            <strong>{clock(hours[i])}</strong>
            <span>Winter {winter[i].toFixed(1)}</span>
            <span>Summer {summer[i].toFixed(1)}</span>
            <span>Time-of-use {tou[i].toFixed(0)}</span>
          </div>
        )}
      </div>
      <figcaption className="tech-prices-note">Rp/kWh through the day, by the rule set for {year}.</figcaption>
    </figure>
  );
}
