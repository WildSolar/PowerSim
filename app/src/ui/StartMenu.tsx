import { useEffect, useMemo, useState } from "react";
import { loadMunicipalityIndex, type MunicipalityIndexEntry } from "../data/loadDataset";
import { DEFAULT_DIFFICULTY, DIFFICULTY_ORDER, DIFFICULTY_SPECS, type Difficulty } from "../config/difficulty";
import { LoadGamePanel } from "./LoadGamePanel";
import { ChangelogPanel, hasUnseenRelease } from "./ChangelogPanel";
import { VERSION_LABEL } from "../changelog";
import type { SaveFile } from "../sim/saveGame";
import "./StartMenu.css";

// Case- and accent-insensitive, so "zur" finds Zürich.
function normalize(text: string): string {
  return text
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase();
}

interface Props {
  onStart: (slug: string, difficulty: Difficulty, transparency: boolean, restore?: SaveFile) => void;
}

export function StartMenu({ onStart }: Props) {
  const [municipalities, setMunicipalities] = useState<MunicipalityIndexEntry[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [difficulty, setDifficulty] = useState<Difficulty>(DEFAULT_DIFFICULTY);
  const [transparency, setTransparency] = useState(false);
  const [tab, setTab] = useState<"new" | "load">("new");
  const [showChangelog, setShowChangelog] = useState(false);
  const [unseen, setUnseen] = useState(hasUnseenRelease);

  useEffect(() => {
    loadMunicipalityIndex()
      .then(setMunicipalities)
      .catch((e: Error) => setError(e.message));
  }, []);

  const filtered = useMemo(() => {
    const q = normalize(query.trim());
    return (municipalities ?? [])
      .filter((m) => normalize(m.name).includes(q))
      .sort((a, b) => a.name.localeCompare(b.name, "de"));
  }, [municipalities, query]);

  return (
    <div className="start-menu">
      <div className="start-menu-title">
        <span className="start-menu-mark" aria-hidden="true" />
        <h1>
          Commune
          <br />
          Zéro
        </h1>
        <p>A Swiss municipality, its buildings, its grid — and the road to net zero.</p>
        <div className="start-menu-version">
          <span>Version {VERSION_LABEL}</span>
          <button
            onClick={() => {
              setShowChangelog(true);
              setUnseen(false);
            }}
          >
            What's new{unseen && <span className="start-menu-new">New</span>}
          </button>
        </div>
      </div>
      <div className="start-menu-card">
        <div className="start-menu-tabs" role="tablist">
          <button role="tab" aria-selected={tab === "new"} className={tab === "new" ? "active" : ""} onClick={() => setTab("new")}>
            New game
          </button>
          <button role="tab" aria-selected={tab === "load"} className={tab === "load" ? "active" : ""} onClick={() => setTab("load")}>
            Load game
          </button>
        </div>
        {tab === "load" ? (
          <LoadGamePanel municipalities={municipalities} onLoad={(file) => onStart(file.meta.slug, file.meta.difficulty, file.meta.transparency, file)} />
        ) : (
          <>
        <p className="start-menu-tagline">Choose a municipality to guide toward net zero.</p>
        <div className="start-menu-difficulty">
          <div className="start-menu-difficulty-buttons">
            {DIFFICULTY_ORDER.map((d) => (
              <button key={d} className={d === difficulty ? "active" : ""} onClick={() => setDifficulty(d)}>
                {DIFFICULTY_SPECS[d].label}
              </button>
            ))}
          </div>
          <p>{DIFFICULTY_SPECS[difficulty].description}</p>
        </div>
        <label className="start-menu-transparency">
          <input type="checkbox" checked={transparency} onChange={(e) => setTransparency(e.target.checked)} />
          <span>
            <strong>Transparency mode</strong> — open the decision log: every choice households, owners and businesses make, with the options and costs
            they weighed and the leanings behind them. Otherwise you only see what they did, not why.
          </span>
        </label>
        {error && <p className="start-menu-error">{error}</p>}
        {!error && !municipalities && <p className="start-menu-status">Loading municipalities…</p>}
        {municipalities && municipalities.length === 0 && (
          <p className="start-menu-status">No municipalities built yet — run the data pipeline first.</p>
        )}
        {municipalities && municipalities.length > 0 && (
          <>
            <input
              className="start-menu-search"
              type="search"
              placeholder={`Search ${municipalities.length} municipalities…`}
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && filtered.length > 0) onStart(filtered[0].slug, difficulty, transparency);
              }}
              autoFocus
            />
            <ul className="start-menu-list">
              {filtered.map((m) => (
                <li key={m.slug}>
                  <button className="start-menu-item" onClick={() => onStart(m.slug, difficulty, transparency)}>
                    <span className="start-menu-name">{m.name}</span>
                    <span className="start-menu-meta">{m.buildingCount.toLocaleString("de-CH")} buildings</span>
                  </button>
                </li>
              ))}
              {filtered.length === 0 && <li className="start-menu-status">No municipality matches "{query}".</li>}
            </ul>
          </>
        )}
          </>
        )}
      </div>
      {showChangelog && <ChangelogPanel onClose={() => setShowChangelog(false)} />}
    </div>
  );
}
