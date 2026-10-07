import { useMemo, useState, useSyncExternalStore } from "react";
import { MAX_EXTRA_FLOORS, REZONE_TARGETS, ZONING_LEAD_MONTHS } from "../config/zoning";
import type { SiteZone } from "../data/types";
import { ZONING_LEGEND } from "../map/colorModes";
import { approval } from "../sim/approval";
import { formatDate } from "../sim/calendar";
import { simClock } from "../sim/engine";
import { useSimDay } from "../sim/store";
import { zoning, type ZoningAction, type ZoningChange } from "../sim/zoning";
import { formatCHF } from "./format";
import { useStockBuildings } from "./useStock";
import "./districtHeatPanel.css";
import "./evChargingPanel.css";
import "./zoningPanel.css";
import { SupervisionNotice } from "./SupervisionNotice";
import { AgriPvSection } from "./AgriPvSection";

const ZONE_LABEL: Record<SiteZone, string> = { residential: "Residential", mixed: "Mixed", centre: "Centre", work: "Work", public: "Public use" };
const ZONE_COLOR = Object.fromEntries(ZONING_LEGEND.map((l) => [l.bucket, l.color])) as Record<SiteZone, string>;

function monthYear(simTimeMs: number): string {
  return formatDate(simTimeMs).replace(/^\d+ /, "");
}

function hectares(m2: number): string {
  return `${(m2 / 10_000).toFixed(1)} ha`;
}

function sameAction(a: ZoningAction, b: ZoningAction): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}

function ChangeStatus({ change, now }: { change: ZoningChange; now: number }) {
  if (change.rejected) return <span className="zn-status bad">Struck down by the voters</span>;
  const vote = approval.getVoteInfo(`zoning:${change.id}`, null, now);
  if (vote) return <span className="zn-status">Public vote {monthYear(vote.atMs)} · poll {Math.round(vote.pollYes)}% yes</span>;
  if (change.effectiveAtMs > now) return <span className="zn-status">In force from {monthYear(change.effectiveAtMs)}</span>;
  return <span className="zn-status good">In force since {monthYear(change.effectiveAtMs)}</span>;
}

/** The zoning layer's panel: the plan as it stands, picking parcels and putting a change forward
 * (what it touches, what it costs, how the public takes it), and the changes on their way. */
