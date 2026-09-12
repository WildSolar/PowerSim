import type { Building, Dwelling } from "../data/types";
import { dwellingDevicePowerW } from "../sim/devices";
import { buildingEvTraits, evDailySession, evPowerWFromTraits } from "../sim/ev";
import { isOffPeakHour } from "../sim/tariff";
import {
  historyTimeSteps,
  sampleDwellingSeries,
  HISTORY_WINDOW_MS,
  HISTORY_SAMPLE_COUNT,
  HISTORY_REFRESH_MS,
} from "../sim/history";
import { useSimTime, useTariff } from "../sim/store";
import { simClock } from "../sim/engine";
import { HistoryChart } from "./HistoryChart";
import { useHistorySeries } from "./useHistorySeries";
import { formatWatts } from "./format";
import "./panels.css";

export interface DwellingPanelProps {
  building: Building;
  dwelling: Dwelling;
  onBack: () => void;
  onClose: () => void;
}

const DAY_MS = 24 * 60 * 60_000;

function formatHourOfDay(ms: number): string {
  const h = (((ms % DAY_MS) + DAY_MS) % DAY_MS) / 3_600_000;
  const hh = Math.floor(h);
  const mm = Math.round((h - hh) * 60);
  return `${String(hh).padStart(2, "0")}:${String(mm).padStart(2, "0")}`;
}

export function DwellingPanel({ building, dwelling, onBack, onClose }: DwellingPanelProps) {
  const simTimeMs = useSimTime();
  const tariff = useTariff();
  const { fridgeW, lightingW } = dwellingDevicePowerW(building.egid, dwelling, simTimeMs);
  const evTraits = buildingEvTraits(building, dwelling);
  const evW = evPowerWFromTraits(building.egid, dwelling, evTraits, simTimeMs, tariff);
  const totalW = fridgeW + lightingW + evW;

  const todaySession = evTraits.hasEV
    ? evDailySession(building.egid, dwelling, Math.floor(simTimeMs / DAY_MS), evTraits.responsive, tariff)
    : null;
  const sessionStartsOffPeak =
    todaySession && isOffPeakHour(tariff, ((((todaySession.startMs % DAY_MS) + DAY_MS) % DAY_MS) / 3_600_000));

  const history = useHistorySeries(
    () => {
      const times = historyTimeSteps(simClock.getSimTimeMs(), HISTORY_WINDOW_MS, HISTORY_SAMPLE_COUNT);
      return { times, ...sampleDwellingSeries(building, dwelling, times, tariff) };
    },
    HISTORY_REFRESH_MS,
    `${building.egid}:${dwelling.ewid}:${tariff.offPeakPriceRpKWh}:${tariff.peakPriceRpKWh}`,
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
      {evTraits.hasEV && (
        <div className="device-row">
          <span className="device-name">
            🚗 EV charging
            <span className={`ev-badge${evTraits.responsive ? " responsive" : ""}`}>
              {evTraits.responsive ? "responsive" : "not responsive"}
            </span>
          </span>
          <span className={`device-watts${evW === 0 ? " off" : ""}`}>{formatWatts(evW)}</span>
        </div>
      )}
      <div className="total-row">
        <span>Total</span>
        <span>{formatWatts(totalW)}</span>
      </div>

      {todaySession && (
        <div className="ev-session-note">
          Tonight: {formatHourOfDay(todaySession.startMs)}–{formatHourOfDay(todaySession.endMs)}
          {sessionStartsOffPeak ? " (off-peak)" : " (peak)"}
        </div>
      )}

      <h2 style={{ fontSize: 14, marginTop: 14 }}>Power — last 24h</h2>
      <HistoryChart
        times={history.times}
        series={[
          { key: "fridge", label: "Fridge", color: "#2a78d6", values: history.fridgeW },
          { key: "lighting", label: "Lighting", color: "#eb6834", values: history.lightingW },
        ]}
      />

      {evTraits.hasEV && (
        <>
          <h2 style={{ fontSize: 14, marginTop: 14 }}>EV charging — last 24h</h2>
          <HistoryChart times={history.times} series={[{ key: "ev", label: "EV", color: "#1baf7a", values: history.evW }]} />
        </>
      )}
    </div>
  );
}
