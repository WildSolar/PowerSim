import { useEffect, useMemo, useState } from "react";
import { MapView } from "./map/MapView";
import { BuildingPanel } from "./ui/BuildingPanel";
import { ControlPanel } from "./ui/ControlPanel";
import { DwellingPanel } from "./ui/DwellingPanel";
import { ColorModeControl } from "./ui/ColorModeControl";
import { ReportCardModal } from "./ui/ReportCardModal";
import { TimeControl } from "./ui/TimeControl";
import { StartMenu } from "./ui/StartMenu";
import { WikiPanel } from "./ui/WikiPanel";
import { loadDataset } from "./data/loadDataset";
import type { MunicipalityDataset } from "./data/types";
import type { ColorMode } from "./map/colorModes";
import { simClock } from "./sim/engine";
import { reportCardStore } from "./sim/reportCardStore";
import { useReportCardYear } from "./sim/store";
import { useTimeKeyboard } from "./ui/useTimeKeyboard";
import { useStockBuildings } from "./ui/useStock";
import { stock } from "./sim/stock";
import { startYearEndWatcher } from "./sim/yearEndWatcher";
import "./App.css";

// The simulation's state lives in many module-level singletons and caches (policy,
// tariffs, solar adoption, decision log, per-year finances/emissions...), so a page
// reload is the one reliable way to get a clean slate for the next municipality. The
// app always opens on the start menu, so reloading lands there. There's no save
// system yet, so the current run is lost — hence the confirm.
function returnToMenu() {
  if (window.confirm("Return to the main menu? Your current run will be lost.")) {
    window.location.reload();
  }
}

// Dev-only handle for inspecting the simulation from the browser console.
if (import.meta.env.DEV) Object.assign(window, { __debug: { stock, simClock } });

function Game({ slug }: { slug: string }) {
  const [dataset, setDataset] = useState<MunicipalityDataset | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [selectedEgid, setSelectedEgid] = useState<string | null>(null);
  const [selectedEwid, setSelectedEwid] = useState<string | null>(null);
  const [colorMode, setColorMode] = useState<ColorMode>("none");
  const [showControl, setShowControl] = useState(false);
  const [showWiki, setShowWiki] = useState(false);
  const reportCardYear = useReportCardYear();
  const stockBuildings = useStockBuildings();
  const keyboardEnabled = !showControl && !showWiki && reportCardYear === null;
  useTimeKeyboard(keyboardEnabled);

  useEffect(() => {
    simClock.start();
    const stopWatcher = startYearEndWatcher();
    return () => {
      simClock.stop();
      stopWatcher();
    };
  }, []);

  useEffect(() => {
    loadDataset(`/data/${slug}.json`)
      .then((loaded) => {
        stock.init(loaded);
        setDataset(loaded);
      })
      .catch((e: Error) => setError(e.message));
  }, [slug]);

  // The dataset as it stands now: the base buildings plus everything built since (sim/stock.ts).
  // MapView keeps the original dataset (its mount is keyed on that reference) and reads the stock itself.
  const liveDataset = useMemo(() => (dataset ? { ...dataset, buildings: stockBuildings } : null), [dataset, stockBuildings]);

  const selectedBuilding = useMemo(
    () => stockBuildings.find((b) => b.egid === selectedEgid) ?? null,
    [stockBuildings, selectedEgid],
  );
  const selectedDwelling = useMemo(
    () => selectedBuilding?.dwellings.find((d) => d.ewid === selectedEwid) ?? null,
    [selectedBuilding, selectedEwid],
  );

  if (error) {
    return <div style={{ padding: 24, fontFamily: "system-ui, sans-serif" }}>Failed to load dataset: {error}</div>;
  }
  if (!dataset) {
    return <div style={{ padding: 24, fontFamily: "system-ui, sans-serif" }}>Loading…</div>;
  }

  return (
    <div style={{ position: "absolute", inset: 0 }}>
      <MapView
        dataset={dataset}
        selectedEgid={selectedEgid}
        onSelectBuilding={(egid) => {
          setSelectedEgid(egid);
          setSelectedEwid(null);
        }}
        colorMode={colorMode}
        keyboardEnabled={keyboardEnabled}
      />
      <div className="top-left-stack">
        <TimeControl />
        <ColorModeControl mode={colorMode} onChange={setColorMode} />
      </div>
      <div className="bottom-left-stack">
        <button className="pill-button" onClick={() => setShowControl(true)}>
          ⚙️ {dataset.name} Control
        </button>
        <button className="pill-button" onClick={() => setShowWiki(true)}>
          📖 Wiki
        </button>
        <button className="pill-button" onClick={returnToMenu}>
          ☰ Main menu
        </button>
      </div>
      {showControl && <ControlPanel dataset={liveDataset ?? dataset} onClose={() => setShowControl(false)} />}
      {showWiki && <WikiPanel onClose={() => setShowWiki(false)} />}
      {reportCardYear !== null && (
        <ReportCardModal dataset={liveDataset ?? dataset} year={reportCardYear} onClose={() => reportCardStore.dismiss()} />
      )}
      {selectedDwelling && selectedBuilding ? (
        <DwellingPanel
          building={selectedBuilding}
          dwelling={selectedDwelling}
          allBuildings={stockBuildings}
          realPlants={dataset.powerPlants}
          onBack={() => setSelectedEwid(null)}
          onClose={() => {
            setSelectedEgid(null);
            setSelectedEwid(null);
          }}
        />
      ) : selectedBuilding ? (
        <BuildingPanel
          building={selectedBuilding}
          allBuildings={stockBuildings}
          realPlants={dataset.powerPlants}
          onSelectDwelling={setSelectedEwid}
          onClose={() => setSelectedEgid(null)}
        />
      ) : null}
    </div>
  );
}

export default function App() {
  const [slug, setSlug] = useState<string | null>(null);
  return slug ? <Game slug={slug} /> : <StartMenu onStart={setSlug} />;
}
