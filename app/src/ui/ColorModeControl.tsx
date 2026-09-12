import { CATEGORY_LEGEND, HEATING_LEGEND, POWER_RAMP, type ColorMode } from "../map/colorModes";
import "./colorModeControl.css";

const MODES: { key: ColorMode; label: string }[] = [
  { key: "none", label: "Default" },
  { key: "category", label: "Building type" },
  { key: "heating", label: "Heating" },
  { key: "power", label: "Power draw" },
];

export interface ColorModeControlProps {
  mode: ColorMode;
  onChange: (mode: ColorMode) => void;
}

export function ColorModeControl({ mode, onChange }: ColorModeControlProps) {
  const legend = mode === "category" ? CATEGORY_LEGEND : mode === "heating" ? HEATING_LEGEND : null;

  return (
    <div className="color-mode-control">
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
      {mode === "power" && (
        <div className="legend power-legend">
          <div className="power-gradient" style={{ background: `linear-gradient(to right, ${POWER_RAMP.join(",")})` }} />
          <div className="power-gradient-labels">
            <span>0 W</span>
            <span>highest live draw</span>
          </div>
        </div>
      )}
    </div>
  );
}
