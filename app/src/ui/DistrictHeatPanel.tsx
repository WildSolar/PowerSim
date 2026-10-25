import { useEffect, useMemo, useState, useSyncExternalStore } from "react";
import { DH_BOILER_EFFICIENCY, DH_LINE_COST_FACTOR, DH_SOURCE_SPECS, DH_WOOD_NUISANCE_RADIUS_M, type DhLineTerrain } from "../config/districtHeat";
import type { DhCandidateData } from "../data/types";
import { BASELINE_YEAR, formatDate, toDateMs } from "../sim/calendar";
import { districtHeat, type DhNetworkInfo } from "../sim/districtHeat";
import { zeroDhEnergy, type DhEnergyKWh } from "../sim/districtHeatDispatch";
import { candidateName, onContract, districtHeatSources, type PlacedKind } from "../sim/districtHeatSources";
import { districtHeatLines } from "../sim/districtHeatLines";
import { simClock } from "../sim/engine";
import { networkCoverage, networkPeaksW, networkStatusAt, networkYearProjection, streetDemand, type CoverageShare } from "../sim/districtHeatStats";
import { heatPumpSiting } from "../sim/heatPumpSiting";
import { OIL_ENERGY_KWH_PER_LITER } from "../sim/heatingSystems";
import { existsAt } from "../sim/lifetime";
import { market } from "../sim/market";
import { useSimDay } from "../sim/store";
import { computeHeatingTechnologyBreakdown } from "../sim/yearReport";
import { formatCHF } from "./format";
import { mapFocus } from "../map/mapFocus";
import { useStockBuildings } from "./useStock";
import "./districtHeatPanel.css";
import { InspectCard } from "./InspectCard";
import { ToolPanel } from "./ToolPanel";
import { PlotLink } from "./PlotLink";
import { CardKind, Facts } from "./CardParts";
import { ToolListGroup, ToolListRow, ToolTile } from "./ToolList";

function percent(part: number, share: CoverageShare): string {
  return share.total > 0 ? `${Math.round((part / share.total) * 100)}%` : "–";
}

function formatMW(w: number): string {
  const mw = w / 1e6;
  return `${mw.toFixed(mw < 10 ? 1 : 0)} MW`;
}

function monthYear(ms: number): string {
  return formatDate(ms).replace(/^\d+ /, "");
}

// A network's dot in a list: how much of its winter peak clean sources carry.
const CLEAN_COLOR = { all: "#1baf7a", most: "#f2b01e", little: "#d0342c", none: "#b6b4ac" };
const DH_BUILDING_COLOR = "#b6b4ac";

const PLACED: { kind: PlacedKind; note: string }[] = [
  { kind: "groundwater", note: "over a usable aquifer" },
  { kind: "surfaceWater", note: "beside a river or lake" },
  { kind: "wood", note: "anywhere, as big as the town's forest can feed" },
];

/** Who made last year's district heat, once that year has been counted. */
function useLastYearHeat(buildings: ReturnType<typeof useStockBuildings>, simDay: number): DhEnergyKWh | null {
  const year = new Date(toDateMs(simDay)).getUTCFullYear() - 1;
  const [energy, setEnergy] = useState<{ year: number; e: DhEnergyKWh } | null>(null);
  useEffect(() => {
    if (year < BASELINE_YEAR) return;
    let cancelled = false;
    computeHeatingTechnologyBreakdown(buildings, year).then((t) => {
      if (!cancelled) setEnergy({ year, e: t.districtHeat ?? zeroDhEnergy() });
    });
    return () => {
      cancelled = true;
    };
  }, [buildings, year]);
  return energy?.year === year ? energy.e : null;
}

/** How much of a network's winter peak its clean sources carry (0–1). */
function cleanCover(network: DhNetworkInfo, peakW: number): number {
  const cleanW = network.sources.filter((s) => s.kind && s.cleanW > 0).reduce((sum, s) => sum + s.cleanW, 0);
  return peakW > 0 ? Math.min(1, cleanW / peakW) : 1;
}

/** The card for the network picked on the map (a plant, a piped street) or in a list: what feeds
 * it, against its winter peak. */
