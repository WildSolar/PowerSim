import { Fragment, useEffect, useMemo, useState, useSyncExternalStore } from "react";
import { DH_BOILER_EFFICIENCY, DH_SOURCE_SPECS, DH_WOOD_NUISANCE_RADIUS_M } from "../config/districtHeat";
import type { DhCandidateData } from "../data/types";
import { BASELINE_YEAR, formatDate, toDateMs } from "../sim/calendar";
import { districtHeat, type DhNetworkInfo } from "../sim/districtHeat";
import { zeroDhEnergy, type DhEnergyKWh } from "../sim/districtHeatDispatch";
import { candidateName, districtHeatSources, type PlacedKind } from "../sim/districtHeatSources";
import { simClock } from "../sim/engine";
import { networkCoverage, networkPeaksW, networkStatusAt, streetDemand, type CoverageShare } from "../sim/districtHeatStats";
import { heatPumpSiting } from "../sim/heatPumpSiting";
import { OIL_ENERGY_KWH_PER_LITER } from "../sim/heatingSystems";
import { existsAt } from "../sim/lifetime";
import { market } from "../sim/market";
import { useSimDay } from "../sim/store";
import { computeHeatingTechnologyBreakdown } from "../sim/yearReport";
import { zoning } from "../sim/zoning";
import { formatCHF } from "./format";
import { mapFocus } from "../map/mapFocus";
import { useStockBuildings } from "./useStock";
import "./districtHeatPanel.css";
import { SupervisionNotice } from "./SupervisionNotice";

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

