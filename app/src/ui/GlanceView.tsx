import { useEffect, useMemo, useState, useSyncExternalStore } from "react";
import { HEATING_SYSTEM_CATALOG } from "../config/heating";
import { MOBILITY_MODE_CATALOG } from "../config/mobility";
import { RESIDENTS_PER_DWELLING } from "../config/treasury";
import type { Building, MunicipalityDataset, PowerPlant } from "../data/types";
import { BASELINE_YEAR, MONTH_NAMES, formatDate, toDateMs } from "../sim/calendar";
import { cachedEmissionsForYear } from "../sim/emissions";
import { fleets } from "../sim/fleet";
import { GRID_BATTERY_ROUND_TRIP } from "../config/spotMarket";
import { grid } from "../sim/grid";
import { batteriesThroughTheDay } from "../sim/peakShave";
import { currentHeatingSystemId } from "../sim/heatingRenewal";
import type { CategorySeries } from "../sim/history";
import { existsAt } from "../sim/lifetime";
import { mobilityCensus } from "../sim/mobility";
import { monthRecords, type MonthRecord } from "../sim/monthRecords";
import { sampleMunicipalityLast24h, warmLast24h } from "../sim/rollingHistory";
import { effectivePowerPlantsAt } from "../sim/solarAdoption";
import { useSimDay, useTariff } from "../sim/store";
import { tariffKey } from "../sim/tariff";
import { windPowerW } from "../sim/windPower";
import { ELECTRICITY_GROUPS, energyUnit, HEAT_KEYS, type ChartData } from "./charts";
import { DEVICE_CATEGORIES } from "./deviceCategories";
import { PlotLink } from "./PlotLink";
import { formatValue, TimeChart } from "./TimeChart";
import "./glance.css";

const HOUR_MS = 3_600_000;

// --- then and now ---

/** What the town had at an instant: the figures the table compares. */
interface TownFigures {
  buildings: number;
  homes: number;
  heated: number;
  fossil: number;
  heatPumps: number;
  districtHeat: number;
  solarKw: number;
  windKw: number;
  batteryKwh: number;
  cars: number;
  carsElectric: number;
  byMode: Record<"car" | "bike" | "other", number>;
  vans: number;
  vansElectric: number;
  trucks: number;
  trucksElectric: number;
}

function townAt(buildings: Building[], realPlants: PowerPlant[], t: number): TownFigures {
  let count = 0;
  let homes = 0;
  let heated = 0;
  let fossil = 0;
  let heatPumps = 0;
  let districtHeat = 0;
  for (const b of buildings) {
    if (!existsAt(b, t)) continue;
    count++;
    homes += b.dwellings.length;
    const id = currentHeatingSystemId(b, t);
    if (!id) continue;
    heated++;
    if (id === "oilBoiler" || id === "gasBoiler") fossil++;
    else if (id === "airHeatPump" || id === "groundHeatPump") heatPumps++;
    else if (id === "districtHeating") districtHeat++;
  }
  const plants = effectivePowerPlantsAt(buildings, realPlants, t).filter((p) => p.activeToMs === undefined || p.activeToMs > t);
  const solar = plants.filter((p) => p.technology === "Photovoltaic");
  const mobility = mobilityCensus(buildings, t);
  const fleet = fleets.census(buildings, t);
  return {
    buildings: count,
    homes,
    heated,
    fossil,
    heatPumps,
    districtHeat,
    solarKw: solar.reduce((s, p) => s + (p.capacityKw ?? 0), 0),
    windKw: plants.filter((p) => p.technology === "Wind").reduce((s, p) => s + (p.capacityKw ?? 0), 0),
    batteryKwh: solar.reduce((s, p) => s + (p.battery?.kwh ?? 0), 0) + grid.batteriesInService(t).kwh,
    cars: mobility.byMode.car,
    carsElectric: mobility.carsElectric,
    byMode: mobility.byMode,
    ...fleet,
  };
}