export function NetworkInspectCard() {
  useSyncExternalStore(
    (listener) => districtHeat.subscribe(listener),
    () => districtHeat.getVersion(),
  );
  const simDay = useSimDay();
  const buildings = useStockBuildings();
  const network = districtHeat.pickedNetworkAt(simDay);
  const facts = useMemo(() => {
    if (!network) return null;
    let connected = 0;
    for (const b of buildings) {
      if (existsAt(b, simDay) && networkStatusAt(b, simDay) === "connected" && districtHeat.networkOf(b.streetSegments, simDay)?.id === network.id) connected++;
    }
    const cleanW = network.sources.filter((s) => s.kind && s.cleanW > 0).reduce((sum, s) => sum + s.cleanW, 0);
    return { connected, peakW: networkPeaksW(buildings, simDay).get(network.id) ?? 0, year: network.id >= 0 ? networkYearProjection(buildings, network.id, cleanW, simDay) : null };
  }, [network, buildings, simDay]);
  if (!network || !facts) return null;
  return (
    <InspectCard kicker="District heating network" title={network.name} onClose={() => districtHeat.pickNetwork(null)}>
      <NetworkCard network={network} peakW={facts.peakW} connected={facts.connected} year={facts.year} />
    </InspectCard>
  );
}

function formatMWh(kWh: number): string {
  return kWh >= 10_000_000 ? `${Math.round(kWh / 1_000_000)} GWh` : kWh >= 1_000_000 ? `${(kWh / 1_000_000).toFixed(1)} GWh` : `${Math.round(kWh / 1000).toLocaleString("de-CH")} MWh`;
}

/** One network's card: how many buildings it serves and its winter peak in a line, then what feeds
 * it — each clean source, the boilers for the rest — and how far the clean sources carry the peak, and
 * the boilers' heat over a year. */
function NetworkCard({ network, peakW, connected, year }: { network: DhNetworkInfo; peakW: number; connected: number; year: { heatKWh: number; boilerKWh: number } | null }) {
  const clean = network.sources.filter((s) => s.kind && s.cleanW > 0);
  const cleanW = clean.reduce((sum, s) => sum + s.cleanW, 0);
  const cover = peakW > 0 ? Math.min(1, cleanW / peakW) : 1;
  const spareW = cleanW - peakW;
  if (network.id < 0) {
    return (
      <>
        <CardKind>No pipes reach it yet: extend the network to it, or from it.</CardKind>
        <Facts facts={clean.map((s) => ({ label: s.label, value: formatMW(s.cleanW), title: s.existing ? "There when the game started" : `In service since ${monthYear(s.fromMs)}` }))} />
      </>
    );
  }
  return (
    <>
      <CardKind>
        {connected} building{connected === 1 ? "" : "s"} connected · winter peak {formatMW(peakW)}
      </CardKind>
      <Facts
        facts={[
          ...clean.map((s) => ({
            label: s.label,
            value: (
              <>
                {formatMW(s.cleanW)}
                {s.name !== network.name && <span className="bp-sub"> · {s.name}</span>}
              </>
            ),
            title: s.existing ? "There when the game started" : `In service since ${monthYear(s.fromMs)}`,
          })),
          { label: `${network.fossil === "gas" ? "Gas" : "Oil"} boilers`, value: cleanW >= peakW && peakW > 0 ? "stand by" : "for the rest" },
          {
            label: "Clean share of the peak",
            value: (
              <>
                {Math.round(cover * 100)}%<span className="bp-sub"> · {formatMW(cleanW)} clean</span>
                <div className="dh-bar">
                  <div className="dh-bar-fill" style={{ width: `${cover * 100}%` }} />
                </div>
              </>
            ),
            title: "How much of the winter peak of the buildings connected now the clean sources can carry; the boilers make the rest",
          },
          {
            label: spareW >= 0 ? "Room before the boilers" : "Boilers at the peak",
            value: spareW >= 0 ? formatMW(spareW) : `${formatMW(-spareW)} (${Math.round((1 - cover) * 100)}%)`,
            title: spareW >= 0 ? "How much more peak load the clean sources can take before the boilers start on the coldest days" : "How much of the winter peak the boilers have to make",
          },
          year &&
            year.boilerKWh > 0 && {
              label: "Boiler heat a year",
              value: `${formatMWh(year.boilerKWh)} · ${Math.round((year.boilerKWh / Math.max(1, year.heatKWh)) * 100)}%`,
              title: "Projected over the coming year: on each day, the heat the connected buildings need above what the clean sources carry",
            },
        ]}
      />
    </>
  );
}

