import { useSyncExternalStore } from "react";
import { CAR_PARK_BUILD_MONTHS } from "../config/carParks";
import { mapFocus } from "../map/mapFocus";
import { formatDate } from "../sim/calendar";
import { carParks, type CarPark } from "../sim/carParks";
import { simClock } from "../sim/engine";
import { measures } from "../sim/measures";
import { policyStore } from "../sim/policy";
import { useSimDay } from "../sim/store";
import { formatCHF } from "./format";
import "./districtHeatPanel.css";
import { InspectCard } from "./InspectCard";
import { PlotLink } from "./PlotLink";
import { ToolPanel } from "./ToolPanel";

function monthYear(ms: number): string {
  return formatDate(ms).replace(/^\d+ /, "");
}

function useCarParks(): void {
  useSyncExternalStore(
    (l) => carParks.subscribe(l),
    () => carParks.getVersion(),
  );
}

function lotName(lot: CarPark): string {
  if (lot.name) return lot.name;
  const host = carParks.host(lot);
  return host?.address ? `Car park at ${host.address}` : "Car park";
}

function stateLabel(lot: CarPark, now: number): string {
  const c = carParks.canopyOn(lot.id);
  if (c) return c.installedAtMs <= now ? "Solar canopy" : `Canopy from ${monthYear(c.installedAtMs)}`;
  return lot.owner === "municipal" ? "The town's" : "Private";
}

/** The card for the car park picked on the map or in the list: its size, whose it is, what a
 * canopy would make and cost — and, for one of the town's own, the order. */
export function CarParkCard() {
  useCarParks();
  useSyncExternalStore(
    (l) => measures.subscribe(l),
    () => measures.getVersion(),
  );
  const now = useSimDay();
  const id = carParks.getSelectedId();
  const lot = id ? carParks.getLot(id) : undefined;
  if (!lot) return null;
  const canopy = carParks.canopyOn(lot.id);
  const host = carParks.host(lot);
  const q = carParks.quote(lot, now);
  const o = carParks.outlook(lot, now);
  const due = carParks.dueAtMs(lot);
  const subsidyPerKwp = policyStore.get().carParkSolarSubsidyRpPerKwp;
  return (
    <InspectCard kicker={lot.owner === "municipal" ? "The town's car park" : "Private car park"} title={lotName(lot)} onClose={() => carParks.select(null)}>
      <div className="info-row">
        <span>Size</span>
        <span className="info-value">
          {lot.spaces} spaces · {Math.round(lot.areaM2).toLocaleString("de-CH")} m²
        </span>
      </div>
      {host && (
        <div className="info-row" title="The building the car park goes with: it would take part of the canopy's power">
          <span>Goes with</span>
          <span className="info-value">{host.address ?? host.egid}</span>
        </div>
      )}
      <div className="info-row" title="Panels over the parking spaces (not the aisles), facing as the canopy is laid out">
        <span>{canopy ? "Canopy" : "A canopy"}</span>
        <span className="info-value">
          {Math.round(lot.canopyKw)} kWp · {(o.kWh / 1000).toFixed(0)} MWh a year
        </span>
      </div>
      {canopy ? (
        <>
          <div className="info-row">
            <span>{canopy.installedAtMs <= now ? "Generating since" : "Generating from"}</span>
            <span className="info-value">{monthYear(canopy.installedAtMs)}</span>
          </div>
          <p className="dh-note">
            {canopy.owner === "municipal"
              ? canopy.mandated
                ? "Built under the solar duty, paid by the treasury."
                : "Built by the municipality."
              : canopy.mandated
                ? `Built by its owner under the solar duty${canopy.subsidyRp > 0 ? `, with ${formatCHF(canopy.subsidyRp)} of municipal subsidy` : ""}.`
                : `Built by its owner${canopy.subsidyRp > 0 ? `, with ${formatCHF(canopy.subsidyRp)} of municipal subsidy` : ""}.`}
          </p>
        </>
      ) : (
        <>
          <div className="info-row" title="The build cost, less the federal one-off payment every installation gets">
            <span>Cost</span>
            <span className="info-value">{formatCHF(q.netRp)}</span>
          </div>
          <div className="info-row" title="What its building would no longer buy, and the rest at the feed-in price, less the upkeep">
            <span>Worth a year</span>
            <span className="info-value">{formatCHF(o.valueRp - o.upkeepRp)}</span>
          </div>
          {due !== null && (
            <div className="info-row" title="The solar duty: this car park must have its canopy by then">
              <span>Due under the duty</span>
              <span className="info-value">{monthYear(due)}</span>
            </div>
          )}
          {lot.owner === "municipal" ? (
            <>
              <p className="dh-note">
                Built in {CAR_PARK_BUILD_MONTHS} months, paid by the treasury. What the panels save {host ? "the building next door" : "the town"} and earn feeding in is credited to you.
              </p>
              <div className="dh-actions">
                <button className="dh-order" onClick={() => carParks.buildMunicipal(lot.id, simClock.getSimTimeMs())}>
                  Build a canopy for {formatCHF(q.netRp)}
                </button>
              </div>
            </>
          ) : (
            <p className="dh-note">
              Its owner decides, looking into it now and then: worth it if what the canopy saves and earns beats its cost.
              {subsidyPerKwp > 0 ? ` Your subsidy would pay ${formatCHF(subsidyPerKwp * lot.canopyKw)} of it.` : " A subsidy or a solar duty can tip it."}
            </p>
          )}
        </>
      )}
    </InspectCard>
  );
}

