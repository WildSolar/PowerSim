/**
 * The charts in the town hall's Statistics tab (ChartsTab.tsx): what the town looked like over time.
 * Each chart reads what the game already keeps — the monthly record (sim/monthRecords.ts), the
 * transformers' readings, the booked accounts, the payouts, the counted emissions, approval — and
 * turns it into series for TimeChart.tsx. Nothing here counts anything new.
 *
 * x is a year with its fraction (2031.5 is mid-2031); monthly values sit mid-month, yearly ones
 * mid-year.
 */

import { DH_SOURCE_SPECS } from "../config/districtHeat";
import { HEATING_SYSTEM_CATALOG, type HeatingSystemId } from "../config/heating";
import { ENERGY_CLASS_CATALOG, ENERGY_CLASS_ORDER } from "../config/retrofit";
import { MOBILITY_MODE_CATALOG } from "../config/mobility";
import { approval } from "../sim/approval";
import { BASELINE_YEAR, MONTH_NAMES, toDateMs, toSimTimeMs } from "../sim/calendar";
import { cachedEmissionsForYear, EMISSION_SOURCES, EMISSIONS_SOURCE_COLOR } from "../sim/emissions";
import { bookedFinances, townTakeRp, utilityProfitRp, type UtilityMonth } from "../sim/finances";
import { grid } from "../sim/grid";
import { measures } from "../sim/measures";
import { monthRecords, type MonthRecord } from "../sim/monthRecords";
import { PAYOUT_CATEGORIES, PAYOUT_LABEL, treasury, type PayoutCategory } from "../sim/treasury";
import { DEVICE_CATEGORIES } from "./deviceCategories";

export interface ChartSeries {
  key: string;
  label: string;
  color: string;
  /** Stacked areas (or bars, for a chart in bars), a line on top, or only in the tooltip. */
  kind: "stack" | "line" | "hidden";
  dashed?: boolean;
  /** A stack drawn below the zero line (its values given as they are, drawn downward): the other
   * side of a balance (where power came from, under where it went). */
  below?: boolean;
  /** Its name in the legend, if not its label; false: not in the legend (another entry speaks for it). */
  legend?: string | false;
  values: (number | null)[];
}

export interface ChartData {
  xs: number[];
  /** The tooltip's heading for each x ("Mar 2031", "2031"). */
  xLabels: string[];
  series: ChartSeries[];
  /** What the values are in ("MWh", "%", "t CO₂"). */
  unit: string;
  /** Yearly values: drawn as stacked bars rather than areas. */
  bars?: boolean;
  /** A reference line (approval's 50%). */
  reference?: { value: number; label: string };
  /** Counts: the axis steps in whole numbers. */
  integer?: boolean;
  /** Fixed y range (shares: 0–100). */
  yMax?: number;
  /** The tooltip adds up the stack — and, for a balance, the stack below the line. */
  total?: string;
  totalBelow?: string;
  /** The plot's height (viewBox units, 320 if not given). */
  height?: number;
  /** The first and last year on the axis. */
  from: number;
  to: number;
  /** Moments marked on the chart (the player's decisions), listed in the tooltip of their month. */
  events?: { x: number; label: string }[];
  eventsLabel?: string;
  /** The x axis's labels, where they aren't years (the last 24 hours). */
  xTicks?: { x: number; label: string }[];
}

export interface ChartParam {
  label: string;
  options: () => { value: string; label: string }[];
  /** The option picked when none is (else the first). */
  defaultValue?: () => string | null;
}

export interface ChartDef {
  id: string;
  group: string;
  title: string;
  description: string;
  param?: ChartParam;
  data: (param: string | null, nowMs: number) => ChartData;
}

function nowYear(nowMs: number): number {
  const d = new Date(toDateMs(nowMs));
  return d.getUTCFullYear() + (d.getUTCMonth() + d.getUTCDate() / 31) / 12;
}

function axis(nowMs: number): { from: number; to: number } {
  // To the end of the year under way (on 1 January, the year just finished).
  return { from: BASELINE_YEAR, to: Math.max(BASELINE_YEAR + 1, Math.ceil(nowYear(nowMs) - 1 / 24)) };
}

function monthly(nowMs: number, pick: (r: MonthRecord) => boolean): { records: MonthRecord[]; xs: number[]; xLabels: string[]; from: number; to: number } {
  const records = monthRecords.all().filter(pick);
  return {
    records,
    xs: records.map((r) => Math.floor(r.month / 12) + ((r.month % 12) + 0.5) / 12),
    xLabels: records.map((r) => `${MONTH_NAMES[r.month % 12]} ${Math.floor(r.month / 12)}`),
    ...axis(nowMs),
  };
}

/** kWh into a unit the chart reads well at its largest value. */
export function energyUnit(maxKWh: number): { unit: string; scale: number } {
  if (maxKWh >= 2_000_000) return { unit: "GWh", scale: 1e-6 };
  if (maxKWh >= 2_000) return { unit: "MWh", scale: 1e-3 };
  return { unit: "kWh", scale: 1 };
}

function stackMax(series: { values: (number | null)[] }[], n: number): number {
  let max = 0;
  for (let i = 0; i < n; i++) max = Math.max(max, series.reduce((s, x) => s + (x.values[i] ?? 0), 0));
  return max;
}

const color = (key: string) => DEVICE_CATEGORIES.find((c) => c.key === key)?.color ?? "#888";

