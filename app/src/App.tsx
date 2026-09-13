import { useEffect, useMemo, useState } from "react";
import { MapView } from "./map/MapView";
import { BuildingPanel } from "./ui/BuildingPanel";
import { ControlPanel } from "./ui/ControlPanel";
import { DwellingPanel } from "./ui/DwellingPanel";
import { ColorModeControl } from "./ui/ColorModeControl";
import { TimeControl } from "./ui/TimeControl";
import { WikiPanel } from "./ui/WikiPanel";
import { loadDataset } from "./data/loadDataset";
import type { MunicipalityDataset } from "./data/types";
import type { ColorMode } from "./map/colorModes";
import { simClock } from "./sim/engine";
import "./App.css";

export default function App() {
  const [dataset, setDataset] = useState<MunicipalityDataset | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [selectedEgid, setSelectedEgid] = useState<string | null>(null);
  const [selectedEwid, setSelectedEwid] = useState<string | null>(null);
  const [colorMode, setColorMode] = useState<ColorMode>("none");
  const [showControl, setShowControl] = useState(false);
  const [showWiki, setShowWiki] = useState(false);

  useEffect(() => {
    simClock.start();
    return () => simClock.stop();
  }, []);

  useEffect(() => {
    loadDataset()
      .then(setDataset)
      .catch((e: Error) => setError(e.message));
  }, []);

  const selectedBuilding = useMemo(
    () => dataset?.buildings.find((b) => b.egid === selectedEgid) ?? null,
    [dataset, selectedEgid],
  );
  const selectedDwelling = useMemo(
    () => selectedBuilding?.dwellings.find((d) => d.ewid === selectedEwid) ?? null,
    [selectedBuilding, selectedEwid],
  );

  if (error) {
    return <div style={{ padding: 24, fontFamily: "system-ui, sans-serif" }}>Failed to load dataset: {error}</div>;
  }
  if (!dataset) {
    return <div style={{ padding: 24, fontFamily: "system-ui, sans-serif" }}>Loading Schlieren…</div>;
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
      </div>
      {showControl && <ControlPanel dataset={dataset} onClose={() => setShowControl(false)} />}
      {showWiki && <WikiPanel onClose={() => setShowWiki(false)} />}
      {selectedDwelling && selectedBuilding ? (
        <DwellingPanel
          building={selectedBuilding}
          dwelling={selectedDwelling}
          plants={dataset.powerPlants}
          onBack={() => setSelectedEwid(null)}
          onClose={() => {
            setSelectedEgid(null);
            setSelectedEwid(null);
          }}
        />
      ) : selectedBuilding ? (
        <BuildingPanel
          building={selectedBuilding}
          plants={dataset.powerPlants}
          onSelectDwelling={setSelectedEwid}
          onClose={() => setSelectedEgid(null)}
        />
      ) : null}
    </div>
  );
}
