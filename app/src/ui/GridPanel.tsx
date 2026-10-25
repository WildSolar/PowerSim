import { BatteryCharging, Wrench } from "lucide-react";
import { useMemo, useSyncExternalStore, type ReactNode } from "react";
import { CardKind, CardSection, Facts } from "./CardParts";
import { BATTERY_MONTHS, GRID_BATTERY_SIZES, REINFORCE_MONTHS } from "../config/grid";
import { GRID_LEGEND } from "../map/colorModes";
import { mapFocus } from "../map/mapFocus";
import { formatDate } from "../sim/calendar";
import { simClock } from "../sim/engine";
import { grid, gridBatteryCostRp, type GridArea } from "../sim/grid";
import { useSimDay } from "../sim/store";
import { formatCHF } from "./format";
import "./districtHeatPanel.css";
import "./evChargingPanel.css";
import { InspectCard } from "./InspectCard";
import { ToolPanel } from "./ToolPanel";
import { PlotLink } from "./PlotLink";

const BUCKET_COLOR = Object.fromEntries(GRID_LEGEND.map((l) => [l.bucket, l.color]));

/** Opens an area's card and brings its station into view. */
function pickArea(a: GridArea): void {
  grid.select(a.id);
  mapFocus.request({ lon: a.lon, lat: a.lat, minZoom: 15.5 });
}

/** "CHF 350k", "CHF 1.05M" — for the narrow battery buttons. */
function compactCHF(rp: number): string {
  const chf = rp / 100;
  return chf >= 1e6 ? `CHF ${(chf / 1e6).toFixed(2).replace(/0$/, "")}M` : `CHF ${Math.round(chf / 1000)}k`;
}

function monthYear(simTimeMs: number): string {
  return formatDate(simTimeMs).replace(/^\d+ /, "");
}

/** "500 kWh", "1 MWh": a neighbourhood battery's storage (two hours of its power, for an order
 * that didn't keep it). */
