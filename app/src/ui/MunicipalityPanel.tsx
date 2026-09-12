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
import { useTariff } from "../sim/store";
import { EnergyBreakdown } from "./EnergyBreakdown";
import { HistoryChart } from "./HistoryChart";
import { useHistorySeries } from "./useHistorySeries";
import "./panels.css";

export interface MunicipalityPanelProps {
  dataset: MunicipalityDataset;
  onClose: () => void;
}

export function MunicipalityPanel({ dataset, onClose }: MunicipalityPanelProps) {
  const tariff = useTariff();
  const solarPlants = dataset.powerPlants.filter((p) => p.technology === "Photovoltaic");

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
    </div>
  );
}