const n = (v: number) => Math.round(v).toLocaleString("de-CH");
const pct = (part: number, whole: number) => (whole > 0 ? `${Math.round((part / whole) * 100)}%` : "–");
const mw = (kw: number) => `${(kw / 1000).toLocaleString("de-CH", { maximumFractionDigits: kw >= 10_000 ? 0 : 1 })} MW`;
const mwh = (kwh: number) => `${(kwh / 1000).toLocaleString("de-CH", { maximumFractionDigits: kwh >= 10_000 ? 0 : 1 })} MWh`;
const ofWhole = (part: number, whole: number) => `${n(part)} (${pct(part, whole)})`;

/** Transformer areas whose station was over capacity: at its first reading, and at its last. */
function overloaded(nowMs: number): { start: number | null; now: number | null } {
  const areas = grid.getAreas().filter((a) => (a.readings ?? []).length > 0);
  if (areas.length === 0) return { start: null, now: null };
  const firstYear = Math.min(...areas.flatMap((a) => a.readings!.map((r) => r.year)));
  return {
    start: areas.filter((a) => a.readings!.some((r) => r.year === firstYear && r.kw > r.capacityKw)).length,
    now: areas.filter((a) => grid.bucket(a, nowMs) === "over").length,
  };
}

/** Net CO₂ per resident in a counted year (t). */
function perResidentT(year: number): number | null {
  const e = cachedEmissionsForYear(year);
  return e && e.residents > 0 ? e.netKgCO2 / e.residents / 1000 : null;
}

interface Row {
  label: string;
  start: string;
  now: string;
  chart?: string;
  sub?: boolean;
}

function ThenAndNow({ dataset, nowMs }: { dataset: MunicipalityDataset; nowMs: number }) {
  useSyncExternalStore(
    (l) => grid.subscribe(l),
    () => grid.getVersion(),
  );
  const start = useMemo(() => townAt(dataset.buildings, dataset.powerPlants, 0), [dataset]);
  const now = useMemo(() => townAt(dataset.buildings, dataset.powerPlants, nowMs), [dataset, nowMs]);
  const grids = overloaded(nowMs);
  const year = new Date(toDateMs(nowMs)).getUTCFullYear();
  const lastCounted = [year - 1, year - 2].find((y) => y >= BASELINE_YEAR && cachedEmissionsForYear(y) !== null) ?? null;
  const co2Start = perResidentT(BASELINE_YEAR);
  const co2Now = lastCounted !== null ? perResidentT(lastCounted) : null;
  const t = (v: number | null, y: number) => (v === null ? "–" : `${v.toLocaleString("de-CH", { minimumFractionDigits: 1, maximumFractionDigits: 1 })} t (${y})`);
  const travellers = (f: TownFigures) => f.byMode.car + f.byMode.bike + f.byMode.other;

  const rows: Row[] = [
    { label: "Homes", start: n(start.homes), now: n(now.homes) },
    { label: "Residents", start: n(start.homes * RESIDENTS_PER_DWELLING), now: n(now.homes * RESIDENTS_PER_DWELLING), sub: true },
    { label: "Heated buildings", start: n(start.heated), now: n(now.heated), chart: "heating-systems" },
    { label: "with oil or gas", start: ofWhole(start.fossil, start.heated), now: ofWhole(now.fossil, now.heated), sub: true },
    { label: "with a heat pump", start: ofWhole(start.heatPumps, start.heated), now: ofWhole(now.heatPumps, now.heated), chart: "heat-pumps", sub: true },
    { label: "on district heating", start: ofWhole(start.districtHeat, start.heated), now: ofWhole(now.districtHeat, now.heated), chart: "dh-reach", sub: true },
    { label: "Solar", start: mw(start.solarKw), now: mw(now.solarKw), chart: "capacity" },
    ...(now.windKw > 0 || start.windKw > 0 ? [{ label: "Wind", start: mw(start.windKw), now: mw(now.windKw), chart: "capacity" }] : []),
    { label: "Batteries", start: mwh(start.batteryKwh), now: mwh(now.batteryKwh), chart: "batteries" },
    { label: "Residents' cars", start: n(start.cars), now: n(now.cars), chart: "electric-vehicles" },
    { label: "electric", start: ofWhole(start.carsElectric, start.cars), now: ofWhole(now.carsElectric, now.cars), sub: true },
    { label: "Business vans, electric", start: ofWhole(start.vansElectric, start.vans), now: ofWhole(now.vansElectric, now.vans) },
    { label: "Lorries, electric", start: ofWhole(start.trucksElectric, start.trucks), now: ofWhole(now.trucksElectric, now.trucks) },
    { label: "Getting around", start: "", now: "", chart: "modal-split" },
    ...(["car", "bike", "other"] as const).map((m) => ({
      label: `${MOBILITY_MODE_CATALOG[m].icon} ${MOBILITY_MODE_CATALOG[m].label}`,
      start: pct(start.byMode[m], travellers(start)),
      now: pct(now.byMode[m], travellers(now)),
      sub: true,
    })),
    {
      label: "Transformers over capacity",
      start: grids.start === null ? "–" : n(grids.start),
      now: grids.now === null ? "–" : n(grids.now),
      chart: "overloaded",
    },
    { label: "CO₂ per resident", start: t(co2Start, BASELINE_YEAR), now: lastCounted !== null ? t(co2Now, lastCounted) : "–", chart: "emissions" },
  ];

  return (
    <section className="glance-card glance-then-now">
      <h3>The town, then and now</h3>
      <table>
        <thead>
          <tr>
            <th />
            <th>{formatDate(0).replace(/^\d+ /, "")}</th>
            <th>Now</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.label} className={r.sub ? "sub" : r.start === "" ? "head" : ""}>
              <td>
                {r.label}
                {r.chart && <PlotLink chart={r.chart} title={`${r.label.replace(/^\W+ /, "")} over time`} />}
              </td>
              <td>{r.start}</td>
              <td>{r.now}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <p className="glance-note">CO₂ is counted at the end of each year; the transformers are read after each winter and summer.</p>
    </section>
  );
}