/** The car parks layer's panel: the town's open-air car parks big enough for a canopy, whose they
 * are, and what is built over them. */
export function CarParksPanel() {
  useCarParks();
  const now = useSimDay();
  const lots = [...carParks.getLots()].sort((a, b) => b.spaces - a.spaces);
  const selectedId = carParks.getSelectedId();
  const built = carParks.capacityAtKw(now);
  const potential = carParks.potentialKw();
  const mine = lots.filter((l) => l.owner === "municipal");
  const pick = (lot: CarPark) => {
    carParks.select(lot.id);
    mapFocus.request({ lon: lot.lon, lat: lot.lat, minZoom: 16 });
  };
  const row = (lot: CarPark) => (
    <button key={lot.id} className={`ev-list-row${lot.id === selectedId ? " selected" : ""}`} onClick={() => pick(lot)}>
      <span className="ev-list-name">{lotName(lot)}</span>
      <span className="info-value">
        {lot.spaces} · {stateLabel(lot, now)}
      </span>
    </button>
  );

  const overview = (
    <>
      <p className="dh-note">
        A solar canopy over a car park makes power where it is used, shades the cars, and takes no land that isn't paved already. These are the town's open-air car parks
        of about 20 spaces and up.
      </p>
      <div className="info-row">
        <span>Car parks · spaces</span>
        <span className="info-value">
          {lots.length} · {lots.reduce((s, l) => s + l.spaces, 0).toLocaleString("de-CH")}
        </span>
      </div>
      <div className="info-row" title="Canopies generating, against what every car park could carry">
        <span>Canopies</span>
        <span className="info-value">
          {(built / 1000).toFixed(1)} of {(potential / 1000).toFixed(1)} MWp
        </span>
      </div>
      {lots.length === 0 && <p className="dh-note">No open-air car park here is big enough for a canopy.</p>}
      {lots.map(row)}
      {lots.length > 0 && <p className="dh-note tool-list-hint">Click a car park here or on the map: its card shows what a canopy would make and cost.</p>}
    </>
  );

  const build = (
    <>
      <p className="dh-note">
        The town's own car parks — by its schools, halls and sports grounds, and the public ones — you can cover directly, or a few a year with the measure ‘Solar over the
        town's car parks’. Private ones are their owners' to decide; the car park solar subsidy and the solar duty for large car parks (Town hall → Measures) move them.
      </p>
      {mine.length === 0 ? <p className="dh-note">The town has no car park of its own big enough for a canopy.</p> : mine.map(row)}
    </>
  );

  return <ToolPanel mode="carParks" title="Car parks" titleExtra={<PlotLink chart="capacity" title="Solar and wind built over time" />} overview={overview} build={build} />;
}
