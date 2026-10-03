import { useState, useSyncExternalStore } from "react";
import { formatDate } from "../sim/calendar";
import { MEASURE_CATALOG } from "../sim/measureCatalog";
import { defaultParams, MEASURE_CATEGORY_LABEL, type MeasureCategory, type MeasureDef, type MeasureParams } from "../sim/measureTypes";
import { approval } from "../sim/approval";
import { measures } from "../sim/measures";
import { measureUnavailableReason } from "../sim/measureAvailability";
import { subsidisedDecisions, type SubsidyCategory } from "../sim/additionality";
import { studies } from "../sim/studies";
import { simClock } from "../sim/engine";
import { BLOC_LABEL, BLOC_ORDER } from "../config/approval";
import { EVALUATION_COST_CHF, EVALUATION_LOOKBACK_YEARS, EVALUATION_MONTHS, SURVEY_COST_CHF, SURVEY_MONTHS } from "../config/studies";
import { useSimDay } from "../sim/store";
import { treasury } from "../sim/treasury";
import { formatCHF } from "./format";
import "./measures.css";
import { SupervisionNotice } from "./SupervisionNotice";

const CATEGORY_ORDER: MeasureCategory[] = ["subsidy", "infrastructure", "information", "law"];
const DAY_MS = 24 * 60 * 60_000;
const YEAR_MS = 365.25 * DAY_MS;

function monthYear(simTimeMs: number): string {
  return formatDate(simTimeMs).replace(/^\d+ /, "");
}

function percent(x: number): string {
  return `${Math.round(x * 100)}%`;
}

const SHARED_NOTE: Partial<Record<SubsidyCategory, string>> = {
  vehicle: "All vehicle grants together (electric vehicle grant and scrappage bonus).",
};

/** What a subsidy programme is known to have done: its uptake, always (the treasury pays it, so the
 * municipality knows), and — if it paid for an evaluation — how much of that the money actually
 * changed. */
function SubsidyEvidence({ category, nowMs }: { category: SubsidyCategory; nowMs: number }) {
  const lastYear = subsidisedDecisions(category, nowMs - YEAR_MS, nowMs + DAY_MS);
  const ever = subsidisedDecisions(category, Number.NEGATIVE_INFINITY, nowMs + DAY_MS);
  const lastYearRp = lastYear.reduce((sum, d) => sum + d.subsidyRp, 0);
  const study = studies.latestEvaluation(category);
  const result = study?.result ?? null;
  const additional = result ? result.paid * result.additionalShare : 0;
  return (
    <div className="measure-evidence">
      <div>
        Taken up by <strong>{lastYear.length}</strong> in the last 12 months ({formatCHF(lastYearRp)}) · {ever.length} since the start.
      </div>
      {SHARED_NOTE[category] && <div className="measure-note">{SHARED_NOTE[category]}</div>}
      {study && !result && <div className="measure-note">Evaluation under way — results in {monthYear(study.readyAtMs)}.</div>}
      {result && result.paid === 0 && <div className="measure-note">The evaluation of {monthYear(study!.readyAtMs)} found no one paid in the period it looked at.</div>}
      {result && result.paid > 0 && (
        <div className="measure-evaluation">
          <strong>Evaluation, {monthYear(study!.readyAtMs)}</strong> — of the {result.paid} households paid in the {EVALUATION_LOOKBACK_YEARS} years before, an estimated{" "}
          <strong>
            {percent(result.additionalShare)} (± {percent(result.margin)})
          </strong>{" "}
          would not have acted without the money: about {Math.round(additional)} changed decisions,{" "}
          {additional >= 1 ? `${formatCHF(result.paidRp / additional)} each` : "too few to price"}. The rest would have done the same anyway.
        </div>
      )}
      <button className="measure-study" disabled={!!study && !result} onClick={() => studies.commissionEvaluation(category, simClock.getSimTimeMs())}>
        Commission {result ? "a new" : "an"} evaluation — {formatCHF(EVALUATION_COST_CHF * 100)}, {EVALUATION_MONTHS} months
      </button>
    </div>
  );
}

