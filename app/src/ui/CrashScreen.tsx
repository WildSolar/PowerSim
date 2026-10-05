import { Component, useState, useSyncExternalStore, type ReactNode } from "react";
import { crashes } from "../sim/crash";
import { captureSave, saveToString } from "../sim/saveGame";
import { newSaveId, putSave } from "../sim/saveStore";
import { simClock } from "../sim/engine";
import { FeedbackDialog } from "./FeedbackDialog";
import { downloadText, saveFileName } from "./saveFiles";
import "./feedback.css";

/** Catches a screen that fails to draw, so the run isn't lost with it: the game's screen goes,
 * and the crash screen (below) takes its place. */
export class CrashBoundary extends Component<{ children: ReactNode }, { failed: boolean }> {
  state = { failed: false };

  static getDerivedStateFromError(): { failed: boolean } {
    return { failed: true };
  }

  componentDidCatch(error: unknown): void {
    crashes.report(error, "screen");
  }

  render(): ReactNode {
    return this.state.failed ? null : this.props.children;
  }
}

/** When something broke: save the run (in this browser and as a file), report it, reload — or,
 * if the screen still works, carry on at your own risk. */
export function CrashScreen() {
  const crash = useSyncExternalStore(crashes.subscribe, crashes.get);
  const [saving, setSaving] = useState<"idle" | "busy" | "done" | "failed">("idle");
  const [saveNote, setSaveNote] = useState("");
  const [reporting, setReporting] = useState(false);
  if (!crash) return null;
  const run = crashes.getRun();

  const save = async () => {
    if (!run) return;
    setSaving("busy");
    try {
      const { meta, bytes } = await captureSave(run, "Before the crash");
      await putSave(newSaveId(), meta, bytes).catch(() => undefined); // the file below is the safe copy
      const name = saveFileName(run.municipality, simClock.getSimTimeMs());
      downloadText(name, saveToString(bytes));
      setSaving("done");
      setSaveNote(`Saved in this browser as “Before the crash”, and downloaded as ${name}.`);
    } catch (e) {
      setSaving("failed");
      setSaveNote(`The game couldn't be saved (${(e as Error).message}). The autosave from the last New Year is under Load game on the start screen.`);
    }
  };

  return (
    <div className="crash-layer" role="alertdialog" aria-labelledby="crash-title">
      <div className="crash-dialog">
        <div className="crash-kicker">The game is paused</div>
        <h1 id="crash-title">Something went wrong</h1>
        <p>
          {crash.screenAlive
            ? "Part of the game ran into an error. It may still work, but it's safest to save your game now, then reload and pick it up from the start screen."
            : "The game's screen ran into an error and had to close. Your game is still there: save it now, then reload and load it from the start screen."}
        </p>
        <div className="crash-actions">
          {run && (
            <button className="fb-primary" disabled={saving === "busy" || saving === "done"} onClick={save}>
              {saving === "busy" ? "Saving…" : saving === "done" ? "Saved" : "Save my game"}
            </button>
          )}
          <button className="fb-secondary" onClick={() => setReporting(true)}>
            Report it
          </button>
          <button className="fb-secondary" onClick={() => window.location.reload()}>
            Reload
          </button>
          {crash.screenAlive && (
            <button className="fb-link" onClick={() => crashes.dismiss()}>
              Keep playing anyway
            </button>
          )}
        </div>
        {saveNote && <p className={`crash-note${saving === "failed" ? " fb-bad" : ""}`}>{saveNote}</p>}
        <details className="crash-details">
          <summary>Details for the report</summary>
          <pre>
            {crash.message}
            {"\n"}
            {crash.stack.split("\n").slice(0, 8).join("\n")}
          </pre>
        </details>
      </div>
      {reporting && <FeedbackDialog crash={crash} pause={false} onClose={() => setReporting(false)} />}
    </div>
  );
}