// --- energy, from the month records ---

type Period = "month" | "year";

interface BarRow {
  key: string;
  label: string;
  color: string;
  kWh: number;
}

/** Rows as bars, largest first, each with its amount and its share of the whole. */
function Bars({ rows }: { rows: BarRow[] }) {
  const total = rows.reduce((s, r) => s + r.kWh, 0);
  const max = Math.max(1, ...rows.map((r) => r.kWh));
  const { unit, scale } = energyUnit(max);
  return (
    <div className="glance-bars">
      {[...rows]
        .filter((r) => r.kWh > 0)
        .sort((a, b) => b.kWh - a.kWh)
        .map((r) => (
          <div className="glance-bar" key={r.key}>
            <span className="glance-bar-label">
              <i style={{ background: r.color }} />
              {r.label}
            </span>
            <span className="glance-bar-track">
              <span style={{ width: `${(r.kWh / max) * 100}%`, background: r.color }} />
            </span>
            <span className="glance-bar-value">
              {formatValue(r.kWh * scale)} {unit}
            </span>
            <span className="glance-bar-share">{pct(r.kWh, total)}</span>
          </div>
        ))}
    </div>
  );
}

function monthLabel(month: number): string {
  return `${MONTH_NAMES[month % 12]} ${Math.floor(month / 12)}`;
}

function sumOf(records: MonthRecord[], pick: (r: MonthRecord) => number): number {
  return records.reduce((s, r) => s + pick(r), 0);
}

const deviceColor = (key: string) => DEVICE_CATEGORIES.find((c) => c.key === key)?.color ?? "#888";

