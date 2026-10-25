import { useSyncExternalStore } from "react";
import { GRID_FULL_FOR_SOLAR } from "../sim/gridLimits";
import { ToolListGroup, ToolListRow } from "./ToolList";
import { CAR_PARK_LEGEND } from "../map/colorModes";
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
import { CardKind, CardSection, Facts } from "./CardParts";

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

/** A car park in a list: where it is — the street of the building it goes with, or its own name. */
function lotTitle(lot: CarPark): string {
  return lot.name ?? carParks.host(lot)?.address ?? "Car park";
}

/** The map's colour for a car park's state (colorModes.ts). */
function legendColor(bucket: string): string {
  return CAR_PARK_LEGEND.find((l) => l.bucket === bucket)?.color ?? "#8f8b80";
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
      <CardKind>
        {lot.spaces} spaces · {Math.round(lot.areaM2).toLocaleString("de-CH")} m²
        {host && !lotName(lot).includes(host.address ?? host.egid) ? ` · goes with ${host.address ?? host.egid}` : ""}
      </CardKind>
      <Facts
        facts={[
          {
            label: canopy ? "Canopy" : "A canopy",
            value: (
              <>
                {Math.round(lot.canopyKw)} kWp<span className="bp-sub"> · {(o.kWh / 1000).toFixed(0)} MWh a year</span>
              </>
            ),
            title: "Panels over the parking spaces (not the aisles), facing as the canopy is laid out",
          },
          canopy && { label: canopy.installedAtMs <= now ? "Generating since" : "Generating from", value: monthYear(canopy.installedAtMs) },
          canopy && {
            label: "Built by",
            value:
              canopy.owner === "municipal"
                ? canopy.mandated
                  ? "the municipality, under the solar duty"
                  : "the municipality"
                : `its owner${canopy.mandated ? ", under the solar duty" : ""}${canopy.subsidyRp > 0 ? `, with ${formatCHF(canopy.subsidyRp)} of your subsidy` : ""}`,
          },
          !canopy && { label: "Cost", value: formatCHF(q.netRp), title: "The build cost, less the federal one-off payment every installation gets" },
          !canopy && { label: "Worth a year", value: formatCHF(o.valueRp - o.upkeepRp), title: host ? "What the building next door would no longer buy, and the rest at the feed-in price, less the upkeep" : "What it earns feeding in, less the upkeep" },
          !canopy && due !== null && { label: "Due under the duty", value: monthYear(due), title: "The solar duty: this car park must have its canopy by then" },
        ]}
      />
      {!canopy && (
        <CardSection title="What could change here">
          {lot.owner === "municipal" && carParks.gridFull(lot, now) ? (
            <p className="dh-note grid-full">{GRID_FULL_FOR_SOLAR}</p>
          ) : lot.owner === "municipal" ? (
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
        </CardSection>
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
  const covered = lots.filter((l) => carParks.canopyOn(l.id));
  const mine = lots.filter((l) => l.owner === "municipal" && !carParks.canopyOn(l.id));
  const theirs = lots.filter((l) => l.owner !== "municipal" && !carParks.canopyOn(l.id));
  const pick = (lot: CarPark) => {
    carParks.select(lot.id);
    mapFocus.request({ lon: lot.lon, lat: lot.lat, minZoom: 16 });
  };
  const row = (lot: CarPark) => {
    const c = carParks.canopyOn(lot.id);
    const kwp = `${Math.round(c?.capacityKw ?? lot.canopyKw)} kWp`;
    return (
      <ToolListRow
        key={lot.id}
        color={legendColor(c ? (c.installedAtMs <= now ? "canopy" : "building") : lot.owner === "municipal" ? "municipal" : "private")}
        title={lotTitle(lot)}
        figure={`${lot.spaces} spaces`}
        detail={
          c
            ? c.installedAtMs <= now
              ? `Solar canopy, ${kwp} · ${lot.owner === "municipal" ? "the town's" : "its owner's"}`
              : `Canopy being built, ${kwp} · ready ${monthYear(c.installedAtMs)}`
            : lot.owner === "municipal"
              ? `No canopy yet · would carry about ${kwp}`
              : `Private, no canopy · would carry about ${kwp}`
        }
        selected={lot.id === selectedId}
        onClick={() => pick(lot)}
      />
    );
  };

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
      {lots.length === 0 ? (
        <p className="dh-note">No open-air car park here is big enough for a canopy.</p>
      ) : (
        <p className="dh-note tool-list-hint">Click a car park here or on the map: its card shows what a canopy would make and cost.</p>
      )}
      <ToolListGroup title="With a canopy">{covered.map(row)}</ToolListGroup>
      <ToolListGroup title="The town's, no canopy yet">{mine.map(row)}</ToolListGroup>
      <ToolListGroup title="Private, no canopy">{theirs.map(row)}</ToolListGroup>
    </>
  );

  const build = (
    <>
      <p className="dh-note">
        The town's own car parks — by its schools, halls and sports grounds, and the public ones — you can cover directly, or a few a year with the measure ‘Solar over the
        town's car parks’. Private ones are their owners' to decide; the car park solar subsidy and the solar duty for large car parks (Town hall → Measures) move them.
      </p>
      {mine.length === 0 ? (
        <p className="dh-note">The town has no car park of its own left without a canopy.</p>
      ) : (
        <ToolListGroup title="The town's, no canopy yet" limit={12}>
          {mine.map(row)}
        </ToolListGroup>
      )}
    </>
  );

  return <ToolPanel mode="carParks" title="Car parks" titleExtra={<PlotLink chart="capacity" title="Solar and wind built over time" />} overview={overview} build={build} />;
}