// --- electricity ---

export const ELECTRICITY_GROUPS: { key: string; label: string; color: string; of: (keyof NonNullable<MonthRecord["electricityKWh"]>)[] }[] = [
  { key: "homes", label: "Homes: appliances and lighting", color: color("plugLoad"), of: ["fridge", "lighting", "cooking", "laundry", "plugLoad"] },
  { key: "commercial", label: "Businesses", color: color("commercial"), of: ["commercial"] },
  { key: "heatPump", label: "Heat pumps: space heating", color: color("heatPump"), of: ["heatPump"] },
  { key: "waterHeating", label: "Hot water", color: color("waterHeating"), of: ["waterHeating"] },
  { key: "ac", label: "Cooling", color: color("ac"), of: ["ac"] },
  { key: "ev", label: "Electric cars", color: color("ev"), of: ["ev"] },
];

function electricityChart(nowMs: number): ChartData {
  const { records, ...m } = monthly(nowMs, (r) => !!r.electricityKWh);
  const stacks = ELECTRICITY_GROUPS.map((g) => ({ ...g, values: records.map((r) => g.of.reduce((s, k) => s + r.electricityKWh![k], 0)) }));
  // The district heating heat pumps, after hot water (the utility's own use).
  if (records.some((r) => (r.dhHeatPumpKWh ?? 0) > 0))
    stacks.splice(stacks.findIndex((g) => g.key === "waterHeating") + 1, 0, {
      key: "dhHeatPump",
      label: "District heating heat pumps",
      color: "#7a4fb5",
      of: [],
      values: records.map((r) => r.dhHeatPumpKWh ?? 0),
    });
  const solar = records.map((r) => r.electricityKWh!.solar);
  const wind = records.map((r) => r.windKWh ?? 0);
  const { unit, scale } = energyUnit(Math.max(stackMax(stacks, records.length), ...solar, ...wind));
  const sc = (v: number[]) => v.map((x) => x * scale);
  return {
    ...m,
    unit,
    total: "Used",
    series: [
      ...stacks.map((g) => ({ key: g.key, label: g.label, color: g.color, kind: "stack" as const, values: sc(g.values) })),
      { key: "solar", label: "Made by solar", color: color("solar"), kind: "line", values: sc(solar) },
      ...(wind.some((w) => w > 0) ? [{ key: "wind", label: "Made by wind", color: "#5b6b7a", kind: "line" as const, dashed: true, values: sc(wind) }] : []),
    ],
  };
}

function tradeChart(nowMs: number): ChartData {
  const { records, ...m } = monthly(nowMs, (r) => r.boughtKWh !== undefined);
  const bought = records.map((r) => r.boughtKWh!);
  const sold = records.map((r) => r.soldKWh!);
  const stored = records.map((r) => r.storedKWh!);
  const { unit, scale } = energyUnit(Math.max(0, ...bought, ...sold));
  const sc = (v: number[]) => v.map((x) => x * scale);
  return {
    ...m,
    unit,
    series: [
      { key: "bought", label: "Bought over contracts", color: "#2a78d6", kind: "line", values: sc(bought) },
      { key: "sold", label: "Surplus sold on the spot market", color: color("solar"), kind: "line", values: sc(sold) },
      ...(stored.some((v) => v > 0) ? [{ key: "stored", label: "Shifted by neighbourhood batteries", color: "#4a3aa7", kind: "line" as const, dashed: true, values: sc(stored) }] : []),
    ],
  };
}

// --- heat ---

/** The month record's heat (heatingKWh) by key, and the heating system each is. */
export const HEAT_KEYS = [
  ["airHeatPump", "airHeatPump"],
  ["groundHeatPump", "groundHeatPump"],
  ["districtHeating", "districtHeating"],
  ["wood", "woodPellet"],
  ["gas", "gasBoiler"],
  ["oil", "oilBoiler"],
] as const;

function heatChart(nowMs: number): ChartData {
  const { records, ...m } = monthly(nowMs, (r) => !!r.heatingKWh);
  const keys = HEAT_KEYS;
  const raw = keys.map(([k]) => records.map((r) => r.heatingKWh![k] ?? 0));
  const { unit, scale } = energyUnit(stackMax(raw.map((values) => ({ values })), records.length));
  return {
    ...m,
    unit,
    total: "All heat",
    series: keys.map(([k, id], i) => ({ key: k, label: HEATING_SYSTEM_CATALOG[id].label, color: HEATING_SYSTEM_CATALOG[id].color, kind: "stack" as const, values: raw[i].map((v) => v * scale) })),
  };
}

const DH_COLORS: Record<string, string> = {
  incinerator: "#4a3aa7",
  industry: "#a56b2c",
  wastewater: "#2a78d6",
  groundwater: "#0f8fc0",
  surfaceWater: "#2f9e8f",
  wood: "#1baf7a",
  other: "#e87ba4",
};

function districtHeatChart(nowMs: number): ChartData {
  const { records, ...m } = monthly(nowMs, (r) => !!r.districtHeatKWh);
  const order = [
    ...Object.entries(DH_SOURCE_SPECS)
      .sort((a, b) => a[1].merit - b[1].merit)
      .map(([kind, spec]) => ({ label: spec.label, color: DH_COLORS[kind] ?? "#888" })),
    { label: "Gas boilers", color: "#eb6834" },
    { label: "Oil boilers", color: "#b23a2e" },
  ].filter((s) => records.some((r) => (r.districtHeatKWh![s.label] ?? 0) > 0));
  const raw = order.map((s) => records.map((r) => r.districtHeatKWh![s.label] ?? 0));
  const { unit, scale } = energyUnit(stackMax(raw.map((values) => ({ values })), records.length));
  return {
    ...m,
    unit,
    total: "All district heat",
    series: order.map((s, i) => ({ key: s.label, label: s.label, color: s.color, kind: "stack" as const, values: raw[i].map((v) => v * scale) })),
  };
}

