import { useMemo, useSyncExternalStore } from "react";
import { BATTERY_MONTHS, GRID_BATTERY_SIZES, REINFORCE_MONTHS } from "../config/grid";
import { GRID_LEGEND } from "../map/colorModes";
import { mapFocus } from "../map/mapFocus";
import { formatDate } from "../sim/calendar";
import { simClock } from "../sim/engine";
import { grid, gridBatteryCostRp, reinforceCostRp, type GridArea } from "../sim/grid";
import { useSimDay } from "../sim/store";
import { formatCHF } from "./format";
import "./districtHeatPanel.css";
import "./evChargingPanel.css";
import { SupervisionNotice } from "./SupervisionNotice";

const BUCKET_COLOR = Object.fromEntries(GRID_LEGEND.map((l) => [l.bucket, l.color]));

/** "CHF 350k", "CHF 1.05M" — for the narrow battery buttons. */
function compactCHF(rp: number): string {
  const chf = rp / 100;
  return chf >= 1e6 ? `CHF ${(chf / 1e6).toFixed(2).replace(/0$/, "")}M` : `CHF ${Math.round(chf / 1000)}k`;
}

function monthYear(simTimeMs: number): string {
  return formatDate(simTimeMs).replace(/^\d+ /, "");
}

function LoadBar({ kw, capacityKw }: { kw: number; capacityKw: number }) {
  const share = capacityKw > 0 ? kw / capacityKw : 0;
  const color = share > 1 ? BUCKET_COLOR.over : share >= 0.9 ? BUCKET_COLOR.full : share >= 0.75 ? BUCKET_COLOR.tight : BUCKET_COLOR.ok;
  return (
    <div className="dh-bar">
      <div style={{ height: "100%", width: `${Math.min(100, share * 100)}%`, background: color }} />
    </div>
  );
}

function AreaDetails({ area, now }: { area: GridArea; now: number }) {
  const capacity = grid.capacityAt(area, now);
  const planned = grid.plannedCapacity(area);
  const battery = grid.batteryKwAt(area, now);
  const pendingBatteries = area.batteries.filter((b) => b.atMs > now);
  const pendingUpgrade = area.upgrades.filter((u) => u.atMs > now);
  const { drawKw, feedInKw } = grid.effectivePeaks(area, now);
  const drawBlocked = drawKw > capacity;
  const feedInBlocked = feedInKw > capacity;
  return (
    <div className="ev-site">
      <div className="ev-site-head">
        <span className="ev-site-name">Transformer area {area.name}</span>
        <button className="ev-close" onClick={() => grid.select(null)} title="Deselect">
          ✕
        </button>
      </div>
      <div className="info-row">
        <span>Station</span>
        <span className="info-value">
          {capacity} kVA{battery > 0 ? ` + ${battery} kW battery` : ""}
        </span>
      </div>
      <div className="info-row" title="The highest draw on the coldest evenings of the last winter, less what batteries cover">
        <span>Winter peak {area.winter ? `(${area.winter.year})` : ""}</span>
        <span className="info-value">
          {Math.round(drawKw)} kW · {Math.round((drawKw / capacity) * 100)}%
        </span>
      </div>
      <LoadBar kw={drawKw} capacityKw={capacity} />
      <div className="info-row" style={{ marginTop: 6 }} title="The highest feed-in from rooftop solar on the sunniest middays of the last summer, less what batteries cover">
        <span>Summer solar feed-in {area.summer ? `(${area.summer.year})` : ""}</span>
        <span className="info-value">
          {Math.round(feedInKw)} kW · {Math.round((feedInKw / capacity) * 100)}%
        </span>
      </div>
      <LoadBar kw={feedInKw} capacityKw={capacity} />
      {(drawBlocked || feedInBlocked) && (
        <p className="dh-warning">
          Overloaded:{" "}
          {drawBlocked && feedInBlocked
            ? "new heat pumps, wallboxes and large solar arrays"
            : drawBlocked
              ? "new heat pumps and wallboxes"
              : "new large solar arrays"}{" "}
          can't connect here until it's reinforced or a battery takes the edge off.
        </p>
      )}
      {pendingUpgrade.map((u) => (
        <p className="dh-note" key={u.atMs}>
          Reinforcing to {u.capacityKw} kVA — in service {monthYear(u.atMs)}.
        </p>
      ))}
      {pendingBatteries.length > 0 && (
        <p className="dh-note">
          {pendingBatteries.length} battery{pendingBatteries.length === 1 ? "" : "s"} being installed — in service {monthYear(pendingBatteries[pendingBatteries.length - 1].atMs)}.
        </p>
      )}
      <div className="ev-sizes">
        <button onClick={() => grid.reinforce(area.id, simClock.getSimTimeMs())}>
          <span className="ev-build-name">
            Reinforce to {grid.nextSizeFor(area)} kVA
          </span>
          <span className="ev-build-detail">
            {formatCHF(reinforceCostRp(planned))} · {REINFORCE_MONTHS} months
          </span>
        </button>
      </div>
      <div className="dh-note" style={{ marginTop: 6 }} title="A battery covers its power of the area's peak — the winter evening draw and the summer midday feed-in alike — and stores two hours of it">
        Add a neighbourhood battery ({BATTERY_MONTHS} months):
      </div>
      <div className="ev-sizes">
        {GRID_BATTERY_SIZES.map((size, i) => (
          <button key={size.kw} title={formatCHF(gridBatteryCostRp(i, now))} onClick={() => grid.addBattery(area.id, simClock.getSimTimeMs(), i)}>
            <span className="ev-build-name">{size.kwh >= 1000 ? `${size.kwh / 1000} MWh` : `${size.kwh} kWh`}</span>
            <span className="ev-build-detail">{size.kw >= 1000 ? `${size.kw / 1000} MW` : `${size.kw} kW`}</span>
            <span className="ev-build-detail">{compactCHF(gridBatteryCostRp(i, now))}</span>
          </button>
        ))}
      </div>
    </div>
  );
}

