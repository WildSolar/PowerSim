import { AGE_LEGEND, CATEGORY_LEGEND, CONSTRUCTION_COLOR, HEATING_LEGEND, INSULATION_LEGEND, POWER_RAMP, EXPORT_RAMP, SOLAR_RAMP, type ColorMode } from "../map/colorModes";
import "./colorModeControl.css";

const MODES: { key: ColorMode; label: string }[] = [
  { key: "none", label: "Default" },
  { key: "category", label: "Building type" },
  { key: "heating", label: "Heating" },
  { key: "power", label: "Power draw" },
  { key: "solar", label: "Solar" },
  { key: "age", label: "Age" },
  { key: "insulation", label: "Insulation" },
];

const DIVERGING_POWER_GRADIENT = [...[...EXPORT_RAMP].reverse(), ...POWER_RAMP].join(",");
const SOLAR_GRADIENT = SOLAR_RAMP.join(",");

export interface ColorModeControlProps {
  mode: ColorMode;
  onChange: (mode: ColorMode) => void;
}

export function ColorModeControl({ mode, onChange }: ColorModeControlProps) {
  const legend = mode === "category" ? CATEGORY_LEGEND : mode === "heating" ? HEATING_LEGEND : mode === "age" ? AGE_LEGEND : mode === "insulation" ? INSULATION_LEGEND : null;

  return (
    <div className="color-mode-control">
      <h3 className="panel-title">Layers</h3>
      <div className="mode-buttons">
        {MODES.map((m) => (
          <button key={m.key} className={m.key === mode ? "active" : ""} onClick={() => onChange(m.key)}>
            {m.label}
          </button>
        ))}
      </div>
      {legend && (
        <div className="legend">
          {legend.map((entry) => (
            <div className="legend-row" key={entry.bucket}>
              <span className="swatch" style={{ background: entry.color }} />
              <span>{entry.label}</span>
            </div>
          ))}
        </div>
      )}
      <div className="legend" style={{ marginTop: 6 }}>
        <div className="legend-row">
          <span className="swatch" style={{ background: CONSTRUCTION_COLOR }} />
          <span>Construction site</span>
        </div>
      </div>
      {mode === "power" && (
        <div className="legend power-legend">
          <div className="power-gradient" style={{ background: `linear-gradient(to right, ${DIVERGING_POWER_GRADIENT})` }} />
          <div className="power-gradient-labels">
            <span>exporting</span>
            <span>importing</span>
          </div>
        </div>
      )}
      {mode === "solar" && (
        <div className="legend power-legend">
          <div className="power-gradient" style={{ background: `linear-gradient(to right, ${SOLAR_GRADIENT})` }} />
          <div className="power-gradient-labels">
            <span>0 kWp</span>
            <span>largest installation</span>
          </div>
          <div className="legend-row" style={{ marginTop: 6 }}>
            <span className="swatch" style={{ background: "#b6b4ac" }} />
            <span>No solar</span>
          </div>
        </div>
      )}
    </div>
  );
}
