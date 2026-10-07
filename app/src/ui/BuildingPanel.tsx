import { useState } from "react";
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
import { buildingLoadW } from "../sim/buildingPower";
import { solarAndBatteryAt } from "../sim/homeBattery";
import { solarAdoptionLog } from "../sim/solarAdoption";
import { snowDepthCm } from "../sim/snow";
import { useSimTime, useTariff } from "../sim/store";
import { tariffKey } from "../sim/tariff";
import { hasElectricWaterHeating, waterHeatingPowerW } from "../sim/waterHeating";
import { BillSection } from "./BillSection";
import { COMMERCIAL_CATEGORY_ICON, COMMERCIAL_CATEGORY_LABEL } from "./commercialDisplay";
import { EnergyBreakdown } from "./EnergyBreakdown";
import { FleetSection } from "./FleetSection";
import { PublicBuildingOrders } from "./PublicBuildingsPanel";
import { RoofContractCard } from "./RoofSolarPanel";
import { ROOF_CONTRACT_MIN_FOOTPRINT_M2 } from "../config/roofContracts";
import { SupervisionNotice } from "./SupervisionNotice";
import { isPublicBuilding, publicBuildingKind } from "../sim/publicBuildings";
import { HeatPumpSiteSection } from "./HeatPumpSiteSection";
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
  const [, setOrders] = useState(0); // re-read after ordering solar or chargers here
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
  const solarState = hasSolar ? solarAndBatteryAt(building.egid, plants, simTimeMs, buildingLoadW(building, simTimeMs), snowCoverCm) : null;
  const solarGenerationW = solarState?.generationW ?? 0;
  const battery = solarState?.battery ?? null;
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

      {isPublicBuilding(building) && (
        <>
          <h3 className="section-heading">Municipal building · {publicBuildingKind(building)}</h3>
          <SupervisionNotice />
          <div className="public-orders">
            <PublicBuildingOrders building={building} realPlants={realPlants} now={simTimeMs} onOrdered={() => setOrders((n) => n + 1)} withName={false} />
          </div>
        </>
      )}

      {!isPublicBuilding(building) && (building.footprintAreaM2 ?? 0) >= ROOF_CONTRACT_MIN_FOOTPRINT_M2 && (
        <>
          <h3 className="section-heading">Roof contract</h3>
          <RoofContractCard building={building} now={simTimeMs} />
        </>
      )}

      <h3 className="section-heading">Climate control</h3>
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
      {heatingSystemId && <HeatPumpSiteSection building={building} simTimeMs={simTimeMs} />}
      <RenewalLogSection title="Insulation history" entries={retrofitLog(building, simTimeMs)} />

      <h3 className="section-heading">Hot water</h3>
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
          <h3 className="section-heading">Commercial</h3>
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

      <h3 className="section-heading">Solar</h3>
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
      {battery && solarState && (
        <div className="device-row" title="Charges from the solar surplus, and covers the building's own use from the late afternoon for as long as the day's charge lasts">
          <span className="device-name">
            🔋 Battery
            <span className="ev-badge responsive">{battery.kwh.toFixed(0)} kWh</span>
            {battery.feedInCap !== null && <span className="ev-badge">grid-friendly · feed-in ≤ {Math.round(battery.feedInCap * 100)}%</span>}
          </span>
          <span className={`device-watts${solarState.batteryW === 0 ? " off" : ""}`}>
            {solarState.batteryW > 0 ? `charging ${formatWatts(solarState.batteryW)}` : solarState.batteryW < 0 ? `supplying ${formatWatts(-solarState.batteryW)}` : "idle"}
          </span>
        </div>
      )}
      {solarState && solarState.curtailedW > 0 && (
        <p className="dh-note" style={{ margin: "2px 0 0" }}>
          {formatWatts(solarState.curtailedW)} curtailed to keep the feed-in under its cap.
        </p>
      )}
      <RenewalLogSection title="Solar history" entries={solarLog} />

      <h3 className="section-heading">Daily energy — last 24h</h3>
      <EnergyBreakdown energy={history.energy} />

      <h3 className="section-heading">Bill</h3>
      <BillSection summary={billSummary} />

      <h3 className="section-heading">Net power — last 24h</h3>
      <HistoryChart
        times={history.times}
        series={[{ key: "total", label: "Net", color: "#2a78d6", values: history.totalW }]}
      />

      {hasSolar && (
        <>
          <h3 className="section-heading">Solar generation — last 24h</h3>
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

      <h3 className="section-heading">Dwellings ({building.dwellings.length})</h3>
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
        {building.dwellings.length === 0 && <li style={{ color: "var(--ink-3)", fontSize: 13 }}>No dwellings on record.</li>}
      </ul>
    </div>
  );
}
