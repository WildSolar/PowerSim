import { useState } from "react";
import type { ScoredYear } from "../sim/score";
import "./scoreChart.css";

const W = 960;
const H = 260;
const PAD = { left: 44, right: 96, top: 14, bottom: 28 };

/** Each year's cut against the start (the year's points), with par as a reference line. The area
 * under the town's line is the score. */
export function ScoreChart({ years, par, firstYear, lastYear }: { years: ScoredYear[]; par: { year: number; points: number }[] | null; firstYear: number; lastYear: number }) {
  const [hover, setHover] = useState<number | null>(null);
  const values = [...years.map((y) => y.points), ...(par ?? []).map((p) => p.points), 0, 100];
  const yMin = Math.min(0, Math.floor(Math.min(...values) / 10) * 10);
  const yMax = 100;
  const x = (year: number) => PAD.left + ((year - firstYear) / Math.max(1, lastYear - firstYear)) * (W - PAD.left - PAD.right);
  const y = (v: number) => PAD.top + ((yMax - v) / (yMax - yMin)) * (H - PAD.top - PAD.bottom);
  const path = (pts: { year: number; points: number }[]) => pts.map((p, i) => `${i ? "L" : "M"}${x(p.year).toFixed(1)},${y(p.points).toFixed(1)}`).join(" ");
  const area =
    years.length > 0 ? `${path(years)} L${x(years[years.length - 1].year).toFixed(1)},${y(0).toFixed(1)} L${x(years[0].year).toFixed(1)},${y(0).toFixed(1)} Z` : "";
  const ticks = [yMin, ...[0, 25, 50, 75, 100].filter((t) => t > yMin)];
  const yearTicks = [firstYear, ...[2030, 2035, 2040, 2045].filter((t) => t > firstYear && t < lastYear), lastYear];
  const lastOwn = years[years.length - 1];
  // After finishing early, the years left count in full: drawn apart from the played ones.
  const played = years.filter((p) => !p.projected);
  const projected = years.filter((p) => p.projected);
  const lastPlayed = played[played.length - 1];
  const lastPar = par?.[par.length - 1];
  const hovered = hover === null ? null : { own: years.find((y2) => y2.year === hover), par: par?.find((p) => p.year === hover) };

  return (
    <figure className="score-chart">
      <div className="score-chart-legend">
        <span>
          <i className="own" /> Your town
        </span>
        {projected.length > 0 && (
          <span>
            <i className="projected" /> Counted in full
          </span>
        )}
        {par && (
          <span>
            <i className="par" /> Par (doing nothing)
          </span>
        )}
      </div>
      <div className="score-chart-plot">
        <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label="Each year's cut in emissions per resident against the start, in percent, with par">
          {ticks.map((t) => (
            <g key={t}>
              <line className={t === 0 ? "zero" : "grid"} x1={PAD.left} x2={W - PAD.right} y1={y(t)} y2={y(t)} />
              <text className="tick" x={PAD.left - 6} y={y(t) + 3} textAnchor="end">
                {t}%
              </text>
            </g>
          ))}
          {yearTicks.map((t) => (
            <text key={t} className="tick" x={x(t)} y={H - 8} textAnchor="middle">
              {t}
            </text>
          ))}
          {area && <path className="own-area" d={area} />}
          {par && <path className="par-line" d={path(par)} />}
          {played.length > 0 && <path className="own-line" d={path(played)} />}
          {projected.length > 0 && <path className="own-line projected" d={path(lastPlayed ? [lastPlayed, ...projected] : projected)} />}
          {years.map((p) => (
            <circle key={p.year} className={`own-dot${p.projected ? " projected" : ""}`} cx={x(p.year)} cy={y(p.points)} r={4} />
          ))}
          {lastOwn && (
            <text className="end-label own" x={x(lastOwn.year) + 6} y={y(lastOwn.points) + 4}>
              {Math.round(lastOwn.points)}%
            </text>
          )}
          {lastPar && (
            <text className="end-label par" x={x(lastPar.year) + 6} y={y(lastPar.points) + 4}>
              par {Math.round(lastPar.points)}%
            </text>
          )}
          {hover !== null && <line className="crosshair" x1={x(hover)} x2={x(hover)} y1={PAD.top} y2={H - PAD.bottom} />}
          {Array.from({ length: lastYear - firstYear + 1 }, (_, i) => firstYear + i).map((year) => (
            <rect
              key={year}
              className="hit"
              x={x(year) - (W - PAD.left - PAD.right) / (lastYear - firstYear) / 2}
              y={PAD.top}
              width={(W - PAD.left - PAD.right) / (lastYear - firstYear)}
              height={H - PAD.top - PAD.bottom}
              onMouseEnter={() => setHover(year)}
              onMouseLeave={() => setHover(null)}
            />
          ))}
        </svg>
        {hovered && hover !== null && (
          <div className="score-chart-tip" style={{ left: `${(x(hover) / W) * 100}%` }}>
            <strong>{hover}</strong>
            <span>
              Your town: {hovered.own ? `${Math.round(hovered.own.points)}%` : "—"}
              {hovered.own?.projected ? " (counted in full)" : ""}
            </span>
            {par && <span>Par: {hovered.par ? `${Math.round(hovered.par.points)}%` : "—"}</span>}
          </div>
        )}
      </div>
    </figure>
  );
}
