import { useState } from "react";
import "./historyChart.css";
import "./periodBarChart.css";

export interface BarSeries {
  key: string;
  label: string;
  color: string;
  values: number[]; // aligned with `labels`, one per bar
}

export interface PeriodBarChartProps {
  labels: string[];
  series: BarSeries[]; // one series = plain bars; more than one = stacked
  formatValue: (v: number) => string;
}

const WIDTH = 280;
const HEIGHT = 140;
const PAD = { left: 40, right: 8, top: 10, bottom: 18 };

function niceMax(value: number): number {
  if (value <= 0) return 100;
  const magnitude = 10 ** Math.floor(Math.log10(value));
  const normalized = value / magnitude;
  const step = normalized <= 1 ? 1 : normalized <= 2 ? 2 : normalized <= 5 ? 5 : 10;
  return step * magnitude;
}

export function PeriodBarChart({ labels, series, formatValue }: PeriodBarChartProps) {
  const [hoverIndex, setHoverIndex] = useState<number | null>(null);

  if (labels.length === 0 || series.length === 0) return null;

  const n = labels.length;
  const totals = labels.map((_, i) => series.reduce((sum, s) => sum + Math.max(0, s.values[i] ?? 0), 0));
  const maxTotal = niceMax(Math.max(1, ...totals));

  const plotW = WIDTH - PAD.left - PAD.right;
  const plotH = HEIGHT - PAD.top - PAD.bottom;
  const groupW = plotW / n;
  const barW = Math.max(2, groupW * 0.6);

  const yScale = (v: number) => plotH - (v / maxTotal) * plotH;
  const gridValues = [0, maxTotal / 2, maxTotal];
  const isStacked = series.length > 1;
  const detailIndex = hoverIndex ?? n - 1;

  return (
    <div className="period-bar-chart">
      {isStacked && (
        <div className="history-chart-legend">
          {series.map((s) => (
            <span key={s.key} className="legend-item">
              <span className="legend-line" style={{ background: s.color }} />
              {s.label}
            </span>
          ))}
        </div>
      )}
      <svg viewBox={`0 0 ${WIDTH} ${HEIGHT}`} className="period-bar-chart-svg">
        <g transform={`translate(${PAD.left},${PAD.top})`}>
          {gridValues.map((v) => (
            <g key={v}>
              <line x1={0} x2={plotW} y1={yScale(v)} y2={yScale(v)} className="grid-line" />
              <text x={-4} y={yScale(v) + 3} textAnchor="end" className="axis-label">
                {formatValue(v)}
              </text>
            </g>
          ))}

          {labels.map((label, i) => {
            const x = i * groupW + (groupW - barW) / 2;
            let cumulative = 0;
            return (
              <g
                key={label + i}
                onPointerEnter={() => setHoverIndex(i)}
                onPointerLeave={() => setHoverIndex(null)}
                className={i === hoverIndex ? "bar-group hovered" : "bar-group"}
              >
                <rect x={i * groupW} y={0} width={groupW} height={plotH} fill="transparent" />
                {series.map((s) => {
                  const v = Math.max(0, s.values[i] ?? 0);
                  const y0 = yScale(cumulative);
                  cumulative += v;
                  const y1 = yScale(cumulative);
                  return (
                    <rect key={s.key} x={x} y={y1} width={barW} height={Math.max(0, y0 - y1)} fill={s.color} className="bar-segment" />
                  );
                })}
                <text x={i * groupW + groupW / 2} y={plotH + 13} textAnchor="middle" className="axis-label">
                  {label}
                </text>
              </g>
            );
          })}
        </g>
      </svg>

      <div className="bar-chart-detail">
        <span className="bar-chart-detail-label">{labels[detailIndex]}</span>
        {series.map((s) => (
          <span key={s.key} className="bar-chart-detail-row">
            <span className="legend-line" style={{ background: s.color }} />
            {isStacked && <span className="bar-chart-detail-name">{s.label}</span>}
            <span className="bar-chart-detail-value">{formatValue(s.values[detailIndex] ?? 0)}</span>
          </span>
        ))}
      </div>
    </div>
  );
}
