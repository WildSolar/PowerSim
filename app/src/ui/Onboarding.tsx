import { Check, ChevronDown, ChevronUp, X } from "lucide-react";
import { useEffect, useRef, useSyncExternalStore } from "react";
import { ELECTION_FIRST_YEAR, ELECTION_INTERVAL_YEARS } from "../config/approval";
import { BASELINE_YEAR, toDateMs } from "../sim/calendar";
import { MEASURE_CATALOG } from "../sim/measureCatalog";
import { measures } from "../sim/measures";
import { NET_ZERO_TARGET_YEAR } from "../sim/score";
import { useSimDay, useTariff } from "../sim/store";
import { tariffStore } from "../sim/tariffStore";
import { usePauseWhileOpen } from "./usePauseWhileOpen";
import "./onboarding.css";

// --- what the guide remembers (this browser only: a convenience, not part of the game) ---

const STORAGE_KEY = "cz-guide-v1";

export type GuideStep = "building" | "heating" | "measure" | "tariff" | "year";

interface GuideState {
  hidden: boolean;
  collapsed: boolean;
  seen: GuideStep[];
}

const DEFAULT_STATE: GuideState = { hidden: false, collapsed: false, seen: [] };
let state: GuideState = load();
const listeners = new Set<() => void>();

function load(): GuideState {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? { ...DEFAULT_STATE, ...(JSON.parse(raw) as Partial<GuideState>) } : DEFAULT_STATE;
  } catch {
    return DEFAULT_STATE;
  }
}

function update(patch: Partial<GuideState>): void {
  state = { ...state, ...patch };
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  } catch {
    // Private mode or blocked storage: the guide just won't be remembered.
  }
  listeners.forEach((l) => l());
}

export const guide = {
  /** A new game: the steps start over, and the guide shows unless skipped. */
  start(): void {
    update({ hidden: false, collapsed: false, seen: [] });
  },
  hide(): void {
    update({ hidden: true });
  },
  show(): void {
    update({ hidden: false, collapsed: false });
  },
  /** Marks a step the player has done (for the steps the game itself can't tell). */
  saw(step: GuideStep): void {
    if (!state.seen.includes(step)) update({ seen: [...state.seen, step] });
  },
  get(): GuideState {
    return state;
  },
  subscribe(listener: () => void): () => void {
    listeners.add(listener);
    return () => listeners.delete(listener);
  },
};

export function useGuide(): GuideState {
  return useSyncExternalStore(guide.subscribe, guide.get);
}

// --- the briefing at the start of a game ---

/** The job in a few lines, before the clock starts: the goal, how it's scored, how it ends. The
 * game is paused while it's open. */
export function WelcomeBriefing({ town, onStart, onSkipGuide }: { town: string; onStart: () => void; onSkipGuide: () => void }) {
  usePauseWhileOpen();
  // Ready for Enter, without scrolling a tall briefing (a phone) down to the button.
  const startRef = useRef<HTMLButtonElement>(null);
  useEffect(() => startRef.current?.focus({ preventScroll: true }), []);
  return (
    <div className="ob-layer">
      <div className="ob-scrim" />
      <div className="ob-dialog" role="dialog" aria-labelledby="ob-title">
        <div className="ob-kicker">Your new job · {BASELINE_YEAR}</div>
        <h1 id="ob-title">{town} has to reach net zero by {NET_ZERO_TARGET_YEAR}</h1>
        <p className="ob-lead">
          You run the energy department of {town}. Its buildings burn oil and gas, its cars run on petrol, and its grid was built for another age. By{" "}
          {NET_ZERO_TARGET_YEAR}, the town's emissions have to be down to net zero.
        </p>
        <dl className="ob-points">
          <div>
            <dt>The goal</dt>
            <dd>
              Net zero by {NET_ZERO_TARGET_YEAR} wins. Every year from {BASELINE_YEAR + 1} also scores for how far emissions per resident have fallen since{" "}
              {BASELINE_YEAR} — shown against what doing nothing would score.
            </dd>
          </div>
          <div>
            <dt>Staying in office</dt>
            <dd>
              Every {ELECTION_INTERVAL_YEARS} years, from {ELECTION_FIRST_YEAR}, there is an election: below 50% approval and you're out. Spend far beyond
              what the department takes in, or push through what people hate, and approval falls.
            </dd>
          </div>
          <div>
            <dt>What you control</dt>
            <dd>
              Grants, laws and programmes in the Town hall; district heating, chargers, the grid and zoning on the map; the utility's prices. People decide
              for themselves — you change what they find worth doing.
            </dd>
          </div>
          <div>
            <dt>Start early</dt>
            <dd>Most people only replace a boiler or a car when it wears out — every 15 to 20 years. What you do this year shows in the 2030s.</dd>
          </div>
        </dl>
        <div className="ob-actions">
          <button className="ob-primary" onClick={onStart} ref={startRef}>
            Show me around
          </button>
          <button className="ob-secondary" onClick={onSkipGuide}>
            I know the game
          </button>
          <span className="ob-note">The game is paused. The Wiki (top right) explains everything in detail.</span>
        </div>
      </div>
    </div>
  );
}

