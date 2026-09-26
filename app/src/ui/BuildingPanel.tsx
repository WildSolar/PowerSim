import { ENERGY_CLASS_CATALOG } from "../sim/energyClass";
import { energyClassAt, retrofitLog } from "../sim/retrofit";
import { buildingThermalProfile } from "../sim/spaceHeating";
import { existsAt } from "../sim/lifetime";
import { lifecycleNotes } from "./lifecycleNotes";
import type { Building, PowerPlant } from "../data/types";
import { hasAC, acPowerW } from "../sim/ac";
import { buildingEnvelopeAreaM2 } from "../sim/buildingGeometry";
import { commercialCategory, commercialPowerW, totalFloorAreaM2 } from "../sim/commercial";
import { simClock } from "../sim/engine";
import { categoryEnergyFromSeries } from "../sim/energy";
import { hasHeatPump, heatPumpPowerW } from "../sim/heatPump";
import { currentHeatingSystemId, heatingRenewalLog } from "../sim/heatingRenewal";
import { HEATING_SYSTEM_CATALOG } from "../sim/heatingSystems";
import {
  historyTimeSteps,
  netTotalFromCategorySeries,
  sampleBuildingCategorySeries,
  HISTORY_WINDOW_MS,
  HISTORY_SAMPLE_COUNT,
  HISTORY_REFRESH_MS,
} from "../sim/history";
import { pvPowerForBuildingW } from "../sim/pv";
import { solarAdoptionLog } from "../sim/solarAdoption";
import { snowDepthCm } from "../sim/snow";
import { useSimTime, useTariff } from "../sim/store";
import { tariffKey } from "../sim/tariff";
import { hasElectricWaterHeating, waterHeatingPowerW } from "../sim/waterHeating";
import { BillSection } from "./BillSection";
import { COMMERCIAL_CATEGORY_ICON, COMMERCIAL_CATEGORY_LABEL } from "./commercialDisplay";
import { EnergyBreakdown } from "./EnergyBreakdown";
import { FleetSection } from "./FleetSection";
import { energySourceLabel } from "./energySourceLabel";
import { HistoricalEnergySection } from "./HistoricalEnergySection";
import { HistoryChart } from "./HistoryChart";
import { RenewalLogSection } from "./RenewalLogSection";
import { useBuildingBillSummary } from "./useBillSummary";
import { useHistorySeries } from "./useHistorySeries";
import { useLivePowerPlants } from "./useLivePowerPlants";
import { formatWatts } from "./format";
import "./panels.css";

export interface BuildingPanelProps {
  building: Building;
  allBuildings: Building[];
  realPlants: PowerPlant[];
  onSelectDwelling: (ewid: string) => void;
  onClose: () => void;
}

