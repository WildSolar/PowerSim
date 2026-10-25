import { useMemo, useState, useSyncExternalStore } from "react";
import { GRID_FULL_FOR_SOLAR } from "../sim/gridLimits";
import type { Building, PowerPlant } from "../data/types";
import { mapFocus } from "../map/mapFocus";
import { formatDate } from "../sim/calendar";
import { simClock } from "../sim/engine";
import { existsAt } from "../sim/lifetime";
import { measures } from "../sim/measures";
import { isPublicBuilding, publicBuildingKind, publicBuildingStatus } from "../sim/publicBuildings";
import { buildCostRp, buildMonthsFor, pointsAt, publicCharging, sizesFor } from "../sim/publicCharging";
import { installMunicipalSolarNow, municipalSolarQuote } from "../sim/solarAdoption";
import { useSimDay } from "../sim/store";
import { formatCHF } from "./format";
import "./districtHeatPanel.css";
import "./evChargingPanel.css";
import { ToolPanel } from "./ToolPanel";
import { ToolListGroup, ToolListRow, ToolTile } from "./ToolList";
import { Facts } from "./CardParts";
import { PUBLIC_BUILDINGS_LEGEND } from "../map/colorModes";
import { treasury } from "../sim/treasury";

function monthYear(simTimeMs: number): string {
  return formatDate(simTimeMs).replace(/^\d+ /, "");
}

function shortPriceTag(rp: number): string {
  const chf = rp / 100;
  return chf >= 1_000_000 ? `CHF ${Number((chf / 1_000_000).toFixed(2))}M` : `CHF ${Math.round(chf / 1000)}k`;
}

const LEGEND_COLOR = Object.fromEntries(PUBLIC_BUILDINGS_LEGEND.map((l) => [l.bucket, l.color]));

function nameOf(b: Building): string {
  return b.address ?? `Building ${b.egid}`;
}

/** What the municipality has on one of its buildings, and ordering more: solar on its roof, chargers
 * in its car park. Also in the building panel of a public building (without the name, which the
 * panel already shows). */
