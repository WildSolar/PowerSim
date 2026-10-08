/**
 * Anonymous usage counting with GoatCounter (goatcounter.com): no cookies, nothing personal, nothing
 * about the game beyond a few milestones. Only in the deployed build, and only if it was given a
 * GoatCounter site code — VITE_GOATCOUNTER_CODE, set in the deploy workflow from the repository
 * variable GOATCOUNTER_CODE. Without one (and in development) nothing is loaded or sent.
 *
 * The script counts the visit itself. On top, events: a game started (which town, which
 * difficulty) or loaded, the tutorial started, each chapter reached, finished or left (and where),
 * each Year in Review reached (by how many years in), how a run ended, a crash, the feedback form.
 */

const CODE = ((import.meta.env.VITE_GOATCOUNTER_CODE as string | undefined) ?? "").trim();
export const ANALYTICS_ENABLED = import.meta.env.PROD && /^[a-z0-9-]+$/i.test(CODE);

interface GoatCounter {
  count?: (vars: { path: string; title?: string; event?: boolean }) => void;
}

declare global {
  interface Window {
    goatcounter?: GoatCounter;
  }
}

// Events before the script has loaded wait here.
const queue: { path: string; title: string }[] = [];

function flush(): void {
  const count = window.goatcounter?.count;
  if (!count) return;
  for (const e of queue.splice(0)) {
    try {
      count({ path: e.path, title: e.title, event: true });
    } catch {
      // Counting must never get in the way of the game.
    }
  }
}

/** Loads GoatCounter's script (which counts the visit), if analytics are on. Once, at start. */
export function initAnalytics(): void {
  if (!ANALYTICS_ENABLED) return;
  const script = document.createElement("script");
  script.async = true;
  script.src = "https://gc.zgo.at/count.js";
  script.dataset.goatcounter = `https://${CODE}.goatcounter.com/count`;
  script.onload = flush;
  document.head.appendChild(script);
}

/** Counts an event: a short path like "start/schlieren/normal", shown as is on the dashboard. */
export function track(path: string, title?: string): void {
  if (!ANALYTICS_ENABLED) return;
  queue.push({ path, title: title ?? path });
  flush();
}