/** Public opinion: the one number everyone sees, and what the latest paid survey found about each group. */
function PublicOpinion({ nowMs }: { nowMs: number }) {
  const latest = studies.latestSurvey();
  const result = studies.latestSurveyResult();
  return (
    <section className="measures-section">
      <h3>Public opinion</h3>
      <p className="measure-note">
        Approval stands at {Math.round(approval.getApproval())}%. How each group feels takes a survey — a snapshot as of its fieldwork, with a margin.
      </p>
      {result?.result && (
        <div className="survey-result">
          <div className="survey-head">Survey, {monthYear(result.readyAtMs)} (± {result.result.margin} points)</div>
          {BLOC_ORDER.map((b) => (
            <div className="survey-row" key={b}>
              <span>{BLOC_LABEL[b]}</span>
              <span className="survey-bar">
                <span style={{ width: `${result.result!.levels[b]}%` }} />
              </span>
              <span className="survey-value">{Math.round(result.result!.levels[b])}%</span>
            </div>
          ))}
          {nowMs - result.readyAtMs > YEAR_MS && <div className="measure-note">Over a year old — opinion may have moved since.</div>}
        </div>
      )}
      {latest && !latest.result && <p className="measure-note">A survey is in the field — results in {monthYear(latest.readyAtMs)}.</p>}
      <button className="measure-study" disabled={!!latest && !latest.result} onClick={() => studies.commissionSurvey(simClock.getSimTimeMs())}>
        Commission an opinion survey — {formatCHF(SURVEY_COST_CHF * 100)}, {SURVEY_MONTHS} months
      </button>
    </section>
  );
}

function sameParams(a: MeasureParams, b: MeasureParams): boolean {
  return Object.keys(a).every((k) => a[k] === b[k]);
}

/** One measure: what it is, its options, what it costs, where it stands, and the buttons to enact,
 * change or repeal it. The draft the player is editing lives here; only Enact/Apply touches the game. */
function MeasureCard({ def, nowMs }: { def: MeasureDef; nowMs: number }) {
  const state = measures.getState(def.id);
  const latest = state?.pending?.params ?? state?.active ?? null;
  const [draft, setDraft] = useState<MeasureParams>(latest ?? defaultParams(def));

  const cost = measures.costPreview(def, draft);
  const reaction = approval.reaction(def, draft);
  const vote = approval.getVoteInfo(def.id, def, nowMs);
  const changed = latest === null || !sameParams(latest, draft);
  // Nothing left for it to do (every public building already has what it would build).
  const unavailable = measureUnavailableReason(def.id, nowMs);

  let status: { label: string; tone: "off" | "pending" | "active" } = { label: "Not enacted", tone: "off" };
  if (state?.pending) {
    status = { label: `${state.active ? "Change" : "Takes effect"} ${formatDate(state.pending.activeFromMs)}`, tone: "pending" };
  } else if (state?.active) {
    status = { label: "In effect", tone: "active" };
  }

  return (
    <div className={`measure-card${unavailable ? " unavailable" : ""}`}>
      <div className="measure-head">
        <span className="measure-title">{def.title}</span>
        <span className={`measure-status ${status.tone}`}>{unavailable && latest !== null ? "Winding up" : status.label}</span>
      </div>
      {unavailable && (
        <div className="measure-note">
          Nothing left to do: {unavailable} A measure in force is wound up automatically once this is so — no
          repeal, so no cost in approval.
        </div>
      )}
      {state?.pending && state.active && <div className="measure-note">Currently in effect with the earlier settings.</div>}
      <p className="measure-summary">{def.summary}</p>

      {def.params.map((spec) => (
        <div className="measure-param" key={spec.key}>
          <span className="measure-param-label">{spec.label}</span>
          {spec.kind === "slider" && (
            <>
              <input
                type="range"
                min={spec.min}
                max={spec.max}
                step={spec.step}
                value={draft[spec.key] as number}
                onChange={(e) => setDraft({ ...draft, [spec.key]: Number(e.target.value) })}
              />
              <span className="measure-param-value">
                {(draft[spec.key] as number).toLocaleString("de-CH")} <small>{spec.unit}</small>
              </span>
            </>
          )}
          {spec.kind === "toggle" && (
            <input type="checkbox" checked={draft[spec.key] as boolean} onChange={(e) => setDraft({ ...draft, [spec.key]: e.target.checked })} />
          )}
          {spec.kind === "choice" && (
            <select value={draft[spec.key] as string} onChange={(e) => setDraft({ ...draft, [spec.key]: e.target.value })}>
              {spec.options.map((o) => (
                <option key={o.value} value={o.value}>
                  {o.label}
                </option>
              ))}
            </select>
          )}
        </div>
      ))}

      <div className="measure-meta">
        <span>
          Takes effect {def.leadTimeMonths === 0 ? "immediately" : `${def.leadTimeMonths} month${def.leadTimeMonths === 1 ? "" : "s"} after enacting`}
        </span>
        {cost.oneOffRp > 0 && <span>One-off cost {formatCHF(cost.oneOffRp)}</span>}
        {cost.annualRp > 0 && <span>Running cost {formatCHF(cost.annualRp)} / year</span>}
        <span className={`measure-reaction ${reaction.tone}`}>Public reaction: {reaction.label}</span>
        {def.referendum === "mandatory" && <span>Goes to a public vote</span>}
        {def.referendum === "optional" && <span>May go to a public vote if contested</span>}
      </div>
      {def.subsidyCategory && <SubsidyEvidence category={def.subsidyCategory} nowMs={nowMs} />}
      {vote && (
        <div className="measure-vote">
          Public vote in {formatDate(vote.atMs).replace(/^\w+, \d+ /, "")} — latest poll: {Math.round(vote.pollYes)}% in favour
        </div>
      )}

      <div className="measure-actions">
        <button className="measure-enact" disabled={!changed || unavailable !== null} onClick={() => measures.enact(def.id, draft)}>
          {latest === null ? "Enact" : "Apply change"}
        </button>
        {latest !== null && unavailable === null && (
          <button className="measure-repeal" onClick={() => measures.repeal(def.id)}>
            Repeal
          </button>
        )}
      </div>
    </div>
  );
}

