import { useMemo, useSyncExternalStore } from "react";
import { ToolListGroup, ToolListRow } from "./ToolList";
import { FARM_PLOT_COLORS } from "../map/colorModes";
import { AGRI_PV_BUILD_MONTHS, AGRI_PV_LEAD_MONTHS, AGRI_PV_PERMIT_MONTHS, AGRI_PV_SYSTEMS } from "../config/agriPv";
import { mapFocus } from "../map/mapFocus";
import { AGRI_PV_DEVELOPER_LABEL, AGRI_PV_PHASE_LABEL, agriPv, partnerName, type AgriPvDesignation, type AgriPvDeveloper, type AgriPvProject } from "../sim/agriPv";
import { approval, votePct } from "../sim/approval";
import { formatDate } from "../sim/calendar";
import { simClock } from "../sim/engine";
import { policyStore } from "../sim/policy";
import { useSimDay } from "../sim/store";
import { tariffStore } from "../sim/tariffStore";
import { formatCHF } from "./format";
import { InspectCard } from "./InspectCard";
import { PlotLink } from "./PlotLink";
import { ToolPanel } from "./ToolPanel";
import { useStockBuildings } from "./useStock";
import "./districtHeatPanel.css";
import "./evChargingPanel.css";
import "./zoningPanel.css";

function monthYear(ms: number): string {
  return formatDate(ms).replace(/^\d+ /, "");
}

function hectares(m2: number): string {
  return `${(m2 / 10_000).toFixed(1)} ha`;
}

function mw(kw: number): string {
  return `${(kw / 1000).toFixed(1)} MWp`;
}

function useAgriPv(): number {
  return useSyncExternalStore(
    (l) => agriPv.subscribe(l),
    () => agriPv.getVersion(),
  );
}

function pick(plotId: string): void {
  const plot = agriPv.getPlot(plotId);
  agriPv.select(plotId);
  if (plot) mapFocus.request({ lon: plot.lon, lat: plot.lat, minZoom: 14.5 });
}

function DesignationStatus({ d, now }: { d: AgriPvDesignation; now: number }) {
  if (d.rejected) return <span className="zn-status bad">Struck down by the voters</span>;
  const vote = approval.getVoteInfo(`agriPv:${d.id}`, null, now);
  if (vote) return <span className="zn-status">Public vote {monthYear(vote.atMs)} · poll {votePct(vote.pollYes)}% yes</span>;
  if (d.effectiveAtMs > now) return <span className="zn-status">In force from {monthYear(d.effectiveAtMs)}</span>;
  return <span className="zn-status good">In force since {monthYear(d.effectiveAtMs)}</span>;
}

/** The card for the field picked on the map or in a list: what it would hold, where it stands, who
 * develops it — and, for a zoned field no one has taken up, the municipality's own permit. */