/** The grid layer's panel: the transformer areas by how loaded their stations were at the last
 * readings, the selected area's peaks, and reinforcing it or adding a battery. */
export function GridPanel() {
  const version = useSyncExternalStore(
    (listener) => grid.subscribe(listener),
    () => grid.getVersion(),
  );
  const now = useSimDay();
  const areas = grid.getAreas();
  const selectedId = grid.getSelectedId();
  const selected = selectedId !== null ? grid.getArea(selectedId) : undefined;

  const ranked = useMemo(
    () => [...areas].sort((a, c) => grid.loadShare(c, now) - grid.loadShare(a, now)),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [areas, now, version],
  );
  const counts = { ok: 0, tight: 0, full: 0, over: 0 } as Record<string, number>;
  for (const a of areas) counts[grid.bucket(a, now)]++;
  const lastWinter = areas[0]?.winter?.year;
  const lastSummer = areas[0]?.summer?.year;

  return (
    <div className="district-heat-panel">
      <h3 className="panel-title">Electricity grid</h3>
      <SupervisionNotice />
      <div className="info-row">
        <span>Transformer areas</span>
        <span className="info-value">{areas.length}</span>
      </div>
      {GRID_LEGEND.map((l) => (
        <div className="info-row" key={l.bucket}>
          <span>
            <span style={{ display: "inline-block", width: 9, height: 9, borderRadius: 2, background: l.color, marginRight: 5 }} />
            {l.label}
          </span>
          <span className="info-value">{counts[l.bucket]}</span>
        </div>
      ))}
      <p className="dh-note">
        Readings: winter {lastWinter} (coldest January/February evenings), summer {lastSummer} (sunniest middays). The next ones come after each season.
      </p>

      {selected ? <AreaDetails area={selected} now={now} /> : <p className="dh-note">Click a station or a building on the map to see its area.</p>}

      <h4 className="dh-subtitle">Most loaded areas</h4>
      {ranked.slice(0, 8).map((a) => (
        <button
          key={a.id}
          className={`ev-list-row${a.id === selectedId ? " selected" : ""}`}
          onClick={() => {
            grid.select(a.id);
            mapFocus.request({ lon: a.lon, lat: a.lat, minZoom: 15.5 });
          }}
        >
          <span className="ev-list-name">{a.name}</span>
          <span className="info-value">{Math.round(grid.loadShare(a, now) * 100)}%</span>
        </button>
      ))}
    </div>
  );
}