function Energy() {
  useSyncExternalStore(
    (l) => monthRecords.subscribe(l),
    () => monthRecords.getVersion(),
  );
  const [period, setPeriod] = useState<Period>("year");
  const all = monthRecords.all();
  const electricity = all.filter((r) => r.electricityKWh).slice(period === "month" ? -1 : -12);
  const heat = all.filter((r) => r.heatingKWh).slice(period === "month" ? -1 : -12);
  const range = (rs: MonthRecord[]) =>
    rs.length === 0 ? "" : rs.length === 1 ? monthLabel(rs[0].month) : `${monthLabel(rs[0].month)} – ${monthLabel(rs[rs.length - 1].month)}`;

  const useRows: BarRow[] = ELECTRICITY_GROUPS.map((g) => ({ key: g.key, label: g.label, color: g.color, kWh: sumOf(electricity, (r) => g.of.reduce((s, k) => s + r.electricityKWh![k], 0)) }));
  const dhHeatPump = sumOf(electricity, (r) => r.dhHeatPumpKWh ?? 0);
  if (dhHeatPump > 0) useRows.push({ key: "dhHeatPump", label: "District heating heat pumps", color: "#7a4fb5", kWh: dhHeatPump });
  const used = useRows.reduce((s, r) => s + r.kWh, 0);
  const solar = sumOf(electricity, (r) => r.electricityKWh!.solar);
  const wind = sumOf(electricity, (r) => r.windKWh ?? 0);
  // What the town's own generation covered: made, less the surplus sold — where the trade was kept.
  const traded = electricity.length > 0 && electricity.every((r) => r.soldKWh !== undefined);
  const sold = sumOf(electricity, (r) => r.soldKWh ?? 0);
  const local = Math.min(used, Math.max(0, solar + wind - sold));

  const heatRows: BarRow[] = HEAT_KEYS.map(([k, id]) => ({ key: k, label: HEATING_SYSTEM_CATALOG[id].label, color: HEATING_SYSTEM_CATALOG[id].color, kWh: sumOf(heat, (r) => r.heatingKWh![k] ?? 0) }));
  const heatTotal = heatRows.reduce((s, r) => s + r.kWh, 0);
  const fossilHeat = heatRows.filter((r) => r.key === "oil" || r.key === "gas").reduce((s, r) => s + r.kWh, 0);

  return (
    <>
      <div className="glance-section-head">
        <h3>Energy</h3>
        <div className="tier-buttons">
          <button className={period === "month" ? "active" : ""} onClick={() => setPeriod("month")}>
            Last month
          </button>
          <button className={period === "year" ? "active" : ""} onClick={() => setPeriod("year")}>
            Last 12 months
          </button>
        </div>
      </div>
      {electricity.length === 0 && heat.length === 0 ? (
        <p className="glance-empty">Nothing counted yet: each month is counted once it is over.</p>
      ) : (
        <>
          <section className="glance-card">
            <h4>
              Electricity by use <PlotLink chart="electricity" title="Electricity over time" />
            </h4>
            <p className="glance-sub">{range(electricity)}{period === "year" && electricity.length < 12 ? ` (${electricity.length} months counted so far)` : ""}</p>
            <Bars rows={useRows} />
            <div className="glance-figures">
              <div>
                <span>Made by solar{wind > 0 ? " and wind" : ""}</span>
                <strong>{mwh(solar + wind)}</strong>
              </div>
              {traded && (
                <>
                  <div>
                    <span>Of the town's use, covered by its own</span>
                    <strong>{pct(local, used)}</strong>
                  </div>
                  <div>
                    <span>Surplus sold</span>
                    <strong>{mwh(sold)}</strong>
                  </div>
                </>
              )}
            </div>
          </section>
          <section className="glance-card">
            <h4>
              Heat by heating system <PlotLink chart="heat" title="Heat over time" />
            </h4>
            <p className="glance-sub">{range(heat)}</p>
            <Bars rows={heatRows} />
            <div className="glance-figures">
              <div>
                <span>From oil and gas</span>
                <strong>{pct(fossilHeat, heatTotal)}</strong>
              </div>
            </div>
          </section>
        </>
      )}
    </>
  );
}

