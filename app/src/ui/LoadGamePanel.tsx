import { useEffect, useState } from "react";
import { DIFFICULTY_SPECS } from "../config/difficulty";
import type { MunicipalityIndexEntry } from "../data/loadDataset";
import { GAME_VERSION, isCompatible, openSave, SaveError, saveFromString, saveToString, type SaveFile } from "../sim/saveGame";
import { deleteSave, listSaves, readSave, type StoredSave } from "../sim/saveStore";
import { downloadText, saveFileName, savedAtLabel } from "./saveFiles";

/** The start screen's "Load game": saves kept in this browser, and a save string or file. */
export function LoadGamePanel({ municipalities, onLoad }: { municipalities: MunicipalityIndexEntry[] | null; onLoad: (file: SaveFile) => void }) {
  const [saves, setSaves] = useState<StoredSave[] | null>(null);
  const [text, setText] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const refresh = () =>
    listSaves()
      .then(setSaves)
      .catch(() => setSaves([]));
  useEffect(() => {
    refresh();
  }, []);

  /** Opens a save and starts it, if this build and this list of municipalities can. */
  const start = async (open: () => Promise<SaveFile>) => {
    setBusy(true);
    setError(null);
    try {
      const file = await open();
      if (municipalities && !municipalities.some((m) => m.slug === file.meta.slug)) {
        throw new SaveError(`This save is of ${file.meta.municipality}, which this version of the game doesn't include.`);
      }
      onLoad(file);
    } catch (e) {
      setError(e instanceof SaveError ? e.message : `Couldn't load it: ${(e as Error).message}`);
      setBusy(false);
    }
  };

  return (
    <div className="load-game">
      <h2 className="load-heading">In this browser</h2>
      {saves === null && <p className="start-menu-status">Looking for saves…</p>}
      {saves && saves.length === 0 && <p className="start-menu-status">No saves in this browser yet. Save from the game menu (☰) while playing.</p>}
      {saves && saves.length > 0 && (
        <ul className="load-list">
          {saves.map((s) => {
            const ok = isCompatible(s.meta);
            return (
              <li key={s.id} className={ok ? "" : "incompatible"}>
                <button
                  className="load-item"
                  disabled={!ok || busy}
                  onClick={() =>
                    start(async () => {
                      const bytes = await readSave(s.id);
                      if (!bytes) throw new SaveError("This save has gone missing from the browser's storage.");
                      return openSave(bytes);
                    })
                  }
                  title={ok ? "Load this game" : `Made with another version (${s.meta.version}); this is ${GAME_VERSION}.`}
                >
                  <span className="load-name">{s.meta.name}</span>
                  <span className="load-meta">
                    {s.meta.municipality} · {s.meta.dateLabel} · {DIFFICULTY_SPECS[s.meta.difficulty]?.label ?? s.meta.difficulty} · approval {s.meta.approval}%
                  </span>
                  <span className="load-meta">{ok ? `Saved ${savedAtLabel(s.meta.savedAt)}` : "Made with another version — can't be loaded"}</span>
                </button>
                <div className="load-actions">
                  {ok && (
                    <button
                      className="load-link"
                      onClick={async () => {
                        const bytes = await readSave(s.id);
                        if (bytes) downloadText(saveFileName(s.meta.municipality, s.meta.simTimeMs), saveToString(bytes));
                      }}
                    >
                      Download
                    </button>
                  )}
                  <button
                    className="load-link danger"
                    onClick={async () => {
                      if (!window.confirm(`Delete “${s.meta.name}”? This can't be undone.`)) return;
                      await deleteSave(s.id);
                      refresh();
                    }}
                  >
                    Delete
                  </button>
                </div>
              </li>
            );
          })}
        </ul>
      )}

      <h2 className="load-heading">From a save string or file</h2>
      <textarea className="load-string" placeholder="Paste a save string (it starts with CZ1:)" value={text} onChange={(e) => setText(e.target.value)} spellCheck={false} />
      <div className="load-row">
        <button className="load-primary" disabled={busy || text.trim() === ""} onClick={() => start(() => saveFromString(text))}>
          {busy ? "Loading…" : "Load"}
        </button>
        <label className="load-file">
          Open a file…
          <input
            type="file"
            accept=".txt,text/plain"
            onChange={(e) => {
              const f = e.target.files?.[0];
              e.target.value = "";
              if (f) start(async () => saveFromString(await f.text()));
            }}
          />
        </label>
      </div>
      {error && <p className="start-menu-error">{error}</p>}
      <p className="load-version">Version {GAME_VERSION}. A save loads only into the version that made it.</p>
    </div>
  );
}
