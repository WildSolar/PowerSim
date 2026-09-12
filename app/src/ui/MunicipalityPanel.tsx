import { useState } from "react";
import type { MunicipalityDataset } from "../data/types";
import { simClock } from "../sim/engine";
import { categoryEnergyFromSeries } from "../sim/energy";
import {
  historyTimeSteps,
  netTotalFromCategorySeries,
  sampleMunicipalityCategorySeries,
  HISTORY_WINDOW_MS,
  MUNICIPALITY_HISTORY_SAMPLE_COUNT,
  HISTORY_REFRESH_MS,
} from "../sim/history";
import type { PeriodTier } from "../sim/historyLong";
import { useTariff } from "../sim/store";
import { DEVICE_CATEGORIES, type DeviceCategoryKey } from "./deviceCategories";
import { EnergyBreakdown } from "./EnergyBreakdown";
import { formatKWh } from "./format";
import { HistoryChart } from "./HistoryChart";
import { PeriodBarChart, type BarSeries } from "./PeriodBarChart";
import { useHistorySeries } from "./useHistorySeries";
import { useLongHistory } from "./useLongHistory";
import "./panels.css";

export interface MunicipalityPanelProps {
  dataset: MunicipalityDataset;
  onClose: () => void;
}

const TIERS: { label: string; value: PeriodTier }[] = [
  { label: "Day", value: "day" },
  { label: "Week", value: "week" },
  { label: "Month", value: "month" },
];

const CONSUMPTION_CATEGORIES = DEVICE_CATEGORIES.filter((c) => c.key !== "solar");

type CategorySelection = "total" | "stacked" | DeviceCategoryKey;

export function MunicipalityPanel({ dataset, onClose }: MunicipalityPanelProps) {
  const tariff = useTariff();
  const solarPlants = dataset.powerPlants.filter((p) => p.technology === "Photovoltaic");
  const [tier, setTier] = useState<PeriodTier>("day");
  const [categorySelection, setCategorySelection] = useState<CategorySelection>("total");

  const { bars, loading } = useLongHistory(tier, dataset, tariff);
  const barLabels = bars.map((b) => b.label);
  const barSeries: BarSeries[] =
    categorySelection === "stacked"
      ? CONSUMPTION_CATEGORIES.map((c) => ({ key: c.key, label: c.label, color: c.color, values: bars.map((b) => b.energy[c.key]) }))
      : categorySelection === "total"
        ? [
            {
              key: "total",
              label: "Total",
              color: "#2a78d6",
              values: bars.map((b) => CONSUMPTION_CATEGORIES.reduce((sum, c) => sum + b.energy[c.key], 0) - b.energy.solar),
            },
          ]
        : [
            {
              key: categorySelection,
              label: DEVICE_CATEGORIES.find((c) => c.key === categorySelection)!.label,
              color: DEVICE_CATEGORIES.find((c) => c.key === categorySelection)!.color,
              values: bars.map((b) => b.energy[categorySelection]),
            },
          ];

  const history = useHistorySeries(
    () => {
      const times = historyTimeSteps(simClock.getSimTimeMs(), HISTORY_WINDOW_MS, MUNICIPALITY_HISTORY_SAMPLE_COUNT);
      const categorySeries = sampleMunicipalityCategorySeries(dataset.buildings, times, tariff, dataset.powerPlants);
      return {
        times,
        totalW: netTotalFromCategorySeries(categorySeries),
        pvW: categorySeries.solarW,
        energy: categoryEnergyFromSeries(times, categorySeries),
      };
    },
    HISTORY_REFRESH_MS,
    `${dataset.name}:${tariff.offPeakPriceRpKWh}:${tariff.peakPriceRpKWh}`,
  );

  return (
    <div className="panel">
      <button className="panel-close" onClick={onClose} aria-label="Close">
        ×
      </button>
      <h2>{dataset.name}</h2>
      <dl>
        <dt>Buildings</dt>
        <dd>{dataset.buildings.length}</dd>
        <dt>Dwellings</dt>
        <dd>{dataset.buildings.reduce((sum, b) => sum + b.dwellings.length, 0)}</dd>
        <dt>Solar installations</dt>
        <dd>
          {solarPlants.length} ({solarPlants.reduce((sum, p) => sum + (p.capacityKw ?? 0), 0).toFixed(0)} kWp total)
        </dd>
      </dl>

      <h2 style={{ fontSize: 14, marginTop: 14 }}>Daily energy — last 24h</h2>
      <EnergyBreakdown energy={history.energy} />

      <h2 style={{ fontSize: 14, marginTop: 14 }}>Net power — last 24h</h2>
      <HistoryChart
        times={history.times}
        series={[{ key: "total", label: "Net", color: "#2a78d6", values: history.totalW }]}
      />

      <h2 style={{ fontSize: 14, marginTop: 14 }}>Solar generation — last 24h</h2>
      <HistoryChart times={history.times} series={[{ key: "pv", label: "Solar", color: "#eda100", values: history.pvW }]} />

      <h2 style={{ fontSize: 14, marginTop: 14 }}>Historical energy</h2>
      <div className="tier-buttons">
        {TIERS.map((t) => (
          <button key={t.value} className={t.value === tier ? "active" : ""} onClick={() => setTier(t.value)}>
            {t.label}
          </button>
        ))}
      </div>
      <select
        className="category-select"
        value={categorySelection}
        onChange={(e) => setCategorySelection(e.target.value as CategorySelection)}
      >
        <option value="total">Total (net)</option>
        <option value="stacked">By category (stacked)</option>
        {DEVICE_CATEGORIES.map((c) => (
          <option key={c.key} value={c.key}>
            {c.icon} {c.label}
          </option>
        ))}
      </select>
      {loading && <div className="loading-note">Computing…</div>}
      <PeriodBarChart labels={barLabels} series={barSeries} formatValue={formatKWh} />
    </div>
  );
}
