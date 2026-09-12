import type { MunicipalityDataset } from "../data/types";
import { simClock } from "../sim/engine";
import {
  historyTimeSteps,
  sampleMunicipalitySeries,
  HISTORY_WINDOW_MS,
  HISTORY_SAMPLE_COUNT,
  HISTORY_REFRESH_MS,
} from "../sim/history";
import { HistoryChart } from "./HistoryChart";
import { useHistorySeries } from "./useHistorySeries";
import "./panels.css";

export interface MunicipalityPanelProps {
  dataset: MunicipalityDataset;
  onClose: () => void;
}

export function MunicipalityPanel({ dataset, onClose }: MunicipalityPanelProps) {
  const history = useHistorySeries(
    () => {
      const times = historyTimeSteps(simClock.getSimTimeMs(), HISTORY_WINDOW_MS, HISTORY_SAMPLE_COUNT);
      return { times, totalW: sampleMunicipalitySeries(dataset.buildings, times) };
    },
    HISTORY_REFRESH_MS,
    dataset.name,
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
        <dt>Power plants</dt>
        <dd>{dataset.powerPlants.length}</dd>
      </dl>

      <h2 style={{ fontSize: 14, marginTop: 14 }}>Power — last 24h</h2>
      <HistoryChart
        times={history.times}
        series={[{ key: "total", label: "Total", color: "#2a78d6", values: history.totalW }]}
      />
    </div>
  );
}
