import { useState } from "react";
import type { MunicipalityDataset } from "../data/types";
import { sampleMunicipalityCategorySeries } from "../sim/history";
import { effectivePowerPlantsAt } from "../sim/solarAdoption";
import { useSimDay, useTariff } from "../sim/store";
import { tariffKey } from "../sim/tariff";
import { CityStatsTab } from "./CityStatsTab";
import { DecisionLogTab } from "./DecisionLogTab";
import { HistoricalEnergySection } from "./HistoricalEnergySection";
import { MeasuresTab } from "./MeasuresTab";
import { TariffControl } from "./TariffControl";
import { TechnologyPrices } from "./TechnologyPrices";
import "./modal.css";

export interface ControlPanelProps {
  dataset: MunicipalityDataset;
  onClose: () => void;
}

type ControlTab = "prices" | "measures" | "stats" | "history" | "debug";

const TABS: { id: ControlTab; icon: string; title: string }[] = [
  { id: "prices", icon: "💰", title: "Prices" },
  { id: "measures", icon: "🏛️", title: "Measures" },
  { id: "stats", icon: "📊", title: "City stats" },
  { id: "history", icon: "📈", title: "History" },
  { id: "debug", icon: "🐛", title: "Debug" },
];

/** The central "run the municipality" panel — a Wiki-style modal (no need to
 * see the map while adjusting prices or reading city stats) with a tab per
 * concern, rather than a growing pile of floating corner boxes. Prices used to
 * be a permanently-visible box that had started overlapping the building/
 * dwelling panel as it grew; City stats and History used to be
 * MunicipalityPanel, which this replaces outright. */
export function ControlPanel({ dataset, onClose }: ControlPanelProps) {
  const [tab, setTab] = useState<ControlTab>("prices");
  const tariff = useTariff();
  const currentDay = useSimDay();
  // Only resolved for the History tab, and only while it's actually open —
  // effectivePowerPlantsAt locks in that year's solar adoptions (once, the
  // first time it's ever queried) using whatever policy is set *right then*
  // (solarAdoption.ts's own retroactive-but-frozen rule), so merely opening
  // Control (defaulting to the Prices tab) must never trigger it ahead of
  // the player ever reaching the Measures tab.
  const plants = tab === "history" ? effectivePowerPlantsAt(dataset.buildings, dataset.powerPlants, currentDay) : dataset.powerPlants;

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal-shell" onClick={(e) => e.stopPropagation()}>
        <button className="modal-close" onClick={onClose} aria-label="Close">
          ×
        </button>
        <nav className="modal-nav">
          <h2>{dataset.name}</h2>
          <ul>
            {TABS.map((t) => (
              <li key={t.id}>
                <button className={t.id === tab ? "active" : ""} onClick={() => setTab(t.id)}>
                  <span className="modal-nav-icon">{t.icon}</span>
                  {t.title}
                </button>
              </li>
            ))}
          </ul>
        </nav>
        <div className="modal-content">
          {tab === "prices" && (
            <>
              <h2>💰 Prices</h2>
              <div className="prices-columns">
                <TariffControl />
                <TechnologyPrices />
              </div>
            </>
          )}
          {tab === "measures" && <MeasuresTab />}
          {tab === "stats" && <CityStatsTab dataset={dataset} />}
          {tab === "history" && (
            <HistoricalEnergySection
              entityId="municipality"
              sampler={(times) => sampleMunicipalityCategorySeries(dataset.buildings, times, tariff, plants)}
              tariffKey={`${tariffKey(tariff)}:${currentDay}`}
            />
          )}
          {tab === "debug" && <DecisionLogTab dataset={dataset} />}
        </div>
      </div>
    </div>
  );
}
