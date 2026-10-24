import { useState } from "react";
import type { AgriPvKindYear } from "../sim/agriPvProfile";
import "./tariffControl.css";

const W = 320;
const H = 120;
const PAD = { left: 28, right: 16, top: 8, bottom: 20 };

/** A kind of Agri-PV installation through the day: its average summer and winter day, hour by hour,
 * as a share of its rating — up to `top` (a share), the same for every kind, so they compare. */
export function AgriPvDayChart({ kind, label, year, top }: { kind: AgriPvKindYear; label: string; year: number; top: number }) {
  const [hover, setHover] = useState<number | null>(null);
  const hours = Array.from({ length: 24 }, (_, h) => h + 0.5);
  const summer = kind.summerDay.map((v) => v * 100);
  const winter = kind.winterDay.map((v) => v * 100);
  const hi = Math.max(20, Math.ceil((top * 100) / 10) * 10);
  const x = (h: number) => PAD.left + (h / 24) * (W - PAD.left - PAD.right);
  const y = (v: number) => PAD.top + (1 - v / hi) * (H - PAD.top - PAD.bottom);
  const path = (values: number[]) => values.map((v, i) => `${i === 0 ? "M" : "L"}${x(hours[i]).toFixed(1)},${y(v).toFixed(1)}`).join("");
  const ticks = [0, hi / 2, hi];

  const onMove = (e: React.PointerEvent<SVGSVGElement>) => {
    const rect = e.currentTarget.getBoundingClientRect();
    const h = ((((e.clientX - rect.left) / rect.width) * W - PAD.left) / (W - PAD.left - PAD.right)) * 24;
    setHover(h < 0 || h >= 24 ? null : Math.floor(h));
  };

  return (
    <figure className="dyn-chart">
      <div className="dyn-chart-legend" aria-hidden>
        <span>
          <i className="summer" />
          Summer day
        </span>
        <span>
          <i className="winter" />
          Winter day
        </span>
      </div>
      <div className="dyn-chart-plot">
        <svg
          viewBox={`0 0 ${W} ${H}`}
          role="img"
          aria-label={`${label}: output over an average summer and winter day, as a share of its rating`}
          onPointerMove={onMove}
          onPointerLeave={() => setHover(null)}
        >
          {ticks.map((t) => (
            <g key={t}>
              <line className="grid" x1={PAD.left} x2={W - PAD.right} y1={y(t)} y2={y(t)} />
              <text className="tick" x={PAD.left - 4} y={y(t) + 3} textAnchor="end">
                {Math.round(t)}%
              </text>
            </g>
          ))}
          {[0, 6, 12, 18, 24].map((h) => (
            <text key={h} className="tick" x={x(h)} y={H - 6} textAnchor={h === 24 ? "end" : "middle"}>
              {String(h).padStart(2, "0")}:00
            </text>
          ))}
          <path className="winter" d={path(winter)} />
          <path className="summer" d={path(summer)} />
          {hover !== null && <line className="cross" x1={x(hours[hover])} x2={x(hours[hover])} y1={PAD.top} y2={H - PAD.bottom} />}
          {hover !== null && (
            <>
              <circle className="winter-dot" cx={x(hours[hover])} cy={y(winter[hover])} r={3} />
              <circle className="summer-dot" cx={x(hours[hover])} cy={y(summer[hover])} r={3} />
            </>
          )}
        </svg>
        {hover !== null && (
          <div className="dyn-chart-tip" style={{ left: `${(x(hours[hover]) / W) * 100}%` }}>
            <strong>
              {String(hover).padStart(2, "0")}:00–{String(hover + 1).padStart(2, "0")}:00
            </strong>
            <span>Summer {Math.round(summer[hover])}%</span>
            <span>Winter {Math.round(winter[hover])}%</span>
          </div>
        )}
      </div>
      <figcaption className="tech-prices-note">
        Output as a share of its rating, on an average day of June and July, and of December and January, in {year}&apos;s weather.
      </figcaption>
    </figure>
  );
}