// --- the last day ---

const DAY_HOURS = 24;
// The other side of the balance: where the town's power came from, and what it did beyond its use.
const WIND_COLOR = "#2a78d6";
const BATTERY_COLOR = "#eb6834";
const BOUGHT_COLOR = "#6f6d66";
const SENT_OUT_COLOR = "#b4b2a9";

/** The day's power as a balance: above the line where it went — each use, the batteries charging,
 * what was sent out of town — and below it where it came from — the town's own solar and wind, the
 * batteries, and the wider grid. The neighbourhood batteries are run through the day as the utility
 * runs them (spotMarket.ts, peakShave.ts): empty at midnight, they store from the top of the town's
 * surplus — the sunniest hours — and give it back into the top of its draw once they have it. */
function dayChart(
  times: number[],
  series: CategorySeries,
  windW: number[],
  homeBatteryW: number[],
  curtailedW: number[],
  gridBattery: { kw: number; kwh: number },
  startMs: number,
): ChartData {
  const toMW = (w: number) => w / 1e6;
  const stacks = ELECTRICITY_GROUPS.map((g) => ({
    key: g.key,
    label: g.label,
    color: g.color,
    kind: "stack" as const,
    values: times.map((_, i) => toMW(g.of.reduce((s, k) => s + series[`${k}W` as keyof CategorySeries][i], 0))),
  }));
  const usedW = times.map((_, i) => ELECTRICITY_GROUPS.reduce((sum, g) => sum + g.of.reduce((s, k) => s + series[`${k}W` as keyof CategorySeries][i], 0), 0));
  // The series' generation is everything the plants made, wind turbines included; less what the
  // home batteries' feed-in caps held back.
  const solarW = times.map((_, i) => Math.max(0, series.solarW[i] - windW[i] - curtailedW[i]));
  const hoursOf = times.map((t, i) => (i > 0 ? (t - times[i - 1]) / HOUR_MS : 0));
  // What the town still needs after its own plants and its home batteries (negative: a surplus).
  const residualW = times.map((_, i) => usedW[i] + homeBatteryW[i] - solarW[i] - windW[i]);
  const { chargeW, dischargeW } = batteriesThroughTheDay(residualW, hoursOf, gridBattery, GRID_BATTERY_ROUND_TRIP);
  const intoW = times.map((_, i) => Math.max(0, homeBatteryW[i]) + chargeW[i]);
  const outOfW = times.map((_, i) => Math.max(0, -homeBatteryW[i]) + dischargeW[i]);
  const netW = residualW.map((w, i) => w + chargeW[i] - dischargeW[i]);
  const boughtW = netW.map((w) => Math.max(0, w));
  const sentW = netW.map((w) => Math.max(0, -w));
  const clock = (t: number) => {
    const d = new Date(toDateMs(t));
    return `${String(d.getUTCHours()).padStart(2, "0")}:${String(d.getUTCMinutes()).padStart(2, "0")}`;
  };
  const any = (w: number[]) => w.some((v) => v > 1);
  return {
    xs: times.map((t) => (t - startMs) / HOUR_MS),
    xLabels: times.map(clock),
    xTicks: [0, 6, 12, 18, 24].map((h) => ({ x: h, label: `${String(h).padStart(2, "0")}:00` })),
    from: 0,
    to: DAY_HOURS,
    unit: "MW",
    total: "Went to",
    totalBelow: "Came from",
    height: 400,
    series: [
      ...stacks,
      ...(any(intoW) || any(outOfW)
        ? [{ key: "into", label: "Into batteries", legend: "Batteries: in (above), out (below)", color: BATTERY_COLOR, kind: "stack" as const, values: intoW.map(toMW) }]
        : []),
      ...(any(sentW) ? [{ key: "sent", label: "Sent out of town", color: SENT_OUT_COLOR, kind: "stack" as const, values: sentW.map(toMW) }] : []),
      { key: "solar", label: "Own solar", color: deviceColor("solar"), kind: "stack", below: true, values: solarW.map(toMW) },
      ...(any(windW) ? [{ key: "wind", label: "Own wind", color: WIND_COLOR, kind: "stack" as const, below: true, values: windW.map(toMW) }] : []),
      ...(any(intoW) || any(outOfW)
        ? [{ key: "outOf", label: "Out of batteries", legend: false as const, color: BATTERY_COLOR, kind: "stack" as const, below: true, values: outOfW.map(toMW) }]
        : []),
      { key: "bought", label: "Bought from the grid", color: BOUGHT_COLOR, kind: "stack", below: true, values: boughtW.map(toMW) },
    ],
  };
}

