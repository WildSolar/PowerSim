import type { Building, Dwelling } from "../data/types";
import { dwellingDevicePowerW } from "../sim/devices";
import {
  historyTimeSteps,
  sampleDwellingSeries,
  HISTORY_WINDOW_MS,
  HISTORY_SAMPLE_COUNT,
  HISTORY_REFRESH_MS,
} from "../sim/history";
import { useSimTime } from "../sim/store";
import { simClock } from "../sim/engine";
import { HistoryChart } from "./HistoryChart";
import { useHistorySeries } from "./useHistorySeries";
import "./panels.css";

export interface DwellingPanelProps {
  building: Building;
  dwelling: Dwelling;
  onBack: () => void;
  onClose: () => void;
}

function formatWatts(w: number): string {
  return `${Math.round(w)} W`;
}

export function DwellingPanel({ building, dwelling, onBack, onClose }: DwellingPanelProps) {
  const simTimeMs = useSimTime();
  const { fridgeW, lightingW } = dwellingDevicePowerW(building.egid, dwelling, simTimeMs);
  const totalW = fridgeW + lightingW;

  const history = useHistorySeries(
    () => {
      const times = historyTimeSteps(simClock.getSimTimeMs(), HISTORY_WINDOW_MS, HISTORY_SAMPLE_COUNT);
      return { times, ...sampleDwellingSeries(building.egid, dwelling, times) };
    },
    HISTORY_REFRESH_MS,
    `${building.egid}:${dwelling.ewid}`,
  );

  return (
    <div className="panel">
      <button className="panel-close" onClick={onClose} aria-label="Close">
        ×
      </button>
      <button className="back-link" onClick={onBack}>
        ← Building {building.egid}
      </button>
      <h2>Dwelling {dwelling.ewid}</h2>
      <dl>
        <dt>Rooms</dt>
        <dd>{dwelling.roomCount ?? "Unknown"}</dd>
        <dt>Area</dt>
        <dd>{dwelling.areaM2 ? `${dwelling.areaM2} m²` : "Unknown"}</dd>
      </dl>

      <h2 style={{ fontSize: 14, marginTop: 14 }}>Devices</h2>
      <div className="device-row">
        <span className="device-name">🧊 Fridge</span>
        <span className={`device-watts${fridgeW === 0 ? " off" : ""}`}>{formatWatts(fridgeW)}</span>
      </div>
      <div className="device-row">
        <span className="device-name">💡 Lighting</span>
        <span className={`device-watts${lightingW === 0 ? " off" : ""}`}>{formatWatts(lightingW)}</span>
      </div>
      <div className="total-row">
        <span>Total</span>
        <span>{formatWatts(totalW)}</span>
      </div>

      <h2 style={{ fontSize: 14, marginTop: 14 }}>Power — last 24h</h2>
      <HistoryChart
        times={history.times}
        series={[
          { key: "fridge", label: "Fridge", color: "#2a78d6", values: history.fridgeW },
          { key: "lighting", label: "Lighting", color: "#eb6834", values: history.lightingW },
        ]}
      />
    </div>
  );
}