// --- solar, mobility ---

function rooftopSolarChart(nowMs: number): ChartData {
  const { records, ...m } = monthly(nowMs, (r) => r.solarPotentialKw !== undefined);
  return {
    ...m,
    unit: "%",
    yMax: 100,
    series: [
      { key: "share", label: "Share of the roofs' potential built", color: color("solar"), kind: "stack", values: records.map((r) => (r.solarPotentialKw! > 0 ? (100 * r.solarBuiltKw!) / r.solarPotentialKw! : 0)) },
      { key: "built", label: "Built (MWp)", color: color("solar"), kind: "hidden", values: records.map((r) => r.solarBuiltKw! / 1000) },
      { key: "potential", label: "Potential (MWp)", color: "#888", kind: "hidden", values: records.map((r) => r.solarPotentialKw! / 1000) },
    ],
  };
}

// --- what the town has (monthRecords.ts's assets, at each month's end) ---

function capacityChart(nowMs: number): ChartData {
  const { records, ...m } = monthly(nowMs, (r) => !!r.assets && r.solarBuiltKw !== undefined);
  return {
    ...m,
    unit: "MW",
    total: "Together",
    series: [
      { key: "roof", label: "Rooftop solar (MWp)", color: color("solar"), kind: "stack", values: records.map((r) => r.solarBuiltKw! / 1000) },
      { key: "carParks", label: "Car park canopies (MWp)", color: "#b5523b", kind: "stack", values: records.map((r) => (r.assets!.carParkKw ?? 0) / 1000) },
      { key: "agri", label: "Agri-PV (MWp)", color: "#2f9e8f", kind: "stack", values: records.map((r) => r.assets!.agriPvKw / 1000) },
      { key: "wind", label: "Wind (MW)", color: "#4a3aa7", kind: "stack", values: records.map((r) => r.assets!.windKw / 1000) },
      // Of it all, what the town and its utility own: a line over the stack.
      { key: "own", label: "Of it, the town's and its utility's own (MW)", color: "#6f6d66", kind: "line", dashed: true, values: records.map((r) => (r.assets!.ownKw ?? 0) / 1000) },
    ],
  };
}

function batteryChart(nowMs: number): ChartData {
  const { records, ...m } = monthly(nowMs, (r) => !!r.assets);
  return {
    ...m,
    unit: "MWh",
    total: "Together",
    series: [
      { key: "home", label: "Home batteries", color: "#2a78d6", kind: "stack", values: records.map((r) => r.assets!.homeBatteryKwh / 1000) },
      { key: "grid", label: "Neighbourhood batteries", color: "#4a3aa7", kind: "stack", values: records.map((r) => r.assets!.gridBatteryKwh / 1000) },
    ],
  };
}

function dhPipesChart(nowMs: number): ChartData {
  const { records, ...m } = monthly(nowMs, (r) => !!r.assets);
  return {
    ...m,
    unit: "km",
    series: [{ key: "pipes", label: "District heating pipes", color: "#4a3aa7", kind: "line", values: records.map((r) => r.assets!.dhPipeM / 1000) }],
  };
}

const DH_REACH_MEASURES = [
  { value: "buildings", label: "Buildings" },
  { value: "floor", label: "Floor area" },
  { value: "demand", label: "Heat demand" },
] as const;

function dhReachChart(param: string | null, nowMs: number): ChartData {
  const { records, ...m } = monthly(nowMs, (r) => !!r.assets);
  const by = (DH_REACH_MEASURES.find((x) => x.value === param) ?? DH_REACH_MEASURES[0]).value;
  return {
    ...m,
    unit: "%",
    yMax: 100,
    series: [
      { key: "connected", label: "Connected", color: "#4a3aa7", kind: "line", values: records.map((r) => 100 * r.assets!.dhConnected[by]) },
      { key: "reach", label: "Connected or free to connect", color: "#4a3aa7", kind: "line", dashed: true, values: records.map((r) => 100 * r.assets!.dhWithinReach[by]) },
    ],
  };
}

function chargingChart(nowMs: number): ChartData {
  const { records, ...m } = monthly(nowMs, (r) => !!r.assets);
  return {
    ...m,
    unit: "%",
    series: [
      { key: "full", label: "How full", color: "#eb6834", kind: "line", values: records.map((r) => (r.assets!.chargerRoom > 0 ? (100 * r.assets!.chargerTaken) / r.assets!.chargerRoom : 0)) },
      { key: "points", label: "Charge points", color: "#888", kind: "hidden", values: records.map((r) => r.assets!.chargerPoints) },
    ],
  };
}

function chargingQualityChart(nowMs: number): ChartData {
  const { records, ...m } = monthly(nowMs, (r) => !!r.assets);
  return {
    ...m,
    unit: "%",
    yMax: 100,
    series: [
      { key: "qos", label: "Public charging, households without a wallbox (average)", color: "#2a78d6", kind: "line", values: records.map((r) => 100 * r.assets!.chargingQos) },
      { key: "wallbox", label: "Households with a wallbox", color: "#1baf7a", kind: "line", values: records.map((r) => 100 * r.assets!.wallboxShare) },
    ],
  };
}

