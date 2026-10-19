import { useState } from "react";
import type { Difficulty } from "../config/difficulty";
import { buildSubmission, LEADERBOARD_ENABLED, lastName, rememberSubmission, runBoard, runEligible, submitRun, submittedEntryId } from "../leaderboard/client";
import { NAME_MAX, nameProblem, type SubmitResult } from "../leaderboard/rules";
import type { GameOver } from "../sim/approval";
import { getRunId } from "../sim/score";
import { LeaderboardPanel } from "./LeaderboardPanel";
import "./leaderboard.css";
import { BASELINE_YEAR, formatDate } from "../sim/calendar";
import { NET_ZERO_TARGET_YEAR, scoreSoFar } from "../sim/score";
import { parThrough, parYears } from "../sim/par";
import { ScoreChart } from "./ScoreChart";
import "./reportCard.css";
import "./endScreen.css";

/** The end of a run: voted out or recalled (`over`), or 2050 done. The score so far stands — the
 * years a defeat cut short score nothing. */
export function EndScreen({
  municipality,
  slug,
  difficulty,
  over,
  onMainMenu,
  onKeepPlaying,
}: {
  municipality: string;
  slug: string;
  difficulty: Difficulty;
  over: GameOver | null;
  onMainMenu: () => void;
  onKeepPlaying?: () => void;
}) {
  const score = scoreSoFar();
  const par = parThrough(NET_ZERO_TARGET_YEAR);
  const total = Math.round(score.total);
  const vsPar = par === null ? null : total - Math.round(par);
  // The last year actually played (after finishing early, the rest only count).
  const played = score.years.filter((y) => !y.projected);
  const counted = score.years.length - played.length;
  const last = played[played.length - 1];
  const cut = last ? Math.round(last.points) : null;

  const headline = over
    ? over.headline
    : score.netZeroYear !== null
      ? `Net zero in ${score.netZeroYear}`
      : `${NET_ZERO_TARGET_YEAR}: not yet net zero`;
  const lede = over
    ? over.text
    : score.finishedYear !== null && score.netZeroYear !== null
      ? `${municipality} reached net zero ${NET_ZERO_TARGET_YEAR - score.netZeroYear} years ahead of the deadline, and handed over at the end of ${score.finishedYear} with its books in order. The years left until ${NET_ZERO_TARGET_YEAR} count in full.`
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
              {played.length} year{played.length === 1 ? "" : "s"} scored
              {counted > 0 ? `, ${counted} more counted in full` : ""}
              {over ? "; the rest score nothing" : ""}
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

        {LEADERBOARD_ENABLED && <SubmitRun municipality={municipality} slug={slug} difficulty={difficulty} over={over !== null} />}

        <div className="end-actions">
          {onKeepPlaying && (
            <button className="end-secondary" onClick={onKeepPlaying}>
              {score.finishedYear !== null ? "Keep exploring (the score stays)" : "Keep exploring the town"}
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

/** Putting the run on the leaderboard: a name, checked as it is typed, and the run's place. */
function SubmitRun({ municipality, slug, difficulty, over }: { municipality: string; slug: string; difficulty: Difficulty; over: boolean }) {
  const runId = getRunId();
  const [name, setName] = useState(lastName());
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<SubmitResult | null>(null);
  const [already] = useState(() => submittedEntryId(runId) !== null);
  const [showBoard, setShowBoard] = useState(false);
  const board = runBoard(slug, difficulty);
  const eligible = !over && runEligible();
  const problem = name.trim() === "" ? null : nameProblem(name);

  const submit = async () => {
    setBusy(true);
    setError(null);
    try {
      const r = await submitRun(buildSubmission(slug, difficulty, name));
      rememberSubmission(runId, r.id, name.trim());
      setResult(r);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="yr-card">
      <h2>Leaderboard</h2>
      <div className="lb-submit">
        {!eligible ? (
          <p className="lb-submit-note">Only a run that reaches {NET_ZERO_TARGET_YEAR} — or hands over early at net zero — goes on the leaderboard.</p>
        ) : result ? (
          <p className="lb-submit-done">
            On the board: <strong>#{result.rank}</strong> of {result.entries} for {municipality} ({difficulty}, from {board.startYear}, version {board.version}).
          </p>
        ) : already ? (
          <p className="lb-submit-done">This run is on the leaderboard.</p>
        ) : (
          <>
            <p className="lb-submit-note">
              Put this run on the {municipality} board ({difficulty}, from {board.startYear}, version {board.version}) under a name of your choice. What's sent is
              the name and the run's emissions, year by year — nothing else.
            </p>
            <div className="lb-submit-row">
              <input type="text" value={name} maxLength={NAME_MAX + 8} placeholder="Your name" aria-label="Your name" onChange={(e) => setName(e.target.value)} />
              <button className="yr-close" disabled={busy || name.trim() === "" || problem !== null} onClick={submit}>
                {busy ? "Submitting…" : "Submit"}
              </button>
            </div>
            {(problem ?? error) && <span className="lb-submit-problem">{problem ?? error}</span>}
          </>
        )}
        <div>
          <button className="end-secondary" onClick={() => setShowBoard(true)}>
            View the leaderboard
          </button>
        </div>
      </div>
      {showBoard && <LeaderboardPanel initial={board} onClose={() => setShowBoard(false)} />}
    </section>
  );
}
