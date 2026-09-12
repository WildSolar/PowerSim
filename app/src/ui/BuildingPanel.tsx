import type { Building } from "../data/types";
import "./panels.css";

export interface BuildingPanelProps {
  building: Building;
  onSelectDwelling: (ewid: string) => void;
  onClose: () => void;
}

export function BuildingPanel({ building, onSelectDwelling, onClose }: BuildingPanelProps) {
  return (
    <div className="panel">
      <button className="panel-close" onClick={onClose} aria-label="Close">
        ×
      </button>
      <h2>Building {building.egid}</h2>
      <dl>
        <dt>Category</dt>
        <dd>{building.category ?? "Unknown"}</dd>
        <dt>Built</dt>
        <dd>{building.constructionYear ?? "Unknown"}</dd>
        <dt>Floors</dt>
        <dd>{building.floorCount ?? "Unknown"}</dd>
        <dt>Heating</dt>
        <dd>
          {building.heatingGenerator ?? "Unknown"}
          {building.heatingEnergySource ? ` (${building.heatingEnergySource})` : ""}
        </dd>
      </dl>
      <h2 style={{ fontSize: 14, marginTop: 14 }}>Dwellings ({building.dwellings.length})</h2>
      <ul>
        {building.dwellings.map((dwelling) => (
          <li key={dwelling.ewid}>
            <button onClick={() => onSelectDwelling(dwelling.ewid)}>
              Dwelling {dwelling.ewid}
              {dwelling.roomCount ? ` — ${dwelling.roomCount} rooms` : ""}
              {dwelling.areaM2 ? `, ${dwelling.areaM2} m²` : ""}
            </button>
          </li>
        ))}
        {building.dwellings.length === 0 && <li style={{ color: "#888", fontSize: 13 }}>No dwellings on record.</li>}
      </ul>
    </div>
  );
}
