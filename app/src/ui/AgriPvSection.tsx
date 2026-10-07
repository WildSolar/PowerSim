import { useMemo, useSyncExternalStore } from "react";
import { AGRI_PV_LEAD_MONTHS } from "../config/agriPv";
import { agriPv, partnerName, type AgriPvDesignation } from "../sim/agriPv";
import { approval } from "../sim/approval";
import { formatDate } from "../sim/calendar";
import { simClock } from "../sim/engine";
import { policyStore } from "../sim/policy";
import { useSimDay } from "../sim/store";
import { formatCHF } from "./format";
import { useStockBuildings } from "./useStock";

function monthYear(ms: number): string {
  return formatDate(ms).replace(/^\d+ /, "");
}

function hectares(m2: number): string {
  return `${(m2 / 10_000).toFixed(1)} ha`;
}

function DesignationStatus({ d, now }: { d: AgriPvDesignation; now: number }) {
  if (d.rejected) return <span className="zn-status bad">Struck down by the voters</span>;
  const vote = approval.getVoteInfo(`agriPv:${d.id}`, null, now);
  if (vote) return <span className="zn-status">Public vote {monthYear(vote.atMs)} · poll {Math.round(vote.pollYes)}% yes</span>;
  if (d.effectiveAtMs > now) return <span className="zn-status">In force from {monthYear(d.effectiveAtMs)}</span>;
  return <span className="zn-status good">In force since {monthYear(d.effectiveAtMs)}</span>;
}

/** Farmland and Agri-PV, in the zoning layer's panel: what is zoned and built, how people take it,
 * and zoning the picked fields. */
export function AgriPvSection() {
  const version = useSyncExternalStore(
    (l) => agriPv.subscribe(l),
    () => agriPv.getVersion(),
  );
  useSyncExternalStore(
    (l) => policyStore.subscribe(l),
    () => policyStore.get(),
  );
  const now = useSimDay();
  const buildings = useStockBuildings();
  const plots = agriPv.getPlots();
  const selection = agriPv.getSelection();
  const summary = useMemo(() => {
    const farmM2 = plots.reduce((sum, p) => sum + p.areaM2, 0);
    const fields = agriPv.getFields();
    return {
      farmM2,
      zonedM2: agriPv.zonedAreaM2(now),
      inService: fields.filter((f) => f.installedAtMs <= now),
      building: fields.filter((f) => f.installedAtMs > now),
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [now, version, plots]);
  const quote = useMemo(() => agriPv.quote(), [version]); // eslint-disable-line react-hooks/exhaustive-deps
  const reaction = approval.reactionTo(quote.stances);
  const dialogue = policyStore.get().agriPvDialogue > 0;
  const designations = [...agriPv.getDesignations()].reverse();
  const mw = (kw: number) => `${(kw / 1000).toFixed(1)} MWp`;

  if (plots.length === 0) return null;

  return (
    <>
      <h4 className="dh-subtitle">Farmland · Agri-PV</h4>
      <p className="dh-note">
        Solar over fields that stay farmed. Zone fields for it, and businesses with a big electricity use may build there, buying the power as it comes.
      </p>
      <div className="info-row">
        <span>Farmland fields</span>
        <span className="info-value">
          {plots.length} · {hectares(summary.farmM2)}
        </span>
      </div>
      <div className="info-row">
        <span>Zoned for Agri-PV</span>
        <span className="info-value">{hectares(summary.zonedM2)}</span>
      </div>
      <div className="info-row">
        <span>Agri-PV fields in service</span>
        <span className="info-value">
          {summary.inService.length} · {mw(summary.inService.reduce((sum, f) => sum + f.capacityKw, 0))}
        </span>
      </div>
      <div className="info-row" title="How far people have come round to solar over farmland: it softens the opposition to Agri-PV zones, new and in force">
        <span>Acceptance</span>
        <span className="info-value">{Math.round(agriPv.getAcceptance() * 100)}%</span>
      </div>
      <p className="dh-note">
        {dialogue
          ? "The Agri-PV dialogue is running: acceptance grows year by year."
          : "Acceptance grows a little with every field people get to see. The Agri-PV dialogue (Town hall → Measures, Advice) builds it faster."}
      </p>

      {selection.size === 0 ? (
        <p className="dh-note">Click fields on the map (the green ones, outside the building zones) to zone them for Agri-PV.</p>
      ) : quote.plotIds.length === 0 ? (
        <p className="dh-note">The picked fields are zoned already, or on their way.</p>
      ) : (
        <div className="zn-quote">
          <div className="zn-quote-title">{quote.title}</div>
          <div className="info-row">
            <span>Prime cropland</span>
            <span className="info-value">{Math.round(quote.primeShare * 100)}%</span>
          </div>
          <div className="info-row">
            <span>Planning cost</span>
            <span className="info-value">{formatCHF(quote.costRp)}</span>
          </div>
          <div className="info-row">
            <span>Public reaction</span>
            <span className={`zn-reaction ${reaction.tone}`}>{reaction.label}</span>
          </div>
          <p className="dh-note">
            Always goes to a public vote, which can strike it down; in force {AGRI_PV_LEAD_MONTHS} months after it's put forward. Some of the opposition stays for
            as long as the zone is there{quote.primeShare > 0.3 ? " — more so on prime cropland" : ""}.
          </p>
          <div className="dh-actions">
            <button className="dh-order" onClick={() => agriPv.submit(simClock.getSimTimeMs())}>
              Put forward for {formatCHF(quote.costRp)}
            </button>
            <button onClick={() => agriPv.clearSelection()}>Clear</button>
          </div>
        </div>
      )}

      {designations.length > 0 &&
        designations.map((d) => (
          <div className="zn-change" key={d.id}>
            <span className="zn-change-title">{d.title}</span>
            <DesignationStatus d={d} now={now} />
          </div>
        ))}

      {(summary.inService.length > 0 || summary.building.length > 0) && (
        <>
          <h4 className="dh-subtitle">Agri-PV fields</h4>
          {[...summary.building, ...summary.inService].map((f) => (
            <div className="zn-change" key={f.id}>
              <span className="zn-change-title">
                {agriPv.getPlot(f.plotId)?.name ?? "Field"} · {mw(f.capacityKw)}
              </span>
              <span className="zn-status">
                {f.installedAtMs > now ? `Being built, ready ${monthYear(f.installedAtMs)}` : `Since ${monthYear(f.installedAtMs)}`} · power for {partnerName(f.partnerEgid, buildings)}
              </span>
            </div>
          ))}
        </>
      )}
    </>
  );
}