export function AgriPvFieldCard() {
  useAgriPv();
  const now = useSimDay();
  const buildings = useStockBuildings();
  const id = agriPv.getSelectedId();
  const plot = id ? agriPv.getPlot(id) : undefined;
  if (!id || !plot) return null;
  const project = agriPv.projectOn(id);
  const live = project && project.phase !== "struckDown" ? project : undefined;
  const state = agriPv.stateAt(id, now);
  const free = agriPv.isFree(id, now);
  const answer = agriPv.farmerAnswer(id, now);
  const askAgain = agriPv.askAgainFromMs(id);
  const e = agriPv.economics(id, now);
  const wholesale = tariffStore.at(now).wholesalePriceRpKWh;
  const restingUntil = project ? agriPv.restingUntil(project) : null;

  return (
    <InspectCard kicker="Agri-PV field" title={plot.name ?? "Field"} onClose={() => agriPv.select(null)}>
      <div className="dh-note">
        {live
          ? `${AGRI_PV_PHASE_LABEL[live.phase]}${live.phaseUntilMs ? ` · until ${monthYear(live.phaseUntilMs)}` : ""}`
          : state === "zoned"
            ? "Zoned for Agri-PV"
            : state === "refused"
              ? "Zoned for Agri-PV — the farmer said no"
            : state === "planned"
              ? "Agri-PV zone on its way"
              : "Farmland"}
      </div>
      <div className="info-row">
        <span>Area</span>
        <span className="info-value">
          {hectares(plot.areaM2)}
          {plot.primeShare >= 0.5 ? " · prime cropland" : ""}
        </span>
      </div>
      <div className="info-row" title="The kind of installation the field suits, and its size over the whole field">
        <span>Installation</span>
        <span className="info-value">
          {AGRI_PV_SYSTEMS[e.system].label} · {mw(live?.capacityKw ?? e.capacityKw)}
        </span>
      </div>
      <div className="info-row">
        <span>Output</span>
        <span className="info-value">{(e.yearlyKWh / 1e6).toFixed(1)} GWh a year</span>
      </div>
      {live && (
        <div className="info-row">
          <span>Developer</span>
          <span className="info-value">
            {AGRI_PV_DEVELOPER_LABEL[live.developer]}
            {live.partnerEgid ? ` · ${partnerName(live.partnerEgid, buildings)}` : ""}
          </span>
        </div>
      )}
      {live?.developer === "business" && (
        <p className="dh-note">The business takes {Math.round(live.ppaShare * 100)}% of the power as it comes; the utility buys the rest at the feed-in price.</p>
      )}
      {live?.developer === "cooperative" && <p className="dh-note">The cooperative sells all the power to the utility at the feed-in price.</p>}
      {live?.developer === "municipality" && <p className="dh-note">The utility&apos;s own: it pays no feed-in for the power, and buys that much less.</p>}

      {state === "refused" && answer && (
        <p className="dh-note">
          Asked in {monthYear(answer.atMs)}, the farmer didn&apos;t want panels over the field. They may be asked again from {monthYear(askAgain ?? now)} — farmers come round as
          acceptance grows.
        </p>
      )}
      {free && (
        <>
          <h4 className="dh-subtitle">Develop it yourself</h4>
          <div className="info-row" title="Whoever farms the field has the last word: no one knows beforehand whether they'd have panels over it">
            <span>The farmer</span>
            <span className="info-value">{answer?.yes ? `Agreed (${monthYear(answer.atMs)})` : "Not asked yet"}</span>
          </div>
          <div className="info-row">
            <span>Panels</span>
            <span className="info-value">{formatCHF(e.buildCostRp)}</span>
          </div>
          <div
            className="info-row"
            title={answer?.yes ? "Paid by the utility each year: the upkeep, and the rent the farmer asks for the land under the panels" : "Paid by the utility each year: the upkeep, and a typical rent for the land — the farmer names their own once asked"}
          >
            <span>Upkeep and rent{answer?.yes ? "" : " (typical)"}</span>
            <span className="info-value">{formatCHF(e.upkeepRpPerYear + e.rentRpPerYear)} a year</span>
          </div>
          <div className="info-row" title="The power the utility needn't buy, at this year's wholesale price">
            <span>Power, at today&apos;s wholesale price</span>
            <span className="info-value">{formatCHF(e.yearlyKWh * wholesale)} a year</span>
          </div>
          <p className="dh-note">
            Businesses and energy cooperatives may take this field up on their own. To develop it yourself, ask the farmer first — a no stands for a few years — then apply for
            the permit ({AGRI_PV_PERMIT_MONTHS} months, sometimes appealed); the panels are paid when you order them, in service {AGRI_PV_BUILD_MONTHS} months on.
          </p>
          <div className="dh-actions">
            {answer?.yes ? (
              <button className="dh-order" onClick={() => agriPv.applyForPermit(id, simClock.getSimTimeMs())}>
                Apply for the permit — {formatCHF(agriPv.permitCostRp(id))}
              </button>
            ) : (
              <button className="dh-order" onClick={() => agriPv.askFarmer(id, simClock.getSimTimeMs())}>
                Ask the farmer
              </button>
            )}
          </div>
        </>
      )}
      {live?.developer === "municipality" && live.phase === "permitted" && (
        <div className="dh-actions">
          <button className="dh-order" onClick={() => agriPv.build(id, simClock.getSimTimeMs())}>
            Build for {formatCHF(e.buildCostRp)}
          </button>
        </div>
      )}
      {restingUntil !== null && restingUntil > now && <p className="dh-note">Struck down in court; can be taken up again from {monthYear(restingUntil)}.</p>}

      {project && project.log.length > 0 && (
        <details className="wind-log">
          <summary className="dh-note">History</summary>
          {agriPv
            .getProjects()
            .filter((p) => p.plotId === id)
            .flatMap((p) => p.log)
            .map((l, i) => (
              <div className="dh-note" key={i}>
                {monthYear(l.atMs)}: {l.text}
              </div>
            ))}
        </details>
      )}
    </InspectCard>
  );
}

