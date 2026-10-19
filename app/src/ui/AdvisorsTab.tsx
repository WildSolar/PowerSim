import { MapPin } from "lucide-react";
import { useState, useSyncExternalStore } from "react";
import { ADVISOR_ORDER, ADVISORS, advisors, type AdvisorId, type AdvisorReport } from "../sim/advisors";
import { formatDate } from "../sim/calendar";
import { districtHeat } from "../sim/districtHeat";
import { districtHeatSources } from "../sim/districtHeatSources";
import { simClock } from "../sim/engine";
import { cannotPay } from "../sim/fiscalRules";
import type { LetterPick } from "../sim/inbox";
import { measures } from "../sim/measures";
import { buildCostRp, publicCharging, sizesFor } from "../sim/publicCharging";
import { roofContracts } from "../sim/roofContracts";
import { stock } from "../sim/stock";
import { useSimDay } from "../sim/store";
import { formatCHF } from "./format";
import "./measures.css";
import "./measuresPage.css";
import "./advisorsPage.css";

function monthYear(ms: number): string {
  return formatDate(ms).replace(/^\d+ /, "");
}

/** The advisor a letter asked for: the page opens on it (App sets it before opening the Town hall). */
let requested: AdvisorId | null = null;
export function openAdvisorPage(id: AdvisorId): void {
  requested = id;
}

/** Re-renders when anything a pick's state depends on changes. */
function useAdvisorState(): void {
  for (const store of [measures, advisors, roofContracts, publicCharging, districtHeat, districtHeatSources]) {
    // eslint-disable-next-line react-hooks/rules-of-hooks -- a fixed list, called in the same order every render
    useSyncExternalStore(
      (l) => store.subscribe(l),
      () => store.getVersion(),
    );
  }
}

type Standing = { label: string; tone: "off" | "pending" | "active" };

function standing(id: AdvisorId, now: number): Standing {
  const state = measures.getState(ADVISORS[id].measureId);
  if (state?.active) return { label: "Retained", tone: "active" };
  if (state?.pending) return { label: `From ${monthYear(state.pending.activeFromMs)}`, tone: "pending" };
  void now;
  return { label: "Not retained", tone: "off" };
}

/** Metres between two points, near enough. */
function distanceM(aLon: number, aLat: number, bLon: number, bLat: number): number {
  const mPerLat = 111_320;
  const mPerLon = mPerLat * Math.cos((aLat * Math.PI) / 180);
  return Math.hypot((aLon - bLon) * mPerLon, (aLat - bLat) * mPerLat);
}

function Chip({ tone, children }: { tone: "good" | "pending" | "off"; children: React.ReactNode }) {
  return <span className={`advisor-chip ${tone}`}>{children}</span>;
}

function ActionButton({ costRp, now, onClick, children }: { costRp: number; now: number; onClick: () => void; children: React.ReactNode }) {
  const short = cannotPay(costRp, now);
  return (
    <button className="advisor-act" disabled={short} title={short ? "The treasury can't pay for it now (Treasury: borrow first)" : undefined} onClick={onClick}>
      {children}
    </button>
  );
}

/** What can be done about a roof the roof solar advisor picked. */
function RoofAction({ pick, now }: { pick: LetterPick; now: number }) {
  const b = pick.egid ? stock.lookup(pick.egid) : undefined;
  if (!b) return <Chip tone="off">The building is gone</Chip>;
  const c = roofContracts.latest(b.egid);
  const quote = roofContracts.quote(b, now, c?.status === "accepted" ? c.rentChfPerM2 : undefined);
  if (c?.status === "built") return <Chip tone="good">{(c.installedAtMs ?? 0) > now ? `Array ordered, ready ${monthYear(c.installedAtMs ?? now)}` : "The utility's array is running"}</Chip>;
  if (c?.status === "accepted" && quote?.gridFull)
    return (
      <>
        <Chip tone="good">Accepted — build by {monthYear(c.buildByMs ?? now)}</Chip>
        <Chip tone="pending">The grid here is full: reinforce the area first (Grid tool)</Chip>
      </>
    );
  if (c?.status === "accepted")
    return (
      <>
        <Chip tone="good">Accepted — build by {monthYear(c.buildByMs ?? now)}</Chip>
        <ActionButton costRp={quote?.costRp ?? 0} now={now} onClick={() => roofContracts.build(b.egid, simClock.getSimTimeMs())}>
          Build{quote ? ` for ${formatCHF(quote.costRp)}` : ""}
        </ActionButton>
      </>
    );
  if (c?.status === "offered") return <Chip tone="pending">Offered — the owner is thinking it over</Chip>;
  if (c?.status === "ownSolar") return <Chip tone="off">The owner built their own</Chip>;
  const eligibility = roofContracts.eligibility(b, now);
  if (!eligibility.ok) return <Chip tone="off">{eligibility.reason}</Chip>;
  return (
    <>
      {c?.status === "declined" && <Chip tone="off">Declined before</Chip>}
      <button className="advisor-act" onClick={() => roofContracts.offer(b, simClock.getSimTimeMs())}>
        Offer {quote ? `${formatCHF(Math.round(quote.rentRp / 100) * 100)} a year` : "the contract"} at CHF {roofContracts.getRent().toFixed(2)}/m²
      </button>
    </>
  );
}

