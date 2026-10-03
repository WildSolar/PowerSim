import { useEffect } from "react";
import { simClock } from "../sim/engine";
import { useSimSpeed } from "../sim/store";
import { PAUSE_SPEED, setSpeed } from "../sim/timeControls";

// Windows that pause the game (the town hall, the wiki) hold the pause together: the game stops
// when the first opens and resumes, at the speed it ran before, when the last closes — unless the
// player set it running themselves in between, in which case their choice stands.
let holders = 0;
let resumeTo: number | null = null;

function hold(): () => void {
  if (holders++ === 0) {
    const running = simClock.getSpeed();
    resumeTo = running !== PAUSE_SPEED ? running : null;
    if (resumeTo !== null) setSpeed(PAUSE_SPEED);
  }
  return () => {
    if (--holders > 0) return;
    if (resumeTo !== null && simClock.getSpeed() === PAUSE_SPEED) setSpeed(resumeTo);
    resumeTo = null;
  };
}

/** Pauses the game while the calling window is open. */
export function usePauseWhileOpen(): void {
  useEffect(hold, []);
  const speed = useSimSpeed();
  useEffect(() => {
    // The live clock, not the rendered speed: on opening, the render still shows the speed from
    // before the pause.
    if (speed !== PAUSE_SPEED && simClock.getSpeed() !== PAUSE_SPEED) resumeTo = null;
  }, [speed]);
}
