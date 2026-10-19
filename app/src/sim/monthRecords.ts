/**
 * A month-by-month record of the town, for the charts (ui/charts.ts): small totals kept as each
 * month is first counted (yearReport.ts's monthly electricity and heating passes, which run for
 * every finished month), so a chart over twenty years needs no recounting — and survives saving.
 *
 *  - electricity: what the town used, by category, and what its solar and wind made (kWh);
 *  - heating: heat delivered, by heating system (kWh);
 *  - district heat: what each kind of source made, and the boilers (kWh), and each network's
 *    clean heat and boiler heat;
 *  - at the month's end: rooftop solar built and the roofs' potential (kWp), how residents get
 *    around (the modal split, cars electric), the town's equipment (assets), and the treasury's
 *    balance and the loans still owed.
 *
 * A month is recorded once (its passes are cached forever); a record only grows.
 */

import type { CategoryEnergyKWh } from "./energy";
import type { UtilityMonth } from "./finances";

export interface MonthRecord {
  /** year * 12 + month (0-based). */
  month: number;
  electricityKWh?: CategoryEnergyKWh;
  windKWh?: number;
  /** What the district heating heat pumps drew (kWh): the utility's own use. */
  dhHeatPumpKWh?: number;
  heatingKWh?: { oil: number; gas: number; airHeatPump: number; groundHeatPump: number; districtHeating: number; wood?: number };
  /** District heat made, by what made it ("Wood chips", "Oil boilers"…). */
  districtHeatKWh?: Record<string, number>;
  /** Each network's heat (by its name): from its clean sources, and from its boilers (kWh). */
  dhNetworkKWh?: Record<string, { clean: number; boiler: number }>;
  solarBuiltKw?: number;
  solarPotentialKw?: number;
  mobility?: { car: number; carElectric: number; bike: number; other: number };
  /** The utility's trade (spotMarket.ts): bought over the contracts, sold on the spot market, and
   * what the neighbourhood batteries took in (kWh). */
  boughtKWh?: number;
  soldKWh?: number;
  storedKWh?: number;
  /** The utility's month as it was settled (finances.ts): every line of its accounts. */
  utility?: UtilityMonth;
  /** What the town had at the month's end. */
  assets?: MonthAssets;
  /** The treasury's balance at the month's end, once the utility's month was settled, and what
   * the loans still owed (Rappen). */
  books?: { balanceRp: number; loansRp: number };
}

export interface MonthAssets {
  /** Generation (kW of rating): Agri-PV fields, canopies over car parks and wind turbines (rooftop
   * solar is solarBuiltKw). */
  agriPvKw: number;
  carParkKw?: number;
  windKw: number;
  /** Of all the generation (rooftops too), the town's and its utility's own (kW): the wind turbines,
   * the utility's arrays on rented roofs, solar on public buildings, the town's car-park canopies and
   * its own Agri-PV fields. */
  ownKw?: number;
  /** Batteries' storage (kWh): homes' and the neighbourhood batteries. */
  homeBatteryKwh: number;
  gridBatteryKwh: number;
  /** District heating: pipe length (m, streets, trunk lines and direct lines), and what it reaches
   * — connected, and connected or free to connect — by buildings, floor area and heat demand
   * (shares of the heated buildings', 0-1). */
  dhPipeM: number;
  dhConnected: { buildings: number; floor: number; demand: number };
  dhWithinReach: { buildings: number; floor: number; demand: number };
  /** Public charging: charge points, their room and the room taken (cars' worth). */
  chargerPoints: number;
  chargerRoom: number;
  chargerTaken: number;
  /** Households without a wallbox: how good public charging is around them, on average (0-1);
   * and the share of all households with a wallbox. */
  chargingQos: number;
  wallboxShare: number;
  /** Business vehicles, and how many of them are electric (residents' cars are in `mobility`). */
  vans?: number;
  vansElectric?: number;
  trucks?: number;
  trucksElectric?: number;
  /** Heated buildings by heating system and by insulation class: buildings, and floor area (m2). */
  heatingSystems?: Record<string, { buildings: number; floor: number }>;
  insulation?: Record<string, { buildings: number; floor: number }>;
  /** Heat pumps' rating: the heat they deliver on a cold winter day (kW), air and ground. */
  airHeatPumpKw?: number;
  groundHeatPumpKw?: number;
}

class MonthRecords {
  private months = new Map<number, MonthRecord>();
  private readonly listeners = new Set<() => void>();
  private version = 0;

  init(): void {
    this.months = new Map();
    this.notify();
  }

  record(month: number, patch: Omit<MonthRecord, "month">): void {
    this.months.set(month, { ...(this.months.get(month) ?? { month }), ...patch });
    this.notify();
  }

  /** Every recorded month, in order. */
  all(): MonthRecord[] {
    return [...this.months.values()].sort((a, b) => a.month - b.month);
  }

  subscribe(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  getVersion(): number {
    return this.version;
  }

  private notify(): void {
    this.version++;
    this.listeners.forEach((l) => l());
  }

  // --- saving (saveGame.ts) ---

  snapshot() {
    return { months: this.all() };
  }

  restore(s: { months: MonthRecord[] } | undefined): void {
    this.months = new Map((s?.months ?? []).map((m) => [m.month, m]));
    this.notify();
  }
}

export const monthRecords = new MonthRecords();