const COUNTED_BY = [
  { value: "buildings", label: "Buildings" },
  { value: "floor", label: "Floor area" },
] as const;

/** Heated buildings split some way (heating system, insulation), stacked: counted, or by floor area. */
function buildingSplitChart(
  nowMs: number,
  param: string | null,
  pick: (a: NonNullable<MonthRecord["assets"]>) => Record<string, { buildings: number; floor: number }> | undefined,
  keys: { key: string; label: string; color: string }[],
): ChartData {
  const { records, ...m } = monthly(nowMs, (r) => !!r.assets && !!pick(r.assets));
  const floor = param === "floor";
  return {
    ...m,
    unit: floor ? "1,000 m²" : "buildings",
    integer: !floor,
    total: "All heated buildings",
    series: keys.map((k) => ({
      key: k.key,
      label: k.label,
      color: k.color,
      kind: "stack" as const,
      values: records.map((r) => {
        const t = pick(r.assets!)![k.key];
        return t ? (floor ? t.floor / 1000 : t.buildings) : 0;
      }),
    })),
  };
}

const HEATING_ORDER: HeatingSystemId[] = ["airHeatPump", "groundHeatPump", "districtHeating", "woodPellet", "gasBoiler", "oilBoiler"];

function heatingSystemsChart(param: string | null, nowMs: number): ChartData {
  return buildingSplitChart(
    nowMs,
    param,
    (a) => a.heatingSystems,
    HEATING_ORDER.map((id) => ({ key: id, label: HEATING_SYSTEM_CATALOG[id].label, color: HEATING_SYSTEM_CATALOG[id].color })),
  );
}

function insulationChart(param: string | null, nowMs: number): ChartData {
  return buildingSplitChart(
    nowMs,
    param,
    (a) => a.insulation,
    // The best insulated at the bottom, so the stack grows from below as the town renovates.
    [...ENERGY_CLASS_ORDER].reverse().map((id) => ({ key: id, label: ENERGY_CLASS_CATALOG[id].label, color: ENERGY_CLASS_CATALOG[id].color })),
  );
}

function heatPumpChart(nowMs: number): ChartData {
  const { records, ...m } = monthly(nowMs, (r) => r.assets?.airHeatPumpKw !== undefined);
  return {
    ...m,
    unit: "MW of heat",
    total: "All heat pumps",
    series: [
      { key: "air", label: HEATING_SYSTEM_CATALOG.airHeatPump.label, color: HEATING_SYSTEM_CATALOG.airHeatPump.color, kind: "stack", values: records.map((r) => r.assets!.airHeatPumpKw! / 1000) },
      { key: "ground", label: HEATING_SYSTEM_CATALOG.groundHeatPump.label, color: HEATING_SYSTEM_CATALOG.groundHeatPump.color, kind: "stack", values: records.map((r) => r.assets!.groundHeatPumpKw! / 1000) },
    ],
  };
}

const NETWORK_COLORS = ["#4a3aa7", "#1baf7a", "#eb6834", "#2a78d6", "#c9a227", "#e87ba4"];

function dhCleanShareChart(nowMs: number): ChartData {
  const { records, ...m } = monthly(nowMs, (r) => !!r.dhNetworkKWh && Object.keys(r.dhNetworkKWh).length > 0);
  // The networks that made the most heat over the whole record, biggest first.
  const totals = new Map<string, number>();
  for (const r of records) for (const [name, e] of Object.entries(r.dhNetworkKWh!)) totals.set(name, (totals.get(name) ?? 0) + e.clean + e.boiler);
  const names = [...totals].sort((a, b) => b[1] - a[1]).slice(0, NETWORK_COLORS.length).map(([name]) => name);
  const share = (e: { clean: number; boiler: number } | undefined) => (e && e.clean + e.boiler > 0 ? (100 * e.clean) / (e.clean + e.boiler) : null);
  return {
    ...m,
    unit: "%",
    yMax: 100,
    series: [
      ...names.map((name, i) => ({ key: name, label: name, color: NETWORK_COLORS[i], kind: "line" as const, values: records.map((r) => share(r.dhNetworkKWh![name])) })),
      ...(names.length > 1
        ? [
            {
              key: "all",
              label: "All networks",
              color: "var(--ink)",
              kind: "line" as const,
              dashed: true,
              values: records.map((r) => share(Object.values(r.dhNetworkKWh!).reduce((s, e) => ({ clean: s.clean + e.clean, boiler: s.boiler + e.boiler }), { clean: 0, boiler: 0 }))),
            },
          ]
        : []),
    ],
  };
}

function electricVehiclesChart(nowMs: number): ChartData {
  const { records, ...m } = monthly(nowMs, (r) => !!r.mobility && r.assets?.vans !== undefined);
  const pct = (part: number, all: number) => (all > 0 ? (100 * part) / all : null);
  return {
    ...m,
    unit: "%",
    series: [
      { key: "cars", label: "Residents' cars", color: "#2a78d6", kind: "line", values: records.map((r) => pct(r.mobility!.carElectric, r.mobility!.car)) },
      { key: "vans", label: "Business vans", color: "#eb6834", kind: "line", values: records.map((r) => pct(r.assets!.vansElectric!, r.assets!.vans!)) },
      { key: "trucks", label: "Lorries", color: "#4a3aa7", kind: "line", values: records.map((r) => pct(r.assets!.trucksElectric!, r.assets!.trucks!)) },
    ],
  };
}

