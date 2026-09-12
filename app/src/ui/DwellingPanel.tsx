import { useMemo } from "react";
import type { Building, Dwelling } from "../data/types";
import { hashSeed } from "../sim/rng";
import {
  makeFridgeProfile,
  fridgePowerW,
  makeLightingProfile,
  lightingPowerW,
} from "../sim/devices";
import { useSimTime } from "../sim/store";
import "./panels.css";

export interface DwellingPanelProps {
  building: Building;
  dwelling: Dwelling;
  onBack: () => void;
  onClose: () => void;
}

function formatWatts(w: number): string {
  return `${Math.round(w)} W`;
}

export function DwellingPanel({ building, dwelling, onBack, onClose }: DwellingPanelProps) {
  const simTimeMs = useSimTime();

  const fridgeProfile = useMemo(
    () => makeFridgeProfile(hashSeed(building.egid, dwelling.ewid, "fridge")),
    [building.egid, dwelling.ewid],
  );
  const lightingProfile = useMemo(
    () => makeLightingProfile(hashSeed(building.egid, dwelling.ewid, "lighting")),
    [building.egid, dwelling.ewid],
  );

  const fridgeW = fridgePowerW(fridgeProfile, simTimeMs);
  const lightingW = lightingPowerW(lightingProfile, simTimeMs);
  const totalW = fridgeW + lightingW;

  return (
    <div className="panel">
      <button className="panel-close" onClick={onClose} aria-label="Close">
        ×
      </button>
      <button className="back-link" onClick={onBack}>
        ← Building {building.egid}
      </button>
      <h2>Dwelling {dwelling.ewid}</h2>
      <dl>
        <dt>Rooms</dt>
        <dd>{dwelling.roomCount ?? "Unknown"}</dd>
        <dt>Area</dt>
        <dd>{dwelling.areaM2 ? `${dwelling.areaM2} m²` : "Unknown"}</dd>
      </dl>

      <h2 style={{ fontSize: 14, marginTop: 14 }}>Devices</h2>
      <div className="device-row">
        <span className="device-name">🧊 Fridge</span>
        <span className={`device-watts${fridgeW === 0 ? " off" : ""}`}>{formatWatts(fridgeW)}</span>
      </div>
      <div className="device-row">
        <span className="device-name">💡 Lighting</span>
        <span className={`device-watts${lightingW === 0 ? " off" : ""}`}>{formatWatts(lightingW)}</span>
      </div>
      <div className="total-row">
        <span>Total</span>
        <span>{formatWatts(totalW)}</span>
      </div>
    </div>
  );
}
