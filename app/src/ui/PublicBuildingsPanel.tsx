import { useMemo, useState, useSyncExternalStore } from "react";
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
import { SupervisionNotice } from "./SupervisionNotice";

function monthYear(simTimeMs: number): string {
  return formatDate(simTimeMs).replace(/^\d+ /, "");
}

function shortPriceTag(rp: number): string {
  const chf = rp / 100;
  return chf >= 1_000_000 ? `CHF ${Number((chf / 1_000_000).toFixed(2))}M` : `CHF ${Math.round(chf / 1000)}k`;
}

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
      {solarQuote && (
        <div className="dh-actions">
          <button
            className="dh-order"
            onClick={() => {
              installMunicipalSolarNow(building, realPlants, simClock.getSimTimeMs());
              onOrdered();
            }}
          >
            Put {solarQuote.capacityKw.toFixed(0)} kWp on its roof{solarQuote.batteryKwh !== null ? ` with a ${solarQuote.batteryKwh} kWh grid-friendly battery` : ""} for{" "}
            {formatCHF(solarQuote.costRp)}
          </button>
        </div>
      )}
      {solarQuote?.batteryKwh != null && (
        <p className="dh-note">The grid here is full at summer middays: the array can only connect with a battery that keeps its feed-in to half its rating.</p>
      )}
      {!solar && !solarQuote && <p className="dh-note">No roof to put panels on.</p>}

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
  const [solarOrders, setSolarOrders] = useState(0); // solar orders don't announce themselves; this re-reads after one

  const rows = useMemo(
    () =>
      buildings
        .filter((b) => isPublicBuilding(b) && existsAt(b, now))
        .map((b) => ({ b, status: publicBuildingStatus(b, realPlants) }))
        .sort((a, c) => publicBuildingKind(a.b).localeCompare(publicBuildingKind(c.b)) || (c.b.footprintAreaM2 ?? 0) - (a.b.footprintAreaM2 ?? 0)),
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
  const selected = selectedEgid ? rows.find((r) => r.b.egid === selectedEgid)?.b : undefined;

  const pick = (b: Building) => {
    onSelectBuilding(b.egid);
    mapFocus.focusBuilding(b);
  };

  return (
    <div className="district-heat-panel">
      <h3 className="panel-title">Public buildings</h3>
      <SupervisionNotice />
      <div className="info-row">
        <span>Public buildings</span>
        <span className="info-value">{rows.length}</span>
      </div>
      <div className="info-row">
        <span>☀️ With solar</span>
        <span className="info-value">
          {withSolar.length} · {Math.round(kwp)} kWp
        </span>
      </div>
      <div className="info-row">
        <span>🔌 With chargers</span>
        <span className="info-value">
          {withChargers.length} · {points} points
        </span>
      </div>
      <p className="dh-note">
        Automatically: {solarMeasure ? `solar on ${solarMeasure.perYear} a year` : "no solar programme"},{" "}
        {chargerMeasure ? `chargers at ${chargerMeasure.perYear} a year` : "no charger programme"} (Town hall → Measures). Or pick a building here or on the
        map and order it directly.
      </p>

      {selected ? (
        <PublicBuildingOrders building={selected} realPlants={realPlants} now={now} onOrdered={() => setSolarOrders((n) => n + 1)} />
      ) : (
        <p className="dh-note">Click a public building on the map or in the list below.</p>
      )}

      <h4 className="dh-subtitle">All public buildings</h4>
      {rows.map(({ b, status }) => (
        <button key={b.egid} className={`ev-list-row${b.egid === selectedEgid ? " selected" : ""}`} onClick={() => pick(b)}>
          <span className="ev-list-name" title={publicBuildingKind(b)}>
            {nameOf(b)}
            <span className="dh-note" style={{ margin: 0 }}>
              {" "}
              · {publicBuildingKind(b)}
            </span>
          </span>
          <span className="info-value">
            {status.solar ? "☀️" : ""}
            {status.chargers.length > 0 ? "🔌" : ""}
          </span>
        </button>
      ))}
    </div>
  );
}
