/**
 * When something breaks: the first error that would otherwise lose the player's run — a screen
 * that fails to draw (ui/CrashScreen.tsx's boundary), an error inside the clock's loop (engine.ts,
 * which would otherwise freeze the game silently), or any uncaught error in the page. The game
 * pauses, and the crash screen offers to save the run, report it, and reload.
 *
 * Also keeps which run is being played, so the crash screen can save it even after the game's
 * screen has gone.
 */

import { track } from "../analytics";
import type { RunInfo } from "./saveGame";

export interface Crash {
  message: string;
  stack: string;
  /** Where it happened: "screen" (React), "simulation" (the clock), "page" (anything else). */
  where: "screen" | "simulation" | "page";
  /** Whether the game's screen is still there to keep playing on. */
  screenAlive: boolean;
}

let crash: Crash | null = null;
let run: RunInfo | null = null;
const listeners = new Set<() => void>();

/** Errors the browser raises that break nothing (layout noise, aborted downloads). */
function harmless(message: string): boolean {
  // Network trouble (the basemap's tiles, say) isn't a broken game; the map shows it on its own.
  return /ResizeObserver loop|AbortError|The user aborted a request|Failed to fetch|NetworkError|Load failed/i.test(message);
}

export const crashes = {
  report(error: unknown, where: Crash["where"]): void {
    const e = error instanceof Error ? error : new Error(String(error));
    if (harmless(e.message)) return;
    if (crash) return; // the first one is the one that matters (a broken listener throws every frame)
    console.error(`[crash: ${where}]`, e);
    crash = { message: e.message || String(error), stack: e.stack ?? "", where, screenAlive: where !== "screen" };
    track(`crash/${where}`, "Crash");
    pauseHook();
    listeners.forEach((l) => l());
  },
  get(): Crash | null {
    return crash;
  },
  /** The player chose to carry on (only offered while the screen still works). */
  dismiss(): void {
    crash = null;
    listeners.forEach((l) => l());
  },
  subscribe(listener: () => void): () => void {
    listeners.add(listener);
    return () => listeners.delete(listener);
  },
  setRun(info: RunInfo | null): void {
    run = info;
  },
  getRun(): RunInfo | null {
    return run;
  },
};

let pauseHook: () => void = () => {};

/** Registered by engine.ts: stops the clock when something breaks. */
export function setCrashPause(pause: () => void): void {
  pauseHook = pause;
}

/** Catches what nothing else does. Once, at startup. */
export function installCrashHandlers(): void {
  window.addEventListener("error", (e) => crashes.report(e.error ?? e.message, "page"));
  window.addEventListener("unhandledrejection", (e) => crashes.report(e.reason, "page"));
}
