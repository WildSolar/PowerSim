import { useState, useSyncExternalStore } from "react";
import { formatDate } from "../sim/calendar";
import { MEASURE_CATALOG } from "../sim/measureCatalog";
import { defaultParams, MEASURE_CATEGORY_LABEL, type MeasureCategory, type MeasureDef, type MeasureParams } from "../sim/measureTypes";
import { approval } from "../sim/approval";
import { measures } from "../sim/measures";
import { useSimDay } from "../sim/store";
import { formatCHF } from "./format";
import "./measures.css";

const CATEGORY_ORDER: MeasureCategory[] = ["subsidy", "infrastructure", "information", "law"];

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

  let status: { label: string; tone: "off" | "pending" | "active" } = { label: "Not enacted", tone: "off" };
  if (state?.pending) {
    status = { label: `${state.active ? "Change" : "Takes effect"} ${formatDate(state.pending.activeFromMs)}`, tone: "pending" };
  } else if (state?.active) {
    status = { label: "In effect", tone: "active" };
  }

  return (
    <div className="measure-card">
      <div className="measure-head">
        <span className="measure-title">{def.title}</span>
        <span className={`measure-status ${status.tone}`}>{status.label}</span>
      </div>
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
      {vote && (
        <div className="measure-vote">
          Public vote in {formatDate(vote.atMs).replace(/^\w+, \d+ /, "")} — latest poll: {Math.round(vote.pollYes)}% in favour
        </div>
      )}

      <div className="measure-actions">
        <button className="measure-enact" disabled={!changed} onClick={() => measures.enact(def.id, draft)}>
          {latest === null ? "Enact" : "Apply change"}
        </button>
        {latest !== null && (
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
  const nowMs = useSimDay();
  const outlook = measures.externalOutlook(nowMs);
  const history = [...measures.getHistory(), ...approval.getLog()].sort((a, b) => b.atMs - a.atMs);

  return (
    <div className="measures-tab">
      <h2>🏛️ Measures</h2>
      <p className="measures-intro">
        What the municipality can decide. Money leaves the treasury only when something actually happens — a subsidy when a household takes it up, a
        campaign month by month. Laws and programmes take months to years to come into effect.
      </p>

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
