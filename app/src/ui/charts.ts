/**
 * The charts in the town hall's Charts tab (ChartsTab.tsx): what the town looked like over time.
 * Each chart reads what the game already keeps — the monthly record (sim/monthRecords.ts), the
 * transformers' readings, the booked accounts, the payouts, the counted emissions, approval — and
 * turns it into series for TimeChart.tsx. Nothing here counts anything new.
 *
 * x is a year with its fraction (2031.5 is mid-2031); monthly values sit mid-month, yearly ones
 * mid-year.
 */

import { DH_SOURCE_SPECS } from "../config/districtHeat";
import { HEATING_SYSTEM_CATALOG } from "../config/heating";
import { MOBILITY_MODE_CATALOG } from "../config/mobility";
import { approval } from "../sim/approval";
import { BASELINE_YEAR, MONTH_NAMES, toDateMs, toSimTimeMs } from "../sim/calendar";
import { cachedEmissionsForYear, EMISSIONS_SOURCE_COLOR } from "../sim/emissions";
import { bookedFinances } from "../sim/finances";
import { grid } from "../sim/grid";
import { monthRecords, type MonthRecord } from "../sim/monthRecords";
import { treasury, type PayoutCategory } from "../sim/treasury";
import { DEVICE_CATEGORIES } from "./deviceCategories";

export interface ChartSeries {
  key: string;
  label: string;
  color: string;
  /** Stacked areas (or bars, for a chart in bars), a line on top, or only in the tooltip. */
  kind: "stack" | "line" | "hidden";
  dashed?: boolean;
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
  /** The tooltip adds up the stack. */
  total?: string;
  /** The first and last year on the axis. */
  from: number;
  to: number;
}

export interface ChartParam {
  label: string;
  options: () => { value: string; label: string }[];
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
function energyUnit(maxKWh: number): { unit: string; scale: number } {
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

const ELECTRICITY_GROUPS: { key: string; label: string; color: string; of: (keyof NonNullable<MonthRecord["electricityKWh"]>)[] }[] = [
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

// --- heat ---

function heatChart(nowMs: number): ChartData {
  const { records, ...m } = monthly(nowMs, (r) => !!r.heatingKWh);
  const keys = [
    ["airHeatPump", "airHeatPump"],
    ["groundHeatPump", "groundHeatPump"],
    ["districtHeating", "districtHeating"],
    ["gas", "gasBoiler"],
    ["oil", "oilBoiler"],
  ] as const;
  const raw = keys.map(([k]) => records.map((r) => r.heatingKWh![k]));
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

// --- the books ---

function emissionsChart(nowMs: number): ChartData {
  const list: NonNullable<ReturnType<typeof cachedEmissionsForYear>>[] = [];
  for (let y = BASELINE_YEAR; y < Math.floor(nowYear(nowMs)); y++) {
    const e = cachedEmissionsForYear(y);
    if (e) list.push(e);
  }
  const t = (kg: number) => kg / 1000;
  const keys = [
    ["electricity", "Electricity", "electricityKgCO2"],
    ["districtHeating", "District heating", "districtHeatingKgCO2"],
    ["gas", "Gas heating", "gasKgCO2"],
    ["oil", "Oil heating", "oilKgCO2"],
    ["mobility", "Cars", "mobilityKgCO2"],
  ] as const;
  return {
    xs: list.map((e) => e.year + 0.5),
    xLabels: list.map((e) => String(e.year)),
    ...axis(nowMs),
    unit: "t CO₂",
    bars: true,
    total: "Emitted",
    series: [
      ...keys.map(([k, label, field]) => ({ key: k, label, color: EMISSIONS_SOURCE_COLOR[k], kind: "stack" as const, values: list.map((e) => t(e[field])) })),
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

function spendingChart(nowMs: number): ChartData {
  const last = Math.floor(nowYear(nowMs));
  const years = Array.from({ length: last - BASELINE_YEAR + 1 }, (_, i) => BASELINE_YEAR + i);
  const paid = years.map((y) => treasury.paidOut(toSimTimeMs(Date.UTC(y, 0, 1)), toSimTimeMs(Date.UTC(y + 1, 0, 1))));
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

function utilityChart(nowMs: number): ChartData {
  const list = bookedFinances();
  const k = (rp: number) => rp / 100 / 1000;
  const sales = list.map((f) => f.consumerRevenueRp + f.districtHeatRevenueRp + f.publicChargingRevenueRp);
  const costs = list.map(
    (f) =>
      f.feedInPaidRp +
      f.wholesaleCostRp +
      f.gridMaintenanceCostRp +
      f.districtHeatPurchaseRp +
      f.districtHeatUpkeepRp +
      f.publicChargingUpkeepRp +
      f.roofContractCostRp +
      f.windUpkeepRp,
  );
  return {
    xs: list.map((f) => f.year + 0.5),
    xLabels: list.map((f) => String(f.year)),
    ...axis(nowMs),
    unit: "kCHF",
    series: [
      { key: "sales", label: "Sales: power, district heat, charging", color: "#2a78d6", kind: "line", values: sales.map(k) },
      { key: "costs", label: "Costs: power bought, feed-in, the grid, heat, upkeep", color: "#eb6834", kind: "line", values: costs.map(k) },
      { key: "result", label: "Result", color: "#1baf7a", kind: "line", dashed: true, values: sales.map((s, i) => k(s - costs[i])) },
    ],
  };
}

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
  };
}

export const CHARTS: ChartDef[] = [
  {
    id: "electricity",
    group: "Energy",
    title: "Electricity",
    description: "What the town used each month, by what used it, and what its solar panels and wind turbines made.",
    data: (_, now) => electricityChart(now),
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
    id: "transformer",
    group: "Grid",
    title: "A transformer",
    description: "Each winter's peak draw and each summer's peak solar feed-in at one transformer station, against its capacity.",
    param: { label: "Transformer", options: transformerOptions },
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
    description: "Public approval of the municipality's energy policy, month by month.",
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
    id: "spending",
    group: "Books",
    title: "Spending",
    description: "What the department paid out each year, by kind.",
    data: (_, now) => spendingChart(now),
  },
  {
    id: "utility",
    group: "Books",
    title: "The utility's accounts",
    description: "What the municipal utility sold and what it cost each booked year, and the result.",
    data: (_, now) => utilityChart(now),
  },
];

export const CHART_GROUPS = [...new Set(CHARTS.map((c) => c.group))];