function batterySize(b: { kw: number; kwh?: number }): string {
  const kwh = b.kwh ?? b.kw * 2;
  return kwh >= 1000 ? `${kwh / 1000} MWh` : `${kwh} kWh`;
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

/** The card for the transformer area picked on the map or in a list: its station, its peaks
 * against it, and reinforcing it or adding a battery. */
export function StationCard() {
  useSyncExternalStore(
    (listener) => grid.subscribe(listener),
    () => grid.getVersion(),
  );
  const now = useSimDay();
  const id = grid.getSelectedId();
  const area = id !== null ? grid.getArea(id) : undefined;
  if (!area) return null;
  return (
    <InspectCard
      kicker="Transformer station"
      title={`Area ${area.name}`}
      titleExtra={<PlotLink chart="transformer" param={String(area.id)} title="This transformer over time" />}
      onClose={() => grid.select(null)}
    >
      <AreaDetails area={area} now={now} />
    </InspectCard>
  );
}

/** A peak as a fact: as read, its share of the station — and with a battery in the area, what is left
 * of it on the station — over a bar against the station. */
function peakValue(measuredKw: number, onStationKw: number, batteryKw: number, capacityKw: number): ReactNode {
  const share = Math.round((onStationKw / capacityKw) * 100);
  return (
    <>
      {Math.round(measuredKw)} kW
      <span className="bp-sub">
        {batteryKw > 0 ? ` · ${Math.round(onStationKw)} kW on the station with the battery` : ""} · {share}% of the station
      </span>
      <LoadBar kw={onStationKw} capacityKw={capacityKw} />
    </>
  );
}

const BUCKET_WORDS: Record<string, string> = { ok: "room to spare", tight: "getting tight", full: "nearly full", over: "overloaded" };

/** A transformer area's card: its station and how loaded it is in a line, its two peaks against it,
 * and what could change — a reinforcement or a neighbourhood battery, and those on their way. */
function AreaDetails({ area, now }: { area: GridArea; now: number }) {
  const capacity = grid.capacityAt(area, now);
  const options = grid.reinforceOptions(area, now);
  const battery = grid.batteryKwAt(area, now);
  const pendingBatteries = area.batteries.filter((b) => b.atMs > now);
  const pendingUpgrade = area.upgrades.filter((u) => u.atMs > now);
  const { drawKw, feedInKw } = grid.effectivePeaks(area, now);
  const drawBlocked = drawKw > capacity;
  const feedInBlocked = feedInKw > capacity;
  return (
    <>
      <CardKind>
        {capacity} kVA station{battery > 0 ? ` + ${battery} kW battery` : ""} · {BUCKET_WORDS[grid.bucket(area, now)]}
      </CardKind>
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
      <Facts
        facts={[
          {
            label: `Winter peak${area.winter ? ` (${area.winter.year})` : ""}`,
            value: peakValue(area.winter?.peakKw ?? 0, drawKw, battery, capacity),
            title: "The highest draw on the coldest evenings of the last winter, read on 1 March. A reinforcement or a battery changes what it is measured against straight away, not the reading itself.",
          },
          {
            label: `Summer feed-in${area.summer ? ` (${area.summer.year})` : ""}`,
            value: peakValue(area.summer?.exportKw ?? 0, feedInKw, battery, capacity),
            title: "The highest feed-in from rooftop solar on the sunniest middays of the last summer, read on 1 September. A reinforcement or a battery changes what it is measured against straight away, not the reading itself.",
          },
        ]}
      />
      <CardSection title="What could change here">
        {pendingUpgrade.map((u) => (
          <p className="dh-note" key={u.atMs}>
            Reinforcing to {u.capacityKw} kVA — in service {monthYear(u.atMs)}
            {u.auto ? " (ordered automatically)" : ""}.
          </p>
        ))}
        {pendingBatteries.length > 0 && (
          <p className="dh-note">
            {pendingBatteries.length === 1 ? "1 battery" : `${pendingBatteries.length} batteries`} ({pendingBatteries.map(batterySize).join(", ")}) being installed — in service{" "}
            {monthYear(pendingBatteries[pendingBatteries.length - 1].atMs)}.
          </p>
        )}
        {options.length > 0 && (
          <>
            <p className="dh-note" title="A new station replaces the old one, cables included: going straight to the size you need costs less than two steps">
              Reinforce the station ({REINFORCE_MONTHS} months):
            </p>
            <div className="ev-sizes">
              {options.map((o) => (
                <button key={o.kw} onClick={() => grid.reinforce(area.id, simClock.getSimTimeMs(), o.kw)}>
                  <span className="ev-build-name">{o.kw} kVA</span>
                  <span className="ev-build-detail">{compactCHF(o.costRp)}</span>
                </button>
              ))}
            </div>
          </>
        )}
        <p
          className="dh-note"
          style={{ marginTop: 8 }}
          title="A battery takes the top off the area's peaks — the winter evening draw and the summer midday feed-in alike: at most its power, and only as much as its storage lasts through the peak"
        >
          Add a neighbourhood battery ({BATTERY_MONTHS} months): <PlotLink chart="trade" title="Power bought, sold and shifted by batteries" />
        </p>
        <div className="ev-sizes">
          {GRID_BATTERY_SIZES.map((size, i) => (
            <button key={size.kw} title={formatCHF(gridBatteryCostRp(i, now))} onClick={() => grid.addBattery(area.id, simClock.getSimTimeMs(), i)}>
              <span className="ev-build-name">{size.kwh >= 1000 ? `${size.kwh / 1000} MWh` : `${size.kwh} kWh`}</span>
              <span className="ev-build-detail">{size.kw >= 1000 ? `${size.kw / 1000} MW` : `${size.kw} kW`}</span>
              <span className="ev-build-detail">{compactCHF(gridBatteryCostRp(i, now))}</span>
            </button>
          ))}
        </div>
      </CardSection>
    </>
  );
}

/** A small mark for an area with work on the way: a bigger station being built, a battery being installed. */
function WorkInProgress({ area, now }: { area: GridArea; now: number }) {
  const upgrade = area.upgrades.filter((u) => u.atMs > now).sort((x, y) => x.atMs - y.atMs)[0];
  const battery = area.batteries.filter((b) => b.atMs > now).sort((x, y) => x.atMs - y.atMs)[0];
  if (!upgrade && !battery) return null;
  const parts = [
    upgrade && `Reinforcing the station (${upgrade.capacityKw} kVA, ${monthYear(upgrade.atMs)})`,
    battery && `A ${batterySize(battery)} battery is being installed (${monthYear(battery.atMs)})`,
  ].filter(Boolean);
  return (
    <span className="grid-wip" title={parts.join("\n")} aria-label={parts.join(". ")}>
      {upgrade && <Wrench size={12} strokeWidth={2} aria-hidden />}
      {battery && <BatteryCharging size={12} strokeWidth={2} aria-hidden />}
    </span>
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

  const ranked = useMemo(
    () => [...areas].sort((a, c) => grid.loadShare(c, now) - grid.loadShare(a, now)),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [areas, now, version],
  );
  const counts = { ok: 0, tight: 0, full: 0, over: 0 } as Record<string, number>;
  for (const a of areas) counts[grid.bucket(a, now)]++;
  const lastWinter = areas[0]?.winter?.year;
  const lastSummer = areas[0]?.summer?.year;

  const working = areas.filter((a) => grid.pendingUpgrade(a, now) || a.batteries.some((b) => b.atMs > now));

  const overview = (
    <>
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
      <h4 className="dh-subtitle">Most loaded areas</h4>
      {ranked.slice(0, 8).map((a) => (
        <button
          key={a.id}
          className={`ev-list-row${a.id === selectedId ? " selected" : ""}`}
          onClick={() => pickArea(a)}
        >
          <span className="ev-list-name">{a.name}</span>
          <WorkInProgress area={a} now={now} />
          <span className="info-value">{Math.round(grid.loadShare(a, now) * 100)}%</span>
        </button>
      ))}
      <p className="dh-note tool-list-hint">Click a station or a building on the map to see its area.</p>
    </>
  );

  const build = (
    <>
      <p className="dh-note">
        Pick a station on the map (or in the Overview&apos;s list) to reinforce it — a bigger transformer, the size of your choice — or to add a neighbourhood battery.
      </p>
      <label className="dh-check" title="After each reading, every overloaded station with nothing on order gets the size its peak needs, worst first, paid from the treasury. A station the treasury can't pay for waits for the next reading.">
        <input type="checkbox" checked={grid.getAutoReinforce()} onChange={(e) => grid.setAutoReinforce(e.target.checked)} />
        Reinforce overloaded stations automatically, if the treasury has the money
      </label>
      {working.length > 0 && (
        <>
          <h4 className="dh-subtitle">Work under way</h4>
          {working.map((a) => {
            const up = grid.pendingUpgrade(a, now);
            const batteries = a.batteries.filter((b) => b.atMs > now);
            return (
              <button key={a.id} className={`ev-list-row${a.id === selectedId ? " selected" : ""}`} onClick={() => pickArea(a)}>
                <span className="ev-list-name">{a.name}</span>
                <span className="info-value">
                  {up ? `${up.capacityKw} kVA, ${monthYear(up.atMs)}` : ""}
                  {up && batteries.length > 0 ? " · " : ""}
                  {batteries.length > 0 ? `${batteries.map(batterySize).join(", ")}, ${monthYear(batteries[batteries.length - 1].atMs)}` : ""}
                </span>
              </button>
            );
          })}
        </>
      )}
    </>
  );

  return (
    <ToolPanel
      mode="grid"
      title="Electricity grid"
      titleExtra={<PlotLink chart="overloaded" title="Overloaded transformers over time" />}
      overview={overview}
      build={build}
    />
  );
}
