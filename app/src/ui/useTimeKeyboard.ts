import { useEffect } from "react";
import { cycleSpeed, togglePause } from "../sim/timeControls";
import { hasModifier, isTypingTarget } from "./keyboard";

/** Tab cycles the running speeds; Space pauses/resumes. */
export function useTimeKeyboard(enabled: boolean): void {
  useEffect(() => {
    if (!enabled) return;

    const onKeyDown = (e: KeyboardEvent) => {
      if (hasModifier(e) || isTypingTarget(e.target)) return;
      if (e.key === "Tab") {
        e.preventDefault(); // otherwise Tab would move browser focus between buttons
        cycleSpeed();
      } else if (e.key === " ") {
        e.preventDefault();
        if (!e.repeat) togglePause();
      }
    };
    // A focused button activates on Space *release*, so a click on a UI button followed
    // by Space would otherwise both pause and re-press that button.
    const onKeyUp = (e: KeyboardEvent) => {
      if (e.key === " " && !hasModifier(e) && !isTypingTarget(e.target)) e.preventDefault();
    };

    window.addEventListener("keydown", onKeyDown);
    window.addEventListener("keyup", onKeyUp);
    return () => {
      window.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("keyup", onKeyUp);
    };
  }, [enabled]);
}