function modalSplitChart(nowMs: number): ChartData {
  const { records, ...m } = monthly(nowMs, (r) => !!r.mobility);
  const share = (pick: (x: NonNullable<MonthRecord["mobility"]>) => number) =>
    records.map((r) => {
      const t = r.mobility!.car + r.mobility!.bike + r.mobility!.other;
      return t > 0 ? (100 * pick(r.mobility!)) / t : 0;
    });
  return {
    ...m,
    unit: "%",
    yMax: 100,
    series: [
      { key: "car", label: "Car, petrol or diesel", color: MOBILITY_MODE_CATALOG.car.color, kind: "stack", values: share((x) => x.car - x.carElectric) },
      { key: "carElectric", label: "Car, electric", color: "#e87ba4", kind: "stack", values: share((x) => x.carElectric) },
      { key: "bike", label: MOBILITY_MODE_CATALOG.bike.label, color: MOBILITY_MODE_CATALOG.bike.color, kind: "stack", values: share((x) => x.bike) },
      { key: "other", label: MOBILITY_MODE_CATALOG.other.label, color: MOBILITY_MODE_CATALOG.other.color, kind: "stack", values: share((x) => x.other) },
    ],
  };
}

// --- the grid ---

function transformerOptions(): { value: string; label: string }[] {
  return grid.getAreas().map((a) => ({ value: String(a.id), label: `Transformer area ${a.name}` }));
}

function transformerChart(param: string | null, nowMs: number): ChartData {
  const area = grid.getAreas().find((a) => String(a.id) === param) ?? grid.getAreas()[0];
  const readings = (area?.readings ?? []).slice().sort((a, b) => a.year - b.year || (a.season === "winter" ? -1 : 1));
  const xs = readings.map((r) => r.year + (r.season === "winter" ? 2 : 8) / 12);
  return {
    xs,
    xLabels: readings.map((r) => `${r.season === "winter" ? "Winter" : "Summer"} ${r.year}`),
    ...axis(nowMs),
    unit: "kW",
    series: [
      { key: "winter", label: "Winter peak draw", color: "#2a78d6", kind: "line", values: readings.map((r) => (r.season === "winter" ? r.kw : null)) },
      { key: "summer", label: "Summer solar feed-in", color: color("solar"), kind: "line", values: readings.map((r) => (r.season === "summer" ? r.kw : null)) },
      { key: "capacity", label: "Station capacity", color: "var(--ink-3)", kind: "line", dashed: true, values: readings.map((r) => r.capacityKw) },
    ],
  };
}

function overloadedChart(nowMs: number): ChartData {
  const years = new Map<number, { winter: number; summer: number }>();
  for (const a of grid.getAreas())
    for (const r of a.readings ?? []) {
      const y = years.get(r.year) ?? { winter: 0, summer: 0 };
      if (r.kw > r.capacityKw) y[r.season]++;
      years.set(r.year, y);
    }
  const list = [...years].sort((a, b) => a[0] - b[0]);
  return {
    xs: list.map(([y]) => y + 0.5),
    xLabels: list.map(([y]) => String(y)),
    ...axis(nowMs),
    unit: "transformers",
    integer: true,
    series: [
      { key: "winter", label: "Overloaded in winter (draw)", color: "#2a78d6", kind: "line", values: list.map(([, v]) => v.winter) },
      { key: "summer", label: "Overloaded in summer (feed-in)", color: color("solar"), kind: "line", values: list.map(([, v]) => v.summer) },
    ],
  };
}

const LOAD_BANDS = [
  { key: "low", label: "Under half full", color: "#b9d3ee", upTo: 0.5 },
  { key: "mid", label: "Half to 80% full", color: "#6a9fd8", upTo: 0.8 },
  { key: "high", label: "80% to full", color: "#2a5aa6", upTo: 1 },
  { key: "over", label: "Over capacity", color: "#b23a2e", upTo: Infinity },
] as const;

const SEASONS = [
  { value: "winter", label: "Winter peak draw" },
  { value: "summer", label: "Summer solar feed-in" },
] as const;

function transformerLoadChart(param: string | null, nowMs: number): ChartData {
  const season = param === "summer" ? "summer" : "winter";
  const years = new Map<number, number[]>();
  for (const a of grid.getAreas())
    for (const r of a.readings ?? []) {
      if (r.season !== season || r.capacityKw <= 0) continue;
      const counts = years.get(r.year) ?? LOAD_BANDS.map(() => 0);
      counts[LOAD_BANDS.findIndex((b) => r.kw / r.capacityKw <= b.upTo)]++;
      years.set(r.year, counts);
    }
  const list = [...years].sort((a, b) => a[0] - b[0]);
  return {
    xs: list.map(([y]) => y + 0.5),
    xLabels: list.map(([y]) => String(y)),
    ...axis(nowMs),
    unit: "transformers",
    integer: true,
    bars: true,
    total: "All transformers",
    series: LOAD_BANDS.map((b, i) => ({ key: b.key, label: b.label, color: b.color, kind: "stack" as const, values: list.map(([, c]) => c[i]) })),
  };
}

// --- the books ---