export function ZoningPanel() {
  const version = useSyncExternalStore(
    (listener) => zoning.subscribe(listener),
    () => zoning.getVersion(),
  );
  const simDay = useSimDay();
  const buildings = useStockBuildings();
  const [action, setAction] = useState<ZoningAction>({ type: "rezone", zone: "mixed" });
  const selection = zoning.getSelection();

  const plan = useMemo(() => {
    const byZone: Partial<Record<SiteZone, number>> = {};
    let densified = 0;
    let energyZones = 0;
    for (const p of zoning.getParcels()) {
      const state = zoning.stateAt(p.id, simDay);
      if (!state) continue;
      byZone[state.zone] = (byZone[state.zone] ?? 0) + p.areaM2;
      if (state.extraFloors > 0) densified += p.areaM2;
      if (state.dhPriority || state.highStandard) energyZones += p.areaM2;
    }
    return { byZone, densified, energyZones, levyRp: zoning.leviesTotalRp(simDay + 1) };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [simDay, version]);

  const quote = useMemo(() => zoning.quote(action, buildings, simDay), [action, buildings, simDay, version]); // eslint-disable-line react-hooks/exhaustive-deps
  const reaction = approval.reactionTo(quote.stances);
  const toVote = approval.wouldGoToVote(quote.stances, quote.referendum);
  const changes = [...zoning.getChanges()].reverse();

  if (zoning.getParcels().length === 0) {
    return (
      <div className="district-heat-panel">
        <h3 className="panel-title">Zoning</h3>
        <p className="dh-note">There's no zoning plan for this municipality in the data.</p>
      </div>
    );
  }

  const choice = (label: string, a: ZoningAction, swatch?: string) => (
    <button key={label} className={`ev-filter${sameAction(action, a) ? " on" : ""}`} onClick={() => setAction(a)}>
      {swatch && <span className="zn-swatch" style={{ background: swatch }} />}
      {label}
    </button>
  );

  return (
    <div className="district-heat-panel zoning-panel">
      <h3 className="panel-title">Zoning</h3>
      <SupervisionNotice />
      <div className="zn-plan">
        {(Object.keys(ZONE_LABEL) as SiteZone[])
          .filter((z) => (plan.byZone[z] ?? 0) > 0)
          .map((z) => (
            <div className="info-row" key={z}>
              <span>
                <span className="zn-swatch" style={{ background: ZONE_COLOR[z] }} />
                {ZONE_LABEL[z]}
              </span>
              <span className="info-value">{hectares(plan.byZone[z] ?? 0)}</span>
            </div>
          ))}
        {plan.densified > 0 && (
          <div className="info-row">
            <span>Densified</span>
            <span className="info-value">{hectares(plan.densified)}</span>
          </div>
        )}
        {plan.energyZones > 0 && (
          <div className="info-row">
            <span>In energy zones</span>
            <span className="info-value">{hectares(plan.energyZones)}</span>
          </div>
        )}
        <div className="info-row" title="Value-capture levy on projects that gained from a zoning change, collected at their permits">
          <span>Levy collected so far</span>
          <span className="info-value">{formatCHF(plan.levyRp)}</span>
        </div>
      </div>

      <h4 className="dh-subtitle">Change the plan</h4>
      <p className="dh-note">
        Click parcels on the map to pick them{selection.size > 0 ? ` (${selection.size} picked)` : ""}, or pick every parcel of a zone:
      </p>
      <div className="ev-filters">
        {(["work", "mixed", "residential", "centre"] as SiteZone[]).map((z) => (
          <button key={z} className="ev-filter" onClick={() => zoning.selectMany(zoning.parcelIdsInZone(z, simDay))}>
            <span className="zn-swatch" style={{ background: ZONE_COLOR[z] }} />
            {ZONE_LABEL[z]}
          </button>
        ))}
        {selection.size > 0 && (
          <button className="ev-filter" onClick={() => zoning.clearSelection()}>
            Clear
          </button>
        )}
      </div>

      <div className="zn-actions">
        <span className="zn-action-label">Rezone to</span>
        <div className="ev-filters">{REZONE_TARGETS.map((z) => choice(ZONE_LABEL[z], { type: "rezone", zone: z }, ZONE_COLOR[z]))}</div>
        <span className="zn-action-label">Floors allowed</span>
        <div className="ev-filters">
          {Array.from({ length: MAX_EXTRA_FLOORS + 1 }, (_, n) => choice(n === 0 ? "As today" : `+${n}`, { type: "densify", extraFloors: n }))}
        </div>
        <span className="zn-action-label">District-heat priority</span>
        <div className="ev-filters">
          {choice("Set", { type: "dhPriority", on: true })}
          {choice("Lift", { type: "dhPriority", on: false })}
        </div>
        <span className="zn-action-label">High standard</span>
        <div className="ev-filters">
          {choice("Set", { type: "highStandard", on: true })}
          {choice("Lift", { type: "highStandard", on: false })}
        </div>
      </div>

      {selection.size === 0 ? (
        <p className="dh-note">Pick parcels to see what this change would do.</p>
      ) : quote.parcelIds.length === 0 ? (
        <p className="dh-note">The plan already says this for the picked parcels{action.type === "rezone" ? " (public-use land isn't rezoned)" : ""}.</p>
      ) : (
        <div className="zn-quote">
          <div className="zn-quote-title">{quote.title}</div>
          <div className="info-row">
            <span>Area</span>
            <span className="info-value">
              {hectares(quote.areaM2)} · {Math.round(quote.areaShare * 100)}% of zoned land
            </span>
          </div>
          <div className="info-row">
            <span>Buildings standing there</span>
            <span className="info-value">
              {quote.buildings} · {quote.dwellings} homes
            </span>
          </div>
          <div className="info-row">
            <span>Open building land</span>
            <span className="info-value">{hectares(quote.vacantM2)}</span>
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
            Comes into force {ZONING_LEAD_MONTHS} months after it's put forward
            {toVote
              ? quote.referendum === "mandatory"
                ? " — a change this large goes to a public vote first, which can strike it down."
                : " — contested enough that it will likely go to a public vote first, which can strike it down."
              : "."}
          </p>
          <div className="dh-actions">
            <button className="dh-order" onClick={() => zoning.submit(action, buildings, simClock.getSimTimeMs())}>
              Put forward for {formatCHF(quote.costRp)}
            </button>
          </div>
        </div>
      )}

      <AgriPvSection />

      {changes.length > 0 && (
        <>
          <h4 className="dh-subtitle">Changes to the plan</h4>
          {changes.map((c) => (
            <div className="zn-change" key={c.id}>
              <span className="zn-change-title">{c.title}</span>
              <ChangeStatus change={c} now={simDay} />
            </div>
          ))}
        </>
      )}
    </div>
  );
}
