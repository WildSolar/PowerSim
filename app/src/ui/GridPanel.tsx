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
import { ToolListGroup, ToolListRow, ToolTile } from "./ToolList";
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
  const auto = grid.getAutoReinforce();
  const blocked = counts.over > 0 ? grid.blockedShare(now) : 0;

  /** What a station's area is doing: which peak loads it most, its size, and work on the way. */
  const areaDetail = (a: GridArea): string => {
    const { drawKw, feedInKw } = grid.effectivePeaks(a, now);
    const up = grid.pendingUpgrade(a, now);
    const battery = a.batteries.filter((b) => b.atMs > now).sort((x, y) => x.atMs - y.atMs)[0];
    return [
      `${grid.capacityAt(a, now)} kVA`,
      drawKw >= feedInKw ? "busiest on winter evenings" : "busiest at sunny middays",
      up && `reinforcing to ${up.capacityKw} kVA, ${monthYear(up.atMs)}`,
      battery && `battery ${monthYear(battery.atMs)}`,
    ]
      .filter(Boolean)
      .join(" · ");
  };
  const areaRow = (a: GridArea, detail = areaDetail(a)) => (
    <ToolListRow
      key={a.id}
      color={BUCKET_COLOR[grid.bucket(a, now)]}
      title={a.name}
      figure={`${Math.round(grid.loadShare(a, now) * 100)}%`}
      detail={detail}
      selected={a.id === selectedId}
      onClick={() => pickArea(a)}
    />
  );
  const needsYou = ranked
    .filter((a) => grid.bucket(a, now) === "over" && !grid.pendingUpgrade(a, now))
    .map((a) => areaRow(a, auto ? "Overloaded — reinforced automatically once the treasury has the money" : "Overloaded — new connections wait; reinforce it on its card"));
  const inBucket = (bucket: string) => ranked.filter((a) => grid.bucket(a, now) === bucket).map((a) => areaRow(a));

  const overview = (
    <>
      <div className="tool-tiles">
        <ToolTile
          label="Stations"
          value={String(areas.length)}
          sub={`${counts.ok} with room to spare`}
          title={`The transformer stations that feed the town's streets, each with its area. Their load is read twice a year: winter ${lastWinter} (the coldest January/February evenings) and summer ${lastSummer} (the sunniest middays); the next readings come after each season.`}
        />
        <ToolTile
          label="Overloaded"
          value={String(counts.over)}
          sub={counts.over > 0 ? `${Math.round(blocked * 100)}% of buildings wait` : "none — all connect"}
          title="Stations whose last peak was more than they can carry. In their area, new heat pumps, wallboxes and large solar arrays wait for a bigger station or a battery."
        />
        <ToolTile
          label="Getting tight"
          value={String(counts.tight + counts.full)}
          sub={`${counts.full} nearly full (90%+)`}
          title="Stations whose last peak took 75% or more of what they can carry: the next heat pumps or solar roofs in their area may tip them over"
        />
        <ToolTile
          label="Work under way"
          value={String(working.length)}
          sub={auto ? "reinforcing automatically" : "bigger stations, batteries"}
          title="Stations being reinforced, or getting a neighbourhood battery"
        />
      </div>

      <ToolListGroup title="Needs you" limit={4}>
        {needsYou}
      </ToolListGroup>

      <ToolListGroup title="Nearly full (90%+)" limit={4}>
        {inBucket("full")}
      </ToolListGroup>
      <ToolListGroup title="Getting tight (75%+)" limit={4}>
        {inBucket("tight")}
      </ToolListGroup>
      <ToolListGroup title="Room to spare" limit={counts.over + counts.full + counts.tight > 0 ? 3 : 6}>
        {inBucket("ok")}
      </ToolListGroup>
      <p className="dh-note tool-list-hint">Most loaded first, at the last readings. Click a station here, or a station or building on the map, to see its area.</p>
    </>
  );

  const build = (
    <>
      <h4 className="tool-list-heading">Reinforce the grid</h4>
      <p className="dh-note">
        Pick a station on the map or in the Overview to reinforce it — a bigger transformer, the size of your choice — or to add a neighbourhood battery.
      </p>
      <label className="dh-check" title="After each reading, every overloaded station with nothing on order gets the size its peak needs, worst first, paid from the treasury. A station the treasury can't pay for waits for the next reading.">
        <input type="checkbox" checked={auto} onChange={(e) => grid.setAutoReinforce(e.target.checked)} />
        Reinforce overloaded stations automatically, if the treasury has the money
      </label>
      <ToolListGroup title="Overloaded, nothing ordered" limit={6}>
        {ranked.filter((a) => grid.bucket(a, now) === "over" && !grid.pendingUpgrade(a, now)).map((a) => areaRow(a))}
      </ToolListGroup>
      <ToolListGroup title="Work under way" limit={6}>
        {working.map((a) => areaRow(a))}
      </ToolListGroup>
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