/** "a, b and c", leaving out what's false. */
function inWords(parts: (string | false)[]): string {
  const p = parts.filter((x): x is string => !!x);
  return p.length > 1 ? `${p.slice(0, -1).join(", ")} and ${p[p.length - 1]}` : (p[0] ?? "");
}

/** The day before today, midnight to midnight: what the town's power went to, and where it came from. */
function LastDay({ dataset }: { dataset: MunicipalityDataset }) {
  const tariff = useTariff();
  const today = useSimDay(); // midnight today
  const [data, setData] = useState<ChartData | null>(null);
  const [read, setRead] = useState(0);
  const key = `${tariffKey(tariff)}:${today}`;

  useEffect(() => {
    let cancelled = false;
    const run = async () => {
      // Sampled a little at a time first, so the page never stalls on it.
      setRead(0);
      await warmLast24h(dataset.buildings, dataset.powerPlants, today, tariff, () => cancelled, setRead);
      if (cancelled) return;
      const { times, series, homeBatteryW, curtailedW } = sampleMunicipalityLast24h(dataset.buildings, dataset.powerPlants, today, tariff);
      const startMs = today - DAY_HOURS * HOUR_MS;
      const turbines = effectivePowerPlantsAt(dataset.buildings, dataset.powerPlants, today).filter((p) => p.technology === "Wind");
      const windW = times.map((t) => turbines.reduce((s, p) => s + (p.activeToMs === undefined || p.activeToMs > t ? windPowerW(p, t) : 0), 0));
      setData(dayChart(times, series, windW, homeBatteryW, curtailedW, grid.batteriesInService(startMs), startMs));
    };
    run();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, dataset]);

  const has = (key: string) => data?.series.some((s) => s.key === key) ?? false;
  return (
    <section className="glance-card">
      <h4>Power yesterday, {formatDate(today - DAY_HOURS * HOUR_MS)}</h4>
      <p className="glance-sub">
        Above the line, what the town&apos;s power went to: {inWords(["its homes, businesses and cars by use", has("into") && "its batteries charging", has("sent") && "what it sent out of town"])}.
        Below it, where the power came from: {inWords([has("wind") ? "its own solar and wind" : "its own solar", has("outOf") && "its batteries", "the wider grid"])}.
      </p>
      {data ? <TimeChart data={data} emptyText="" /> : <p className="glance-empty">Reading yesterday… {Math.round(read * 100)}%</p>}
    </section>
  );
}

/** The Statistics page's first entry: where the town stands now — then and now, its energy over the
 * last month or year, and yesterday's power. Everything but yesterday reads what the game already
 * keeps; that is sampled a little at a time. */
export function GlanceView({ dataset }: { dataset: MunicipalityDataset }) {
  const nowMs = useSimDay();
  return (
    <div className="glance">
      <LastDay dataset={dataset} />
      <div className="glance-columns">
        <ThenAndNow dataset={dataset} nowMs={nowMs} />
        <div className="glance-stack">
          <Energy />
        </div>
      </div>
    </div>
  );
}