function emissionsChart(nowMs: number): ChartData {
  const list: NonNullable<ReturnType<typeof cachedEmissionsForYear>>[] = [];
  for (let y = BASELINE_YEAR; y < Math.floor(nowYear(nowMs)); y++) {
    const e = cachedEmissionsForYear(y);
    if (e) list.push(e);
  }
  const t = (kg: number) => kg / 1000;
  return {
    xs: list.map((e) => e.year + 0.5),
    xLabels: list.map((e) => String(e.year)),
    ...axis(nowMs),
    unit: "t CO₂",
    bars: true,
    total: "Emitted",
    series: [
      ...EMISSION_SOURCES.map((s) => ({ key: s.key, label: s.label, color: EMISSIONS_SOURCE_COLOR[s.key], kind: "stack" as const, values: list.map((e) => t(s.kgCO2(e))) })),
      { key: "removals", label: "Removed (contracts)", color: "#888", kind: "hidden", values: list.map((e) => t(e.removalsKgCO2)) },
      { key: "net", label: "Net, after removals", color: "var(--ink)", kind: "line", values: list.map((e) => t(e.netKgCO2)) },
    ],
  };
}

const SPENDING_GROUPS: { key: string; label: string; color: string; of: PayoutCategory[] }[] = [
  { key: "subsidies", label: "Subsidies", color: "#1baf7a", of: ["solar", "heating", "vehicle", "retrofit"] },
  { key: "programs", label: "Campaigns and programmes", color: "#e87ba4", of: ["programs"] },
  { key: "investments", label: "Investments: buildings, pipes, chargers, grid, zoning", color: "#2a78d6", of: ["infrastructure", "districtHeat", "charging", "zoning", "grid"] },
  { key: "removals", label: "Carbon removal contracts", color: "#4a3aa7", of: ["removals"] },
  { key: "debt", label: "Interest and repayments", color: "#b23a2e", of: ["interest", "debtRepayment"] },
];

function spendingOptions(): { value: string; label: string }[] {
  return [{ value: "groups", label: "By kind, all together" }, ...PAYOUT_CATEGORIES.map((c) => ({ value: c, label: PAYOUT_LABEL[c] }))];
}

function spendingChart(param: string | null, nowMs: number): ChartData {
  const last = Math.floor(nowYear(nowMs));
  const years = Array.from({ length: last - BASELINE_YEAR + 1 }, (_, i) => BASELINE_YEAR + i);
  const paid = years.map((y) => treasury.paidOut(toSimTimeMs(Date.UTC(y, 0, 1)), toSimTimeMs(Date.UTC(y + 1, 0, 1))));
  const one = param && param !== "groups" ? (param as PayoutCategory) : null;
  if (one)
    return {
      xs: years.map((y) => y + 0.5),
      xLabels: years.map((y) => (y === last ? `${y} so far` : String(y))),
      ...axis(nowMs),
      unit: "kCHF",
      bars: true,
      series: [{ key: one, label: PAYOUT_LABEL[one], color: "#2a78d6", kind: "stack", values: paid.map((p) => p[one] / 100 / 1000) }],
    };
  return {
    xs: years.map((y) => y + 0.5),
    xLabels: years.map((y) => (y === last ? `${y} so far` : String(y))),
    ...axis(nowMs),
    unit: "kCHF",
    bars: true,
    total: "Spent",
    series: SPENDING_GROUPS.map((g) => ({ key: g.key, label: g.label, color: g.color, kind: "stack" as const, values: paid.map((p) => g.of.reduce((s, c) => s + p[c], 0) / 100 / 1000) })),
  };
}

function treasuryChart(nowMs: number): ChartData {
  const { records, ...m } = monthly(nowMs, (r) => !!r.books);
  const mchf = (rp: number) => rp / 100 / 1_000_000;
  return {
    ...m,
    unit: "M CHF",
    series: [
      { key: "balance", label: "Treasury balance", color: "#2a78d6", kind: "line", values: records.map((r) => mchf(r.books!.balanceRp)) },
      { key: "debt", label: "Debt: loans and overdraft", color: "#b23a2e", kind: "line", values: records.map((r) => mchf(r.books!.loansRp + Math.max(0, -r.books!.balanceRp))) },
    ],
  };
}

/** The utility's accounts line by line (and the department's credit for public solar). */
const UTILITY_LINES: { key: keyof UtilityMonth | "concessionFee"; label: string; cost: boolean }[] = [
  { key: "energyRevenueRp", label: "Electricity sold (energy price)", cost: false },
  { key: "networkRevenueRp", label: "Network fees and base fees", cost: false },
  { key: "surplusSoldRp", label: "Surplus sold on the spot market", cost: false },
  { key: "districtHeatRevenueRp", label: "District heat sold", cost: false },
  { key: "publicChargingRevenueRp", label: "Public charging sold", cost: false },
  { key: "wholesaleCostRp", label: "Electricity bought over contracts", cost: true },
  { key: "feedInPaidRp", label: "Solar feed-in paid to owners", cost: true },
  { key: "gridMaintenanceCostRp", label: "Grid upkeep", cost: true },
  { key: "districtHeatPurchaseRp", label: "Making district heat", cost: true },
  { key: "districtHeatUpkeepRp", label: "District heating upkeep", cost: true },
  { key: "publicChargingUpkeepRp", label: "Public charger upkeep", cost: true },
  { key: "roofContractCostRp", label: "Roof rent and upkeep (utility's solar)", cost: true },
  { key: "windUpkeepRp", label: "Wind turbine upkeep", cost: true },
  { key: "agriPvUpkeepRp", label: "Agri-PV upkeep and rent (utility's fields)", cost: true },
  { key: "concessionFee", label: "Concession fee to the town", cost: true },
  { key: "publicSolarSavingsRp", label: "Solar on public buildings (credited to you)", cost: false },
];

