import { useEffect, useMemo, useState } from "react";
import { MapView } from "./map/MapView";
import { BuildingPanel } from "./ui/BuildingPanel";
import { DwellingPanel } from "./ui/DwellingPanel";
import { MunicipalityPanel } from "./ui/MunicipalityPanel";
import { ColorModeControl } from "./ui/ColorModeControl";
import { TimeControl } from "./ui/TimeControl";
import { TariffControl } from "./ui/TariffControl";
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
  const [showMunicipality, setShowMunicipality] = useState(false);

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
          setShowMunicipality(false);
        }}
        colorMode={colorMode}
      />
      <TimeControl />
      <ColorModeControl mode={colorMode} onChange={setColorMode} />
      <TariffControl />
      <button
        className="municipality-toggle"
        onClick={() => {
          setShowMunicipality(true);
          setSelectedEgid(null);
          setSelectedEwid(null);
        }}
      >
        {dataset.name} overview
      </button>
      {showMunicipality ? (
        <MunicipalityPanel dataset={dataset} onClose={() => setShowMunicipality(false)} />
      ) : selectedDwelling && selectedBuilding ? (
        <DwellingPanel
          building={selectedBuilding}
          dwelling={selectedDwelling}
          onBack={() => setSelectedEwid(null)}
          onClose={() => {
            setSelectedEgid(null);
            setSelectedEwid(null);
          }}
        />
      ) : selectedBuilding ? (
        <BuildingPanel
          building={selectedBuilding}
          onSelectDwelling={setSelectedEwid}
          onClose={() => setSelectedEgid(null)}
        />
      ) : null}
    </div>
  );
}
