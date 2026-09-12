import type { Building } from "../data/types";
import { simClock } from "../sim/engine";
import {
  historyTimeSteps,
  sampleBuildingSeries,
  HISTORY_WINDOW_MS,
  HISTORY_SAMPLE_COUNT,
  HISTORY_REFRESH_MS,
} from "../sim/history";
import { HistoryChart } from "./HistoryChart";
import { useHistorySeries } from "./useHistorySeries";
import "./panels.css";

export interface BuildingPanelProps {
  building: Building;
  onSelectDwelling: (ewid: string) => void;
  onClose: () => void;
}

export function BuildingPanel({ building, onSelectDwelling, onClose }: BuildingPanelProps) {
  const history = useHistorySeries(
    () => {
      const times = historyTimeSteps(simClock.getSimTimeMs(), HISTORY_WINDOW_MS, HISTORY_SAMPLE_COUNT);
      return { times, totalW: sampleBuildingSeries(building, times) };
    },
    HISTORY_REFRESH_MS,
    building.egid,
  );

  return (
    <div className="panel">
      <button className="panel-close" onClick={onClose} aria-label="Close">
        ×
      </button>
      <h2>Building {building.egid}</h2>
      <dl>
        <dt>Category</dt>
        <dd>{building.category ?? "Unknown"}</dd>
        <dt>Built</dt>
        <dd>{building.constructionYear ?? "Unknown"}</dd>
        <dt>Floors</dt>
        <dd>{building.floorCount ?? "Unknown"}</dd>
        <dt>Heating</dt>
        <dd>
          {building.heatingGenerator ?? "Unknown"}
          {building.heatingEnergySource ? ` (${building.heatingEnergySource})` : ""}
        </dd>
      </dl>
      <h2 style={{ fontSize: 14, marginTop: 14 }}>Dwellings ({building.dwellings.length})</h2>
      <ul>
        {building.dwellings.map((dwelling) => (
          <li key={dwelling.ewid}>
            <button onClick={() => onSelectDwelling(dwelling.ewid)}>
              Dwelling {dwelling.ewid}
              {dwelling.roomCount ? ` — ${dwelling.roomCount} rooms` : ""}
              {dwelling.areaM2 ? `, ${dwelling.areaM2} m²` : ""}
            </button>
          </li>
        ))}
        {building.dwellings.length === 0 && <li style={{ color: "#888", fontSize: 13 }}>No dwellings on record.</li>}
      </ul>

      <h2 style={{ fontSize: 14, marginTop: 14 }}>Power — last 24h</h2>
      <HistoryChart
        times={history.times}
        series={[{ key: "total", label: "Total", color: "#2a78d6", values: history.totalW }]}
      />
    </div>
  );
}
