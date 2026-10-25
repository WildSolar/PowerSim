import type { Building, Dwelling, PowerPlant } from "../data/types";
import { chargingTariff } from "../sim/chargingTariff";
import { dynamicTariff } from "../sim/dynamicTariff";
import { dwellingDevicePowerW } from "../sim/devices";
import { categoryEnergyFromSeries } from "../sim/energy";
import { currentHeatingSystemId } from "../sim/heatingRenewal";
import { HEATING_SYSTEM_CATALOG } from "../sim/heatingSystems";
import { mobilityChargingPowerW, mobilityRenewalLog, mobilitySlotSummaries, evSessionForSlot, slotCharging, type MobilitySlotSummary, type SlotCharging } from "../sim/mobility";
import { isOffPeakHour, tariffKey, type Tariff } from "../sim/tariff";
import { historyTimeSteps, sampleDwellingCategorySeries, HISTORY_WINDOW_MS, HISTORY_SAMPLE_COUNT, HISTORY_REFRESH_MS } from "../sim/history";
import { useLiveSimTime, useTariff } from "../sim/store";
import { transit } from "../sim/transit";
import type { TransitClass } from "../config/mobility";
import { simClock } from "../sim/engine";
import { BillSection } from "./BillSection";
import { DEVICE_CATEGORIES } from "./deviceCategories";
import { EnergyBreakdown } from "./EnergyBreakdown";
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

/** "Electric car", "Standard bike", "Public transport": how one member of the household gets around. */
function slotLabel(slot: MobilitySlotSummary): string {
  return slot.vehicleLabel ? `${slot.vehicleIcon ?? slot.modeIcon} ${slot.vehicleLabel}` : `${slot.modeIcon} ${slot.modeLabel}`;
}

/** Where a car charges, or could, in a sentence: at home (and tonight's session), in public (where),
 * or — for a petrol or diesel car — how an electric one would. */
function chargingText(
  charging: SlotCharging,
  session: { plugsIn: boolean; startMs: number; endMs: number } | null,
  meter: "controlled" | "night" | null,
  onDynamic: boolean,
  tariff: Tariff,
): string {
  if (charging.kind === "public") return `Charges ${charging.sources.map((s) => `${s.name.startsWith("at ") ? s.name : `at ${s.name}`} (${percentOf(s.share)})`).join(", ")}.`;
  if (charging.kind === "home") {
    if (!session) return "Charges at home.";
    if (!session.plugsIn) return "Charges at home — not tonight: it plugs in two or three nights a week.";
    const startHour = (((session.startMs % DAY_MS) + DAY_MS) % DAY_MS) / 3_600_000;
    const byDay = startHour > 6 && startHour < 18;
    const why =
      meter === "controlled"
        ? byDay
          ? "the town's solar hours"
          : "when the utility chooses"
        : meter === "night"
          ? "night rate"
          : onDynamic
            ? "the cheapest hours"
            : isOffPeakHour(tariff, startHour)
              ? "off-peak"
              : "peak";
    return `Charges at home — ${byDay ? "today" : "tonight"} ${formatHourOfDay(session.startMs)}–${formatHourOfDay(session.endMs)} (${why}).`;
  }
  const home = charging.hasWallbox
    ? "Has a wallbox."
    : charging.wallboxRp !== null
      ? `Could put in a wallbox for ${formatCHF(Math.round(charging.wallboxRp / 10_000) * 10_000)}.`
      : "No wallbox possible.";
  const where = charging.sources.map((s) => (s.name === "at work" ? "at work" : `${s.name}, ${s.distanceM >= 1000 ? `${(s.distanceM / 1000).toFixed(1)} km` : `${Math.round(s.distanceM / 10) * 10} m`}`));
  const choice =
    charging.prefers === "home" ? "An electric car would charge at home." : charging.prefers === "public" ? "An electric car would charge in public." : "No way to charge an electric car.";
  return `${home} Public charging here: ${percentOf(charging.qos)}${charging.usable ? "" : " (too little to rely on)"}${where.length > 0 ? ` — ${where.join("; ")}` : ""}. ${choice}`;
}

const COULD_TITLE =
  "With an electric car, a household charges where it costs it less a year: at home (the electricity, and a wallbox if it has none yet, spread over its life) or at public chargers and at work (their price, and the hassle — the better the charging, the less). Public charging below 10% can't be relied on.";

/** The card for a home in a building: what it is, how its household lives — getting around, how its
 * car charges, its tariff, the building's heating — what it uses this moment, its bill and its last
 * 24 hours, and the rest folded away. */