function utilityOptions(): { value: string; label: string }[] {
  return [{ value: "overview", label: "Sales, costs and result (yearly)" }, ...UTILITY_LINES.map((l) => ({ value: l.key, label: `${l.label} (monthly)` }))];
}

function utilityChart(param: string | null, nowMs: number): ChartData {
  const line = UTILITY_LINES.find((l) => l.key === param);
  if (line) {
    // Month by month, as each was settled.
    const { records, ...m } = monthly(nowMs, (r) => !!r.utility);
    const value = (r: MonthRecord) => {
      const u = r.utility!;
      const year = Math.floor(r.month / 12);
      return line.key === "concessionFee" ? townTakeRp(year, utilityProfitRp(u), u.networkKWh) : (u[line.key] as number);
    };
    return {
      ...m,
      unit: "kCHF",
      series: [{ key: line.key, label: line.label, color: line.cost ? "#eb6834" : "#2a78d6", kind: "line", values: records.map((r) => value(r) / 100 / 1000) }],
    };
  }
  const list = bookedFinances();
  const k = (rp: number) => rp / 100 / 1000;
  const sales = list.map((f) => f.energyRevenueRp + f.networkRevenueRp + f.districtHeatRevenueRp + f.publicChargingRevenueRp + f.surplusSoldRp);
  const costs = list.map(
    (f) =>
      f.feedInPaidRp +
      f.wholesaleCostRp +
      f.gridMaintenanceCostRp +
      f.districtHeatPurchaseRp +
      f.districtHeatUpkeepRp +
      f.publicChargingUpkeepRp +
      f.roofContractCostRp +
      f.windUpkeepRp +
      f.agriPvUpkeepRp,
  );
  return {
    xs: list.map((f) => f.year + 0.5),
    xLabels: list.map((f) => String(f.year)),
    ...axis(nowMs),
    unit: "kCHF",
    series: [
      { key: "sales", label: "Sales: power, surplus, district heat, charging", color: "#2a78d6", kind: "line", values: sales.map(k) },
      { key: "costs", label: "Costs: power bought, feed-in, the grid, heat, upkeep", color: "#eb6834", kind: "line", values: costs.map(k) },
      { key: "result", label: "Result", color: "#1baf7a", kind: "line", dashed: true, values: sales.map((s, i) => k(s - costs[i])) },
    ],
  };
}

/** The measure log's entries that were the player's decisions (or the voters' verdict on one). */
const DECISION_PREFIXES = ["Enacted:", "Changed:", "Repealed:", "Struck down"];

function approvalChart(nowMs: number): ChartData {
  const history = approval.getHistory();
  return {
    xs: history.map((h) => nowYear(h.atMs)),
    xLabels: history.map((h) => {
      const d = new Date(toDateMs(h.atMs));
      return `${MONTH_NAMES[d.getUTCMonth()]} ${d.getUTCFullYear()}`;
    }),
    ...axis(nowMs),
    unit: "%",
    yMax: 100,
    reference: { value: 50, label: "50%: an election lost" },
    series: [{ key: "approval", label: "Approval", color: "#2a78d6", kind: "line", values: history.map((h) => h.approval) }],
    events: measures
      .getHistory()
      .filter((e) => DECISION_PREFIXES.some((p) => e.text.startsWith(p)))
      .map((e) => ({ x: nowYear(e.atMs), label: e.text.replace(/ In effect from .*$/, "") })),
    eventsLabel: "Measures enacted, changed or repealed",
  };
}

