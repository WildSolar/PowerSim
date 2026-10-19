import { useState } from "react";
import type { ChartData } from "./charts";
import "./timeChart.css";

const W = 960;
const H = 320;
const PAD = { left: 56, right: 16, top: 26, bottom: 28 };

/** A round step for about `count` ticks over `span`. */
function niceStep(span: number, count: number): number {
  const raw = span / count;
  const mag = 10 ** Math.floor(Math.log10(raw));
  const f = raw / mag;
  return (f <= 1 ? 1 : f <= 2 ? 2 : f <= 2.5 ? 2.5 : f <= 5 ? 5 : 10) * mag;
}

export function formatValue(v: number): string {
  const a = Math.abs(v);
  const digits = a >= 100 || a === 0 ? 0 : a >= 10 ? 1 : 2;
  return v.toLocaleString("de-CH", { minimumFractionDigits: digits, maximumFractionDigits: digits });
}

/** A chart over time, in the style of the end-of-game score chart: stacked areas (or bars, for
 * yearly values) with lines on top, a crosshair and a tooltip on hover, and a legend. */
export function TimeChart({ data, emptyText }: { data: ChartData; emptyText: string }) {
  const [hover, setHover] = useState<number | null>(null);
  const n = data.xs.length;
  const stacks = data.series.filter((s) => s.kind === "stack");
  const lines = data.series.filter((s) => s.kind === "line");

  // Cumulative tops of the stack, per point.
  const tops: number[][] = [];
  stacks.forEach((s, j) => tops.push(data.xs.map((_, i) => (j > 0 ? tops[j - 1][i] : 0) + (s.values[i] ?? 0))));
  const lineValues = lines.flatMap((s) => s.values.filter((v): v is number => v !== null));
  const maxData = Math.max(0, ...(tops.length ? tops[tops.length - 1] : []), ...lineValues, data.reference?.value ?? 0);
  const minData = Math.min(0, ...lineValues, ...stacks.flatMap((s) => s.values.filter((v): v is number => v !== null)));
  const range = (data.yMax ?? maxData) - minData;
  const step = Math.max(data.integer ? 1 : 0, niceStep(range > 0 ? range : 1, 5));
  const yMin = Math.floor(minData / step) * step;
  const yMax = data.yMax ?? (maxData > 0 ? Math.ceil(maxData / step) * step : 5 * step);
  // As many decimals as the step has (2.5 needs one), so no tick is rounded onto its neighbour's.
  const stepDigits = (String(Number(step.toPrecision(6))).split(".")[1] ?? "").length;
  const yTicks: number[] = [];
  for (let t = yMin; t <= yMax + step / 2; t += step) yTicks.push(Number(t.toPrecision(10)));

  const span = Math.max(1e-6, data.to - data.from);
  const x = (v: number) => PAD.left + ((v - data.from) / span) * (W - PAD.left - PAD.right);
  const y = (v: number) => PAD.top + ((yMax - v) / (yMax - yMin)) * (H - PAD.top - PAD.bottom);
  const yearStep = span > 16 ? 5 : span > 8 ? 2 : 1;
  const yearTicks: { x: number; label: string }[] = [];
  if (data.xTicks) yearTicks.push(...data.xTicks);
  else for (let t = Math.ceil(data.from); t <= data.to; t++) if (t === data.from || t === data.to || t % yearStep === 0) yearTicks.push({ x: t, label: String(t) });

  const areaPath = (j: number) => {
    const top = tops[j];
    const bottom = j > 0 ? tops[j - 1] : data.xs.map(() => 0);
    const up = data.xs.map((xv, i) => `${i ? "L" : "M"}${x(xv).toFixed(1)},${y(top[i]).toFixed(1)}`).join(" ");
    const down = [...data.xs.keys()].reverse().map((i) => `L${x(data.xs[i]).toFixed(1)},${y(bottom[i]).toFixed(1)}`).join(" ");
    return `${up} ${down} Z`;
  };
  const linePath = (values: (number | null)[]) =>
    data.xs
      .map((xv, i) => [xv, values[i]] as const)
      .filter(([, v]) => v !== null)
      .map(([xv, v], i) => `${i ? "L" : "M"}${x(xv).toFixed(1)},${y(v!).toFixed(1)}`)
      .join(" ");
  const barWidth = data.bars ? Math.max(4, ((W - PAD.left - PAD.right) / span) * 0.6) : 0;
  const dots = n <= 15;

  // Hover: each point owns the band halfway to its neighbours.
  const bands = data.xs.map((xv, i) => {
    const left = i > 0 ? (x(data.xs[i - 1]) + x(xv)) / 2 : Math.max(PAD.left, x(xv) - 20);
    const right = i < n - 1 ? (x(xv) + x(data.xs[i + 1])) / 2 : Math.min(W - PAD.right, x(xv) + 20);
    return { left, width: Math.max(1, right - left) };
  });
  const hovered = hover !== null && hover < n ? hover : null;
  // The marked moments within the hovered point's band.
  const hoveredEvents =
    hovered !== null
      ? (data.events ?? []).filter((e) => (hovered === 0 || e.x >= (data.xs[hovered - 1] + data.xs[hovered]) / 2) && (hovered === n - 1 || e.x < (data.xs[hovered] + data.xs[hovered + 1]) / 2))
      : [];
  const tipLeft = hovered !== null ? Math.min(85, Math.max(15, (x(data.xs[hovered]) / W) * 100)) : 0;

  return (
    <figure className="time-chart">
      <div className="time-chart-legend">
        {data.series
          .filter((s) => s.kind !== "hidden")
          .map((s) => (
            <span key={s.key}>
              <i className={s.kind === "stack" ? "swatch" : s.dashed ? "line dashed" : "line"} style={s.kind === "stack" ? { background: s.color } : { borderColor: s.color }} />
              {s.label}
            </span>
          ))}
        {data.reference && (
          <span>
            <i className="line dashed" style={{ borderColor: "var(--ink-3)" }} />
            {data.reference.label}
          </span>
        )}
        {data.events && data.events.length > 0 && (
          <span>
            <i className="event" />
            {data.eventsLabel ?? "Events"}
          </span>
        )}
      </div>
      <div className="time-chart-plot">
        <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label={data.series.map((s) => s.label).join(", ")}>
          <text className="unit" x={PAD.left - 8} y={11} textAnchor="end">
            {data.unit}
          </text>
          {yTicks.map((t) => (
            <g key={t}>
              <line className={t === 0 ? "zero" : "grid"} x1={PAD.left} x2={W - PAD.right} y1={y(t)} y2={y(t)} />
              <text className="tick" x={PAD.left - 8} y={y(t) + 3} textAnchor="end">
                {t.toLocaleString("de-CH", { maximumFractionDigits: stepDigits })}
              </text>
            </g>
          ))}
          {yearTicks.map((t) => (
            <text key={t.x} className="tick" x={x(t.x)} y={H - 8} textAnchor="middle">
              {t.label}
            </text>
          ))}
          {n > 0 &&
            !data.bars &&
            stacks.map((s, j) =>
              n === 1 ? (
                <rect key={s.key} className="bar" x={x(data.xs[0]) - 6} width={12} y={y(tops[j][0])} height={Math.max(0, y(j > 0 ? tops[j - 1][0] : 0) - y(tops[j][0]))} style={{ fill: s.color }} />
              ) : (
                <path key={s.key} className="area" d={areaPath(j)} style={{ fill: s.color }} />
              ),
            )}
          {data.bars &&
            data.xs.map((xv, i) =>
              stacks.map((s, j) => {
                const top = y(tops[j][i]);
                const bottom = y(j > 0 ? tops[j - 1][i] : 0);
                return bottom - top > 0.5 ? <rect key={`${s.key}-${i}`} className="bar" x={x(xv) - barWidth / 2} width={barWidth} y={top} height={bottom - top} style={{ fill: s.color }} /> : null;
              }),
            )}
          {(data.events ?? [])
            .filter((e) => e.x >= data.from && e.x <= data.to)
            .map((e, i) => (
              <g key={i} className="event">
                <line x1={x(e.x)} x2={x(e.x)} y1={PAD.top} y2={H - PAD.bottom} />
                <path d={`M${x(e.x) - 4},${PAD.top - 9} L${x(e.x) + 4},${PAD.top - 9} L${x(e.x)},${PAD.top - 2} Z`} />
              </g>
            ))}
          {data.reference && <line className="reference" x1={PAD.left} x2={W - PAD.right} y1={y(data.reference.value)} y2={y(data.reference.value)} />}
          {lines.map((s) => (
            <g key={s.key}>
              <path className={`line${s.dashed ? " dashed" : ""}`} d={linePath(s.values)} style={{ stroke: s.color }} />
              {dots &&
                data.xs.map((xv, i) => (s.values[i] === null ? null : <circle key={i} className="dot" cx={x(xv)} cy={y(s.values[i]!)} r={3.5} style={{ fill: s.color }} />))}
            </g>
          ))}
          {hovered !== null && <line className="crosshair" x1={x(data.xs[hovered])} x2={x(data.xs[hovered])} y1={PAD.top} y2={H - PAD.bottom} />}
          {bands.map((b, i) => (
            <rect key={i} className="hit" x={b.left} y={PAD.top} width={b.width} height={H - PAD.top - PAD.bottom} onMouseEnter={() => setHover(i)} onMouseLeave={() => setHover(null)} />
          ))}
        </svg>
        {n === 0 && <p className="time-chart-empty">{emptyText}</p>}
        {hovered !== null && (
          <div className="time-chart-tip" style={{ left: `${tipLeft}%` }}>
            <strong>{data.xLabels[hovered]}</strong>
            {[...data.series]
              .filter((s) => s.values[hovered] !== null && (s.kind === "line" || s.values[hovered] !== 0))
              .sort((a, b) => (a.kind === "stack" && b.kind === "stack" ? stacks.indexOf(b) - stacks.indexOf(a) : 0))
              .map((s) => (
                <span key={s.key}>
                  {s.kind !== "hidden" && <i style={{ background: s.color }} />}
                  {s.label}: {formatValue(s.values[hovered]!)} {s.kind === "hidden" ? "" : data.unit}
                </span>
              ))}
            {data.total && stacks.length > 1 && (
              <span className="total">
                {data.total}: {formatValue(tops[tops.length - 1][hovered])} {data.unit}
              </span>
            )}
            {hoveredEvents.map((e, i) => (
              <span key={`e${i}`} className="event">
                {e.label}
              </span>
            ))}
          </div>
        )}
      </div>
    </figure>
  );
}
