import { useEffect, useState } from "react";
import { guide } from "./Onboarding";
import { Check, Copy, Download, Save, X } from "lucide-react";
import { simClock } from "../sim/engine";
import { captureSave, GAME_VERSION, saveToString, type RunInfo } from "../sim/saveGame";
import { deleteSave, listSaves, newSaveId, putSave, type StoredSave } from "../sim/saveStore";
import { formatDate } from "../sim/calendar";
import { usePauseWhileOpen } from "./usePauseWhileOpen";
import { ChangelogPanel } from "./ChangelogPanel";
import { VERSION_LABEL } from "../changelog";
import { downloadText, saveFileName, savedAtLabel } from "./saveFiles";
import "./gameMenu.css";

/** The game menu (☰ in the top bar): save the run in this browser, as a save string, or leave.
 * The game pauses while it is open. */
export function GameMenu({ run, onClose, onMainMenu, onFeedback }: { run: RunInfo; onClose: () => void; onMainMenu: () => void; onFeedback: () => void }) {
  usePauseWhileOpen();
  const [name, setName] = useState(() => `${run.municipality}, ${formatDate(simClock.getSimTimeMs())}`);
  const [saves, setSaves] = useState<StoredSave[] | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [message, setMessage] = useState<{ text: string; tone: "good" | "bad" } | null>(null);
  const [exported, setExported] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [showChangelog, setShowChangelog] = useState(false);

  const refresh = () =>
    listSaves()
      .then(setSaves)
      .catch(() => setSaves([]));
  useEffect(() => {
    refresh();
  }, []);

  const save = async (id: string, label: string) => {
    setBusy(id);
    setMessage(null);
    try {
      const { meta, bytes } = await captureSave(run, label);
      await putSave(id, meta, bytes);
      setMessage({ text: `Saved “${label}” in this browser.`, tone: "good" });
      await refresh();
    } catch (e) {
      setMessage({ text: `Couldn't save: ${(e as Error).message}`, tone: "bad" });
    } finally {
      setBusy(null);
    }
  };

  const exportString = async () => {
    setBusy("export");
    setMessage(null);
    setCopied(false);
    try {
      const { bytes } = await captureSave(run, name);
      setExported(saveToString(bytes));
    } catch (e) {
      setMessage({ text: `Couldn't make the save string: ${(e as Error).message}`, tone: "bad" });
    } finally {
      setBusy(null);
    }
  };

  const ownSaves = (saves ?? []).filter((s) => s.meta.slug === run.slug);

  return (
    <div className="game-menu-layer">
      <div className="game-menu-scrim" onClick={onClose} />
      <div className="game-menu" role="dialog" aria-label="Game menu">
        <header className="gm-head">
          <div>
            <div className="gm-kicker">Game · {run.municipality}</div>
            <div className="gm-paused">Paused while the menu is open</div>
          </div>
          <button className="gm-close" onClick={onClose} aria-label="Close the menu">
            <X size={18} strokeWidth={1.75} aria-hidden />
          </button>
        </header>

        <section className="gm-section">
          <h2>Save in this browser</h2>
          <p className="gm-note">Saves stay in this browser on this device. To keep a run safe or move it elsewhere, make a save string too.</p>
          <div className="gm-row">
            <input className="gm-input" value={name} onChange={(e) => setName(e.target.value)} aria-label="Name of the save" maxLength={80} />
            <button className="gm-primary" disabled={busy !== null || name.trim() === ""} onClick={() => save(newSaveId(), name.trim())}>
              <Save size={15} strokeWidth={1.75} aria-hidden /> {busy !== null && busy !== "export" ? "Saving…" : "Save"}
            </button>
          </div>
          {ownSaves.length > 0 && (
            <ul className="gm-saves">
              {ownSaves.map((s) => (
                <li key={s.id}>
                  <div className="gm-save-text">
                    <span className="gm-save-name">{s.meta.name}</span>
                    <span className="gm-save-meta">
                      {s.meta.dateLabel} · saved {savedAtLabel(s.meta.savedAt)}
                      {s.meta.version !== GAME_VERSION ? ` · made with ${s.meta.release ?? "another version"}` : ""}
                    </span>
                  </div>
                  {s.id !== "autosave" && (
                    <button className="gm-secondary" disabled={busy !== null} onClick={() => save(s.id, s.meta.name)}>
                      Overwrite
                    </button>
                  )}
                  <button
                    className="gm-link"
                    disabled={busy !== null}
                    onClick={async () => {
                      await deleteSave(s.id);
                      refresh();
                    }}
                  >
                    Delete
                  </button>
                </li>
              ))}
            </ul>
          )}
        </section>

        <section className="gm-section">
          <h2>Feedback</h2>
          <p className="gm-note">Something broke, something was unclear, an idea? Your game can go along, so we see what you saw.</p>
          <button className="gm-secondary" onClick={onFeedback}>
            Send feedback
          </button>
        </section>

        <section className="gm-section">
          <h2>Getting started</h2>
          <p className="gm-note">The briefing's checklist of first steps, if you closed it.</p>
          <button
            className="gm-secondary"
            onClick={() => {
              guide.show();
              onClose();
            }}
          >
            Show the guide
          </button>
        </section>

        <section className="gm-section">
          <h2>Save string</h2>
          <p className="gm-note">The whole run as text: keep it anywhere, and load it from the start screen — on any device with this version of the game.</p>
          {exported === null ? (
            <button className="gm-secondary" disabled={busy !== null} onClick={exportString}>
              {busy === "export" ? "Making it…" : "Make a save string"}
            </button>
          ) : (
            <>
              <textarea className="gm-string" readOnly value={exported} onFocus={(e) => e.currentTarget.select()} aria-label="Save string" />
              <div className="gm-row">
                <span className="gm-note">{Math.round(exported.length / 1024).toLocaleString("de-CH")} kB</span>
                <span className="gm-spacer" />
                <button
                  className="gm-secondary"
                  onClick={async () => {
                    try {
                      await navigator.clipboard.writeText(exported);
                      setCopied(true);
                    } catch {
                      setMessage({ text: "The browser didn't allow copying; select the text and copy it, or download it.", tone: "bad" });
                    }
                  }}
                >
                  {copied ? <Check size={15} aria-hidden /> : <Copy size={15} aria-hidden />} {copied ? "Copied" : "Copy"}
                </button>
                <button className="gm-secondary" onClick={() => downloadText(saveFileName(run.municipality, simClock.getSimTimeMs()), exported)}>
                  <Download size={15} aria-hidden /> Download
                </button>
              </div>
            </>
          )}
        </section>

        {message && <p className={`gm-message ${message.tone}`}>{message.text}</p>}

        <footer className="gm-foot">
          <span className="gm-version">
            Version {VERSION_LABEL} · build {GAME_VERSION} ·{" "}
            <button className="gm-link" onClick={() => setShowChangelog(true)}>
              What's new
            </button>
          </span>
          <button
            className="gm-secondary"
            onClick={() => {
              if (window.confirm("Return to the main menu? Anything since your last save will be lost.")) onMainMenu();
            }}
          >
            Main menu
          </button>
        </footer>
      </div>
      {showChangelog && <ChangelogPanel onClose={() => setShowChangelog(false)} />}
    </div>
  );
}