export function DwellingPanel({ building, dwelling, allBuildings, realPlants, onBack, onClose }: DwellingPanelProps) {
  const simTimeMs = useLiveSimTime();
  const tariff = useTariff();
  const plants = useLivePowerPlants(allBuildings, realPlants, simTimeMs);
  const billSummary = useDwellingBillSummary(building, dwelling, plants, tariff);
  const devices = dwellingDevicePowerW(building.egid, dwelling, simTimeMs);
  const carW = mobilityChargingPowerW(building.egid, dwelling, simTimeMs, tariff);
  const usingW = devices.fridgeW + devices.lightingW + devices.cookingW + devices.laundryW + devices.plugLoadW + carW;

  const slots = mobilitySlotSummaries(building.egid, dwelling, simTimeMs);
  const mobilityLog = mobilityRenewalLog(building.egid, dwelling, simTimeMs);
  const dayIndex = Math.floor(simTimeMs / DAY_MS);
  const hasCarEV = slots.some((s) => s.vehicleType === "carEV");
  const onDynamic = dynamicTariff.onDynamicDwelling(building.egid, dwelling.ewid, simTimeMs);
  const meter = chargingTariff.meterAt(building.egid, dwelling.ewid, simTimeMs);
  const heatingId = currentHeatingSystemId(building, simTimeMs);

  const history = useHistorySeries(
    () => {
      const times = historyTimeSteps(simClock.getSimTimeMs(), HISTORY_WINDOW_MS, HISTORY_SAMPLE_COUNT);
      const series = sampleDwellingCategorySeries(building, dwelling, times, tariff);
      return {
        times,
        everydayW: times.map((_, i) => series.fridgeW[i] + series.lightingW[i] + series.plugLoadW[i]),
        kitchenW: times.map((_, i) => series.cookingW[i] + series.laundryW[i]),
        evW: series.evW,
        energy: categoryEnergyFromSeries(times, series),
      };
    },
    HISTORY_REFRESH_MS,
    `${building.egid}:${dwelling.ewid}:${tariffKey(tariff)}`,
  );

  // Each car's charging, or how it would charge if electric — a line said once however many cars share it.
  const carNotes: { key: string; label: string; text: string; could: boolean }[] = [];
  for (const s of slots) {
    if (s.mode !== "car") continue;
    const charging = slotCharging(building, dwelling, s.slotIndex, simTimeMs);
    if (!charging) continue;
    const session = s.vehicleType === "carEV" && charging.kind === "home" ? evSessionForSlot(building.egid, dwelling, s.slotIndex, dayIndex, tariff) : null;
    const label = s.vehicleType === "carEV" ? "Charging" : "If it went electric";
    const text = chargingText(charging, session, meter, onDynamic, tariff);
    if (!carNotes.some((n) => n.label === label && n.text === text)) carNotes.push({ key: `c${s.slotIndex}`, label, text, could: charging.kind === "could" });
  }

  const tariffLabel = [onDynamic ? "Dynamic tariff" : "Time-of-use tariff", meter ? `charging meter (${meter === "controlled" ? "utility-controlled" : "night rate only"}, ${tariff.chargingPriceRpKWh.toFixed(1)} Rp/kWh)` : null]
    .filter(Boolean)
    .join(" + ");

  return (
    <div className="panel">
      <button className="panel-close" onClick={onClose} aria-label="Close">
        ×
      </button>
      <button className="back-link" onClick={onBack}>
        ← {building.address ?? `Building ${building.egid}`}
      </button>
      <h2>Home {dwelling.ewid}</h2>
      <p className="bp-kind">
        {[dwelling.roomCount ? `${dwelling.roomCount} room${dwelling.roomCount === 1 ? "" : "s"}` : null, dwelling.areaM2 ? `${dwelling.areaM2} m²` : null].filter(Boolean).join(" · ") || "Size not on record"}
      </p>

      {/* How the household lives. */}
      <dl className="bp-facts">
        <dt title="How each member of the household with a way of getting around does: by car, bike, public transport or on foot">Getting around</dt>
        <dd>{slots.length > 0 ? slots.map((s) => <div key={s.slotIndex}>{slotLabel(s)}</div>) : "—"}</dd>
        {carNotes.map((n) => (
          <div key={n.key} className="bp-fact-pair">
            <dt title={n.could ? COULD_TITLE : undefined}>{n.label}</dt>
            <dd>{n.text}</dd>
          </div>
        ))}
        <dt
          title="The federal public transport quality class of where the building stands (ÖV-Güteklassen): how near the next stop is, and how often it's served. The better served, the likelier a household gets about by public transport."
        >
          Public transport
        </dt>
        <dd>{TRANSIT_CLASS_LABEL[transit.classOf(building)]}</dd>
        <dt>Tariff</dt>
        <dd>
          {tariffLabel}
          {onDynamic && <span className="bp-sub"> · {hasCarEV ? "its car charges, and some laundry runs," : "some laundry runs"} when power is cheapest</span>}
        </dd>
        <dt>Heating</dt>
        <dd>{heatingId ? `${HEATING_SYSTEM_CATALOG[heatingId].icon} ${HEATING_SYSTEM_CATALOG[heatingId].label}` : (building.heatingGenerator ?? "Unknown")}<span className="bp-sub"> · the building&apos;s</span></dd>
      </dl>

      <div className="bp-now" title="What the household's appliances and car draw this moment">
        <span className="bp-now-label">Right now</span>
        <span>
          using {formatWatts(usingW)}
          {carW > 0 && ` · car charging ${formatWatts(carW)}`}
        </span>
      </div>

      <h3 className="section-heading">Bill</h3>
      <BillSection summary={billSummary} />

      <h3 className="section-heading">Power, last 24 hours</h3>
      <HistoryChart
        times={history.times}
        series={[
          { key: "everyday", label: "Fridge, lighting and plugs", color: colorOf("plugLoad"), values: history.everydayW },
          { key: "kitchen", label: "Cooking and laundry", color: colorOf("cooking"), values: history.kitchenW },
          ...(hasCarEV ? [{ key: "ev", label: "Car charging", color: colorOf("ev"), values: history.evW }] : []),
        ]}
      />
      <details className="bp-more">
        <summary>Energy by use, last 24 hours</summary>
        <EnergyBreakdown energy={history.energy} />
      </details>
      <details className="bp-more">
        <summary>Earlier days, weeks and months</summary>
        <HistoricalEnergySection
          entityId={`${building.egid}:${dwelling.ewid}`}
          sampler={(times) => sampleDwellingCategorySeries(building, dwelling, times, tariff)}
          tariffKey={tariffKey(tariff)}
          title={null}
        />
      </details>
      {mobilityLog.length > 0 && (
        <details className="bp-more">
          <summary>What happened here ({mobilityLog.length})</summary>
          <RenewalLogSection title="Getting around" entries={mobilityLog} />
        </details>
      )}
    </div>
  );
}
