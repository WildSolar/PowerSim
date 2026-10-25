import { useMemo, useState, useSyncExternalStore } from "react";
import { ToolListGroup, ToolListRow, ToolTile } from "./ToolList";
import { FARM_PLOT_COLORS } from "../map/colorModes";
import { AGRI_PV_BUILD_MONTHS, AGRI_PV_LEAD_MONTHS, AGRI_PV_PERMIT_MONTHS, AGRI_PV_SYSTEMS, type AgriPvSystem } from "../config/agriPv";
import { agriPvKindYear } from "../sim/agriPvProfile";
import { AgriPvDayChart } from "./AgriPvDayChart";
import { CardKind, CardSection, Facts, Folded } from "./CardParts";
import { ReactionBadge } from "./ReactionBadge";
import { mapFocus } from "../map/mapFocus";
import { AGRI_PV_DEVELOPER_LABEL, AGRI_PV_PHASE_LABEL, agriPv, stopped, partnerName, type AgriPvDesignation, type AgriPvDeveloper, type AgriPvProject } from "../sim/agriPv";
import { approval, votePct } from "../sim/approval";
import { formatDate, toDateMs } from "../sim/calendar";
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

/** Where a zone stands, in words. */
function designationStatus(d: AgriPvDesignation, now: number): string {
  if (d.rejected) return "Struck down by the voters";
  const vote = approval.getVoteInfo(`agriPv:${d.id}`, null, now);
  if (vote) return `Public vote ${monthYear(vote.atMs)} · poll ${votePct(vote.pollYes)}% yes`;
  if (d.effectiveAtMs > now) return `In force from ${monthYear(d.effectiveAtMs)}`;
  return `In force since ${monthYear(d.effectiveAtMs)}`;
}

/** "+9%", "−4%", "±0%". */
function signedPercent(x: number): string {
  const pct = Math.round(x * 100);
  return pct > 0 ? `+${pct}%` : pct < 0 ? `−${-pct}%` : "±0%";
}

/** The card for the field picked on the map or in a list: what it would hold — each kind it takes,
 * to compare, until one is built — where it stands, who develops it, and, for a zoned field no one
 * has taken up, the municipality's own permit. */