/** The player's measures: everything the municipality can enact, grouped by kind, plus the outlook of
 * what the canton and the federal government have announced. */
export function MeasuresTab() {
  useSyncExternalStore(
    (listener) => measures.subscribe(listener),
    () => measures.getVersion(),
  );
  useSyncExternalStore(
    (listener) => approval.subscribe(listener),
    () => approval.getVersion(),
  );
  useSyncExternalStore(
    (listener) => studies.subscribe(listener),
    () => studies.getVersion(),
  );
  const nowMs = useSimDay();
  const outlook = measures.externalOutlook(nowMs);
  const YEAR_MS = 365.25 * 24 * 60 * 60_000;
  const budgetRp = treasury.allocationRp(measures.getDwellingCount(nowMs));
  const spentRp = treasury.operatingPaidOutTotal(nowMs - YEAR_MS, nowMs + 24 * 60 * 60_000); // investments may be borrowed for
  const history = [...measures.getHistory(), ...approval.getLog()].sort((a, b) => b.atMs - a.atMs);

  return (
    <div className="measures-tab">
      <h2>🏛️ Measures</h2>
      <SupervisionNotice />
      <p className="measures-intro">
        What the municipality can decide. Money leaves the treasury only when something actually happens — a subsidy when a household takes it up, a
        campaign month by month. Laws and programmes take months to years to come into effect.
      </p>
      <p className="measures-intro" style={{ color: spentRp > budgetRp ? "var(--bad)" : undefined }}>
        Running spending over the last 12 months (subsidies, programmes, interest — not investments): {formatCHF(spentRp)}, against a yearly government
        allocation of {formatCHF(budgetRp)}. Spending well beyond the allocation costs you approval with taxpayers.
      </p>

      <PublicOpinion nowMs={nowMs} />

      <section className="measures-section">
        <h3>Outlook: canton and federal government</h3>
        {outlook.length === 0 ? (
          <p className="measure-note">Nothing announced yet. Higher levels of government act on their own schedule, and tell you in advance.</p>
        ) : (
          outlook.map((o) => (
            <div className="measure-card external" key={o.id}>
              <div className="measure-head">
                <span className="measure-title">{o.title}</span>
                <span className={`measure-status ${o.inEffect ? "active" : "pending"}`}>{o.inEffect ? "In effect" : `From ${o.startYear}`}</span>
              </div>
              <p className="measure-summary">
                {o.summary} <em>({o.source === "federal" ? "Federal" : "Cantonal"} decision — no cost to the municipality.)</em>
              </p>
            </div>
          ))
        )}
      </section>

      {CATEGORY_ORDER.map((category) => (
        <section className="measures-section" key={category}>
          <h3>{MEASURE_CATEGORY_LABEL[category]}</h3>
          {MEASURE_CATALOG.filter((m) => m.category === category).map((def) => {
            const s = measures.getState(def.id);
            return <MeasureCard key={`${def.id}:${JSON.stringify(s?.pending?.params ?? s?.active ?? null)}`} def={def} nowMs={nowMs} />;
          })}
        </section>
      ))}

      <section className="measures-section">
        <h3>Recent decisions</h3>
        {history.length === 0 ? (
          <p className="measure-note">None yet.</p>
        ) : (
          <ul className="measure-log">
            {history.slice(0, 12).map((h, i) => (
              <li key={i}>
                <span className="measure-log-date">{formatDate(h.atMs)}</span> {h.text}
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
