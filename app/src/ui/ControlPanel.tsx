import { useState } from "react";
import type { MunicipalityDataset } from "../data/types";
import { sampleMunicipalityCategorySeries } from "../sim/history";
import { useTariff } from "../sim/store";
import { tariffKey } from "../sim/tariff";
import { CityStatsTab } from "./CityStatsTab";
import { HistoricalEnergySection } from "./HistoricalEnergySection";
import { TariffControl } from "./TariffControl";
import "./modal.css";

export interface ControlPanelProps {
  dataset: MunicipalityDataset;
  onClose: () => void;
}

type ControlTab = "prices" | "policy" | "stats" | "history";

const TABS: { id: ControlTab; icon: string; title: string }[] = [
  { id: "prices", icon: "💰", title: "Prices" },
  { id: "policy", icon: "📜", title: "Policy" },
  { id: "stats", icon: "📊", title: "City stats" },
  { id: "history", icon: "📈", title: "History" },
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
              <TariffControl />
            </>
          )}
          {tab === "policy" && (
            <>
              <h2>📜 Policy</h2>
              <p>
                Subsidies, regulations, and bans aren't implemented yet — this tab is reserved for the long-term policy layer
                described in the game's design: levers that shift how the building stock adopts heat pumps, solar, EVs and
                the like over time, funded from their own budget rather than the tariff's.
              </p>
            </>
          )}
          {tab === "stats" && <CityStatsTab dataset={dataset} />}
          {tab === "history" && (
            <HistoricalEnergySection
              entityId="municipality"
              sampler={(times) => sampleMunicipalityCategorySeries(dataset.buildings, times, tariff, dataset.powerPlants)}
              tariffKey={tariffKey(tariff)}
            />
          )}
        </div>
      </div>
    </div>
  );
}