export const CHARTS: ChartDef[] = [
  {
    id: "electricity",
    group: "Energy",
    title: "Electricity",
    description: "What the town used each month, by what used it — the district heating networks' heat pumps included — and what its solar panels and wind turbines made.",
    data: (_, now) => electricityChart(now),
  },
  {
    id: "trade",
    group: "Energy",
    title: "Power bought and sold",
    description: "What the utility bought each month over its contracts, the surplus it sold when the town made more than it used, and what the neighbourhood batteries shifted from one to the other.",
    data: (_, now) => tradeChart(now),
  },
  {
    id: "heat",
    group: "Energy",
    title: "Heat by heating system",
    description: "The heat delivered to buildings each month, by what heated them.",
    data: (_, now) => heatChart(now),
  },
  {
    id: "district-heat",
    group: "Energy",
    title: "District heat by source",
    description: "What the district heating networks' plants made each month — and how much the backup boilers had to burn.",
    data: (_, now) => districtHeatChart(now),
  },
  {
    id: "rooftop-solar",
    group: "Energy",
    title: "Rooftop solar",
    description: "How much of what the town's roofs could carry has been built, at the end of each month.",
    data: (_, now) => rooftopSolarChart(now),
  },
  {
    id: "capacity",
    group: "Energy",
    title: "Solar and wind built",
    description: "The rating of the town's rooftop solar, solar canopies over car parks, Agri-PV fields and wind turbines, at the end of each month.",
    data: (_, now) => capacityChart(now),
  },
  {
    id: "batteries",
    group: "Energy",
    title: "Batteries",
    description: "How much the town's batteries can store, at the end of each month: those with home solar, and the neighbourhood batteries at the transformer stations.",
    data: (_, now) => batteryChart(now),
  },
  {
    id: "heating-systems",
    group: "Buildings",
    title: "Heating systems",
    description: "The town's heated buildings by what heats them, at the end of each month — counted, or by floor area. Garages, sheds and buildings with electric or unrecorded heating are left out.",
    param: { label: "Counted by", options: () => COUNTED_BY.map((x) => ({ value: x.value, label: x.label })) },
    data: heatingSystemsChart,
  },
  {
    id: "insulation",
    group: "Buildings",
    title: "Insulation",
    description: "The town's heated buildings by how well they are insulated, at the end of each month — counted, or by floor area.",
    param: { label: "Counted by", options: () => COUNTED_BY.map((x) => ({ value: x.value, label: x.label })) },
    data: insulationChart,
  },
  {
    id: "heat-pumps",
    group: "Buildings",
    title: "Heat pumps",
    description: "How much heat the town's heat pumps deliver on a cold winter day, at the end of each month — what they draw from the grid when it is coldest grows with it.",
    data: (_, now) => heatPumpChart(now),
  },
  {
    id: "transformer",
    group: "Grid",
    title: "A transformer",
    description: "Each winter's peak draw and each summer's peak solar feed-in at one transformer station, against its capacity.",
    param: { label: "Transformer", options: transformerOptions, defaultValue: () => (grid.getSelectedId() !== null ? String(grid.getSelectedId()) : null) },
    data: transformerChart,
  },
  {
    id: "overloaded",
    group: "Grid",
    title: "Overloaded transformers",
    description: "How many transformer stations were over their capacity at each year's readings.",
    data: (_, now) => overloadedChart(now),
  },
  {
    id: "transformer-load",
    group: "Grid",
    title: "How full the transformers are",
    description: "The transformer stations at each year's readings, by how full they were: at the winter peak draw, or at the summer's peak solar feed-in.",
    param: { label: "Reading", options: () => SEASONS.map((x) => ({ value: x.value, label: x.label })) },
    data: transformerLoadChart,
  },
  {
    id: "dh-pipes",
    group: "District heating",
    title: "District heating pipes",
    description: "How long the district heating networks are, at the end of each month — pipes under the streets, trunk lines to the plants and direct lines.",
    data: (_, now) => dhPipesChart(now),
  },
  {
    id: "dh-reach",
    group: "District heating",
    title: "District heating's reach",
    description: "The share of the town's heated buildings on district heat, and the share it could serve (connected, or on a piped street) — by number of buildings, by floor area or by heat demand.",
    param: { label: "Counted by", options: () => DH_REACH_MEASURES.map((x) => ({ value: x.value, label: x.label })) },
    data: dhReachChart,
  },
  {
    id: "dh-clean-share",
    group: "District heating",
    title: "Clean district heat",
    description: "The share of each network's heat made by its clean sources each month — the rest comes from its oil or gas boilers.",
    data: (_, now) => dhCleanShareChart(now),
  },
  {
    id: "electric-vehicles",
    group: "Mobility",
    title: "Electric vehicles",
    description: "The share of residents' cars, business vans and lorries that are electric, at the end of each month.",
    data: (_, now) => electricVehiclesChart(now),
  },
  {
    id: "public-charging",
    group: "Mobility",
    title: "Public charging",
    description: "How full the town's public chargers are, all of them together (a van needs about twice a car's room, a lorry many times), and how many charge points there are, at the end of each month.",
    data: (_, now) => chargingChart(now),
  },
  {
    id: "charging-quality",
    group: "Mobility",
    title: "Charging an electric car",
    description: "How many households have a wallbox, and how good public charging is on average for those who don't (near chargers, how busy, along the streets — charging at work aside), at the end of each month.",
    data: (_, now) => chargingQualityChart(now),
  },
  {
    id: "modal-split",
    group: "Town",
    title: "Modal split",
    description: "How residents get around, at the end of each month.",
    data: (_, now) => modalSplitChart(now),
  },
  {
    id: "approval",
    group: "Town",
    title: "Approval",
    description: "Public approval of the municipality's energy policy, month by month, with your measures marked: hover a month to see what you decided.",
    data: (_, now) => approvalChart(now),
  },
  {
    id: "emissions",
    group: "Books",
    title: "Emissions",
    description: "Each counted year's emissions by source, and what is left after carbon removals.",
    data: (_, now) => emissionsChart(now),
  },
  {
    id: "treasury",
    group: "Books",
    title: "Treasury and debt",
    description: "The treasury's balance at the end of each month, and what the town owes: its loans, and any overdraft.",
    data: (_, now) => treasuryChart(now),
  },
  {
    id: "spending",
    group: "Books",
    title: "Spending",
    description: "What the department paid out each year, by kind — or one kind on its own.",
    param: { label: "Show", options: spendingOptions },
    data: spendingChart,
  },
  {
    id: "utility",
    group: "Books",
    title: "The utility's accounts",
    description: "What the municipal utility sold and what it cost each booked year, and the result — or any line of its accounts, month by month.",
    param: { label: "Show", options: utilityOptions },
    data: utilityChart,
  },
];

export const CHART_GROUPS = [...new Set(CHARTS.map((c) => c.group))];
