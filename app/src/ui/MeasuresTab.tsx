import { useState, useSyncExternalStore } from "react";
import { X } from "lucide-react";
import { formatDate } from "../sim/calendar";
import { MEASURE_CATALOG } from "../sim/measureCatalog";
import {
  defaultParams,
  MEASURE_CATEGORY_LABEL,
  MEASURE_CATEGORY_SINGULAR,
  MEASURE_TOPIC_LABEL,
  MEASURE_TOPIC_ORDER,
  type MeasureCategory,
  type MeasureDef,
  type MeasureParams,
  type MeasureTopic,
} from "../sim/measureTypes";
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
import "./measuresPage.css";
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
export function PublicOpinion({ nowMs }: { nowMs: number }) {
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

/** One measure in full: what it is, its options, what it costs, where it stands, and the buttons to
 * enact, change or repeal it. The draft the player is editing lives here; only Enact/Apply touches the game. */
function MeasureDetail({ def, nowMs, onClose }: { def: MeasureDef; nowMs: number; onClose: () => void }) {
  const state = measures.getState(def.id);
  const latest = state?.pending?.params ?? state?.active ?? null;
  const [draft, setDraft] = useState<MeasureParams>(latest ?? defaultParams(def));

  const cost = measures.costPreview(def, draft);
  const reaction = approval.reaction(def, draft);
  const vote = approval.getVoteInfo(def.id, def, nowMs);
  const changed = latest === null || !sameParams(latest, draft);
  // Nothing left for it to do (every public building already has what it would build).
  const unavailable = measureUnavailableReason(def.id, nowMs);

  const status = measureStatus(def, nowMs);
  const lastVote = measures.lastVote(def.id);
  const moratoriumUntil = measures.moratoriumUntilMs(def.id, nowMs);

  return (
    <div className={`measure-detail${unavailable ? " unavailable" : ""}`}>
      <div className="measure-detail-tags">
        <span>
          {MEASURE_TOPIC_LABEL[def.topic]} · {MEASURE_CATEGORY_SINGULAR[def.category]}
        </span>
        <button className="measure-detail-close" onClick={onClose} aria-label="Close">
          <X size={16} strokeWidth={1.75} aria-hidden />
        </button>
      </div>
      <div className="measure-head">
        <h2 className="measure-title">{def.title}</h2>
        <span className={`measure-status ${status.tone}`}>{status.label}</span>
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
          Public vote in {formatDate(vote.atMs).replace(/^\d+ /, "")} — latest poll: {Math.round(vote.pollYes)}% in favour
        </div>
      )}
      {!vote && lastVote && (
        <div className={`measure-vote-result ${lastVote.accepted ? "accepted" : "rejected"}`}>
          {lastVote.accepted ? "Accepted" : "Rejected"} by the voters in {monthYear(lastVote.atMs)}: {Math.round(lastVote.yesShare)}% yes, {100 - Math.round(lastVote.yesShare)}% no.
          {moratoriumUntil !== null && ` It can't be put forward again before ${monthYear(moratoriumUntil)}.`}
        </div>
      )}

      <div className="measure-actions">
        <button className="measure-enact" disabled={!changed || unavailable !== null || moratoriumUntil !== null} onClick={() => measures.enact(def.id, draft)}>
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

type StatusTone = "off" | "pending" | "active" | "done";

/** Where a measure stands, in a word or two. */
function measureStatus(def: MeasureDef, nowMs: number): { label: string; tone: StatusTone } {
  const state = measures.getState(def.id);
  const latest = state?.pending?.params ?? state?.active ?? null;
  if (measureUnavailableReason(def.id, nowMs)) return { label: latest !== null ? "Winding up" : "Not available", tone: "done" };
  if (latest === null && measures.moratoriumUntilMs(def.id, nowMs) !== null) return { label: "Rejected by voters", tone: "done" };
  if (state?.pending) return { label: `${state.active ? "Change" : "Takes effect"} ${monthYear(state.pending.activeFromMs)}`, tone: "pending" };
  if (state?.active) return { label: "In effect", tone: "active" };
  return { label: "Not enacted", tone: "off" };
}

/** The line under a card's summary: for a measure in force what it is doing, otherwise how it would go down. */
function cardFooter(def: MeasureDef, nowMs: number): { text: string; tone?: "good" | "bad" | "warn" } {
  const vote = approval.getVoteInfo(def.id, def, nowMs);
  if (vote) return { text: `Public vote ${monthYear(vote.atMs)} · poll ${Math.round(vote.pollYes)}% yes`, tone: "warn" };
  const until = measures.moratoriumUntilMs(def.id, nowMs);
  const lastVote = measures.lastVote(def.id);
  if (until !== null && lastVote) return { text: `Rejected ${monthYear(lastVote.atMs)} (${Math.round(lastVote.yesShare)}% yes) · again from ${monthYear(until)}`, tone: "bad" };
  const state = measures.getState(def.id);
  const params = state?.pending?.params ?? state?.active ?? null;
  if (state?.active && def.subsidyCategory) {
    const taken = subsidisedDecisions(def.subsidyCategory, nowMs - YEAR_MS, nowMs + DAY_MS);
    return { text: `${taken.length} took it up in the last 12 months · ${formatCHF(taken.reduce((sum, d) => sum + d.subsidyRp, 0))}` };
  }
  const cost = measures.costPreview(def, params ?? defaultParams(def));
  if (state?.active && cost.annualRp > 0) return { text: `Running cost ${formatCHF(cost.annualRp)} a year` };
  if (state?.active) return { text: "In force" };
  const reaction = approval.reaction(def, defaultParams(def));
  return { text: `Public reaction: ${reaction.label}`, tone: reaction.tone === "good" ? "good" : reaction.tone === "bad" ? "bad" : undefined };
}

function MeasureTile({ def, nowMs, selected, onSelect }: { def: MeasureDef; nowMs: number; selected: boolean; onSelect: () => void }) {
  const status = measureStatus(def, nowMs);
  const footer = cardFooter(def, nowMs);
  return (
    <button className={`measure-tile ${status.tone}${selected ? " selected" : ""}`} onClick={onSelect} aria-pressed={selected}>
      <span className="measure-tile-top">
        <span className="measure-kind">{MEASURE_CATEGORY_SINGULAR[def.category]}</span>
        <span className={`measure-status ${status.tone}`}>{status.label}</span>
      </span>
      <span className="measure-tile-title">{def.title}</span>
      <span className="measure-tile-summary">{def.summary}</span>
      <span className={`measure-tile-foot${footer.tone ? ` ${footer.tone}` : ""}`}>{footer.text}</span>
    </button>
  );
}

type TopicFilter = MeasureTopic | "all" | "enacted";

/** The player's measures: a rail of topics (and kinds to narrow by), the measures as cards, and the
 * one picked in full beside them. */
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
  const [topic, setTopic] = useState<TopicFilter>("all");
  const [kinds, setKinds] = useState<Set<MeasureCategory>>(new Set());
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const selected = MEASURE_CATALOG.find((m) => m.id === selectedId) ?? null;
  const selectedState = selected ? measures.getState(selected.id) : null;

  const enacted = (def: MeasureDef) => {
    const st = measures.getState(def.id);
    return !!(st?.active || st?.pending);
  };
  const kindOk = (def: MeasureDef) => kinds.size === 0 || kinds.has(def.category);
  const visible = MEASURE_CATALOG.filter((def) => kindOk(def) && (topic === "all" || (topic === "enacted" ? enacted(def) : def.topic === topic)));
  const groups: { key: string; title: string | null; defs: MeasureDef[] }[] =
    topic === "all"
      ? MEASURE_TOPIC_ORDER.map((t) => ({ key: t, title: MEASURE_TOPIC_LABEL[t], defs: visible.filter((d) => d.topic === t) })).filter((g) => g.defs.length > 0)
      : [{ key: topic, title: null, defs: visible }];

  const budgetRp = approval.spendingAllowanceRp(nowMs);
  const spentRp = treasury.operatingPaidOutTotal(nowMs - YEAR_MS, nowMs + DAY_MS); // investments may be borrowed for

  const topicRow = (key: TopicFilter, label: string, defs: MeasureDef[]) => {
    const on = defs.filter(enacted).length;
    return (
      <li key={key}>
        <button className={topic === key ? "active" : ""} aria-pressed={topic === key} onClick={() => setTopic(key)}>
          <span>{label}</span>
          <span className="measures-count">{key === "enacted" ? defs.length : on > 0 ? `${on} / ${defs.length}` : defs.length}</span>
        </button>
      </li>
    );
  };

  return (
    <div className="measures-tab">
      <SupervisionNotice />
      <p className="measures-intro" style={{ color: spentRp > budgetRp ? "var(--bad)" : undefined }}>
        Running spending over the last 12 months (subsidies, programmes, interest — not investments): <strong>{formatCHF(spentRp)}</strong>, against what
        the department takes in a year — the government's allocation and its share of the utility's profit — of {formatCHF(budgetRp)}. Spending well beyond that costs you approval with taxpayers. Money leaves the
        treasury only when something actually happens; laws and programmes take months to years to come into effect.
      </p>
      <div className={`measures-layout${selected ? " has-detail" : ""}`}>
        <aside className="measures-rail">
          <h3>Topic</h3>
          <ul>
            {topicRow("all", "All measures", MEASURE_CATALOG)}
            {MEASURE_TOPIC_ORDER.map((t) =>
              topicRow(
                t,
                MEASURE_TOPIC_LABEL[t],
                MEASURE_CATALOG.filter((d) => d.topic === t),
              ),
            )}
            {topicRow("enacted", "Enacted or on the way", MEASURE_CATALOG.filter(enacted))}
          </ul>
          <h3>Kind</h3>
          <div className="measures-kinds">
            {CATEGORY_ORDER.map((k) => (
              <button
                key={k}
                className={kinds.has(k) ? "active" : ""}
                aria-pressed={kinds.has(k)}
                onClick={() =>
                  setKinds((prev) => {
                    const next = new Set(prev);
                    if (next.has(k)) next.delete(k);
                    else next.add(k);
                    return next;
                  })
                }
              >
                {MEASURE_CATEGORY_LABEL[k]}
              </button>
            ))}
          </div>
        </aside>
        <div className="measures-grid-wrap">
          {groups.length === 0 && <p className="measure-note">No measures match.</p>}
          {groups.map((g) => (
            <section key={g.key} className="measures-group">
              {g.title && <h3 className="measures-group-title">{g.title}</h3>}
              <div className="measures-grid">
                {g.defs.map((def) => (
                  <MeasureTile key={def.id} def={def} nowMs={nowMs} selected={def.id === selectedId} onSelect={() => setSelectedId(def.id === selectedId ? null : def.id)} />
                ))}
              </div>
            </section>
          ))}
        </div>
        <aside className="measure-detail-pane" aria-label="Measure details">
          {selected ? (
            <MeasureDetail
              key={`${selected.id}:${JSON.stringify(selectedState?.pending?.params ?? selectedState?.active ?? null)}`}
              def={selected}
              nowMs={nowMs}
              onClose={() => setSelectedId(null)}
            />
          ) : (
            <div className="measure-detail-empty">
              <strong>Pick a measure</strong>
              <p>Its options, what it costs, how people would take it, and what it has done so far appear here.</p>
            </div>
          )}
        </aside>
      </div>
    </div>
  );
}

