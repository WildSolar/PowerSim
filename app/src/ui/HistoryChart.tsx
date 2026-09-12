import { useRef, useState } from "react";
import { formatWatts } from "./format";
import "./historyChart.css";

export interface ChartSeries {
  key: string;
  label: string;
  color: string;
  values: number[];
}

export interface HistoryChartProps {
  times: number[]; // ms, evenly spaced, ascending, same length as each series' values
  series: ChartSeries[];
}

const WIDTH = 280;
const HEIGHT = 120;
const PAD = { left: 36, right: 8, top: 10, bottom: 16 };

function formatOffset(deltaMs: number): string {
  if (deltaMs >= 0) return "now";
  const totalMin = Math.round(-deltaMs / 60_000);
  const h = Math.floor(totalMin / 60);
  const m = totalMin % 60;
  if (h > 0 && m > 0) return `-${h}h${m}m`;
  if (h > 0) return `-${h}h`;
  return `-${m}m`;
}

function niceMax(value: number): number {
  if (value <= 0) return 100;
  const magnitude = 10 ** Math.floor(Math.log10(value));
  const normalized = value / magnitude;
  const step = normalized <= 1 ? 1 : normalized <= 2 ? 2 : normalized <= 5 ? 5 : 10;
  return step * magnitude;
}

export function HistoryChart({ times, series }: HistoryChartProps) {
  const svgRef = useRef<SVGSVGElement | null>(null);
  const [hover, setHover] = useState<{ index: number; px: number; py: number } | null>(null);

  if (times.length < 2 || series.length === 0) return null;

  const maxValue = niceMax(Math.max(1, ...series.flatMap((s) => s.values)));
  const t0 = times[0];
  const t1 = times[times.length - 1];
  const plotW = WIDTH - PAD.left - PAD.right;
  const plotH = HEIGHT - PAD.top - PAD.bottom;

  const xScale = (t: number) => PAD.left + ((t - t0) / (t1 - t0)) * plotW;
  const yScale = (v: number) => HEIGHT - PAD.bottom - (v / maxValue) * plotH;

  const pathFor = (values: number[]) =>
    values.map((v, i) => `${i === 0 ? "M" : "L"} ${xScale(times[i]).toFixed(1)} ${yScale(v).toFixed(1)}`).join(" ");

  const handleMove = (e: React.PointerEvent<SVGRectElement>) => {
    const svg = svgRef.current;
    if (!svg) return;
    const rect = svg.getBoundingClientRect();
    const px = e.clientX - rect.left;
    const xData = (px / rect.width) * WIDTH;
    const frac = Math.min(1, Math.max(0, (xData - PAD.left) / plotW));
    const index = Math.round(frac * (times.length - 1));
    setHover({ index, px, py: e.clientY - rect.top });
  };

  const gridFractions = [0, 0.5, 1];
  const lastIndex = times.length - 1;

  return (
    <div className="history-chart">
      {series.length > 1 && (
        <div className="history-chart-legend">
          {series.map((s) => (
            <span key={s.key} className="legend-item">
              <span className="legend-line" style={{ background: s.color }} />
              {s.label}
            </span>
          ))}
        </div>
      )}
      <svg ref={svgRef} viewBox={`0 0 ${WIDTH} ${HEIGHT}`} className="history-chart-svg">
        {gridFractions.map((f) => {
          const y = HEIGHT - PAD.bottom - f * plotH;
          return (
            <g key={f}>
              <line x1={PAD.left} x2={WIDTH - PAD.right} y1={y} y2={y} className="grid-line" />
              <text x={PAD.left - 4} y={y + 3} textAnchor="end" className="axis-label">
                {formatWatts(maxValue * f)}
              </text>
            </g>
          );
        })}

        {series.map((s) => (
          <path key={s.key} d={pathFor(s.values)} stroke={s.color} className="series-line" />
        ))}

        {series.map((s) => (
          <circle
            key={s.key}
            cx={xScale(times[lastIndex])}
            cy={yScale(s.values[lastIndex])}
            r={4}
            fill={s.color}
            className="end-dot"
          />
        ))}
        {series.length === 1 && (
          <text
            x={xScale(times[lastIndex]) - 6}
            y={yScale(series[0].values[lastIndex]) - 8}
            textAnchor="end"
            className="end-label"
          >
            {formatWatts(series[0].values[lastIndex])}
          </text>
        )}

        <text x={PAD.left} y={HEIGHT - 3} className="axis-label">
          -24h
        </text>
        <text x={WIDTH - PAD.right} y={HEIGHT - 3} textAnchor="end" className="axis-label">
          now
        </text>

        {hover && (
          <>
            <line
              x1={xScale(times[hover.index])}
              x2={xScale(times[hover.index])}
              y1={PAD.top}
              y2={HEIGHT - PAD.bottom}
              className="crosshair"
            />
            {series.map((s) => (
              <circle
                key={s.key}
                cx={xScale(times[hover.index])}
                cy={yScale(s.values[hover.index])}
                r={4}
                fill={s.color}
                className="hover-dot"
              />
            ))}
          </>
        )}

        <rect
          x={PAD.left}
          y={PAD.top}
          width={plotW}
          height={plotH}
          fill="transparent"
          onPointerMove={handleMove}
          onPointerLeave={() => setHover(null)}
        />
      </svg>

      {hover && (
        <div className="chart-tooltip" style={{ left: hover.px, top: hover.py }}>
          <div className="tooltip-time">{formatOffset(times[hover.index] - t1)}</div>
          {series.map((s) => (
            <div key={s.key} className="tooltip-row">
              <span className="legend-line" style={{ background: s.color }} />
              <span className="tooltip-label">{s.label}</span>
              <span className="tooltip-value">{formatWatts(s.values[hover.index])}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