/** The plant being planned: its size, what it costs and where it feeds in. */
function DraftCard({ simDay }: { simDay: number }) {
  useSyncExternalStore(
    (l) => districtHeatSources.subscribe(l),
    () => districtHeatSources.getVersion(),
  );
  const draft = districtHeatSources.getDraft();
  if (!draft) return null;
  const q = districtHeatSources.quote(simDay);
  const index = Math.max(0, q.sizes.indexOf(q.sizeMw));
  const hint = !draft.candidateId && draft.kind !== "wood" ? districtHeatSources.placeHint(draft.kind as PlacedKind) : null;
  const oilRp = market.price("oil", simDay) / OIL_ENERGY_KWH_PER_LITER / DH_BOILER_EFFICIENCY;
  return (
    <div className="dh-draft">
      <div className="dh-network-name">{q.name}</div>
      {q.problem ? (
        <>
          <p className={draft.lon === null ? "dh-note" : "dh-warning"}>{q.problem}</p>
          {hint && (
            <button className="dh-link" onClick={() => mapFocus.request({ lon: hint.lon, lat: hint.lat, minZoom: 15 })}>
              Show me where it can go
            </button>
          )}
        </>
      ) : (
        <>
          {q.sizes.length > 1 ? (
            <label className="dh-size">
              <span>
                Size <strong>{q.sizeMw} MW</strong>
              </span>
              <input type="range" min={0} max={q.sizes.length - 1} step={1} value={index} onChange={(e) => districtHeatSources.setDraftSize(q.sizes[Number(e.target.value)])} />
              <span className="dh-dim">
                {q.sizes[0]}–{q.sizes[q.sizes.length - 1]} MW
              </span>
            </label>
          ) : (
            <div className="info-row">
              <span>Heat on offer</span>
              <span className="info-value">{q.sizeMw} MW</span>
            </div>
          )}
          <div className="info-row">
            <span>Build cost</span>
            <span className="info-value">{formatCHF(q.capexRp)}</span>
          </div>
          {q.trunkM > 0 && (
            <div className="dh-note">
              Including a {q.trunkM >= 1000 ? `${(q.trunkM / 1000).toFixed(1)} km` : `${q.trunkM} m`} trunk line to the network's streets ({formatCHF(q.trunkRp)}).
            </div>
          )}
          <div className="info-row">
            <span>Build time</span>
            <span className="info-value">{q.months} months</span>
          </div>
          <div className="info-row" title="Fuel, power or heat bought, per kWh of heat made, at today's prices — against the oil boilers it replaces">
            <span>Running cost</span>
            <span className="info-value">
              {q.runningRpPerKWh.toFixed(1)} Rp/kWh <span className="dh-dim">(oil {oilRp.toFixed(1)})</span>
            </span>
          </div>
          {q.yearlyRp + q.upkeepRpYear > 0 && (
            <div className="info-row" title={q.yearlyRp > 0 ? "Upkeep, and the fixed payments (the factory's contract, the water concession)" : "Upkeep"}>
              <span>Fixed costs</span>
              <span className="info-value">{formatCHF(q.yearlyRp + q.upkeepRpYear)} a year</span>
            </div>
          )}
          {q.nuisanceHomes !== null && (
            <p className={q.nuisanceHomes > 0 ? "dh-warning" : "dh-note"}>
              {q.nuisanceHomes > 0
                ? `${q.nuisanceHomes} home${q.nuisanceHomes === 1 ? "" : "s"} within ${DH_WOOD_NUISANCE_RADIUS_M} m will mind the lorries and the chimney — homeowners and tenants hold it against you for as long as it runs.`
                : `No homes within ${DH_WOOD_NUISANCE_RADIUS_M} m.`}
            </p>
          )}
          <p className="dh-note">
            It feeds in at the street junction marked on the map. Pipes have to reach it: extend the network from there (or from the network to it).
          </p>
        </>
      )}
      <div className="dh-actions">
        <button className="dh-order" disabled={!!q.problem || q.sizeMw <= 0} onClick={() => districtHeatSources.orderDraft(simClock.getSimTimeMs())}>
          {q.problem ? "Order" : `Order for ${formatCHF(q.capexRp)}`}
        </button>
        <button onClick={() => districtHeatSources.cancelDraft()}>Cancel</button>
      </div>
    </div>
  );
}

