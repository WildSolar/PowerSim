import type { Building, Dwelling, PowerPlant } from "../data/types";
import { dynamicTariff } from "../sim/dynamicTariff";
import { dwellingDevicePowerW } from "../sim/devices";
import { mobilityChargingPowerW, mobilityRenewalLog, mobilitySlotSummaries, evSessionForSlot, slotCharging, slotChargingPowerW, type SlotCharging } from "../sim/mobility";
import { isOffPeakHour, tariffKey } from "../sim/tariff";
import {
  historyTimeSteps,
  sampleDwellingCategorySeries,
  sampleDwellingSeries,
  HISTORY_WINDOW_MS,
  HISTORY_SAMPLE_COUNT,
  HISTORY_REFRESH_MS,
} from "../sim/history";
import { useLiveSimTime, useTariff } from "../sim/store";
import { transit } from "../sim/transit";
import type { TransitClass } from "../config/mobility";
import { simClock } from "../sim/engine";
import { BillSection } from "./BillSection";
import { DEVICE_CATEGORIES } from "./deviceCategories";
import { HistoricalEnergySection } from "./HistoricalEnergySection";
import { HistoryChart } from "./HistoryChart";
import { RenewalLogSection } from "./RenewalLogSection";
import { useDwellingBillSummary } from "./useBillSummary";
import { useHistorySeries } from "./useHistorySeries";
import { useLivePowerPlants } from "./useLivePowerPlants";
import { formatCHF, formatWatts } from "./format";
import "./panels.css";

const colorOf = (key: (typeof DEVICE_CATEGORIES)[number]["key"]) => DEVICE_CATEGORIES.find((c) => c.key === key)!.color;

export interface DwellingPanelProps {
  building: Building;
  dwelling: Dwelling;
  allBuildings: Building[];
  realPlants: PowerPlant[];
  onBack: () => void;
  onClose: () => void;
}

const DAY_MS = 24 * 60 * 60_000;

const TRANSIT_CLASS_LABEL: Record<TransitClass, string> = {
  A: "very good (class A)",
  B: "good (class B)",
  C: "fair (class C)",
  D: "basic (class D)",
  none: "next to none",
};

function formatHourOfDay(ms: number): string {
  const h = (((ms % DAY_MS) + DAY_MS) % DAY_MS) / 3_600_000;
  const hh = Math.floor(h);
  const mm = Math.round((h - hh) * 60);
  return `${String(hh).padStart(2, "0")}:${String(mm).padStart(2, "0")}`;
}

function percentOf(share: number): string {
  return `${Math.round(share * 100)}%`;
}

/** A slot's charging, in a line: where its electric car charges in public, or how it could charge
 * one (nothing to say for one charging at home). */
function ChargingNote({ charging }: { charging: SlotCharging }) {
  if (charging.kind === "home") return null;
  if (charging.kind === "public")
    return <div className="ev-session-note">Charges {charging.sources.map((s) => `${s.name.startsWith("at ") ? s.name : `at ${s.name}`} (${percentOf(s.share)})`).join(", ")}.</div>;
  const where = charging.sources.map((s) => (s.name === "at work" ? "at work" : `${s.name}, ${s.distanceM >= 1000 ? `${(s.distanceM / 1000).toFixed(1)} km` : `${Math.round(s.distanceM / 10) * 10} m`}`));
  const home = charging.hasWallbox
    ? "Has a wallbox."
    : charging.wallboxRp !== null
      ? `Could put in a wallbox for ${formatCHF(Math.round(charging.wallboxRp / 10_000) * 10_000)}.`
      : "No wallbox possible.";
  const choice =
    charging.prefers === "home" ? "An electric car would charge at home." : charging.prefers === "public" ? "An electric car would charge in public." : "No way to charge an electric car.";
  return (
    <div
      className="ev-session-note"
      title="With an electric car, a household charges where it costs it less a year: at home (the electricity, and a wallbox if it has none yet, spread over its life) or at public chargers and at work (their price, and the hassle — the better the charging, the less). Public charging below 10% can't be relied on."
    >
      {home} Public charging here: {percentOf(charging.qos)}
      {charging.usable ? "" : " (too little to rely on)"}
      {where.length > 0 ? ` — ${where.join("; ")}` : ""}. {choice}
    </div>
  );
}