const DEVELOPER_SHORT: Record<AgriPvDeveloper, string> = { business: "A business (PPA)", cooperative: "An energy cooperative", municipality: "Yours" };

/** A field taken up, in the list: its colour on the map, its size, who develops it and where it stands. */
function projectRow(p: AgriPvProject, now: number, selectedId: string | null) {
  const state = agriPv.stateAt(p.plotId, now);
  // What the group's heading doesn't say: who, and the date that matters at this stage.
  const resting = agriPv.restingUntil(p);
  const stage =
    p.phase === "operating"
      ? ""
      : p.phase === "building"
        ? ` · ready ${monthYear(p.installedAtMs ?? now)}`
        : p.phase === "struckDown"
          ? resting
            ? ` · can be taken up again from ${monthYear(resting)}`
            : ""
          : ` · ${AGRI_PV_PHASE_LABEL[p.phase].toLowerCase()}${p.phaseUntilMs ? ` until ${monthYear(p.phaseUntilMs)}` : ""}`;
  return (
    <ToolListRow
      key={p.id}
      color={p.phase === "struckDown" ? FARM_PLOT_COLORS.refused : FARM_PLOT_COLORS[state === "farmland" || state === "planned" ? "zoned" : state]}
      title={agriPv.fieldName(p)}
      figure={mw(p.capacityKw)}
      detail={`${DEVELOPER_SHORT[p.developer]}${stage}`}
      selected={p.plotId === selectedId}
      onClick={() => pick(p.plotId)}
    />
  );
}

/** The Agri-PV layer's panel: the farmland, the zones and the fields and how people take them (the
 * Overview), or zoning the picked fields and taking up a free zoned field (Build). */