/** One network: what feeds it, against its winter peak, and who made last year's heat. */
function NetworkCard({ network, peakW, connected }: { network: DhNetworkInfo; peakW: number; connected: number }) {
  const clean = network.sources.filter((s) => s.kind && s.cleanW > 0);
  const cleanW = clean.reduce((sum, s) => sum + s.cleanW, 0);
  const cover = peakW > 0 ? Math.min(1, cleanW / peakW) : 1;
  return (
    <div className="dh-network">
      <div className="dh-network-name">{network.name}</div>
      <div className="dh-note">
        {network.id < 0 ? "No pipes reach it yet: extend the network to it, or from it." : `${connected} building${connected === 1 ? "" : "s"} connected · winter peak ${formatMW(peakW)}`}
      </div>
      {clean.map((s) => (
        <div className="info-row" key={s.id} title={s.existing ? "There when the game started" : `In service since ${monthYear(s.fromMs)}`}>
          <span>
            {s.label}
            {s.name !== network.name && <span className="dh-dim"> · {s.name}</span>}
          </span>
          <span className="info-value">{formatMW(s.cleanW)}</span>
        </div>
      ))}
      {network.id >= 0 && (
        <>
          <div className="info-row">
            <span>{network.fossil === "gas" ? "Gas" : "Oil"} boilers</span>
            <span className="info-value">for the rest</span>
          </div>
          <div className="dh-bar" title="How much of the winter peak the clean sources can carry; the boilers make the rest">
            <div className="dh-bar-fill" style={{ width: `${cover * 100}%` }} />
          </div>
        </>
      )}
      <div className="dh-note" hidden={network.id < 0}>
        {cleanW === 0
          ? "All of its heat comes from the boilers."
          : cover >= 1
            ? "The clean sources carry the whole winter peak; the boilers only stand by."
            : `The clean sources carry ${Math.round(cover * 100)}% of the winter peak; the boilers make the rest on cold days.`}
      </div>
    </div>
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
  return c.kind === "industry" ? `${maxMw.toFixed(1)} MW of waste heat on offer${where}` : `${size}${where}`;
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
  // District-heat priority zones (zoning.ts): how much land, and how many buildings there on a piped street.
  const priority = useMemo(() => {
    let areaM2 = 0;
    for (const p of zoning.getParcels()) if (zoning.stateAt(p.id, simDay)?.dhPriority) areaM2 += p.areaM2;
    if (areaM2 === 0) return null;
    let onPipes = 0;
    for (const b of buildings) {
      if (existsAt(b, simDay) && zoning.fossilHeatingBannedAt(b, simDay) && districtHeat.servesAt(b.streetSegments, simDay)) onPipes++;
    }
    return { areaM2, onPipes };
  }, [buildings, simDay, version]); // eslint-disable-line react-hooks/exhaustive-deps
  const quote = useMemo(() => districtHeat.quote(simDay), [version, simDay]); // eslint-disable-line react-hooks/exhaustive-deps
  const demand = useMemo(() => streetDemand(buildings, quote.segments, simDay), [buildings, quote, simDay]);
  const pipesUnderConstruction = districtHeat.getOrders().filter((o) => o.completesAtMs > simDay);
  const plantsUnderConstruction = districtHeat.getSources().filter((s) => s.fromMs > simDay);
  const allNetworks = districtHeat
    .networksAt(simDay)
    .filter((n) => n.sources.some((s) => !s.hidden) || (stats.byNetwork.get(n.id) ?? 0) > 0)
    .sort((a, b) => (stats.peaks.get(b.id) ?? 0) - (stats.peaks.get(a.id) ?? 0));
  // Small networks the town starts with that run on boilers alone are summed up in one line.
  const boilersOnly = (n: DhNetworkInfo) => n.sources.every((s) => s.existing && (!s.kind || !(s.cleanW > 0)));
  const networks = allNetworks.filter((n) => !boilersOnly(n));
  const fossilNetworks = allNetworks.filter(boilersOnly);
  const fossilBuildings = fossilNetworks.reduce((sum, n) => sum + (stats.byNetwork.get(n.id) ?? 0), 0);
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

  return (
    <div className="district-heat-panel">
      <h3 className="panel-title">District heating</h3>
      <SupervisionNotice />

      {fossilNetworks.length > 0 && (
        <div className="dh-network">
          <div className="dh-network-name">
            {fossilNetworks.length === 1 ? fossilNetworks[0].name : `${fossilNetworks.length} small networks on boilers alone`}
          </div>
          <div className="dh-note">
            {fossilBuildings} building{fossilBuildings === 1 ? "" : "s"} connected. All of their heat comes from oil or gas boilers: give them a clean source, or pipe them to a
            network that has one.
          </div>
        </div>
      )}
      {allNetworks.length === 0 ? (
        <p className="dh-note">
          {districtHeat.getSources().length === 0
            ? "This municipality has no district heating yet. Build a heat source below, then pipe the streets from it."
            : "No network is in service yet."}
        </p>
      ) : (
        networks.map((n) => <NetworkCard key={n.id} network={n} peakW={stats.peaks.get(n.id) ?? 0} connected={stats.byNetwork.get(n.id) ?? 0} />)
      )}
      {lastYearClean !== null && (
        <p className="dh-note">
          {lastYearClean >= 0.995
            ? "Last year all of the district heat came from clean sources."
            : `Last year ${Math.round(lastYearClean * 100)}% of the district heat came from clean sources, the rest from the boilers.`}
        </p>
      )}

      {hasPipes && (
        <>
          <div className="info-row">
            <span>Piped streets</span>
            <span className="info-value">{stats.lengthKm.toFixed(1)} km</span>
          </div>
          <div className="info-row">
            <span>Connected buildings</span>
            <span className="info-value">{stats.connected}</span>
          </div>
          <div className="info-row">
            <span>On a piped street, not connected</span>
            <span className="info-value">{stats.connectable}</span>
          </div>
          {priority && (
            <div
              className="info-row"
              title="District-heat priority zones (set in the Zoning layer): no new oil or gas heating there, and a new building on a piped street must connect"
            >
              <span>Priority zones · on a piped street</span>
              <span className="info-value">
                {(priority.areaM2 / 10_000).toFixed(1)} ha · {priority.onPipes} buildings
              </span>
            </div>
          )}
          {stats.awaiting > 0 && (
            <div className="info-row">
              <span>Can connect once the pipes are in</span>
              <span className="info-value">{stats.awaiting}</span>
            </div>
          )}

          <div
            className="dh-coverage"
            title="Of the heated buildings (garages, sheds and wood-heated buildings aren't counted). Within reach: connected, or on a piped street and free to connect."
          >
            <span />
            <span className="dh-coverage-head">Connected</span>
            <span className="dh-coverage-head">Within reach</span>
            {(
              [
                ["Buildings", coverage.buildings],
                ["Floor area", coverage.floorAreaM2],
                ["Heat demand", coverage.heatDemandKWh],
              ] as [string, CoverageShare][]
            ).map(([label, share]) => (
              <Fragment key={label}>
                <span>{label}</span>
                <span className="dh-coverage-value">{percent(share.connected, share)}</span>
                <span className="dh-coverage-value">{percent(share.withinReach, share)}</span>
              </Fragment>
            ))}
          </div>
        </>
      )}

      <h4 className="dh-subtitle">New heat</h4>
      {draft ? (
        <DraftCard simDay={simDay} />
      ) : (
        <>
          {candidates.length > 0 && (
            <>
              <p className="dh-note">Heat within reach — pick one here or on the map:</p>
              {candidates.map((c) => (
                <button key={c.id} className="dh-choice" onClick={() => districtHeatSources.startDraft(c.kind, c.id)}>
                  <span className="dh-choice-title">{c.kind === "industry" ? `${candidateName(c)} (waste heat)` : c.name}</span>
                  <span className="dh-dim">{candidateLine(c, districtHeatSources.candidateMaxMw(c))}</span>
                </button>
              ))}
            </>
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

      {plantsUnderConstruction.length > 0 && (
        <>
          <h4 className="dh-subtitle">Plants being built</h4>
          {plantsUnderConstruction.map((s) => (
            <div className="info-row" key={s.id}>
              <span>
                {s.name} · {formatMW(s.cleanW)}
              </span>
              <span className="info-value">ready {monthYear(s.fromMs)}</span>
            </div>
          ))}
        </>
      )}

      {districtHeat.getSources().length > 0 && (
        <>
          <h4 className="dh-subtitle">Extend the network</h4>
          {quote.segments.length === 0 ? (
            <p className="dh-note">Click streets on the map to plan an extension. It has to connect to the network or a heat source, directly or through the other streets you pick.</p>
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

      {pipesUnderConstruction.length > 0 && (
        <>
          <h4 className="dh-subtitle">Pipes being laid</h4>
          {pipesUnderConstruction.map((o) => (
            <div className="info-row" key={o.id}>
              <span>{Math.round(o.lengthM)} m</span>
              <span className="info-value">ready {monthYear(o.completesAtMs)}</span>
            </div>
          ))}
        </>
      )}
    </div>
  );
}
