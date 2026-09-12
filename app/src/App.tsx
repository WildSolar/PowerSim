import { useEffect, useMemo, useState } from "react";
import { MapView } from "./map/MapView";
import { BuildingPanel } from "./ui/BuildingPanel";
import { DwellingPanel } from "./ui/DwellingPanel";
import { loadDataset } from "./data/loadDataset";
import type { MunicipalityDataset } from "./data/types";
import { simClock } from "./sim/engine";
import { useSimTime } from "./sim/store";

function ClockReadout() {
  const simTimeMs = useSimTime();
  const dayMs = 24 * 60 * 60_000;
  const day = Math.floor(simTimeMs / dayMs) + 1;
  const hours = Math.floor((simTimeMs % dayMs) / 3_600_000);
  const minutes = Math.floor((simTimeMs % 3_600_000) / 60_000);
  return (
    <div
      style={{
        position: "absolute",
        top: 16,
        left: 16,
        background: "#ffffffee",
        borderRadius: 8,
        padding: "6px 12px",
        fontFamily: "system-ui, sans-serif",
        fontSize: 13,
        fontVariantNumeric: "tabular-nums",
        boxShadow: "0 2px 10px rgba(0,0,0,0.15)",
      }}
    >
      Day {day}, {String(hours).padStart(2, "0")}:{String(minutes).padStart(2, "0")}
    </div>
  );
}

export default function App() {
  const [dataset, setDataset] = useState<MunicipalityDataset | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [selectedEgid, setSelectedEgid] = useState<string | null>(null);
  const [selectedEwid, setSelectedEwid] = useState<string | null>(null);

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
      />
      <ClockReadout />
      {selectedDwelling && selectedBuilding ? (
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
