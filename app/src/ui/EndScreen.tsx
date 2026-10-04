import type { GameOver } from "../sim/approval";
import { BASELINE_YEAR, formatDate } from "../sim/calendar";
import { NET_ZERO_TARGET_YEAR, scoreSoFar } from "../sim/score";
import { parThrough, parYears } from "../sim/par";
import { ScoreChart } from "./ScoreChart";
import "./reportCard.css";
import "./endScreen.css";

/** The end of a run: voted out or recalled (`over`), or 2050 done. The score so far stands — the
 * years a defeat cut short score nothing. */
export function EndScreen({ municipality, over, onMainMenu, onKeepPlaying }: { municipality: string; over: GameOver | null; onMainMenu: () => void; onKeepPlaying?: () => void }) {
  const score = scoreSoFar();
  const par = parThrough(NET_ZERO_TARGET_YEAR);
  const total = Math.round(score.total);
  const vsPar = par === null ? null : total - Math.round(par);
  const last = score.years[score.years.length - 1];
  const cut = last ? Math.round(last.points) : null;

  const headline = over
    ? over.headline
    : score.netZeroYear !== null
      ? `Net zero in ${score.netZeroYear}`
      : `${NET_ZERO_TARGET_YEAR}: not yet net zero`;
  const lede = over
    ? over.text
    : score.netZeroYear !== null
      ? `${municipality} reached net zero ${NET_ZERO_TARGET_YEAR - score.netZeroYear > 0 ? `${NET_ZERO_TARGET_YEAR - score.netZeroYear} years ahead of the deadline` : "just in time"}.`
      : `${municipality} cut its emissions per resident by ${cut ?? 0}% against ${BASELINE_YEAR}, but some remain.`;

  return (
    <div className="end-screen" role="dialog" aria-label="The end of the run">
      <div className="yr-page">
        <header className="yr-head">
          <div>
            <div className="yr-kicker">
              {over ? "Game over" : "The end"} · {municipality}
            </div>
            <h1 className={`end-headline${over ? " lost" : score.netZeroYear !== null ? " won" : ""}`}>{headline}</h1>
            <p>
              {over && <>{formatDate(over.atMs)} — </>}
              {lede}
            </p>
          </div>
        </header>

        <div className="yr-figures">
          <section>
            <h3>Score</h3>
            <div className="yr-value">{total}</div>
            <div className="yr-detail">
              {score.years.length} year{score.years.length === 1 ? "" : "s"} scored{over ? "; the rest score nothing" : ""}
            </div>
          </section>
          <section>
            <h3>Against par</h3>
            <div className={`yr-value${vsPar === null ? "" : vsPar >= 0 ? " good" : " bad"}`}>{vsPar === null ? "—" : `${vsPar >= 0 ? "+" : "−"}${Math.abs(vsPar)}`}</div>
            <div className="yr-detail">{par === null ? "No par for this town yet" : `Doing nothing scores ${Math.round(par)}`}</div>
          </section>
          <section>
            <h3>Net zero</h3>
            <div className="yr-value">{score.netZeroYear ?? "—"}</div>
            <div className="yr-detail">{score.netZeroYear !== null ? "The goal, reached" : `Not reached by ${last?.year ?? BASELINE_YEAR}`}</div>
          </section>
          <section>
            <h3>CO₂ per resident</h3>
            <div className="yr-value">{last ? `${(last.perResidentKg / 1000).toLocaleString("de-CH", { maximumFractionDigits: 2, minimumFractionDigits: 2 })} t` : "—"}</div>
            <div className="yr-detail">
              {score.baselinePerResidentKg !== null
                ? `${(score.baselinePerResidentKg / 1000).toLocaleString("de-CH", { maximumFractionDigits: 2, minimumFractionDigits: 2 })} t in ${BASELINE_YEAR}`
                : ""}
            </div>
          </section>
        </div>

        <section className="yr-card end-chart">
          <h2>The cut, year by year</h2>
          <p className="yr-note" style={{ margin: "-6px 0 12px" }}>
            Each year scores its cut in emissions per resident against {BASELINE_YEAR}; the score is the area under your line.
          </p>
          <ScoreChart years={score.years} par={parYears()} firstYear={BASELINE_YEAR + 1} lastYear={NET_ZERO_TARGET_YEAR} />
        </section>

        <div className="end-actions">
          {onKeepPlaying && (
            <button className="end-secondary" onClick={onKeepPlaying}>
              Keep exploring the town
            </button>
          )}
          <button className="yr-close" onClick={onMainMenu}>
            Main menu
          </button>
        </div>
      </div>
    </div>
  );
}
