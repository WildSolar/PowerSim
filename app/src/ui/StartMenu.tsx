import { useEffect, useMemo, useState } from "react";
import { loadMunicipalityIndex, type MunicipalityIndexEntry } from "../data/loadDataset";
import { DEFAULT_DIFFICULTY, DIFFICULTY_ORDER, DIFFICULTY_SPECS, type Difficulty } from "../config/difficulty";
import "./StartMenu.css";

// Case- and accent-insensitive, so "zur" finds Zürich.
function normalize(text: string): string {
  return text
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase();
}

interface Props {
  onStart: (slug: string, difficulty: Difficulty) => void;
}

export function StartMenu({ onStart }: Props) {
  const [municipalities, setMunicipalities] = useState<MunicipalityIndexEntry[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [difficulty, setDifficulty] = useState<Difficulty>(DEFAULT_DIFFICULTY);

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
      <div className="start-menu-card">
        <h1>Grid &amp; Ground</h1>
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
                if (e.key === "Enter" && filtered.length > 0) onStart(filtered[0].slug, difficulty);
              }}
              autoFocus
            />
            <ul className="start-menu-list">
              {filtered.map((m) => (
                <li key={m.slug}>
                  <button className="start-menu-item" onClick={() => onStart(m.slug, difficulty)}>
                    <span className="start-menu-name">{m.name}</span>
                    <span className="start-menu-meta">{m.buildingCount.toLocaleString("de-CH")} buildings</span>
                  </button>
                </li>
              ))}
              {filtered.length === 0 && <li className="start-menu-status">No municipality matches "{query}".</li>}
            </ul>
          </>
        )}
      </div>
    </div>
  );
}
