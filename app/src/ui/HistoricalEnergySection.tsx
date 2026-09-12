import { useState } from "react";
import type { Building, PowerPlant } from "../data/types";
import type { PeriodTier } from "../sim/historyLong";
import { useTariff } from "../sim/store";
import { DEVICE_CATEGORIES, type DeviceCategoryKey } from "./deviceCategories";
import { formatKWh } from "./format";
import { PeriodBarChart, type BarSeries } from "./PeriodBarChart";
import { useLongHistory } from "./useLongHistory";
import "./panels.css";

const TIERS: { label: string; value: PeriodTier }[] = [
  { label: "Day", value: "day" },
  { label: "Week", value: "week" },
  { label: "Month", value: "month" },
];

const CONSUMPTION_CATEGORIES = DEVICE_CATEGORIES.filter((c) => c.key !== "solar");

type CategorySelection = "total" | "stacked" | DeviceCategoryKey;

export interface HistoricalEnergySectionProps {
  /** Unique per view — the municipality's name, or a building's EGID — so this
   * view's cached bars never collide with another view's (see historyLong.ts). */
  entityId: string;
  /** The municipality's full building list, or a single-element array for one
   * building's own panel — sampleMunicipalityCategorySeries is generic over both. */
  buildings: Building[];
  plants: PowerPlant[];
}

/** Day/week/month bar-chart history — shared by MunicipalityPanel and
 * BuildingPanel, the only difference between the two being what `buildings`
 * they pass in. */
export function HistoricalEnergySection({ entityId, buildings, plants }: HistoricalEnergySectionProps) {
  const tariff = useTariff();
  const [tier, setTier] = useState<PeriodTier>("day");
  const [categorySelection, setCategorySelection] = useState<CategorySelection>("total");

  const { bars, loading } = useLongHistory(entityId, tier, buildings, plants, tariff);
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

  return (
    <>
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
    </>
  );
}