export function AgriPvFieldCard() {
  useAgriPv();
  const now = useSimDay();
  const buildings = useStockBuildings();
  // The kind looked at on a field not taken up (UI state, not saved).
  const [choice, setChoice] = useState<{ plotId: string; system: AgriPvSystem } | null>(null);
  const id = agriPv.getSelectedId();
  const plot = id ? agriPv.getPlot(id) : undefined;
  if (!id || !plot) return null;
  const project = agriPv.projectOn(id);
  const live = project && !stopped(project) ? project : undefined;
  const state = agriPv.stateAt(id, now);
  const free = agriPv.isFree(id, now);
  const answer = agriPv.farmerAnswer(id, now);
  const askAgain = agriPv.askAgainFromMs(id);
  const systems = agriPv.systemsFor(id);
  const system = live?.system ?? (choice?.plotId === id && systems.includes(choice.system) ? choice.system : systems[0]);
  const e = agriPv.economics(id, now, system);
  const year = new Date(toDateMs(now)).getUTCFullYear();
  const kinds = agriPvKindYear(year);
  const kind = kinds[system];
  const wholesale = tariffStore.at(now).wholesalePriceRpKWh;
  const restingUntil = project ? agriPv.restingUntil(project) : null;

  return (
    <InspectCard kicker="Agri-PV field" title={plot.name ?? "Field"} onClose={() => agriPv.select(null)}>
      <CardKind>
        {live
          ? `${AGRI_PV_PHASE_LABEL[live.phase]}${live.phaseUntilMs ? ` until ${monthYear(live.phaseUntilMs)}` : ""}`
          : state === "zoned"
            ? "Zoned for Agri-PV"
            : state === "refused"
              ? "Zoned — the farmer said no"
              : state === "planned"
                ? "Agri-PV zone on its way"
                : "Farmland"}{" "}
        · {hectares(plot.areaM2)}
        {plot.primeShare >= 0.5 ? " · prime cropland" : ""}
      </CardKind>

      {!live && (
        <>
          <div className="ev-filters" role="group" aria-label="Kind of installation">
            {systems.map((s) => (
              <button key={s} className={`ev-filter${s === system ? " on" : ""}`} aria-pressed={s === system} onClick={() => setChoice({ plotId: id, system: s })}>
                {AGRI_PV_SYSTEMS[s].label}
              </button>
            ))}
          </div>
          <p className="dh-note">
            {AGRI_PV_SYSTEMS[system].blurb}
            {plot.primeShare >= 0.5 ? " On cropland, only rows the machines can work between." : ""}
          </p>
        </>
      )}
      <Facts
        facts={[
          live
            ? { label: "Installation", value: `${AGRI_PV_SYSTEMS[live.system].label} · ${mw(live.capacityKw)}`, title: "The kind of installation, and its size over the whole field" }
            : { label: "Size", value: mw(e.capacityKw), title: "Its size over the whole field, of this kind" },
          live && {
            label: "Developer",
            value: (
              <>
                {AGRI_PV_DEVELOPER_LABEL[live.developer]}
                {live.partnerEgid ? ` · ${partnerName(live.partnerEgid, buildings)}` : ""}
                <span className="bp-sub">
                  {" "}
                  ·{" "}
                  {live.developer === "business"
                    ? `takes ${Math.round(live.ppaShare * 100)}% of the power as it comes; the utility buys the rest at the feed-in price`
                    : live.developer === "cooperative"
                      ? "sells all the power to the utility at the feed-in price"
                      : "the utility's own: no feed-in paid, that much less power bought"}
                </span>
              </>
            ),
          },
          {
            label: "Output",
            value: (
              <>
                {(e.yearlyKWh / 1e6).toFixed(1)} GWh a year<span className="bp-sub"> · {Math.round(kind.winterShare * 100)}% in winter</span>
              </>
            ),
            title: "A year's output, and the share of it made from November to February, when the grid's power is dirtiest and dearest",
          },
          {
            label: "Its hours on the market",
            value: `${signedPercent(kind.valueFactor - 1)} on the average hour`,
            title:
              "What the market pays at the hours it makes its power, against the month's average hour: power in the morning and the evening is worth more than at a sunny noon, when every roof makes it. It counts for the utility's own fields; feed-in pays the same whatever the hour.",
          },
          {
            label: "CO₂ it saves",
            value: (
              <>
                {Math.round((e.yearlyKWh * kind.co2GPerKWh) / 1e6)} t a year<span className="bp-sub"> · {Math.round(kind.co2GPerKWh)} g/kWh</span>
              </>
            ),
            title: "The grid's power it replaces, at the hours it makes its own: dirtier on winter mornings and evenings, cleaner at a sunny noon",
          },
        ]}
      />
      <CardSection title="Its day">
        <AgriPvDayChart kind={kind} label={AGRI_PV_SYSTEMS[system].label} year={year} top={Math.max(...Object.values(kinds).flatMap((k) => k.summerDay))} />
      </CardSection>

      {(state === "refused" || free || (live?.developer === "municipality" && live.phase === "permitted") || (restingUntil !== null && restingUntil > now)) && (
        <CardSection title="What could change here">
          {state === "refused" && answer && (
            <p className="dh-note">
              Asked in {monthYear(answer.atMs)}, the farmer didn&apos;t want panels over the field. They may be asked again from {monthYear(askAgain ?? now)} — farmers come round as
              acceptance grows.
            </p>
          )}
          {free && (
            <>
              <Facts
                facts={[
                  {
                    label: "The farmer",
                    value: answer?.yes ? `Agreed (${monthYear(answer.atMs)})` : "Not asked yet",
                    title: "Whoever farms the field has the last word: no one knows beforehand whether they'd have panels over it",
                  },
                  { label: "Panels", value: formatCHF(e.buildCostRp) },
                  {
                    label: `Upkeep and rent${answer?.yes ? "" : " (typical)"}`,
                    value: `${formatCHF(e.upkeepRpPerYear + e.rentRpPerYear)} a year`,
                    title: answer?.yes
                      ? "Paid by the utility each year: the upkeep, and the rent the farmer asks for the land under the panels"
                      : "Paid by the utility each year: the upkeep, and a typical rent for the land — the farmer names their own once asked",
                  },
                  { label: "Its power, at today's price", value: `${formatCHF(e.yearlyKWh * wholesale * kind.valueFactor)} a year`, title: "The power the utility needn't buy, at today's wholesale price and the hours it comes" },
                ]}
              />
              <Folded summary="How developing it works">
                <p className="dh-note">
                  Businesses and energy cooperatives may take this field up on their own. To develop it yourself, ask the farmer first — a no stands for a few years — then apply for
                  the permit ({AGRI_PV_PERMIT_MONTHS} months; sometimes refused, often appealed); the panels are paid when you order them, in service {AGRI_PV_BUILD_MONTHS} months on.
                </p>
              </Folded>
              <div className="dh-actions">
                {answer?.yes ? (
                  <button className="dh-order" onClick={() => agriPv.applyForPermit(id, system, simClock.getSimTimeMs())}>
                    Apply for the permit: {AGRI_PV_SYSTEMS[system].label.toLowerCase()} — {formatCHF(agriPv.permitCostRp(id))}
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
        </CardSection>
      )}

      {project && project.log.length > 0 && (
        <Folded summary="What happened here">
          {agriPv
            .getProjects()
            .filter((p) => p.plotId === id)
            .flatMap((p) => p.log)
            .map((l, i) => (
              <div className="dh-note" key={i}>
                {monthYear(l.atMs)}: {l.text}
              </div>
            ))}
        </Folded>
      )}
    </InspectCard>
  );
}

const DEVELOPER_SHORT: Record<AgriPvDeveloper, string> = { business: "A business (PPA)", cooperative: "An energy cooperative", municipality: "Yours" };

type DeveloperFilter = "all" | AgriPvDeveloper;
const DEVELOPER_FILTERS: { id: DeveloperFilter; label: string }[] = [
  { id: "all", label: "All" },
  { id: "municipality", label: "Yours" },
  { id: "business", label: "Businesses" },
  { id: "cooperative", label: "Cooperatives" },
];

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
        : stopped(p)
          ? resting
            ? ` · can be taken up again from ${monthYear(resting)}`
            : ""
          : ` · ${AGRI_PV_PHASE_LABEL[p.phase].toLowerCase()}${p.phaseUntilMs ? ` until ${monthYear(p.phaseUntilMs)}` : ""}`;
  return (
    <ToolListRow
      key={p.id}
      color={stopped(p) ? FARM_PLOT_COLORS.refused : FARM_PLOT_COLORS[state === "farmland" || state === "planned" ? "zoned" : state]}
      title={agriPv.fieldName(p)}
      figure={mw(p.capacityKw)}
      detail={`${DEVELOPER_SHORT[p.developer]}${stage}`}
      selected={p.plotId === selectedId}
      onClick={() => pick(p.plotId)}
    />
  );
}

/** "vertical 0.3 · fixed 0.9 · tracking 0.5 MWp": how big a field's installation would be, of each kind it takes. */
function kindSizes(plotId: string): string {
  return `${agriPv
    .systemsFor(plotId)
    .map((s) => `${AGRI_PV_SYSTEMS[s].label.split(" ")[0].toLowerCase()} ${(agriPv.capacityFor(plotId, s) / 1000).toFixed(1)}`)
    .join(" · ")} MWp`;
}

/** "37%", or "34–42%" for several polls. */
function pollRange(polls: number[]): string {
  const lo = Math.min(...polls);
  const hi = Math.max(...polls);
  return votePct(lo) === votePct(hi) ? `${votePct(lo)}%` : `${votePct(lo)}–${votePct(hi)}%`;
}

/** The Agri-PV layer's panel: where the town stands at a glance, what needs the player, the zones and
 * the fields (the Overview), or zoning the picked fields and the free zoned fields to take up (Build). */
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
  const [developer, setDeveloper] = useState<DeveloperFilter>("all");
  const summary = useMemo(() => {
    const projects = agriPv.getProjects();
    const live = projects.filter((p) => !stopped(p) || (agriPv.restingUntil(p) ?? 0) > now);
    const free = plots.filter((p) => agriPv.isFree(p.id, now));
    const designations = agriPv.getDesignations();
    const votes = designations
      .filter((d) => !d.rejected && d.voteAtMs !== null && d.voteAtMs > now)
      .map((d) => ({ d, vote: approval.getVoteInfo(`agriPv:${d.id}`, null, now) }))
      .filter((v): v is { d: AgriPvDesignation; vote: { atMs: number; pollYes: number } } => v.vote !== null)
      .sort((a, b) => a.vote.atMs - b.vote.atMs);
    const inForce = designations.filter((d) => !d.rejected && d.effectiveAtMs <= now);
    return {
      inServiceKw: agriPv.capacityAtKw(now),
      inService: projects.filter((p) => p.installedAtMs !== undefined && p.installedAtMs <= now).length,
      underWay: live.filter((p) => !stopped(p) && p.phase !== "operating").length,
      building: live.filter((p) => p.phase === "building").length,
      // Newest first; struck-down fields drop off once they may be taken up again.
      projects: [...live].reverse(),
      // The free zoned fields: those whose farmer agreed first, then the biggest.
      free: free
        .map((p) => ({ p, agreed: agriPv.farmerAnswer(p.id, now)?.yes === true, kw: agriPv.largestCapacityKw(p.id) }))
        .sort((a, b) => Number(b.agreed) - Number(a.agreed) || b.kw - a.kw),
      freeM2: free.reduce((sum, p) => sum + p.areaM2, 0),
      refused: plots.filter((p) => agriPv.stateAt(p.id, now) === "refused").length,
      agreed: plots.filter((p) => agriPv.farmerAnswer(p.id, now)?.yes).length,
      votes,
      inForceM2: agriPv.zonedAreaM2(now),
      inForceCount: inForce.length,
      // Zones: those still to be voted on first, then the rest, newest first.
      designations: [...designations].reverse().sort((a, b) => Number(votes.some((v) => v.d === b)) - Number(votes.some((v) => v.d === a))),
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [now, version, plots]);
  const quote = useMemo(() => agriPv.quote(), [version]); // eslint-disable-line react-hooks/exhaustive-deps
  const reaction = approval.reactionTo(quote.stances);
  const dialogue = policyStore.get().agriPvDialogue > 0;

  if (plots.length === 0) {
    return (
      <div className="district-heat-panel">
        <h3 className="panel-title">Agri-PV</h3>
        <p className="dh-note">There&apos;s no farmland for Agri-PV in this municipality.</p>
      </div>
    );
  }

  const fresh = agriPv.getDesignations().length === 0 && summary.projects.length === 0;
  const yoursPermitted = summary.projects.filter((p) => p.developer === "municipality" && p.phase === "permitted");
  const agreedFree = summary.free.filter((f) => f.agreed);
  const nextVotes = summary.votes.filter((v) => monthYear(v.vote.atMs) === monthYear(summary.votes[0]?.vote.atMs ?? 0));
  const needsYou = [
    ...yoursPermitted.map((p) => (
      <ToolListRow
        key={`build-${p.id}`}
        color={FARM_PLOT_COLORS.underWay}
        title={agriPv.fieldName(p)}
        figure={formatCHF(agriPv.economics(p.plotId, now, p.system).buildCostRp)}
        detail="Permitted — order the panels on its card"
        selected={p.plotId === selectedId}
        onClick={() => pick(p.plotId)}
      />
    )),
    ...agreedFree.map(({ p, kw }) => (
      <ToolListRow
        key={`permit-${p.id}`}
        color={FARM_PLOT_COLORS.zoned}
        title={p.name ?? "Field"}
        figure={`up to ${mw(kw)}`}
        detail="The farmer agreed — apply for the permit on its card"
        selected={p.id === selectedId}
        onClick={() => pick(p.id)}
      />
    )),
    // The next voting day, once — the zones it decides, and how their polls stand; the rest wait in the zone list.
    ...(nextVotes.length === 0
      ? []
      : [
          <ToolListRow
            key="vote"
            color={FARM_PLOT_COLORS.planned}
            title={nextVotes.length === 1 ? nextVotes[0].d.title : `${nextVotes.length} zones to the vote`}
            figure={monthYear(nextVotes[0].vote.atMs)}
            detail={`Public vote · ${pollRange(nextVotes.map((v) => v.vote.pollYes))} yes in the polls`}
            selected={nextVotes.some((v) => v.d.plotIds.includes(selectedId ?? ""))}
            onClick={() => pick(nextVotes[0].d.plotIds[0])}
          />,
        ]),
  ];
  const shown = summary.projects.filter((p) => developer === "all" || p.developer === developer);
  const nextVote = summary.votes[0];

  const overview = (
    <>
      {fresh && (
        <p className="dh-note">
          Solar over fields that stay farmed. You zone the fields; a business with a big electricity use, an energy cooperative or the municipality itself then takes one up,
          applies for the permit and builds.
        </p>
      )}
      <div className="tool-tiles">
        <ToolTile label="In service" value={mw(summary.inServiceKw)} sub={`${summary.inService} field${summary.inService === 1 ? "" : "s"}`} title="The Agri-PV fields making power, whoever built them" />
        <ToolTile
          label="Under way"
          value={String(summary.underWay)}
          sub={summary.building > 0 ? `${summary.building} being built` : "in permits or the courts"}
          title="Fields taken up and not yet in service: in the permit procedure, in the courts, permitted, or being built"
        />
        <ToolTile
          label="Zoned, free"
          value={hectares(summary.freeM2)}
          sub={`${summary.free.length} field${summary.free.length === 1 ? "" : "s"} · ${summary.agreed} farmer${summary.agreed === 1 ? "" : "s"} agreed`}
          title={`Zoned fields no one has taken up yet, of ${plots.length} fields of farmland (${hectares(plots.reduce((s, p) => s + p.areaM2, 0))}). Whoever farms a field has the last word; a no stands for a few years${summary.refused > 0 ? ` — ${summary.refused} said no, for now` : ""}.`}
        />
        <ToolTile
          label="Acceptance"
          value={`${Math.round(agriPv.getAcceptance() * 100)}%`}
          sub={dialogue ? "dialogue running" : "grows with each field"}
          title={`How far people have come round to solar over farmland: it softens the opposition to Agri-PV zones, new and in force, and brings farmers round. ${
            dialogue ? "The Agri-PV dialogue is running: it grows year by year." : "It grows a little with every field people get to see; the Agri-PV dialogue (Town hall → Measures, Advice) builds it faster."
          }`}
        />
      </div>

      <ToolListGroup title="Needs you" limit={5}>
        {needsYou}
      </ToolListGroup>

      {summary.designations.length > 0 && (
        <>
          <ToolListGroup
            title="Zones"
            limit={3}
            summary={`${hectares(summary.inForceM2)} in force in ${summary.inForceCount} zone${summary.inForceCount === 1 ? "" : "s"}${
              nextVote ? ` · ${summary.votes.length} to the vote, next ${monthYear(nextVote.vote.atMs)} (poll ${votePct(nextVote.vote.pollYes)}% yes)` : ""
            }`}
          >
            {summary.designations.map((d) => {
              const s = designationStatus(d, now);
              return (
                <ToolListRow
                  key={d.id}
                  color={d.rejected ? FARM_PLOT_COLORS.refused : d.effectiveAtMs <= now ? FARM_PLOT_COLORS.zoned : FARM_PLOT_COLORS.planned}
                  title={d.title}
                  detail={s}
                  selected={d.plotIds.includes(selectedId ?? "")}
                  onClick={() => pick(d.plotIds[0])}
                />
              );
            })}
          </ToolListGroup>
        </>
      )}

      {summary.projects.length > 0 && (
        <>
          <h4 className="tool-list-heading">Fields</h4>
          <div className="ev-filters" role="group" aria-label="Whose fields">
            {DEVELOPER_FILTERS.map((f) => (
              <button key={f.id} className={`ev-filter${developer === f.id ? " on" : ""}`} aria-pressed={developer === f.id} onClick={() => setDeveloper(f.id)}>
                {f.label}
              </button>
            ))}
          </div>
          {shown.length === 0 && <p className="dh-note">None.</p>}
          <ToolListGroup title="In service" limit={3}>
            {shown.filter((p) => p.phase === "operating").map((p) => projectRow(p, now, selectedId))}
          </ToolListGroup>
          <ToolListGroup title="Being built" limit={3}>
            {shown.filter((p) => p.phase === "building").map((p) => projectRow(p, now, selectedId))}
          </ToolListGroup>
          <ToolListGroup title="Permit, or in the courts" limit={3}>
            {shown.filter((p) => p.phase === "permitting" || p.phase === "appeal" || p.phase === "permitted").map((p) => projectRow(p, now, selectedId))}
          </ToolListGroup>
          <ToolListGroup title="Refused, or struck down" limit={0}>
            {shown.filter(stopped).map((p) => projectRow(p, now, selectedId))}
          </ToolListGroup>
          <p className="dh-note tool-list-hint">Click a field here or on the map: its card shows where it stands.</p>
        </>
      )}
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
            <span className="zn-reaction">
              <ReactionBadge reaction={reaction} />
            </span>
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
            {summary.free.map(({ p, agreed, kw }) => (
              <ToolListRow
                key={p.id}
                color={FARM_PLOT_COLORS.zoned}
                title={p.name ?? "Field"}
                figure={`up to ${mw(kw)}`}
                detail={`${hectares(p.areaM2)} · ${agreed ? "the farmer agreed" : "farmer not asked"} · ${kindSizes(p.id)}`}
                selected={p.id === selectedId}
                onClick={() => pick(p.id)}
              />
            ))}
          </ToolListGroup>
          <p className="dh-note tool-list-hint">Those whose farmer agreed first, then the biggest. Pick a field: its card compares the kinds, asks the farmer, and has the permit.</p>
        </>
      )}
      {summary.refused > 0 && (
        <p className="dh-note">
          {summary.refused} zoned field{summary.refused === 1 ? "" : "s"} where the farmer said no, for now.
        </p>
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
