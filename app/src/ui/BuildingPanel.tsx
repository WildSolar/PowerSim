import { roofOrientationLabel } from "../sim/pv";
import { workChargingCars } from "../sim/workCharging";
import { useMemo, useState } from "react";
import { ENERGY_CLASS_CATALOG } from "../sim/energyClass";
import { energyClassAt, retrofitLog } from "../sim/retrofit";
import { buildingThermalProfile } from "../sim/spaceHeating";
import { existsAt } from "../sim/lifetime";
import { lifecycleNotes } from "./lifecycleNotes";
import type { Building, PowerPlant } from "../data/types";
import { cooledAreaM2, coolingKind } from "../sim/ac";
import { commercialCategory, totalFloorAreaM2 } from "../sim/commercial";
import { toDateMs } from "../sim/calendar";
import { simClock } from "../sim/engine";
import { categoryEnergyFromSeries } from "../sim/energy";
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
import { mobilitySlotSummaries } from "../sim/mobility";
import { publicCharging } from "../sim/publicCharging";
import { solarAdoptionLog } from "../sim/solarAdoption";
import { snowDepthCm } from "../sim/snow";
import { useLiveSimTime, useTariff } from "../sim/store";
import { tariffKey } from "../sim/tariff";
import { waterHeatingKind } from "../sim/waterHeating";
import { BillSection } from "./BillSection";
import { buildingKindLabel, isMixedUse } from "./buildingLabels";
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

const DAY_MS = 24 * 3_600_000;

export interface BuildingPanelProps {
  building: Building;
  allBuildings: Building[];
  realPlants: PowerPlant[];
  onSelectDwelling: (ewid: string) => void;
  onClose: () => void;
}

/** "Apartment building · 4 homes · 6 floors · built 1961 · 11 jobs". */
function describe(building: Building): string {
  const homes = building.dwellings.length;
  const parts = [
    buildingKindLabel(building.buildingClass) + (homes > 0 && isMixedUse(building.category) ? ", with shops or offices" : ""),
    homes > 0 ? `${homes} home${homes === 1 ? "" : "s"}` : null,
    building.floorCount ? `${building.floorCount} floor${building.floorCount === 1 ? "" : "s"}` : null,
    building.constructionYear ? `built ${building.constructionYear}` : null,
    (building.jobs ?? 0) >= 1 ? `${Math.round(building.jobs ?? 0)} job${Math.round(building.jobs ?? 0) === 1 ? "" : "s"}` : null,
  ];
  return parts.filter((p): p is string => !!p).join(" · ");
}

/** The households' cars, the electric ones among them, and the wallboxes (counted once a day). */
function useHomeCars(building: Building, day: number): { cars: number; electric: number; wallboxes: number } {
  return useMemo(() => {
    let cars = 0;
    let electric = 0;
    let wallboxes = 0;
    for (const d of building.dwellings) {
      for (const s of mobilitySlotSummaries(building.egid, d, day)) {
        if (s.mode !== "car" || !s.vehicleType) continue;
        cars++;
        if (s.vehicleType === "carEV") electric++;
      }
      if (publicCharging.hasWallboxAt(building, d, day)) wallboxes++;
    }
    return { cars, electric, wallboxes };
  }, [building, day]);
}

/** The card for a building picked on the map: what it is and what it has now, what's live this
 * moment, what could change here (the player's own options and the owner's), its energy and bill,
 * what happened here over the years, and its homes. */