function candidateLine(c: DhCandidateData, maxMw: number): string {
  const size = `up to ${maxMw.toFixed(maxMw < 10 ? 1 : 0)} MW`;
  const where = c.outside ? ` · ${(c.trunkM / 1000).toFixed(1)} km trunk line` : "";
  return onContract(c) ? `${maxMw.toFixed(1)} MW of waste heat on offer${where}` : `${size}${where}`;
}

const TERRAIN_LABEL: Record<DhLineTerrain, string> = {
  open: "Through open land",
  plot: "Through gardens and yards",
  road: "Across roads",
  building: "Under buildings",
  water: "Across water",
};

/** Drawing a direct line: where it starts and ends, what it crosses and costs. */
function LineDraftCard() {
  const simDay = useSimDay();
  const draft = districtHeatLines.getDraft();
  const quote = districtHeatLines.quote(simDay);
  if (!draft) return null;
  return (
    <div className="dh-draft">
      <div className="dh-network-name">Direct line</div>
      {!draft.a ? (
        <p className="dh-note">Click on the map where the line should start — at the network, a plant&apos;s junction or anywhere you want to reach. It joins the nearest street junction.</p>
      ) : draft.points.length === 1 ? (
        <p className="dh-note">Now click along its course: every click is a bend, the last one is where it ends (at the nearest street junction). Go round the built-up areas where you can — open land is the cheapest ground.</p>
      ) : null}
      {draft.missed && <p className="dh-warning">No street junction near there: start the line closer to a street.</p>}
      {quote && (
        <>
          <div className="info-row">
            <span>Length</span>
            <span className="info-value">{Math.round(quote.lengthM)} m</span>
          </div>
          {(Object.keys(TERRAIN_LABEL) as DhLineTerrain[])
            .filter((t) => quote.byTerrain[t] >= 1)
            .map((t) => (
              <div className="info-row" key={t} title={`Costs ${DH_LINE_COST_FACTOR[t]}× a metre under a street`}>
                <span>{TERRAIN_LABEL[t]}</span>
                <span className="info-value">{Math.round(quote.byTerrain[t])} m</span>
              </div>
            ))}
          <div className="info-row">
            <span>Cost</span>
            <span className="info-value">{formatCHF(quote.costRp)}</span>
          </div>
          <div className="info-row">
            <span>Build time</span>
            <span className="info-value">{quote.months} months</span>
          </div>
          {quote.problem && <p className={quote.connected || !draft.b ? "dh-note" : "dh-warning"}>{quote.problem}</p>}
          <p className="dh-note">A line carries heat across; nobody connects along it. Click on to carry it further.</p>
        </>
      )}
      <div className="dh-actions">
        {quote && (
          <button className="dh-order" disabled={!!quote.problem} onClick={() => districtHeatLines.order(simClock.getSimTimeMs())}>
            Order for {formatCHF(quote.costRp)}
          </button>
        )}
        {draft.points.length > 0 && <button onClick={() => districtHeatLines.undo()}>Undo last point</button>}
        <button onClick={() => districtHeatLines.cancel()}>Cancel</button>
      </div>
    </div>
  );
}

/** The district heating layer's own panel: each network (what feeds it, against its winter peak),
 * new heat sources (from a plant within reach, or placed on the map), and planning a pipe extension
 * — the streets picked on the map, what they cost and take to build, and how much heat the
 * buildings along them use. */
