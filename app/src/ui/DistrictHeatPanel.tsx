import { useMemo, useSyncExternalStore } from "react";
import { formatDate } from "../sim/calendar";
import { districtHeat } from "../sim/districtHeat";
import { simClock } from "../sim/engine";
import { networkPeakLoadW, networkStatusAt, sourceCapacityW, streetDemand } from "../sim/districtHeatStats";
import { existsAt } from "../sim/lifetime";
import { useSimDay } from "../sim/store";
import { formatCHF } from "./format";
import { useStockBuildings } from "./useStock";
import "./districtHeatPanel.css";

const SOURCE_KIND_NOTE = {
  plant: "inside the municipality",
  import: "heat arrives by trunk line from a neighbouring municipality",
  unknown: "where the heat comes from isn't known — placed at the network's centre",
};

function formatMW(w: number): string {
  return `${(w / 1e6).toFixed(1)} MW`;
}

/** The district heating layer's own panel: the network as it stands (length, who is connected,
 * load against what the source can deliver), and planning an extension — the streets picked on
 * the map, what they cost and take to build, and how much heat the buildings along them use. */
export function DistrictHeatPanel() {
  const version = useSyncExternalStore(
    (listener) => districtHeat.subscribe(listener),
    () => districtHeat.getVersion(),
  );
  const simDay = useSimDay();
  const buildings = useStockBuildings();
  const source = districtHeat.getSource();

  const network = useMemo(() => {
    let connected = 0;
    let connectable = 0;
    let awaiting = 0;
    for (const b of buildings) {
      if (!existsAt(b, simDay)) continue;
      const status = networkStatusAt(b, simDay);
      if (status === "connected") connected++;
      else if (status === "connectable") connectable++;
      else if (status === "outOfReach" && districtHeat.buildingAt(b.streetSegments, simDay)) awaiting++;
    }
    return {
      connected,
      connectable,
      awaiting,
      lengthKm: districtHeat.pipedLengthM(simDay) / 1000,
      peakW: networkPeakLoadW(buildings, simDay),
      capacityW: sourceCapacityW(buildings, 0), // judged by the buildings connected at the start of play
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [buildings, simDay, version]);

  const quote = useMemo(() => districtHeat.quote(), [version]); // eslint-disable-line react-hooks/exhaustive-deps
  const demand = useMemo(() => streetDemand(buildings, quote.segments, simDay), [buildings, quote, simDay]);
  const underConstruction = districtHeat.getOrders().filter((o) => o.completesAtMs > simDay);

  if (!source) {
    return (
      <div className="district-heat-panel">
        <h3 className="panel-title">District heating</h3>
        <p className="dh-note">This municipality has no district heating network. Building a heat source to start one is not possible yet.</p>
      </div>
    );
  }

  const load = network.capacityW > 0 ? network.peakW / network.capacityW : 0;
  const heatPerMetre = quote.lengthM > 0 ? demand.annualHeatKWh / quote.lengthM : 0;

  return (
    <div className="district-heat-panel">
      <h3 className="panel-title">District heating</h3>
      <div className="dh-source">
        🏭 {source.name}
        <div className="dh-note">{SOURCE_KIND_NOTE[source.kind]}</div>
      </div>

      <div className="info-row">
        <span>Piped streets</span>
        <span className="info-value">{network.lengthKm.toFixed(1)} km</span>
      </div>
      <div className="info-row">
        <span>Connected buildings</span>
        <span className="info-value">{network.connected}</span>
      </div>
      <div className="info-row">
        <span>On a piped street, not connected</span>
        <span className="info-value">{network.connectable}</span>
      </div>
      {network.awaiting > 0 && (
        <div className="info-row">
          <span>Can connect once the pipes are in</span>
          <span className="info-value">{network.awaiting}</span>
        </div>
      )}

      <div className="dh-capacity" title="Not a limit yet: the network can grow past it for now">
        <div className="info-row">
          <span>Winter peak vs. source</span>
          <span className="info-value">
            {formatMW(network.peakW)} / {formatMW(network.capacityW)}
          </span>
        </div>
        <div className="dh-bar">
          <div className={`dh-bar-fill${load > 1 ? " over" : ""}`} style={{ width: `${Math.min(100, load * 100)}%` }} />
        </div>
      </div>

      <h4 className="dh-subtitle">Extend the network</h4>
      {quote.segments.length === 0 ? (
        <p className="dh-note">Click streets on the map to plan an extension. It has to connect to the network, directly or through the other streets you pick.</p>
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
          {!quote.connected && <p className="dh-warning">Not every picked street connects to the network.</p>}
          <div className="dh-actions">
            <button className="dh-order" disabled={!quote.connected} onClick={() => districtHeat.order(simClock.getSimTimeMs())}>
              Order for {formatCHF(quote.costRp)}
            </button>
            <button onClick={() => districtHeat.clearSelection()}>Clear</button>
          </div>
          <p className="dh-note">Connecting is up to each owner: a building switches when its heating is next replaced, if district heat is the better deal.</p>
        </>
      )}

      {underConstruction.length > 0 && (
        <>
          <h4 className="dh-subtitle">Under construction</h4>
          {underConstruction.map((o) => (
            <div className="info-row" key={o.id}>
              <span>{Math.round(o.lengthM)} m</span>
              <span className="info-value">ready {formatDate(o.completesAtMs).replace(/^\w+, \d+ /, "")}</span>
            </div>
          ))}
        </>
      )}
    </div>
  );
}