/** What can be done about a spot the mobility advisor picked: chargers ordered there since, or
 * ordering them. */
function ChargerAction({ pick, report, now }: { pick: LetterPick; report: AdvisorReport; now: number }) {
  const hub = pick.charger === "hub";
  const sizes = sizesFor("ac");
  const [points, setPoints] = useState(sizes.find((s) => s.points === 8)?.points ?? sizes[0].points);
  const near = publicCharging
    .getSites()
    .find((s) => s.openedAtMs > report.atMs && (hub ? s.kind !== "ac" : s.kind === "ac") && distanceM(s.lon, s.lat, pick.lon, pick.lat) <= (hub ? 800 : 200));
  if (near) return <Chip tone="good">{near.openedAtMs > now ? `${near.name}: opens ${monthYear(near.openedAtMs)}` : `${near.name}: open`}</Chip>;
  const build = (kind: "ac" | "dc" | "fleet", n?: number) => publicCharging.build(kind, pick.lon, pick.lat, simClock.getSimTimeMs(), n);
  if (hub)
    return (
      <>
        <ActionButton costRp={buildCostRp("dc", now)} now={now} onClick={() => build("dc")}>
          Fast-charging hub — {formatCHF(buildCostRp("dc", now))}
        </ActionButton>
        <ActionButton costRp={buildCostRp("fleet", now)} now={now} onClick={() => build("fleet")}>
          Lorry charging park — {formatCHF(buildCostRp("fleet", now))}
        </ActionButton>
      </>
    );
  return (
    <>
      <select className="advisor-size" value={points} onChange={(e) => setPoints(Number(e.target.value))} aria-label="Charge points">
        {sizes.map((s) => (
          <option key={s.points} value={s.points}>
            {s.points} points
          </option>
        ))}
      </select>
      <ActionButton costRp={buildCostRp("ac", now, points)} now={now} onClick={() => build("ac", points)}>
        Build on-street chargers — {formatCHF(buildCostRp("ac", now, points))}
      </ActionButton>
    </>
  );
}

/** What can be done about a street the district heating advisor picked: the pipes ordered, or
 * ordering them. */
function PipeAction({ pick, now }: { pick: LetterPick; now: number }) {
  const q = districtHeat.quoteSegments(pick.segments ?? [], now);
  if (q.segments.length === 0) return <Chip tone="good">Pipes ordered</Chip>;
  if (!q.connected) return <Chip tone="off">It no longer joins the network</Chip>;
  return (
    <ActionButton costRp={q.costRp} now={now} onClick={() => districtHeat.orderSegments(pick.segments ?? [], simClock.getSimTimeMs())}>
      Order {Math.round(q.lengthM)} m of pipes — {formatCHF(q.costRp)}, ready in {q.months} months
    </ActionButton>
  );
}

/** What can be done about a factory's waste heat the district heating advisor found: taken up since,
 * or taking it — the heat exchanger and the connection, then the yearly payment. */
function FactoryAction({ pick, now }: { pick: LetterPick; now: number }) {
  const c = districtHeat.getCandidates().find((x) => x.id === pick.candidateId);
  if (!c) return <Chip tone="off">No longer on offer</Chip>;
  if (!districtHeatSources.availableCandidates(now).some((x) => x.id === c.id)) return <Chip tone="good">Heat exchanger ordered</Chip>;
  const q = districtHeatSources.candidateQuote(c, now);
  if (q.problem) return <Chip tone="off">{q.problem}</Chip>;
  const take = () => {
    districtHeatSources.startDraft(c.kind, c.id);
    if (!districtHeatSources.orderDraft(simClock.getSimTimeMs())) districtHeatSources.cancelDraft();
  };
  return (
    <ActionButton costRp={q.capexRp} now={now} onClick={take}>
      Take {q.sizeMw.toFixed(1)} MW — {formatCHF(q.capexRp)}, then {formatCHF(q.yearlyRp)} a year
    </ActionButton>
  );
}

