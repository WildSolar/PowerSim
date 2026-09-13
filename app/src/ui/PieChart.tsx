import { useState } from "react";
import { formatKWh } from "./format";
import "./pieChart.css";

export interface PieSlice {
  key: string;
  label: string;
  icon?: string;
  color: string;
  valueKWh: number;
}

export interface PieChartProps {
  title: string;
  slices: PieSlice[];
  /** Slices below this are folded out entirely rather than drawn as a sliver —
   * matches EnergyBreakdown's own near-zero cutoff. */
  minKWh?: number;
}

const SIZE = 150;
const CENTER = SIZE / 2;
const OUTER_R = 58;
const INNER_R = 32;

function arcPoint(angle: number, r: number): [number, number] {
  return [CENTER + r * Math.sin(angle), CENTER - r * Math.cos(angle)];
}

function donutSlicePath(startAngle: number, endAngle: number): string {
  const largeArc = endAngle - startAngle > Math.PI ? 1 : 0;
  const [x0, y0] = arcPoint(startAngle, OUTER_R);
  const [x1, y1] = arcPoint(endAngle, OUTER_R);
  const [x2, y2] = arcPoint(endAngle, INNER_R);
  const [x3, y3] = arcPoint(startAngle, INNER_R);
  return [
    `M ${x0} ${y0}`,
    `A ${OUTER_R} ${OUTER_R} 0 ${largeArc} 1 ${x1} ${y1}`,
    `L ${x2} ${y2}`,
    `A ${INNER_R} ${INNER_R} 0 ${largeArc} 0 ${x3} ${y3}`,
    "Z",
  ].join(" ");
}

/** A donut chart of a set of category slices as a share of their own total —
 * used where the components of a whole matter more than absolute magnitude
 * (see HistoryChart/PeriodBarChart for magnitude-over-time instead). The
 * center reads the total; the legend (always present, never color-only) reads
 * every slice's share, with a hover link between legend row and slice. */
export function PieChart({ title, slices, minKWh = 0.01 }: PieChartProps) {
  const [hoverKey, setHoverKey] = useState<string | null>(null);
  const rows = slices.filter((s) => s.valueKWh >= minKWh);
  const total = rows.reduce((sum, s) => sum + s.valueKWh, 0);

  let cumulative = 0;
  const arcs = rows.map((s) => {
    const startAngle = total > 0 ? (cumulative / total) * Math.PI * 2 : 0;
    cumulative += s.valueKWh;
    const endAngle = total > 0 ? (cumulative / total) * Math.PI * 2 : 0;
    return { ...s, startAngle, endAngle, fraction: total > 0 ? s.valueKWh / total : 0 };
  });

  return (
    <div className="pie-chart">
      <h3 className="pie-chart-title">{title}</h3>
      {rows.length === 0 || total <= 0 ? (
        <p className="pie-chart-empty">No measurable draw.</p>
      ) : (
        <>
          <svg viewBox={`0 0 ${SIZE} ${SIZE}`} className="pie-chart-svg">
            {arcs.map((a) => (
              <path
                key={a.key}
                d={donutSlicePath(a.startAngle, a.endAngle)}
                fill={a.color}
                className={hoverKey && hoverKey !== a.key ? "pie-slice dimmed" : "pie-slice"}
                onPointerEnter={() => setHoverKey(a.key)}
                onPointerLeave={() => setHoverKey(null)}
              >
                <title>
                  {a.label}: {formatKWh(a.valueKWh)} ({(a.fraction * 100).toFixed(1)}%)
                </title>
              </path>
            ))}
            <text x={CENTER} y={CENTER - 4} textAnchor="middle" className="pie-chart-total-value">
              {formatKWh(total)}
            </text>
            <text x={CENTER} y={CENTER + 12} textAnchor="middle" className="pie-chart-total-label">
              total
            </text>
          </svg>
          <div className="pie-chart-legend">
            {arcs.map((a) => (
              <div
                key={a.key}
                className={a.key === hoverKey ? "pie-legend-row hovered" : "pie-legend-row"}
                onPointerEnter={() => setHoverKey(a.key)}
                onPointerLeave={() => setHoverKey(null)}
              >
                <span className="legend-swatch" style={{ background: a.color }} />
                <span className="pie-legend-label">
                  {a.icon} {a.label}
                </span>
                <span className="pie-legend-value">{(a.fraction * 100).toFixed(0)}%</span>
              </div>
            ))}
          </div>
        </>
      )}
    </div>
  );
}
