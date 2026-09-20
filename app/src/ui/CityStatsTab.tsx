import { existsAt } from "../sim/lifetime";
import { useState } from "react";
import type { MunicipalityDataset } from "../data/types";
import { simClock } from "../sim/engine";
import { categoryEnergyFromSeries, type CategoryEnergyKWh } from "../sim/energy";
import {
  historyTimeSteps,
  netTotalFromCategorySeries,
  sampleMunicipalityCategorySeries,
  HISTORY_WINDOW_MS,
  MUNICIPALITY_HISTORY_SAMPLE_COUNT,
  HISTORY_REFRESH_MS,
} from "../sim/history";
import { effectivePowerPlantsAt } from "../sim/solarAdoption";
import { useSimDay, useTariff } from "../sim/store";
import { tariffKey } from "../sim/tariff";
import { CONSUMPTION_CATEGORIES } from "./deviceCategories";
import { HistoryChart } from "./HistoryChart";
import { PieChart, type PieSlice } from "./PieChart";
import { useHistorySeries } from "./useHistorySeries";
import { usePeriodPieEnergy, type PieGranularity } from "./usePeriodPieEnergy";
import "./panels.css";
import "./pieChart.css";

export interface CityStatsTabProps {
  dataset: MunicipalityDataset;
}

const GRANULARITIES: { label: string; value: PieGranularity }[] = [
  { label: "Day", value: "day" },
  { label: "Week", value: "week" },
  { label: "Month", value: "month" },
  { label: "Year", value: "year" },
];

const RESIDENTIAL_CATEGORIES = CONSUMPTION_CATEGORIES.filter((c) => c.key !== "commercial");

function toSlices(energy: CategoryEnergyKWh, categories: typeof CONSUMPTION_CATEGORIES): PieSlice[] {
  return categories.map((c) => ({ key: c.key, label: c.label, icon: c.icon, color: c.color, valueKWh: energy[c.key] }));
}

/** The municipality-wide summary — building/dwelling/solar counts, an Energy
 * breakdown pie pair (day/week/month/year, switchable), and the live Net power
 * / Solar generation charts. Shares `.panel-typography` (panels.css) for its
 * h2/dl look, since it's rendered inside ControlPanel's `.modal-content` rather
 * than a `.panel` card. */
export function CityStatsTab({ dataset }: CityStatsTabProps) {
  const tariff = useTariff();
  const currentDay = useSimDay();
  const plants = effectivePowerPlantsAt(dataset.buildings, dataset.powerPlants, currentDay);
  const solarPlants = plants.filter((p) => p.technology === "Photovoltaic" && (p.activeToMs === undefined || p.activeToMs > currentDay));
  const standing = dataset.buildings.filter((b) => existsAt(b, currentDay));
  const [granularity, setGranularity] = useState<PieGranularity>("day");

  const history = useHistorySeries(
    () => {
      const times = historyTimeSteps(simClock.getSimTimeMs(), HISTORY_WINDOW_MS, MUNICIPALITY_HISTORY_SAMPLE_COUNT);
      const categorySeries = sampleMunicipalityCategorySeries(dataset.buildings, times, tariff, plants);
      return {
        times,
        totalW: netTotalFromCategorySeries(categorySeries),
        pvW: categorySeries.solarW,
        energy: categoryEnergyFromSeries(times, categorySeries),
      };
    },
    HISTORY_REFRESH_MS,
    `${dataset.name}:${tariffKey(tariff)}:${currentDay}`,
  );

  const { energy: periodEnergy, loading } = usePeriodPieEnergy(
    dataset.name,
    granularity,
    (times) => sampleMunicipalityCategorySeries(dataset.buildings, times, tariff, plants),
    `${tariffKey(tariff)}:${currentDay}`,
  );
  const pieEnergy = granularity === "day" ? history.energy : periodEnergy;

  return (
    <div className="panel-typography">
      <dl>
        <dt>Buildings</dt>
        <dd>{standing.length}</dd>
        <dt>Dwellings</dt>
        <dd>{standing.reduce((sum, b) => sum + b.dwellings.length, 0)}</dd>
        <dt>Solar installations</dt>
        <dd>
          {solarPlants.length} ({solarPlants.reduce((sum, p) => sum + (p.capacityKw ?? 0), 0).toFixed(0)} kWp total)
        </dd>
      </dl>

      <h2 style={{ fontSize: 14, marginTop: 14 }}>Energy breakdown</h2>
      <div className="tier-buttons">
        {GRANULARITIES.map((g) => (
          <button key={g.value} className={g.value === granularity ? "active" : ""} onClick={() => setGranularity(g.value)}>
            {g.label}
          </button>
        ))}
      </div>
      {loading || !pieEnergy ? (
        <div className="loading-note">Computing…</div>
      ) : (
        <div className="pie-chart-row">
          <PieChart title="All categories" slices={toSlices(pieEnergy, CONSUMPTION_CATEGORIES)} />
          <PieChart title="Excluding commercial/business" slices={toSlices(pieEnergy, RESIDENTIAL_CATEGORIES)} />
        </div>
      )}

      <h2 style={{ fontSize: 14, marginTop: 14 }}>Net power — last 24h</h2>
      <HistoryChart
        times={history.times}
        series={[{ key: "total", label: "Net", color: "#2a78d6", values: history.totalW }]}
      />

      <h2 style={{ fontSize: 14, marginTop: 14 }}>Solar generation — last 24h</h2>
      <HistoryChart times={history.times} series={[{ key: "pv", label: "Solar", color: "#eda100", values: history.pvW }]} />
    </div>
  );
}