export function DwellingPanel({ building, dwelling, allBuildings, realPlants, onBack, onClose }: DwellingPanelProps) {
  const simTimeMs = useLiveSimTime();
  const tariff = useTariff();
  const plants = useLivePowerPlants(allBuildings, realPlants, simTimeMs);
  const billSummary = useDwellingBillSummary(building, dwelling, plants, tariff);
  const { fridgeW, lightingW, cookingW, laundryW, plugLoadW } = dwellingDevicePowerW(building.egid, dwelling, simTimeMs);
  const evW = mobilityChargingPowerW(building.egid, dwelling, simTimeMs, tariff);
  const totalW = fridgeW + lightingW + cookingW + laundryW + plugLoadW + evW;

  const mobilitySlots = mobilitySlotSummaries(building.egid, dwelling, simTimeMs);
  const mobilityLog = mobilityRenewalLog(building.egid, dwelling, simTimeMs);
  const dayIndex = Math.floor(simTimeMs / DAY_MS);
  const hasCarEV = mobilitySlots.some((s) => s.vehicleType === "carEV");
  const onDynamic = dynamicTariff.onDynamicDwelling(building.egid, dwelling.ewid, simTimeMs);

  const history = useHistorySeries(
    () => {
      const times = historyTimeSteps(simClock.getSimTimeMs(), HISTORY_WINDOW_MS, HISTORY_SAMPLE_COUNT);
      return { times, ...sampleDwellingSeries(building, dwelling, times, tariff) };
    },
    HISTORY_REFRESH_MS,
    `${building.egid}:${dwelling.ewid}:${tariffKey(tariff)}`,
  );

  return (
    <div className="panel">
      <button className="panel-close" onClick={onClose} aria-label="Close">
        ×
      </button>
      <button className="back-link" onClick={onBack}>
        ← {building.address ?? `Building ${building.egid}`}
      </button>
      <h2>Dwelling {dwelling.ewid}</h2>
      <dl>
        <dt>Rooms</dt>
        <dd>{dwelling.roomCount ?? "Unknown"}</dd>
        <dt>Area</dt>
        <dd>{dwelling.areaM2 ? `${dwelling.areaM2} m²` : "Unknown"}</dd>
      </dl>

      <h3 className="section-heading">Devices</h3>
      <div className="device-row">
        <span className="device-name">🧊 Fridge</span>
        <span className={`device-watts${fridgeW === 0 ? " off" : ""}`}>{formatWatts(fridgeW)}</span>
      </div>
      <div className="device-row">
        <span className="device-name">💡 Lighting</span>
        <span className={`device-watts${lightingW === 0 ? " off" : ""}`}>{formatWatts(lightingW)}</span>
      </div>
      <div className="device-row">
        <span className="device-name">🔌 Other plug loads</span>
        <span className={`device-watts${plugLoadW === 0 ? " off" : ""}`}>{formatWatts(plugLoadW)}</span>
      </div>
      <div className="device-row">
        <span className="device-name">🍳 Cooking</span>
        <span className={`device-watts${cookingW === 0 ? " off" : ""}`}>{formatWatts(cookingW)}</span>
      </div>
      <div className="device-row">
        <span className="device-name">🧺 Washer/dryer</span>
        <span className={`device-watts${laundryW === 0 ? " off" : ""}`}>{formatWatts(laundryW)}</span>
      </div>
      <div className="total-row">
        <span>Total</span>
        <span>{formatWatts(totalW)}</span>
      </div>

      <h3 className="section-heading">Mobility</h3>
      <div
        className="ev-session-note"
        title="The federal public transport quality class of where the building stands (ÖV-Güteklassen): how near the next stop is, and how often it's served. The better served, the likelier a household gets about by public transport."
      >
        Public transport here: {TRANSIT_CLASS_LABEL[transit.classOf(building)]}.
      </div>
      {mobilitySlots.map((slot) => {
        const charging = slotCharging(building, dwelling, slot.slotIndex, simTimeMs);
        const isCarEV = slot.vehicleType === "carEV";
        const atHome = isCarEV && charging?.kind !== "public";
        const slotW = atHome ? slotChargingPowerW(building.egid, dwelling, slot.slotIndex, slot.mode, slot.vehicleType, simTimeMs, tariff) : 0;
        const session = atHome ? evSessionForSlot(building.egid, dwelling, slot.slotIndex, dayIndex, tariff) : null;
        const sessionStartsOffPeak =
          session && isOffPeakHour(tariff, ((((session.startMs % DAY_MS) + DAY_MS) % DAY_MS) / 3_600_000));
        return (
          <div key={slot.slotIndex}>
            <div className="device-row">
              <span className="device-name">
                {slot.modeIcon} {slot.modeLabel}
                {slot.vehicleLabel && (
                  <span className="ev-badge">
                    {slot.vehicleIcon} {slot.vehicleLabel}
                  </span>
                )}
              </span>
              {atHome ? (
                <span className={`device-watts${slotW === 0 ? " off" : ""}`}>{formatWatts(slotW)}</span>
              ) : (
                <span className="device-status">{isCarEV ? "Charges away" : "No charging"}</span>
              )}
            </div>
            {charging && <ChargingNote charging={charging} />}
            {session && (
              <div className="ev-session-note">
                Tonight: {formatHourOfDay(session.startMs)}–{formatHourOfDay(session.endMs)}
                {onDynamic ? " (the cheapest hours)" : sessionStartsOffPeak ? " (off-peak)" : " (peak)"}
              </div>
            )}
          </div>
        );
      })}
      <RenewalLogSection title="Mobility history" entries={mobilityLog} />

      <h3 className="section-heading">Bill</h3>
      {onDynamic && (
        <div className="ev-session-note">
          On the dynamic tariff this year: {hasCarEV ? "its car charges, and some of its laundry runs," : "some of its laundry runs"} when power is cheapest.
        </div>
      )}
      <BillSection summary={billSummary} />

      <h3 className="section-heading">Power — last 24h</h3>
      <HistoryChart
        times={history.times}
        series={[
          { key: "fridge", label: "Fridge", color: colorOf("fridge"), values: history.fridgeW },
          { key: "lighting", label: "Lighting", color: colorOf("lighting"), values: history.lightingW },
          { key: "plugLoad", label: "Other plug loads", color: colorOf("plugLoad"), values: history.plugLoadW },
        ]}
      />

      <h3 className="section-heading">Appliances — last 24h</h3>
      <HistoryChart
        times={history.times}
        series={[
          { key: "cooking", label: "Cooking", color: colorOf("cooking"), values: history.cookingW },
          { key: "laundry", label: "Washer/dryer", color: colorOf("laundry"), values: history.laundryW },
        ]}
      />

      {hasCarEV && (
        <>
          <h3 className="section-heading">EV charging — last 24h</h3>
          <HistoryChart times={history.times} series={[{ key: "ev", label: "EV", color: colorOf("ev"), values: history.evW }]} />
        </>
      )}

      <HistoricalEnergySection
        entityId={`${building.egid}:${dwelling.ewid}`}
        sampler={(times) => sampleDwellingCategorySeries(building, dwelling, times, tariff)}
        tariffKey={tariffKey(tariff)}
      />
    </div>
  );
}