function PickRow({ pick, report, now, onShowOnMap }: { pick: LetterPick; report: AdvisorReport; now: number; onShowOnMap: (pick: LetterPick) => void }) {
  return (
    <li className="advisor-pick">
      <div className="advisor-pick-text">
        <strong>{pick.label}</strong>
        <span>{pick.detail}</span>
      </div>
      <div className="advisor-pick-actions">
        {pick.tool === "roofSolar" && <RoofAction pick={pick} now={now} />}
        {pick.tool === "evCharging" && <ChargerAction pick={pick} report={report} now={now} />}
        {pick.tool === "districtHeat" && (pick.candidateId ? <FactoryAction pick={pick} now={now} /> : <PipeAction pick={pick} now={now} />)}
        <button className="advisor-map" onClick={() => onShowOnMap(pick)}>
          <MapPin size={13} strokeWidth={1.75} aria-hidden /> Show on the map
        </button>
      </div>
    </li>
  );
}

function AdvisorPage({ id, now, onShowOnMap, onOpenPrices }: { id: AdvisorId; now: number; onShowOnMap: (pick: LetterPick) => void; onOpenPrices: () => void }) {
  const def = measures.getDef(ADVISORS[id].measureId);
  const state = measures.getState(ADVISORS[id].measureId);
  const s = standing(id, now);
  const report = advisors.getReport(id);
  const feeRp = def ? measures.costPreview(def, {}).annualRp : 0;
  const hired = s.tone !== "off";
  return (
    <section className={`advisor-page${hired ? "" : " not-retained"}`}>
      <div className="advisor-head">
        <h2>{ADVISORS[id].title} advisor</h2>
        <span className={`measure-status ${s.tone}`}>{s.label}</span>
      </div>
      {def && <p className="advisor-summary">{def.summary}</p>}
      <div className="advisor-terms">
        <span>Fee {formatCHF(feeRp)} a year</span>
        {hired ? (
          <button className="measure-repeal" disabled={measures.isFrozen()} onClick={() => measures.repeal(ADVISORS[id].measureId)}>
            Let go
          </button>
        ) : (
          <button className="advisor-act" disabled={measures.isFrozen()} onClick={() => measures.enact(ADVISORS[id].measureId, {})}>
            Retain for {formatCHF(feeRp)} a year
          </button>
        )}
      </div>

      {!report ? (
        <p className="advisor-empty">
          {state?.pending
            ? `Starts in ${monthYear(state.pending.activeFromMs)}; the first report comes the month after.`
            : state?.active
              ? "The first report comes next month."
              : "Retain this advisor to get a report: the first comes the month after the contract starts, then one a year."}
        </p>
      ) : (
        <article className="advisor-report">
          <div className="advisor-report-date">
            Report of {formatDate(report.atMs)}
            {!hired ? " — the last before you let them go" : ""}
          </div>
          <h3>{report.subject}</h3>
          {report.paragraphs.map((p, i) => (
            <p key={i}>{p}</p>
          ))}
          {report.picks && report.picks.length > 0 && (
            <ol className="advisor-picks">
              {report.picks.map((pick, i) => (
                <PickRow key={`${report.atMs}-${i}`} pick={pick} report={report} now={now} onShowOnMap={onShowOnMap} />
              ))}
            </ol>
          )}
          {id === "finance" && (
            <div className="advisor-terms">
              <button className="advisor-act" onClick={onOpenPrices}>
                Set next year&apos;s prices
              </button>
            </div>
          )}
        </article>
      )}
    </section>
  );
}

/** The Town hall's Advisors page: the four advisors, each retained or not, and the latest report of
 * the one picked, its proposals to act on directly or look at on the map. */
export function AdvisorsTab({ onShowOnMap, onOpenPrices }: { onShowOnMap: (pick: LetterPick) => void; onOpenPrices: () => void }) {
  useAdvisorState();
  const now = useSimDay();
  const [current, setCurrent] = useState<AdvisorId>(() => {
    const first = requested ?? ADVISOR_ORDER.find((id) => advisors.retained(id)) ?? ADVISOR_ORDER[0];
    requested = null;
    return first;
  });
  return (
    <div className="advisors-layout">
      <aside className="measures-rail">
        <h3>Advisors</h3>
        <ul>
          {ADVISOR_ORDER.map((id) => {
            const s = standing(id, now);
            return (
              <li key={id}>
                <button className={`${id === current ? "active" : ""}${s.tone === "off" ? " advisor-off" : ""}`} aria-pressed={id === current} onClick={() => setCurrent(id)}>
                  <span>{ADVISORS[id].title}</span>
                  <span className="measures-count">{s.tone === "active" ? "✓" : s.tone === "pending" ? "soon" : ""}</span>
                </button>
              </li>
            );
          })}
        </ul>
      </aside>
      <AdvisorPage key={current} id={current} now={now} onShowOnMap={onShowOnMap} onOpenPrices={onOpenPrices} />
    </div>
  );
}