export function AgriPvPanel() {
  const version = useAgriPv();
  useSyncExternalStore(
    (l) => policyStore.subscribe(l),
    () => policyStore.get(),
  );
  const now = useSimDay();
  const plots = agriPv.getPlots();
  const selection = agriPv.getSelection();
  const selectedId = agriPv.getSelectedId();
  const summary = useMemo(() => {
    const projects = agriPv.getProjects();
    const live = projects.filter((p) => p.phase !== "struckDown" || (agriPv.restingUntil(p) ?? 0) > now);
    return {
      farmM2: plots.reduce((sum, p) => sum + p.areaM2, 0),
      zonedM2: agriPv.zonedAreaM2(now),
      inServiceKw: agriPv.capacityAtKw(now),
      inService: projects.filter((p) => p.installedAtMs !== undefined && p.installedAtMs <= now).length,
      // Newest first; struck-down fields drop off once they may be taken up again.
      projects: [...live].reverse(),
      free: plots.filter((p) => agriPv.isFree(p.id, now)),
      refused: plots.filter((p) => agriPv.stateAt(p.id, now) === "refused").length,
      asked: plots.filter((p) => agriPv.farmerAnswer(p.id, now) !== undefined || agriPv.askAgainFromMs(p.id) !== null).length,
      agreed: plots.filter((p) => agriPv.farmerAnswer(p.id, now)?.yes).length,
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [now, version, plots]);
  const quote = useMemo(() => agriPv.quote(), [version]); // eslint-disable-line react-hooks/exhaustive-deps
  const reaction = approval.reactionTo(quote.stances);
  const dialogue = policyStore.get().agriPvDialogue > 0;
  const designations = [...agriPv.getDesignations()].reverse();

  if (plots.length === 0) {
    return (
      <div className="district-heat-panel">
        <h3 className="panel-title">Agri-PV</h3>
        <p className="dh-note">There&apos;s no farmland for Agri-PV in this municipality.</p>
      </div>
    );
  }

  const overview = (
    <>
      <p className="dh-note">
        Solar over fields that stay farmed. You zone the fields; a business with a big electricity use, an energy cooperative or the municipality itself then takes one up,
        applies for the permit and builds.
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
        <span>Fields in service</span>
        <span className="info-value">
          {summary.inService} · {mw(summary.inServiceKw)}
        </span>
      </div>
      <div className="info-row" title="Farmers on zoned fields asked so far, by whoever wanted to build: how many agreed, and how many said no (a no stands for a few years)">
        <span>Farmers asked · agreed</span>
        <span className="info-value">
          {summary.asked} · {summary.agreed}
        </span>
      </div>
      <div className="info-row" title="How far people have come round to solar over farmland: it softens the opposition to Agri-PV zones, new and in force, and brings farmers round">
        <span>Acceptance</span>
        <span className="info-value">{Math.round(agriPv.getAcceptance() * 100)}%</span>
      </div>
      <p className="dh-note">
        {dialogue
          ? "The Agri-PV dialogue is running: acceptance grows year by year."
          : "Acceptance grows a little with every field people get to see. The Agri-PV dialogue (Town hall → Measures, Advice) builds it faster."}
      </p>

      {designations.length > 0 && (
        <>
          <h4 className="dh-subtitle">Zones</h4>
          {designations.map((d) => (
            <div className="zn-change" key={d.id}>
              <span className="zn-change-title">{d.title}</span>
              <DesignationStatus d={d} now={now} />
            </div>
          ))}
        </>
      )}

      {summary.projects.length > 0 && <p className="dh-note tool-list-hint">Click a field here or on the map: its card shows where it stands.</p>}
      <ToolListGroup title="In service">{summary.projects.filter((p) => p.phase === "operating").map((p) => projectRow(p, now, selectedId))}</ToolListGroup>
      <ToolListGroup title="Being built">{summary.projects.filter((p) => p.phase === "building").map((p) => projectRow(p, now, selectedId))}</ToolListGroup>
      <ToolListGroup title="Permit, or in the courts">
        {summary.projects.filter((p) => p.phase === "permitting" || p.phase === "appeal" || p.phase === "permitted").map((p) => projectRow(p, now, selectedId))}
      </ToolListGroup>
      <ToolListGroup title="Struck down in court">{summary.projects.filter((p) => p.phase === "struckDown").map((p) => projectRow(p, now, selectedId))}</ToolListGroup>
    </>
  );

  const build = (
    <>
      <h4 className="dh-subtitle">Zone fields for Agri-PV</h4>
      {selection.size === 0 ? (
        <p className="dh-note">Click farmland on the map (the green fields, outside the building zones) to pick it for an Agri-PV zone.</p>
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
            Always goes to a public vote, which can strike it down; in force {AGRI_PV_LEAD_MONTHS} months after it&apos;s put forward. Some of the opposition stays for as long
            as the zone is there{quote.primeShare > 0.3 ? " — more so on prime cropland" : ""}.
          </p>
          <div className="dh-actions">
            <button className="dh-order" onClick={() => agriPv.submit(simClock.getSimTimeMs())}>
              Put forward for {formatCHF(quote.costRp)}
            </button>
            <button onClick={() => agriPv.clearSelection()}>Clear</button>
          </div>
        </div>
      )}

      {summary.free.length === 0 ? (
        <>
          <h4 className="dh-subtitle">Zoned fields no one has taken up</h4>
          <p className="dh-note">None at the moment.</p>
        </>
      ) : (
        <>
          <ToolListGroup title="Zoned, no one has taken them up" limit={8}>
            {summary.free.map((p) => (
              <ToolListRow
                key={p.id}
                color={FARM_PLOT_COLORS.zoned}
                title={p.name ?? "Field"}
                figure={mw(agriPv.installationFor(p.id).capacityKw)}
                detail={`${hectares(p.areaM2)} · ${agriPv.farmerAnswer(p.id, now)?.yes ? "the farmer has agreed" : "the farmer hasn't been asked"}`}
                selected={p.id === selectedId}
                onClick={() => pick(p.id)}
              />
            ))}
          </ToolListGroup>
          <p className="dh-note tool-list-hint">Pick a field: its card asks the farmer, and has the permit, to develop it yourself.</p>
        </>
      )}
      {summary.refused > 0 && (
        <>
          <p className="dh-note">
            {summary.refused} zoned field{summary.refused === 1 ? "" : "s"} where the farmer said no, for now.
          </p>
        </>
      )}
    </>
  );

  return (
    <ToolPanel
      mode="agriPv"
      title="Agri-PV"
      titleExtra={<PlotLink chart="electricity" title="Electricity made and used over time" />}
      overview={overview}
      build={build}
      buildActive={selection.size > 0}
    />
  );
}