export function BuildingPanel({ building, allBuildings, realPlants, onSelectDwelling, onClose }: BuildingPanelProps) {
  const simTimeMs = useSimTime();
  const tariff = useTariff();
  const plants = useLivePowerPlants(allBuildings, realPlants, simTimeMs);
  const hasHp = hasHeatPump(building, simTimeMs);
  const heatPumpW = hasHp ? heatPumpPowerW(building, simTimeMs) : 0;
  const heatingSystemId = currentHeatingSystemId(building, simTimeMs);
  const heatingLog = heatingRenewalLog(building, simTimeMs);
  const hasAirCon = hasAC(building);
  const acW = hasAirCon ? acPowerW(building, simTimeMs) : 0;
  const envelopeAreaM2 = hasHp || hasAirCon ? buildingEnvelopeAreaM2(building) : null;
  const hasElectricWater = hasElectricWaterHeating(building, simTimeMs);
  const waterHeatingW = hasElectricWater ? waterHeatingPowerW(building, simTimeMs) : 0;
  const commCategory = commercialCategory(building);
  const commFloorAreaM2 = commCategory ? totalFloorAreaM2(building) : null;
  const commercialW = commCategory ? commercialPowerW(building, simTimeMs) : 0;

  const buildingPlants = plants.filter((p) => p.egid === building.egid && p.technology === "Photovoltaic");
  const hasSolar = buildingPlants.length > 0;
  const snowCoverCm = hasSolar ? snowDepthCm(simTimeMs) : 0;
  const solarGenerationW = hasSolar ? -pvPowerForBuildingW(building.egid, plants, simTimeMs, snowCoverCm) : 0;
  const solarCapacityKw = buildingPlants.reduce((sum, p) => sum + (p.capacityKw ?? 0), 0);
  const solarLog = solarAdoptionLog(building, simTimeMs);

  const history = useHistorySeries(
    () => {
      const times = historyTimeSteps(simClock.getSimTimeMs(), HISTORY_WINDOW_MS, HISTORY_SAMPLE_COUNT);
      const categorySeries = sampleBuildingCategorySeries(building, times, tariff, plants);
      return {
        times,
        totalW: netTotalFromCategorySeries(categorySeries),
        pvW: categorySeries.solarW,
        energy: categoryEnergyFromSeries(times, categorySeries),
      };
    },
    HISTORY_REFRESH_MS,
    `${building.egid}:${tariffKey(tariff)}`,
  );

  const billSummary = useBuildingBillSummary(building, plants, tariff);
  const notes = lifecycleNotes(building, simTimeMs);

  // A construction site (or a building already gone) has no devices, bills or history to show.
  if (!existsAt(building, simTimeMs)) {
    return (
      <div className="panel">
        <button className="panel-close" onClick={onClose} aria-label="Close">
          ×
        </button>
        <h2>{building.address ?? `Building ${building.egid}`}</h2>
        {notes.map((note) => (
          <p key={note} style={{ fontSize: 12 }}>
            {note}
          </p>
        ))}
        <dl>
          <dt>Planned</dt>
          <dd>
            {building.floorCount ?? "?"} floors, {building.dwellings.length} dwelling{building.dwellings.length === 1 ? "" : "s"}
          </dd>
        </dl>
      </div>
    );
  }

  return (
    <div className="panel">
      <button className="panel-close" onClick={onClose} aria-label="Close">
        ×
      </button>
      <h2>{building.address ?? `Building ${building.egid}`}</h2>
      {notes.map((note) => (
        <p key={note} style={{ fontSize: 12, margin: "0 0 6px" }}>
          {note}
        </p>
      ))}
      <dl>
        <dt>Category</dt>
        <dd>{building.category ?? "Unknown"}</dd>
        <dt>Use</dt>
        <dd>{building.buildingClass ?? "Unknown"}</dd>
        <dt>Built</dt>
        <dd>{building.constructionYear ?? "Unknown"}</dd>
        <dt>Floors</dt>
        <dd>{building.floorCount ?? "Unknown"}</dd>
        <dt>Insulation</dt>
        <dd>
          {ENERGY_CLASS_CATALOG[energyClassAt(building, simTimeMs)].label} (U {buildingThermalProfile(building, simTimeMs).uValueWPerM2K.toFixed(2)} W/m²K)
        </dd>
        <dt>Heating</dt>
        <dd>
          {heatingSystemId ? (
            `${HEATING_SYSTEM_CATALOG[heatingSystemId].icon} ${HEATING_SYSTEM_CATALOG[heatingSystemId].label}`
          ) : (
            <>
              {building.heatingGenerator ?? "Unknown"}
              {building.heatingEnergySource ? ` (${building.heatingEnergySource})` : ""}
            </>
          )}
        </dd>
      </dl>

      <h2 style={{ fontSize: 14, marginTop: 14 }}>Climate control</h2>
      <div className={`device-row${hasHp ? "" : " inactive"}`}>
        <span className="device-name">
          🌡️ Space heating
          {envelopeAreaM2 && hasHp && <span className="ev-badge">{Math.round(envelopeAreaM2)} m² envelope</span>}
        </span>
        {hasHp ? (
          <span className={`device-watts${heatPumpW === 0 ? " off" : ""}`}>{formatWatts(heatPumpW)}</span>
        ) : (
          <span className="device-status">
            {heatingSystemId ? HEATING_SYSTEM_CATALOG[heatingSystemId].label : energySourceLabel(building.heatingEnergySource)}
          </span>
        )}
      </div>
      <div className={`device-row${hasAirCon ? "" : " inactive"}`}>
        <span className="device-name">
          ❄️ Air conditioning
          {envelopeAreaM2 && hasAirCon && <span className="ev-badge">{Math.round(envelopeAreaM2)} m² envelope</span>}
        </span>
        {hasAirCon ? (
          <span className={`device-watts${acW === 0 ? " off" : ""}`}>{formatWatts(acW)}</span>
        ) : (
          <span className="device-status">Not installed</span>
        )}
      </div>
      <RenewalLogSection title="Heating history" entries={heatingLog} />
      <RenewalLogSection title="Insulation history" entries={retrofitLog(building, simTimeMs)} />

      <h2 style={{ fontSize: 14, marginTop: 14 }}>Hot water</h2>
      <div className={`device-row${hasElectricWater ? "" : " inactive"}`}>
        <span className="device-name">🚿 Water heating</span>
        {hasElectricWater ? (
          <span className={`device-watts${waterHeatingW === 0 ? " off" : ""}`}>{formatWatts(waterHeatingW)}</span>
        ) : (
          <span className="device-status">{energySourceLabel(building.hotWaterEnergySource)}</span>
        )}
      </div>

      {commCategory && (
        <>
          <h2 style={{ fontSize: 14, marginTop: 14 }}>Commercial</h2>
          <div className="device-row">
            <span className="device-name">
              {COMMERCIAL_CATEGORY_ICON[commCategory]} {COMMERCIAL_CATEGORY_LABEL[commCategory]}
              {commFloorAreaM2 && <span className="ev-badge">{Math.round(commFloorAreaM2)} m² floor area</span>}
            </span>
            <span className={`device-watts${commercialW === 0 ? " off" : ""}`}>{formatWatts(commercialW)}</span>
          </div>
        </>
      )}

      <FleetSection building={building} simTimeMs={simTimeMs} />

      <h2 style={{ fontSize: 14, marginTop: 14 }}>Solar</h2>
      <div className={`device-row${hasSolar ? "" : " inactive"}`}>
        <span className="device-name">
          ☀️ Generation
          {hasSolar && <span className="ev-badge responsive">{solarCapacityKw.toFixed(1)} kWp installed</span>}
          {snowCoverCm > 0 && <span className="ev-badge">❄️ {snowCoverCm.toFixed(1)} cm snow</span>}
        </span>
        {hasSolar ? (
          <span className={`device-watts${solarGenerationW === 0 ? " off" : ""}`}>{formatWatts(solarGenerationW)}</span>
        ) : (
          <span className="device-status">Not installed</span>
        )}
      </div>
      <RenewalLogSection title="Solar history" entries={solarLog} />

      <h2 style={{ fontSize: 14, marginTop: 14 }}>Daily energy — last 24h</h2>
      <EnergyBreakdown energy={history.energy} />

      <h2 style={{ fontSize: 14, marginTop: 14 }}>Bill</h2>
      <BillSection summary={billSummary} />

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

      <HistoricalEnergySection
        entityId={building.egid}
        sampler={(times) => sampleBuildingCategorySeries(building, times, tariff, plants)}
        tariffKey={tariffKey(tariff)}
      />

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
    </div>
  );
}