export function DistrictHeatPanel() {
  const version = useSyncExternalStore(
    (listener) => districtHeat.subscribe(listener),
    () => districtHeat.getVersion(),
  );
  const draftVersion = useSyncExternalStore(
    (l) => districtHeatSources.subscribe(l),
    () => districtHeatSources.getVersion(),
  );
  useSyncExternalStore(
    (l) => districtHeatLines.subscribe(l),
    () => districtHeatLines.getVersion(),
  );
  const simDay = useSimDay();
  const buildings = useStockBuildings();
  const lastYear = useLastYearHeat(buildings, simDay);
  const lastYearClean = useMemo(() => {
    if (!lastYear) return null;
    const clean = Object.values(lastYear.bySource).reduce((x, y) => x + y, 0);
    const total = clean + lastYear.boilerOilKWh + lastYear.boilerGasKWh;
    return total > 0 ? clean / total : null;
  }, [lastYear]);

  const stats = useMemo(() => {
    let connected = 0;
    let connectable = 0;
    let awaiting = 0;
    const byNetwork = new Map<number, number>();
    for (const b of buildings) {
      if (!existsAt(b, simDay)) continue;
      const status = networkStatusAt(b, simDay);
      if (status === "connected") {
        connected++;
        const id = districtHeat.networkOf(b.streetSegments, simDay)?.id ?? -1;
        byNetwork.set(id, (byNetwork.get(id) ?? 0) + 1);
      } else if (status === "connectable") connectable++;
      else if (status === "outOfReach" && districtHeat.buildingAt(b.streetSegments, simDay)) awaiting++;
    }
    return { connected, connectable, awaiting, byNetwork, lengthKm: districtHeat.pipedLengthM(simDay) / 1000, peaks: networkPeaksW(buildings, simDay) };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [buildings, simDay, version]);

  const coverage = useMemo(() => networkCoverage(buildings, simDay), [buildings, simDay, version]); // eslint-disable-line react-hooks/exhaustive-deps
  const quote = useMemo(() => districtHeat.quote(simDay), [version, simDay]); // eslint-disable-line react-hooks/exhaustive-deps
  const demand = useMemo(() => streetDemand(buildings, quote.segments, simDay), [buildings, quote, simDay]);
  const pipesUnderConstruction = [
    ...districtHeat.getOrders().filter((o) => o.completesAtMs > simDay),
    ...districtHeat
      .getLines()
      .filter((l) => l.completesAtMs > simDay)
      .map((l) => ({ id: `line${l.id}`, lengthM: l.lengthM, completesAtMs: l.completesAtMs, line: true })),
  ];
  const lineLengthM = districtHeat.lineLengthM(simDay);
  const plantsUnderConstruction = districtHeat.getSources().filter((s) => s.fromMs > simDay);
  const allNetworks = districtHeat
    .networksAt(simDay)
    .filter((n) => n.sources.some((s) => !s.hidden) || (stats.byNetwork.get(n.id) ?? 0) > 0)
    .sort((a, b) => (stats.peaks.get(b.id) ?? 0) - (stats.peaks.get(a.id) ?? 0));
  // Small networks the town starts with that run on boilers alone are summed up in one line.
  const boilersOnly = (n: DhNetworkInfo) => n.sources.every((s) => s.existing && (!s.kind || !(s.cleanW > 0)));
  const networks = allNetworks.filter((n) => !boilersOnly(n));
  const fossilNetworks = allNetworks.filter(boilersOnly);
  const candidates = useMemo(() => districtHeatSources.availableCandidates(simDay), [simDay, version, draftVersion]); // eslint-disable-line react-hooks/exhaustive-deps
  const draft = districtHeatSources.getDraft();
  const woodLeft = districtHeatSources.woodRemainingMw();
  const placedDisabled = (kind: PlacedKind): string | null => {
    if (kind === "groundwater" && !heatPumpSiting.hasHeatUseAtlas()) return "There's no map of the groundwater here.";
    if (kind === "surfaceWater" && districtHeat.getWater().length === 0) return "No river or lake here is big enough.";
    if (kind === "wood" && woodLeft < DH_SOURCE_SPECS.wood.minMw) return "The town's forest can't feed another wood plant.";
    return null;
  };
  const heatPerMetre = quote.lengthM > 0 ? demand.annualHeatKWh / quote.lengthM : 0;
  const hasPipes = stats.lengthKm > 0 || districtHeat.getSources().length > 0;

  const picked = districtHeat.pickedNetworkAt(simDay);
  const pickNetwork = (n: DhNetworkInfo) => {
    const source = n.sources.find((s) => !s.hidden) ?? n.sources[0];
    if (!source) return;
    districtHeat.pickNetwork({ sourceId: source.id });
    mapFocus.request({ lon: source.lon, lat: source.lat, minZoom: 14.5 });
  };

  const networkRow = (n: DhNetworkInfo, detail?: string) => {
    const connected = stats.byNetwork.get(n.id) ?? 0;
    const clean = n.id < 0 ? null : cleanCover(n, stats.peaks.get(n.id) ?? 0);
    return (
      <ToolListRow
        key={n.id}
        color={clean === null ? CLEAN_COLOR.none : clean >= 0.995 ? CLEAN_COLOR.all : clean >= 0.5 ? CLEAN_COLOR.most : CLEAN_COLOR.little}
        title={n.name}
        figure={clean === null ? undefined : `${Math.round(clean * 100)}% clean`}
        detail={detail ?? (n.id < 0 ? "no pipes yet" : `${connected} connected · winter peak ${formatMW(stats.peaks.get(n.id) ?? 0)}`)}
        selected={picked?.id === n.id}
        onClick={() => pickNetwork(n)}
      />
    );
  };
  const mostlyBoilers = networks.filter((n) => n.id >= 0 && cleanCover(n, stats.peaks.get(n.id) ?? 0) < 0.5);
  const needsYou = [
    ...fossilNetworks.map((n) => {
      const connected = stats.byNetwork.get(n.id) ?? 0;
      return networkRow(n, `${connected} building${connected === 1 ? "" : "s"}, all on oil or gas boilers — give it a clean source, or pipe it to one`);
    }),
    ...mostlyBoilers.map((n) => networkRow(n, "Boilers carry most of its winter peak — add a clean source to it")),
  ];
  const share = (s: CoverageShare) => `${percent(s.connected, s)} connected · ${percent(s.withinReach, s)} within reach`;

  const overview = (
    <>
      {!hasPipes && (
        <p className="dh-note">
          {districtHeat.getSources().length === 0
            ? "This municipality has no district heating yet. Build a heat source (Build), then pipe the streets from it: owners connect when their heating is next replaced, if district heat is the better deal."
            : "No network is in service yet."}
        </p>
      )}
      {hasPipes && (
        <div className="tool-tiles">
          <ToolTile
            label="Networks"
            value={String(allNetworks.length)}
            sub={`${stats.lengthKm.toFixed(1)} km of piped street${lineLengthM > 0 ? ` · ${(lineLengthM / 1000).toFixed(1)} km of lines` : ""}`}
            title="The district heating networks in service, each with what feeds it. Direct lines carry heat across country; nobody connects along them."
          />
          <ToolTile
            label="Connected"
            value={`${stats.connected}`}
            sub={`buildings · ${percent(coverage.heatDemandKWh.connected, coverage.heatDemandKWh)} of the heat used`}
            title="Buildings heated by district heat, and their share of the heat the town's buildings use"
          />
          <ToolTile
            label="Could connect"
            value={String(stats.connectable)}
            sub={stats.awaiting > 0 ? `${stats.awaiting} more once the pipes are in` : "on a piped street"}
            title="Buildings on a piped street that aren't connected yet. Each owner decides when their heating is next replaced, if district heat is the better deal — district heat's price (Town hall → Prices) and the heating measures move them."
          />
          <ToolTile
            label="Clean heat"
            value={lastYearClean === null ? "–" : `${Math.round(lastYearClean * 100)}%`}
            sub={lastYearClean === null ? "counted after the first year" : "of last year's district heat"}
            title="The share of last year's district heat that came from clean sources — waste heat, heat pumps, wood — rather than the oil and gas boilers that stand by for the coldest days and for networks without enough clean heat"
          />
        </div>
      )}

      <ToolListGroup title="Needs you" limit={4}>
        {needsYou}
      </ToolListGroup>

      <ToolListGroup title="Networks" limit={5}>
        {networks.filter((n) => !mostlyBoilers.includes(n)).map((n) => networkRow(n))}
      </ToolListGroup>
      {allNetworks.length > 0 && <p className="dh-note tool-list-hint">Biggest first. Click a network here, or a plant or piped street on the map, to see what feeds it.</p>}

      {hasPipes && (
        <>
          <h4 className="tool-list-heading">How much of the town it reaches</h4>
          <Facts
            facts={[
              { label: "Buildings", value: share(coverage.buildings), title: "Of the heated buildings (garages, sheds and wood-heated buildings aren't counted). Within reach: connected, or on a piped street and free to connect." },
              { label: "Floor area", value: share(coverage.floorAreaM2) },
              { label: "Heat used", value: share(coverage.heatDemandKWh), title: "Of the heat the town's buildings use: the big users count for more" },
            ]}
          />
        </>
      )}
    </>
  );

  const build = (
    <>
      <h4 className="tool-list-heading">New heat</h4>
      {draft ? (
        <DraftCard simDay={simDay} />
      ) : (
        <>
          {candidates.length > 0 && (
            <>
              <p className="dh-note">Heat within reach — pick one here or on the map:</p>
              {candidates.map((c) => (
                <button key={c.id} className="dh-choice" onClick={() => districtHeatSources.startDraft(c.kind, c.id)}>
                  <span className="dh-choice-title">{onContract(c) ? `${candidateName(c)} (waste heat)` : c.name}</span>
                  <span className="dh-dim">{candidateLine(c, districtHeatSources.candidateMaxMw(c))}</span>
                </button>
              ))}
            </>
          )}
          {!candidates.some((c) => c.kind === "industry") && (
            <p className="dh-note">Firms with waste heat to sell are found by the district heating advisor (Town hall → Advisors).</p>
          )}
          <p className="dh-note">{candidates.length > 0 ? "Or build a plant of your own, placed on the map:" : "Build a plant of your own, placed on the map:"}</p>
          {PLACED.map(({ kind, note }) => {
            const disabled = placedDisabled(kind);
            return (
              <button key={kind} className="dh-choice" disabled={!!disabled} onClick={() => districtHeatSources.startDraft(kind)}>
                <span className="dh-choice-title">{DH_SOURCE_SPECS[kind].label}</span>
                <span className="dh-dim">{disabled ?? (kind === "wood" ? `${note} — ${woodLeft.toFixed(1)} MW left` : note)}</span>
              </button>
            );
          })}
        </>
      )}

      <ToolListGroup title="Plants being built" limit={4}>
        {plantsUnderConstruction.map((s) => (
          <ToolListRow
            key={s.id}
            color={DH_BUILDING_COLOR}
            title={s.name}
            figure={`ready ${monthYear(s.fromMs)}`}
            detail={formatMW(s.cleanW)}
            selected={false}
            onClick={() => mapFocus.request({ lon: s.lon, lat: s.lat, minZoom: 14.5 })}
          />
        ))}
      </ToolListGroup>

      {districtHeat.getSources().length > 0 && (
        <>
          <h4 className="tool-list-heading">Extend the network</h4>
          {districtHeatLines.getDraft() ? (
            <LineDraftCard />
          ) : quote.segments.length === 0 ? (
            <>
              <p className="dh-note">Click streets on the map to plan an extension. It has to connect to the network or a heat source, directly or through the other streets you pick.</p>
              <button className="dh-link" onClick={() => districtHeatLines.start()}>
                Or lay a direct line, off the streets…
              </button>
            </>
          ) : (
            <>
              <div className="info-row">
                <span>
                  {quote.segments.length} street segment{quote.segments.length === 1 ? "" : "s"}
                </span>
                <span className="info-value">{Math.round(quote.lengthM)} m</span>
              </div>
              <div className="info-row">
                <span>Cost</span>
                <span className="info-value">{formatCHF(quote.costRp)}</span>
              </div>
              <div className="info-row">
                <span>Build time</span>
                <span className="info-value">{quote.months} months</span>
              </div>
              <div className="info-row">
                <span>Buildings newly reached</span>
                <span className="info-value">{demand.buildings}</span>
              </div>
              <div className="info-row" title="The yearly space heating demand of the buildings newly reached, per metre of new pipe — what a network extension is judged by">
                <span>Their heat use</span>
                <span className="info-value">
                  {Math.round(demand.annualHeatKWh / 1000)} MWh/yr · {Math.round(heatPerMetre)} kWh/m
                </span>
              </div>
              {!quote.connected && (
                <p className="dh-warning">The streets in red don't connect to the network or a heat source — pick the streets in between too, or drop them.</p>
              )}
              <div className="dh-actions">
                <button className="dh-order" disabled={!quote.connected} onClick={() => districtHeat.order(simClock.getSimTimeMs())}>
                  Order for {formatCHF(quote.costRp)}
                </button>
                <button onClick={() => districtHeat.clearSelection()}>Clear</button>
              </div>
              <p className="dh-note">Connecting is up to each owner: a building switches when its heating is next replaced, if district heat is the better deal.</p>
            </>
          )}
        </>
      )}

      <ToolListGroup title="Pipes being laid" limit={4}>
        {pipesUnderConstruction.map((o) => (
          <div className="info-row" key={o.id}>
            <span>
              {Math.round(o.lengthM)} m{"line" in o ? " (direct line)" : ""}
            </span>
            <span className="info-value">ready {monthYear(o.completesAtMs)}</span>
          </div>
        ))}
      </ToolListGroup>
    </>
  );

  return (
    <ToolPanel
      mode="districtHeat"
      title="District heating"
      titleExtra={<PlotLink chart="district-heat" title="District heat over time" />}
      overview={overview}
      build={build}
      buildActive={!!draft || quote.segments.length > 0 || !!districtHeatLines.getDraft()}
    />
  );
}