/** What the canton and the federal government have announced, and what is already in force, in date order. */
export function ExternalOutlook({ nowMs }: { nowMs: number }) {
  const outlook = measures.externalOutlook(nowMs);
  if (outlook.length === 0) return <p className="measure-note">Nothing announced yet. Higher levels of government act on their own schedule, and tell you in advance.</p>;
  return (
    <ol className="outlook-timeline">
      {[...outlook]
        .sort((a, b) => a.startYear - b.startYear)
        .map((o) => (
          <li key={o.id} className={o.inEffect ? "in-effect" : ""}>
            <span className="outlook-year">{o.inEffect ? "In force" : o.startYear}</span>
            <div>
              <div className="outlook-title">
                {o.title} <span className="outlook-source">{o.source === "federal" ? "Federal" : "Cantonal"}</span>
              </div>
              <p className="measure-summary">{o.summary}</p>
            </div>
          </li>
        ))}
    </ol>
  );
}

/** The latest decisions: the player's measures and the votes on them. */
export function RecentDecisions({ limit = 12 }: { limit?: number }) {
  const history = [...measures.getHistory(), ...approval.getLog()].sort((a, b) => b.atMs - a.atMs);
  if (history.length === 0) return <p className="measure-note">None yet.</p>;
  return (
    <ul className="measure-log">
      {history.slice(0, limit).map((h, i) => (
        <li key={i}>
          <span className="measure-log-date">{formatDate(h.atMs)}</span> {h.text}
        </li>
      ))}
    </ul>
  );
}
