import { X } from "lucide-react";
import type { MunicipalityDataset } from "../data/types";
import { useSimSpeed } from "../sim/store";
import { PAUSE_SPEED } from "../sim/timeControls";
import { AdvisorsTab } from "./AdvisorsTab";
import { ChartsTab } from "./ChartsTab";
import type { LetterPick } from "../sim/inbox";
import { DecisionLogTab } from "./DecisionLogTab";
import { MeasuresTab } from "./MeasuresTab";
import { OverviewTab } from "./OverviewTab";
import { TreasuryTab } from "./TreasuryTab";
import { MarketPrices, TariffControl } from "./TariffControl";
import { TechnologyPrices } from "./TechnologyPrices";
import { usePauseWhileOpen } from "./usePauseWhileOpen";
import "./townHall.css";

export type TownHallSection = "overview" | "measures" | "advisors" | "treasury" | "prices" | "charts" | "log";

const SECTIONS: { id: TownHallSection; title: string; blurb: string }[] = [
  { id: "overview", title: "Overview", blurb: "Where the town stands, what the canton and the Confederation have in store, and what was decided lately." },
  { id: "measures", title: "Measures", blurb: "Subsidies, infrastructure, information and laws: what the municipality can enact, and what it has." },
  { id: "advisors", title: "Advisors", blurb: "Consultants you retain for a yearly fee: each reports once a year with what to do next, and you can act on it from here." },
  { id: "treasury", title: "Treasury", blurb: "The department's accounts, year by year, and its borrowing." },
  { id: "prices", title: "Prices", blurb: "What the municipal utility charges, and where technology prices are heading." },
  { id: "charts", title: "Statistics", blurb: "Where the town stands now, and how it has changed since you took office: energy, the grid, the residents and the books, month by month." },
  { id: "log", title: "Decision log", blurb: "Every choice households, owners and businesses made, with the options they weighed." },
];

export interface TownHallProps {
  dataset: MunicipalityDataset;
  /** Transparency mode (start menu): the decision log is open to the player. */
  transparency: boolean;
  section: TownHallSection;
  onSection: (section: TownHallSection) => void;
  onClose: () => void;
  /** Shows an advisor's pick on the map (the Town hall closes). */
  onShowPick: (pick: LetterPick) => void;
}

/** The town hall: everything that isn't on the map — measures, the accounts, prices and the
 * statistics — full screen below the top bar. The simulation pauses while it's open and
 * picks up again at the same speed when it closes (unless the player changed it meanwhile). */
export function TownHall({ dataset, transparency, section, onSection, onClose, onShowPick }: TownHallProps) {
  const sections = SECTIONS.filter((s) => s.id !== "log" || transparency);
  const current = sections.find((s) => s.id === section) ?? sections[0];
  const speed = useSimSpeed();

  usePauseWhileOpen();

  return (
    <div className="town-hall" role="dialog" aria-label="Town hall">
      <header className="th-header">
        <div className="th-heading">
          <span className="th-kicker">Town hall · {dataset.name}</span>
          <span className={`th-paused${speed === PAUSE_SPEED ? "" : " running"}`}>{speed === PAUSE_SPEED ? "Simulation paused" : "Simulation running"}</span>
        </div>
        <nav className="th-tabs" aria-label="Town hall sections">
          {sections.map((s) => (
            <button key={s.id} data-tour={`th-${s.id}`} className={s.id === current.id ? "active" : ""} aria-current={s.id === current.id ? "page" : undefined} onClick={() => onSection(s.id)}>
              {s.title}
            </button>
          ))}
        </nav>
        <button className="th-close" data-tour="th-close" onClick={onClose} aria-label="Close the town hall" title="Back to the map (Esc)">
          <X size={18} strokeWidth={1.75} aria-hidden />
        </button>
      </header>
      <div className="th-body">
        <div className={`th-page th-page-${current.id}`}>
          <div className="th-page-head">
            <h1>{current.title}</h1>
            <p>{current.blurb}</p>
          </div>
          {current.id === "prices" && (
            <div className="prices-columns">
              <TariffControl />
              <div className="prices-context">
                <MarketPrices />
                <div className="tariff-divider" />
                <TechnologyPrices />
              </div>
            </div>
          )}
          {current.id === "overview" && <OverviewTab dataset={dataset} onOpen={onSection} />}
          {current.id === "measures" && <MeasuresTab />}
          {current.id === "advisors" && <AdvisorsTab onShowOnMap={onShowPick} onOpenPrices={() => onSection("prices")} />}
          {current.id === "treasury" && <TreasuryTab dataset={dataset} />}
          {/* Only while Statistics is open does At a glance resolve the solar plants: effectivePowerPlantsAt
              locks in that year's solar adoptions under the policy of the moment (solarAdoption.ts), so
              merely opening the town hall must never trigger it. */}
          {current.id === "charts" && <ChartsTab dataset={dataset} />}
          {current.id === "log" && <DecisionLogTab dataset={dataset} />}
        </div>
      </div>
    </div>
  );
}
