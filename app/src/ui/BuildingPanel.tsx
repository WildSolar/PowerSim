import type { Building, PowerPlant } from "../data/types";
import { hasAC, acPowerW } from "../sim/ac";
import { buildingEnvelopeAreaM2 } from "../sim/buildingGeometry";
import { simClock } from "../sim/engine";
import { hasHeatPump, heatPumpPowerW } from "../sim/heatPump";
import {
  historyTimeSteps,
  sampleBuildingSeries,
  sampleBuildingPvSeries,
  HISTORY_WINDOW_MS,
  HISTORY_SAMPLE_COUNT,
  HISTORY_REFRESH_MS,
} from "../sim/history";
import { pvPowerForBuildingW } from "../sim/pv";
import { snowDepthCm } from "../sim/snow";
import { useSimTime, useTariff } from "../sim/store";
import { HistoryChart } from "./HistoryChart";
import { useHistorySeries } from "./useHistorySeries";
import { formatWatts } from "./format";
import "./panels.css";

export interface BuildingPanelProps {
  building: Building;
  plants: PowerPlant[];
  onSelectDwelling: (ewid: string) => void;
  onClose: () => void;
}

export function BuildingPanel({ building, plants, onSelectDwelling, onClose }: BuildingPanelProps) {
  const simTimeMs = useSimTime();
  const tariff = useTariff();
  const hasHp = hasHeatPump(building);
  const heatPumpW = hasHp ? heatPumpPowerW(building, simTimeMs) : 0;
  const hasAirCon = hasAC(building);
  const acW = hasAirCon ? acPowerW(building, simTimeMs) : 0;
  const envelopeAreaM2 = hasHp || hasAirCon ? buildingEnvelopeAreaM2(building) : null;

  const buildingPlants = plants.filter((p) => p.egid === building.egid && p.technology === "Photovoltaic");
  const hasSolar = buildingPlants.length > 0;
  const snowCoverCm = hasSolar ? snowDepthCm(simTimeMs) : 0;
  const solarGenerationW = hasSolar ? -pvPowerForBuildingW(building.egid, plants, simTimeMs, snowCoverCm) : 0;
  const solarCapacityKw = buildingPlants.reduce((sum, p) => sum + (p.capacityKw ?? 0), 0);

  const history = useHistorySeries(
    () => {
      const times = historyTimeSteps(simClock.getSimTimeMs(), HISTORY_WINDOW_MS, HISTORY_SAMPLE_COUNT);
      return {
        times,
        totalW: sampleBuildingSeries(building, times, tariff, plants),
        pvW: sampleBuildingPvSeries(building, times, plants).map((w) => -w),
      };
    },
    HISTORY_REFRESH_MS,
    `${building.egid}:${tariff.offPeakPriceRpKWh}:${tariff.peakPriceRpKWh}`,
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

      {(hasHp || hasAirCon) && (
        <>
          <h2 style={{ fontSize: 14, marginTop: 14 }}>Climate control</h2>
          {hasHp && (
            <div className="device-row">
              <span className="device-name">
                🌡️ Space heating
                {envelopeAreaM2 && <span className="ev-badge">{Math.round(envelopeAreaM2)} m² envelope</span>}
              </span>
              <span className={`device-watts${heatPumpW === 0 ? " off" : ""}`}>{formatWatts(heatPumpW)}</span>
            </div>
          )}
          {hasAirCon && (
            <div className="device-row">
              <span className="device-name">
                ❄️ Air conditioning
                {envelopeAreaM2 && <span className="ev-badge">{Math.round(envelopeAreaM2)} m² envelope</span>}
              </span>
              <span className={`device-watts${acW === 0 ? " off" : ""}`}>{formatWatts(acW)}</span>
            </div>
          )}
        </>
      )}

      {hasSolar && (
        <>
          <h2 style={{ fontSize: 14, marginTop: 14 }}>Solar</h2>
          <div className="device-row">
            <span className="device-name">
              ☀️ Generation
              <span className="ev-badge responsive">{solarCapacityKw.toFixed(1)} kWp installed</span>
              {snowCoverCm > 0 && <span className="ev-badge">❄️ {snowCoverCm.toFixed(1)} cm snow</span>}
            </span>
            <span className={`device-watts${solarGenerationW === 0 ? " off" : ""}`}>{formatWatts(solarGenerationW)}</span>
          </div>
        </>
      )}

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

      <h2 style={{ fontSize: 14, marginTop: 14 }}>Net power — last 24h</h2>
      <HistoryChart
        times={history.times}
        series={[{ key: "total", label: "Net", color: "#2a78d6", values: history.totalW }]}
      />

      {hasSolar && (
        <>
          <h2 style={{ fontSize: 14, marginTop: 14 }}>Solar generation — last 24h</h2>
          <HistoryChart
            times={history.times}
            series={[{ key: "pv", label: "Solar", color: "#eda100", values: history.pvW }]}
          />
        </>
      )}
    </div>
  );
}
