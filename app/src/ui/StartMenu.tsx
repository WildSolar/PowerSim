import { useEffect, useState } from "react";
import { loadMunicipalityIndex, type MunicipalityIndexEntry } from "../data/loadDataset";
import "./StartMenu.css";

interface Props {
  onStart: (slug: string) => void;
}

export function StartMenu({ onStart }: Props) {
  const [municipalities, setMunicipalities] = useState<MunicipalityIndexEntry[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    loadMunicipalityIndex()
      .then(setMunicipalities)
      .catch((e: Error) => setError(e.message));
  }, []);

  return (
    <div className="start-menu">
      <div className="start-menu-card">
        <h1>Grid &amp; Ground</h1>
        <p className="start-menu-tagline">Choose a municipality to guide toward net zero.</p>
        {error && <p className="start-menu-error">{error}</p>}
        {!error && !municipalities && <p className="start-menu-status">Loading municipalities…</p>}
        {municipalities && municipalities.length === 0 && (
          <p className="start-menu-status">No municipalities built yet — run the data pipeline first.</p>
        )}
        <ul className="start-menu-list">
          {municipalities?.map((m) => (
            <li key={m.slug}>
              <button className="start-menu-item" onClick={() => onStart(m.slug)}>
                <span className="start-menu-name">{m.name}</span>
                <span className="start-menu-meta">
                  BFS {m.bfsNumber} · {m.buildingCount.toLocaleString("de-CH")} buildings
                </span>
              </button>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}
