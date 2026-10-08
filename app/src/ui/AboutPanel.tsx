import { useEffect } from "react";
import { X } from "lucide-react";
import { VERSION_LABEL } from "../changelog";
import { GAME_VERSION } from "../sim/saveGame";
import { ANALYTICS_ENABLED } from "../analytics";
import "./changelog.css";

const DATA: { what: string; source: string }[] = [
  { what: "Buildings and homes — age, size, heating", source: "Federal Register of Buildings and Dwellings (GWR), Federal Statistical Office (BFS)" },
  { what: "Building outlines", source: "Cadastral survey (Amtliche Vermessung), Canton of Zurich" },
  { what: "Basemap, streets and municipal boundaries", source: "© swisstopo (swisstopo basemap, swissTLM3D, swissBOUNDARIES3D)" },
  { what: "Solar panels and other power plants", source: "Register of electricity production plants, Swiss Federal Office of Energy (SFOE) and Pronovo" },
  { what: "Public chargers", source: "Charging stations for electric vehicles, SFOE (ich-tanke-strom.ch)" },
  { what: "Cars and vans per municipality", source: "Road vehicle stock, Federal Statistical Office (BFS)" },
  { what: "Building zones", source: "Harmonised building zones of Switzerland, Federal Office for Spatial Development (ARE)" },
  { what: "Where heat may be taken from the ground", source: "Wärmenutzungsatlas, Canton of Zurich (AWEL)" },
  { what: "Parks, sports grounds and cemeteries", source: "© OpenStreetMap contributors (ODbL)" },
];

const SOFTWARE: { name: string; licence: string }[] = [
  { name: "MapLibre GL JS", licence: "BSD-3-Clause" },
  { name: "React", licence: "MIT" },
  { name: "Lucide icons", licence: "ISC" },
  { name: "Inter and Inter Tight typefaces", licence: "SIL Open Font License" },
];

/** About the game: what it is (a beta, built on open data and simplified), and whose data and
 * software it stands on. */
export function AboutPanel({ onClose }: { onClose: () => void }) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.stopPropagation();
        onClose();
      }
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [onClose]);

  return (
    <div className="changelog" role="dialog" aria-label="About and credits">
      <header className="cl-head">
        <div>
          <div className="cl-kicker">Commune Zéro</div>
          <div className="cl-version">
            Version {VERSION_LABEL} <span>· build {GAME_VERSION}</span>
          </div>
        </div>
        <button className="cl-close" onClick={onClose} aria-label="Close">
          <X size={18} strokeWidth={1.75} aria-hidden />
        </button>
      </header>
      <div className="cl-body">
        <div className="cl-page">
          <h1>About</h1>
          <p className="cl-summary">
            Commune Zéro is a game about taking a real Swiss municipality to net zero: its real buildings, its streets, its grid and its people, simulated
            from open data. It is in beta. Where the data stops, the game fills in plausible households and estimates; its prices, costs and reactions are
            informed guesses, not forecasts. The Wiki says where it simplifies.
          </p>

          <section className="cl-group">
            <h3>Data</h3>
            <ul className="about-list">
              {DATA.map((d) => (
                <li key={d.what}>
                  <strong>{d.what}</strong>
                  <span>{d.source}</span>
                </li>
              ))}
            </ul>
            <p className="cl-summary">
              Open government data of the Swiss Confederation and the Canton of Zurich, used under their terms with the source named. The data is processed
              and simplified for the game; any errors are the game's, not the providers'.
            </p>
          </section>

          <section className="cl-group">
            <h3>Privacy</h3>
            <p className="cl-summary">
              The game runs entirely in your browser; your runs and saves stay there. The published game counts visits and a few milestones — a game started,
              a year reached, the tutorial finished — anonymously, with GoatCounter: no cookies, nothing about you, nothing about your game beyond that.
              {ANALYTICS_ENABLED ? "" : " (Not in this copy.)"}
            </p>
          </section>

          <section className="cl-group">
            <h3>Software</h3>
            <ul className="about-list">
              {SOFTWARE.map((s) => (
                <li key={s.name}>
                  <strong>{s.name}</strong>
                  <span>{s.licence}</span>
                </li>
              ))}
            </ul>
          </section>
        </div>
      </div>
    </div>
  );
}