// --- the checklist ---

interface StepDef {
  id: GuideStep;
  title: string;
  hint: string;
  action: string;
}

const STEPS: StepDef[] = [
  { id: "building", title: "Look at a building", hint: "Click any building on the map: its homes, how it's heated, what it uses and pays.", action: "Show one" },
  { id: "heating", title: "See how the town heats", hint: "The views on the left colour the map — Heating shows every oil and gas boiler still to go.", action: "Open Heating" },
  { id: "measure", title: "Enact a first measure", hint: "The Town hall holds grants, laws and programmes. Each shows its cost and how people will take it.", action: "Open measures" },
  { id: "tariff", title: "Set next year's tariff", hint: "The utility publishes its prices once a year. People judge them against the Swiss average.", action: "Open prices" },
  { id: "year", title: "Let a year go by", hint: "Press Space or a speed (1, 2, 3). In January the Year in Review shows how the town did.", action: "Play" },
];

/** What the game itself can tell is done. */
function doneByGame(id: GuideStep, nowMs: number): boolean {
  if (id === "measure") return MEASURE_CATALOG.some((def) => measures.getState(def.id));
  if (id === "tariff") {
    const year = new Date(toDateMs(nowMs)).getUTCFullYear();
    return [year, year + 1, year + 2].some((y) => y > BASELINE_YEAR && tariffStore.isPublished(y));
  }
  if (id === "year") return new Date(toDateMs(nowMs)).getUTCFullYear() > BASELINE_YEAR;
  return false;
}

/** The getting-started checklist: a handful of first steps, each ticked off as it's done, each
 * with a way to get there. Collapses to a pill; hidden for good from its close button. */
export function GuideCard({ besidePanel, onAction }: { besidePanel: boolean; onAction: (step: GuideStep) => void }) {
  const s = useGuide();
  const nowMs = useSimDay();
  useTariff();
  useSyncExternalStore(
    (l) => measures.subscribe(l),
    () => measures.getVersion(),
  );
  if (s.hidden) return null;
  const done = (id: GuideStep) => s.seen.includes(id) || doneByGame(id, nowMs);
  const count = STEPS.filter((step) => done(step.id)).length;
  const next = STEPS.find((step) => !done(step.id));

  if (s.collapsed) {
    return (
      <button className={`ob-pill${besidePanel ? " beside-panel" : ""}`} onClick={() => update({ collapsed: false })} aria-label="Open the getting started guide">
        Getting started · {count}/{STEPS.length}
        <ChevronUp size={14} strokeWidth={2} aria-hidden />
      </button>
    );
  }

  return (
    <aside className={`ob-card${besidePanel ? " beside-panel" : ""}`} aria-label="Getting started">
      <header className="ob-card-head">
        <span className="ob-card-title">Getting started</span>
        <span className="ob-card-count">
          {count}/{STEPS.length}
        </span>
        <button className="ob-icon" onClick={() => update({ collapsed: true })} aria-label="Collapse the guide" title="Collapse">
          <ChevronDown size={15} strokeWidth={2} aria-hidden />
        </button>
        <button className="ob-icon" onClick={() => guide.hide()} aria-label="Close the guide" title="Close (it can be brought back from the game menu)">
          <X size={15} strokeWidth={2} aria-hidden />
        </button>
      </header>
      <ol className="ob-steps">
        {STEPS.map((step) => {
          const isDone = done(step.id);
          const isNext = step === next;
          return (
            <li key={step.id} className={isDone ? "done" : isNext ? "next" : ""}>
              <span className="ob-check" aria-hidden>
                {isDone ? <Check size={12} strokeWidth={3} /> : null}
              </span>
              <div className="ob-step-body">
                <span className="ob-step-title">{step.title}</span>
                {isNext && (
                  <>
                    <span className="ob-step-hint">{step.hint}</span>
                    <button className="ob-step-action" onClick={() => onAction(step.id)}>
                      {step.action}
                    </button>
                  </>
                )}
              </div>
            </li>
          );
        })}
      </ol>
      {!next && (
        <p className="ob-card-foot">
          That's the basics. Plan for the long haul: heating and cars change slowly, money and approval run out fast. The Wiki has the details.
          <button className="ob-step-action" onClick={() => guide.hide()}>
            Close the guide
          </button>
        </p>
      )}
    </aside>
  );
}
