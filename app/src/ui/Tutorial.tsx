import { useEffect, useRef, useState } from "react";
import { track } from "../analytics";
import { simClock } from "../sim/engine";
import { TUTORIAL_STEPS, type TutorialState } from "./tutorialSteps";
import "./tutorial.css";

export interface TutorialProps {
  /** The game's state the steps watch. */
  state: Omit<TutorialState, "speed">;
  /** "Show me one": picks a building for the player. */
  onPickBuilding: () => void;
  /** Closes the windows, the building and the tool, for a step that needs a clear stage. */
  onClearStage: () => void;
  /** The tutorial is over: back to the start screen, or stay in this town. */
  onExit: () => void;
  onStay: () => void;
}

interface Box {
  left: number;
  top: number;
  width: number;
  height: number;
}

function fill(text: string, s: TutorialState): string {
  return text.replace(/\{town\}/g, s.town).replace(/\{election\}/g, s.nextElection ?? "not yet set");
}

/** The tutorial: Nadia's card, the step's task, and a spotlight on what to use. It sits above
 * everything but lets every click through to the game — the steps watch the game for the task
 * being done, and move on by themselves. */
export function Tutorial({ state, onPickBuilding, onClearStage, onExit, onStay }: TutorialProps) {
  const [index, setIndex] = useState(0);
  const [box, setBox] = useState<Box | null>(null);
  const [speed, setSpeedState] = useState(simClock.getSpeed());
  const [leaving, setLeaving] = useState(false);
  const step = TUTORIAL_STEPS[index];
  const full: TutorialState = { ...state, speed };
  const fullRef = useRef(full);
  fullRef.current = full;
  const isLast = index === TUTORIAL_STEPS.length - 1;

  // How far players get (analytics.ts): each chapter reached, the end, or where they left.
  useEffect(() => {
    if (index === 0 || TUTORIAL_STEPS[index - 1].chapter !== step.chapter) {
      const n = [...new Set(TUTORIAL_STEPS.map((s) => s.chapter))].indexOf(step.chapter) + 1;
      track(isLast ? "tutorial/finish" : `tutorial/chapter/${n}`, isLast ? "Tutorial finished" : `Tutorial chapter ${n}: ${step.chapter}`);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [index]);
  const leave = () => {
    track(`tutorial/leave/${step.id}`, `Tutorial left at ${step.id}`);
    onExit();
  };

  useEffect(() => {
    if (step.clearStage) onClearStage();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [step]);

  // Follow the spotlit element (layouts shift: panels open, the window resizes) and watch the task.
  useEffect(() => {
    let advanced = false;
    const tick = () => {
      setSpeedState(simClock.getSpeed());
      const el = step.target ? (document.querySelector(`[data-tour="${step.target}"]`) as HTMLElement | null) : null;
      const r = el?.getBoundingClientRect();
      setBox(r && r.width > 0 ? { left: r.left, top: r.top, width: r.width, height: r.height } : null);
      if (!advanced && step.done?.({ ...fullRef.current, speed: simClock.getSpeed() })) {
        advanced = true;
        window.setTimeout(() => setIndex((i) => Math.min(i + 1, TUTORIAL_STEPS.length - 1)), 450);
      }
    };
    tick();
    const interval = window.setInterval(tick, 150);
    return () => window.clearInterval(interval);
  }, [step]);

  const next = () => setIndex((i) => Math.min(i + 1, TUTORIAL_STEPS.length - 1));
  const back = () => setIndex((i) => Math.max(0, i - 1));

  // The card stays clear of what it points at: on the other side of the screen.
  const centre = box ? box.left + box.width / 2 : null;
  const side = centre === null ? "centre" : centre < window.innerWidth * 0.45 ? "right" : centre > window.innerWidth * 0.55 ? "left" : "centre";
  const high = box !== null && box.top + box.height > window.innerHeight * 0.6;
  const chapterIndex = [...new Set(TUTORIAL_STEPS.map((s) => s.chapter))].indexOf(step.chapter) + 1;
  const chapters = new Set(TUTORIAL_STEPS.map((s) => s.chapter)).size;

  return (
    <div className="tour" aria-live="polite">
      {box &&
        (() => {
          // The spotlight: a ring round the target, and (unless the step is about the map) the rest
          // of the screen dimmed — four panels round the hole.
          const left = Math.max(2, box.left - 6);
          const top = Math.max(2, box.top - 6);
          const right = Math.min(window.innerWidth - 2, box.left + box.width + 6);
          const bottom = Math.min(window.innerHeight - 2, box.top + box.height + 6);
          return (
            <>
              {!step.noDim && (
                <>
                  <div className="tour-dim" style={{ left: 0, top: 0, right: 0, height: top }} />
                  <div className="tour-dim" style={{ left: 0, top: bottom, right: 0, bottom: 0 }} />
                  <div className="tour-dim" style={{ left: 0, top, width: left, height: bottom - top }} />
                  <div className="tour-dim" style={{ left: right, top, right: 0, height: bottom - top }} />
                </>
              )}
              <div className={`tour-ring${step.task ? " task" : ""}`} style={{ left, top, width: right - left, height: bottom - top }} />
            </>
          );
        })()}
      <section className={`tour-card ${side}${high ? " high" : ""}`} role="dialog" aria-label="Tutorial">
        <header className="tour-head">
          <span className="tour-avatar" aria-hidden="true">
            NF
          </span>
          <span className="tour-who">
            <strong>Nadia Frei</strong>
            <span>Chief of staff</span>
          </span>
          <span className="tour-chapter">
            {chapterIndex}/{chapters} · {step.chapter}
          </span>
        </header>
        <div className="tour-text">
          {step.say.map((p, i) => (
            <p key={i}>{fill(p, full)}</p>
          ))}
        </div>
        {step.task && (
          <div className="tour-task">
            <span className="tour-task-label">Your move</span>
            <span>{fill(step.task, full)}</span>
            {step.help === "pickBuilding" && (
              <button className="tour-link" onClick={onPickBuilding}>
                Show me one
              </button>
            )}
          </div>
        )}
        <footer className="tour-actions">
          {leaving ? (
            <>
              <span className="tour-confirm">Leave the tutorial?</span>
              <button className="tour-secondary" onClick={() => setLeaving(false)}>
                Stay
              </button>
              <button className="tour-primary" onClick={leave}>
                To the start screen
              </button>
            </>
          ) : isLast ? (
            <>
              <button className="tour-secondary" onClick={onStay}>
                Stay in {state.town}
              </button>
              <button className="tour-primary" onClick={onExit}>
                Start my own term
              </button>
            </>
          ) : (
            <>
              <button className="tour-link" onClick={() => setLeaving(true)}>
                Leave the tutorial
              </button>
              <span className="tour-progress" aria-hidden="true">
                {index + 1} / {TUTORIAL_STEPS.length}
              </span>
              {index > 0 && !step.task && (
                <button className="tour-secondary" onClick={back}>
                  Back
                </button>
              )}
              {!step.task && (
                <button className="tour-primary" onClick={next} autoFocus>
                  {index === 0 ? "Let's begin" : "Next"}
                </button>
              )}
              {step.task && (
                <button className="tour-secondary" onClick={next} title="Move on without doing it">
                  Skip
                </button>
              )}
            </>
          )}
        </footer>
      </section>
    </div>
  );
}
