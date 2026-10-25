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

export interface TownHallStripProps {
  /** The page open, or null: the map. */
  section: TownHallSection | null;
  /** Transparency mode (start menu): the decision log is open to the player. */
  transparency: boolean;
  /** Opens a page; null goes back to the map. */
  onSection: (section: TownHallSection | null) => void;
}

/** The Town hall's pages, always in a row under the top bar: a click opens one (the simulation pauses
 * while it's open); the open one clicked again, the ✕ or Esc goes back to the map. */
export function TownHallStrip({ section, transparency, onSection }: TownHallStripProps) {
  const sections = SECTIONS.filter((s) => s.id !== "log" || transparency);
  const speed = useSimSpeed();
  return (
    <nav className={`th-strip${section ? " open" : ""}`} aria-label="Town hall">
      <span className="th-strip-label">Town hall</span>
      <div className="th-tabs" data-tour="townhall">
        {sections.map((s) => (
          <button
            key={s.id}
            data-tour={`th-${s.id}`}
            className={s.id === section ? "active" : ""}
            aria-current={s.id === section ? "page" : undefined}
            title={s.id === section ? "Back to the map (Esc)" : s.blurb}
            onClick={() => onSection(s.id === section ? null : s.id)}
          >
            {s.title}
          </button>
        ))}
      </div>
      {section && (
        <>
          <span className={`th-paused${speed === PAUSE_SPEED ? "" : " running"}`}>{speed === PAUSE_SPEED ? "Simulation paused" : "Simulation running"}</span>
          <button className="th-close" data-tour="th-close" onClick={() => onSection(null)} aria-label="Back to the map" title="Back to the map (Esc)">
            <X size={18} strokeWidth={1.75} aria-hidden />
          </button>
        </>
      )}
    </nav>
  );
}

export interface TownHallProps {
  dataset: MunicipalityDataset;
  /** Transparency mode (start menu): the decision log is open to the player. */
  transparency: boolean;
  section: TownHallSection;
  onSection: (section: TownHallSection) => void;
  /** Shows an advisor's pick on the map (the Town hall closes). */
  onShowPick: (pick: LetterPick) => void;
}

/** The town hall: everything that isn't on the map — measures, the accounts, prices and the
 * statistics — full screen below its row of pages (TownHallStrip). The simulation pauses while it's open and
 * picks up again at the same speed when it closes (unless the player changed it meanwhile). */
export function TownHall({ dataset, transparency, section, onSection, onShowPick }: TownHallProps) {
  const sections = SECTIONS.filter((s) => s.id !== "log" || transparency);
  const current = sections.find((s) => s.id === section) ?? sections[0];

  usePauseWhileOpen();

  return (
    <div className="town-hall" role="dialog" aria-label={`Town hall: ${current.title}`}>
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