export function PublicBuildingOrders({
  building,
  realPlants,
  now,
  onOrdered,
  withName = true,
}: {
  building: Building;
  realPlants: PowerPlant[];
  now: number;
  onOrdered: () => void;
  withName?: boolean;
}) {
  const { solar, chargers } = publicBuildingStatus(building, realPlants);
  const solarQuote = solar ? null : municipalSolarQuote(building, realPlants, now);
  return (
    <div className="ev-site">
      {withName && (
        <div className="ev-site-head">
          <span className="ev-site-name">
            {nameOf(building)}
            <span className="dh-note" style={{ display: "block", margin: 0 }}>
              {publicBuildingKind(building)}
            </span>
          </span>
        </div>
      )}

      <div className="info-row">
        <span>☀️ Solar</span>
        <span className="info-value">
          {solar
            ? `${solar.capacityKw.toFixed(0)} kWp${solar.installedAtMs > now ? ` · from ${monthYear(solar.installedAtMs)}` : ""}`
            : "none"}
        </span>
      </div>
      {solarQuote?.gridFull && <p className="dh-note grid-full">{GRID_FULL_FOR_SOLAR}</p>}
      {solarQuote && !solarQuote.gridFull && (
        <div className="dh-actions">
          <button
            className="dh-order"
            onClick={() => {
              installMunicipalSolarNow(building, realPlants, simClock.getSimTimeMs());
              onOrdered();
            }}
          >
            Put {solarQuote.capacityKw.toFixed(0)} kWp on its roof for{" "}
            {formatCHF(solarQuote.costRp)}
          </button>
        </div>
      )}
      {!solar && !solarQuote && <p className="dh-note">Its roof isn't suited to panels: it faces the wrong way, lies in shade or is too cluttered.</p>}

      <div className="info-row" style={{ marginTop: 6 }}>
        <span>🔌 Chargers</span>
        <span className="info-value">
          {chargers.length === 0
            ? "none"
            : chargers
                .map((s) => (s.openedAtMs > now ? `${s.points} points from ${monthYear(s.openedAtMs)}` : `${pointsAt(s, now)} points`))
                .join(", ")}
        </span>
      </div>
      {chargers.length === 0 ? (
        <div className="ev-sizes">
          {sizesFor("ac").map(({ points }) => (
            <button
              key={points}
              onClick={() => {
                publicCharging.buildAtBuilding(building, points, simClock.getSimTimeMs());
                onOrdered();
              }}
            >
              <span className="ev-build-name">{points} points</span>
              <span className="ev-build-detail">{shortPriceTag(buildCostRp("ac", now, points))}</span>
              <span className="ev-build-detail">{buildMonthsFor("ac", points)} months</span>
            </button>
          ))}
        </div>
      ) : (
        <p className="dh-note">Enlarge or check how they're used in the EV charging layer.</p>
      )}
    </div>
  );
}

/** The Public buildings layer's panel: the municipality's own buildings, what it has put on them,
 * the measures that do it automatically, and putting solar or chargers on one of them directly. */
export function PublicBuildingsPanel({
  buildings,
  realPlants,
  selectedEgid,
  onSelectBuilding,
}: {
  buildings: Building[];
  realPlants: PowerPlant[];
  selectedEgid: string | null;
  onSelectBuilding: (egid: string) => void;
}) {
  const chargingVersion = useSyncExternalStore(
    (listener) => publicCharging.subscribe(listener),
    () => publicCharging.getVersion(),
  );
  const measuresVersion = useSyncExternalStore(
    (listener) => measures.subscribe(listener),
    () => measures.getVersion(),
  );
  const now = useSimDay();
  // Solar orders (on a building's card) don't announce themselves, but they are paid: re-read then.
  const solarOrders = useSyncExternalStore(
    (listener) => treasury.subscribe(listener),
    () => treasury.getVersion(),
  );

  const rows = useMemo(
    () =>
      buildings
        .filter((b) => isPublicBuilding(b) && existsAt(b, now))
        .map((b) => {
          const status = publicBuildingStatus(b, realPlants);
          return { b, kind: publicBuildingKind(b), status, quote: status.solar ? null : municipalSolarQuote(b, realPlants, now) };
        })
        // The biggest roofs first: what they carry, or could.
        .sort((a, c) => (c.status.solar?.capacityKw ?? c.quote?.capacityKw ?? 0) - (a.status.solar?.capacityKw ?? a.quote?.capacityKw ?? 0)),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [buildings, realPlants, now, chargingVersion, solarOrders],
  );
  const withSolar = rows.filter((r) => r.status.solar);
  const withChargers = rows.filter((r) => r.status.chargers.length > 0);
  const kwp = withSolar.reduce((sum, r) => sum + (r.status.solar?.capacityKw ?? 0), 0);
  const points = withChargers.reduce((sum, r) => sum + r.status.chargers.reduce((s, c) => s + publicCharging.plannedPoints(c), 0), 0);

  const active = useMemo(
    () => new Map(measures.getActiveMeasures().map(({ def, params }) => [def.id, params])),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [measuresVersion],
  );
  const solarMeasure = active.get("municipal-solar");
  const chargerMeasure = active.get("public-building-chargers");
  const [kindFilter, setKindFilter] = useState<string | null>(null);
  const kinds = [...new Set(rows.map((r) => r.kind))].sort();
  const shown = rows.filter((r) => kindFilter === null || r.kind === kindFilter);
  const free = rows.filter((r) => r.quote);
  const freeKwp = free.reduce((sum, r) => sum + (r.quote?.capacityKw ?? 0), 0);

  const pick = (b: Building) => {
    onSelectBuilding(b.egid);
    mapFocus.focusBuilding(b);
  };
  type Row = (typeof rows)[number];
  const chargerText = (r: Row) =>
    r.status.chargers.map((c) => (c.openedAtMs > now ? `${c.points} points from ${monthYear(c.openedAtMs)}` : `${pointsAt(c, now)} charge points`)).join(", ");
  const row = (r: Row, figure?: string, detail?: string) => {
    const solar = r.status.solar;
    const chargers = r.status.chargers.length > 0;
    return (
      <ToolListRow
        key={r.b.egid}
        color={LEGEND_COLOR[solar && chargers ? "both" : solar ? "solar" : chargers ? "chargers" : "none"]}
        title={nameOf(r.b)}
        figure={figure ?? (solar ? `${Math.round(solar.capacityKw)} kWp` : r.quote ? `room for ${Math.round(r.quote.capacityKw)} kWp` : undefined)}
        detail={
          detail ??
          [r.kind, solar && solar.installedAtMs > now ? `solar from ${monthYear(solar.installedAtMs)}` : null, chargers ? chargerText(r) : null].filter(Boolean).join(" · ")
        }
        selected={r.b.egid === selectedEgid}
        onClick={() => pick(r.b)}
      />
    );
  };

  const overview = (
    <>
      {withSolar.length === 0 && withChargers.length === 0 && (
        <p className="dh-note">
          The municipality&apos;s own buildings — schools, halls, its offices — are where it can lead by example: solar on their roofs, chargers in their car parks.
        </p>
      )}
      <div className="tool-tiles">
        <ToolTile label="Public buildings" value={String(rows.length)} sub={`${kinds.length} kind${kinds.length === 1 ? "" : "s"}`} title="The municipality's own buildings standing now" />
        <ToolTile
          label="Solar"
          value={`${Math.round(kwp)} kWp`}
          sub={`on ${withSolar.length} of them`}
          title="Solar on public buildings' roofs, the municipality's own and what was there before"
        />
        <ToolTile
          label="Roofs free"
          value={String(free.length)}
          sub={`room for ${Math.round(freeKwp)} kWp`}
          title="Public buildings without solar whose roof would carry panels — not those facing the wrong way, in shade or too cluttered"
        />
        <ToolTile label="Chargers" value={`${points} points`} sub={`at ${withChargers.length} of them`} title="Public charge points in the car parks of public buildings, being built included" />
      </div>

      {kinds.length > 1 && (
        <div className="ev-filters" role="group" aria-label="Which kind of building">
          <button className={`ev-filter${kindFilter === null ? " on" : ""}`} aria-pressed={kindFilter === null} onClick={() => setKindFilter(null)}>
            All
          </button>
          {kinds.map((k) => (
            <button key={k} className={`ev-filter${kindFilter === k ? " on" : ""}`} aria-pressed={kindFilter === k} onClick={() => setKindFilter(k)}>
              {k}
            </button>
          ))}
        </div>
      )}
      <ToolListGroup title="Neither yet" limit={5}>
        {shown.filter((r) => !r.status.solar && r.status.chargers.length === 0).map((r) => row(r))}
      </ToolListGroup>
      <ToolListGroup title="Solar" limit={4}>
        {shown.filter((r) => r.status.solar && r.status.chargers.length === 0).map((r) => row(r))}
      </ToolListGroup>
      <ToolListGroup title="Chargers" limit={4}>
        {shown.filter((r) => !r.status.solar && r.status.chargers.length > 0).map((r) => row(r))}
      </ToolListGroup>
      <ToolListGroup title="Solar and chargers" limit={4}>
        {shown.filter((r) => r.status.solar && r.status.chargers.length > 0).map((r) => row(r))}
      </ToolListGroup>
      <p className="dh-note tool-list-hint">Biggest roofs first. Click a building here or on the map: its card shows what it has, and what you can put on it.</p>
    </>
  );

  const build = (
    <>
      <h4 className="tool-list-heading">Set in Town hall → Measures</h4>
      <Facts
        facts={[
          { label: "Solar programme", value: solarMeasure ? `${solarMeasure.perYear} roofs a year` : "none", title: "The measure that puts solar on public buildings' roofs each year, the biggest first" },
          { label: "Charger programme", value: chargerMeasure ? `${chargerMeasure.perYear} buildings a year` : "none", title: "The measure that puts public chargers at public buildings each year" },
        ]}
      />
      <ToolListGroup title="Roofs for solar" limit={6}>
        {free.map((r) =>
          row(r, r.quote?.gridFull ? "grid full" : formatCHF(r.quote?.costRp ?? 0), `${Math.round(r.quote?.capacityKw ?? 0)} kWp · ${r.kind}${r.quote?.gridFull ? " · the grid here can't take it yet" : ""}`),
        )}
      </ToolListGroup>
      <ToolListGroup title="No chargers yet" limit={4}>
        {rows.filter((r) => r.status.chargers.length === 0).map((r) => row(r, "", r.kind))}
      </ToolListGroup>
      <p className="dh-note tool-list-hint">Pick a building: its card orders solar for its roof (the cost after the federal payment) or chargers for its car park.</p>
    </>
  );

  return <ToolPanel mode="publicBuildings" title="Public buildings" overview={overview} build={build} />;
}