export function BuildingPanel({ building, allBuildings, realPlants, onSelectDwelling, onClose }: BuildingPanelProps) {
  const simTimeMs = useLiveSimTime();
  const day = Math.floor(simTimeMs / DAY_MS) * DAY_MS;
  const tariff = useTariff();
  const [, setOrders] = useState(0); // re-read after ordering solar or chargers here
  const plants = useLivePowerPlants(allBuildings, realPlants, simTimeMs);
  const heatingSystemId = currentHeatingSystemId(building, simTimeMs);
  const heatingLog = heatingRenewalLog(building, simTimeMs);
  const insulationLog = retrofitLog(building, simTimeMs);
  const cooling = coolingKind(building, simTimeMs);
  const water = waterHeatingKind(building, simTimeMs);
  const commCategory = commercialCategory(building);
  const commFloorAreaM2 = commCategory ? totalFloorAreaM2(building) : null;
  const staffCars = workChargingCars(building, simTimeMs);
  const homeCars = useHomeCars(building, day);

  const buildingPlants = plants.filter((p) => p.egid === building.egid && p.technology === "Photovoltaic");
  const hasSolar = buildingPlants.length > 0;
  const snowCoverCm = snowDepthCm(simTimeMs);
  const loadW = buildingLoadW(building, simTimeMs);
  const solarState = solarAndBatteryAt(building, plants, simTimeMs, loadW, snowCoverCm);
  const battery = solarState.battery;
  const netW = loadW + solarState.netW;
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
      <div className="panel" data-tour="building-panel">
        <button className="panel-close" onClick={onClose} aria-label="Close">
          ×
        </button>
        <h2>{building.address ?? `Building ${building.egid}`}</h2>
        <p className="bp-kind">{describe(building)}</p>
        {notes.map((note) => (
          <p key={note} style={{ fontSize: 12 }}>
            {note}
          </p>
        ))}
      </div>
    );
  }

  const heating = heatingSystemId ? HEATING_SYSTEM_CATALOG[heatingSystemId] : null;
  // When the heating went in, if it happened in the game.
  const heatingSince = heatingLog.length > 0 ? new Date(toDateMs(heatingLog[heatingLog.length - 1].installedAtMs)).getUTCFullYear() : null;
  const thermal = buildingThermalProfile(building, simTimeMs);
  const roofContract = !isPublicBuilding(building) && (building.footprintAreaM2 ?? 0) >= ROOF_CONTRACT_MIN_FOOTPRINT_M2;
  const pastEvents = heatingLog.length + insulationLog.length + solarLog.length;

  return (
    <div className="panel" data-tour="building-panel">
      <button className="panel-close" onClick={onClose} aria-label="Close">
        ×
      </button>
      <h2>{building.address ?? `Building ${building.egid}`}</h2>
      <p className="bp-kind">{describe(building)}</p>
      {notes.map((note) => (
        <p key={note} className="bp-note">
          {note}
        </p>
      ))}

      {/* What the building has now. */}
      <dl className="bp-facts">
        <dt>Heating</dt>
        <dd>
          {heating ? `${heating.icon} ${heating.label}` : `${building.heatingGenerator ?? "Unknown"}${building.heatingEnergySource ? ` (${building.heatingEnergySource})` : ""}`}
          {heatingSince && <span className="bp-sub"> · since {heatingSince}</span>}
        </dd>
        <dt>Hot water</dt>
        <dd>{water === "heatPump" ? "From a heat pump" : water === "direct" ? "Electric boiler" : energySourceLabel(building.hotWaterEnergySource)}</dd>
        <dt title="How well the building keeps its heat: its energy class, and how much heat its walls, roof and windows let through on average">Insulation</dt>
        <dd>
          {ENERGY_CLASS_CATALOG[energyClassAt(building, simTimeMs)].label}
          <span className="bp-sub"> · U {thermal.uValueWPerM2K.toFixed(2)} W/m²K</span>
        </dd>
        <dt>Solar</dt>
        <dd title={hasSolar ? "How the panels face the sun: it sets when in the day they make the most" : undefined}>
          {hasSolar ? (
            <>
              {solarCapacityKw.toFixed(1)} kWp<span className="bp-sub"> · facing {roofOrientationLabel(building.egid)}</span>
              {battery && (
                <span className="bp-sub">
                  {" "}
                  · battery {battery.kwh.toFixed(0)} kWh{battery.feedInCap !== null ? `, feed-in held to ${Math.round(battery.feedInCap * 100)}%` : ""}
                </span>
              )}
            </>
          ) : (
            "None"
          )}
        </dd>
        {cooling && (
          <>
            <dt>Cooling</dt>
            <dd>
              {cooling === "ground" ? "Through the ground probes" : "Air conditioning"}
              {cooledAreaM2(building, simTimeMs) > 0 && <span className="bp-sub"> · {Math.round(cooledAreaM2(building, simTimeMs))} m²</span>}
            </dd>
          </>
        )}
        {homeCars.cars > 0 && (
          <>
            <dt title="The households' cars, the electric ones among them, and the homes with a wallbox">Cars</dt>
            <dd>
              {homeCars.cars} · {homeCars.electric} electric
              <span className="bp-sub">
                {" "}
                · {homeCars.wallboxes} wallbox{homeCars.wallboxes === 1 ? "" : "es"}
              </span>
            </dd>
          </>
        )}
        {commCategory && (
          <>
            <dt>Business</dt>
            <dd>
              {COMMERCIAL_CATEGORY_ICON[commCategory]} {COMMERCIAL_CATEGORY_LABEL[commCategory]}
              {commFloorAreaM2 ? <span className="bp-sub"> · {Math.round(commFloorAreaM2).toLocaleString("en-GB")} m²</span> : null}
            </dd>
          </>
        )}
        {(building.jobs ?? 0) >= 1 && staffCars >= 0.5 && (
          <>
            <dt title="Staff who come by car, drive an electric one and have an employer with chargers — residents of the town and commuters alike — charge here on working days">Staff charging</dt>
            <dd>~{Math.round(staffCars)} cars on a working day</dd>
          </>
        )}
      </dl>

      <FleetSection building={building} simTimeMs={simTimeMs} />

      {/* This moment. */}
      <div className="bp-now" title="What the building draws from the grid this moment, its own solar and battery taken off (negative: it feeds in)">
        <span className="bp-now-label">Right now</span>
        <span>
          {netW >= 0 ? `drawing ${formatWatts(netW)}` : `feeding in ${formatWatts(-netW)}`}
          {hasSolar && ` · solar ${formatWatts(solarState.generationW)}`}
          {battery && solarState.batteryW !== 0 && ` · battery ${solarState.batteryW > 0 ? "charging" : "supplying"} ${formatWatts(Math.abs(solarState.batteryW))}`}
          {hasSolar && snowCoverCm > 0 && ` · ❄️ ${snowCoverCm.toFixed(0)} cm snow`}
          {solarState.curtailedW > 0 && ` · ${formatWatts(solarState.curtailedW)} held back`}
        </span>
      </div>

      {/* What could change here: the player's own options, and what the owner could do. */}
      {(isPublicBuilding(building) || heatingSystemId || roofContract) && <h3 className="section-heading">What could change here</h3>}
      {isPublicBuilding(building) && (
        <>
          <h4 className="bp-subheading">Municipal building · {publicBuildingKind(building)}</h4>
          <SupervisionNotice />
          <div className="public-orders">
            <PublicBuildingOrders building={building} realPlants={realPlants} now={simTimeMs} onOrdered={() => setOrders((n) => n + 1)} withName={false} />
          </div>
        </>
      )}
      {heatingSystemId && <HeatPumpSiteSection building={building} simTimeMs={simTimeMs} />}
      {roofContract && (
        <>
          <h4 className="bp-subheading">Renting the roof for solar</h4>
          <RoofContractCard building={building} now={simTimeMs} />
        </>
      )}

      {/* Energy and money. */}
      <h3 className="section-heading">Power, last 24 hours</h3>
      <HistoryChart
        times={history.times}
        series={[
          { key: "total", label: "Drawn from the grid", color: "#2a78d6", values: history.totalW },
          ...(hasSolar ? [{ key: "pv", label: "Solar", color: "#eda100", values: history.pvW }] : []),
        ]}
      />
      <details className="bp-more">
        <summary>Energy by use, last 24 hours</summary>
        <EnergyBreakdown energy={history.energy} />
      </details>

      <h3 className="section-heading">Bill</h3>
      <BillSection summary={billSummary} />

      <details className="bp-more">
        <summary>Earlier days, weeks and months</summary>
        <HistoricalEnergySection entityId={building.egid} sampler={(times) => sampleBuildingCategorySeries(building, times, tariff, plants)} tariffKey={tariffKey(tariff)} title={null} />
      </details>

      {pastEvents > 0 && (
        <details className="bp-more">
          <summary>What happened here ({pastEvents})</summary>
          <RenewalLogSection title="Heating" entries={heatingLog} />
          <RenewalLogSection title="Insulation" entries={insulationLog} />
          <RenewalLogSection title="Solar" entries={solarLog} />
        </details>
      )}

      <h3 className="section-heading">Homes ({building.dwellings.length})</h3>
      <ul className="bp-homes">
        {building.dwellings.map((dwelling) => (
          <li key={dwelling.ewid}>
            <button onClick={() => onSelectDwelling(dwelling.ewid)}>
              Home {dwelling.ewid}
              {dwelling.roomCount ? ` — ${dwelling.roomCount} rooms` : ""}
              {dwelling.areaM2 ? `, ${dwelling.areaM2} m²` : ""}
            </button>
          </li>
        ))}
        {building.dwellings.length === 0 && <li className="bp-empty">No homes on record.</li>}
      </ul>
    </div>
  );
}
