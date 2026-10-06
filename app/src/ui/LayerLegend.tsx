import {
  GROUND_HEAT_LEGEND,
  HEAT_USE_LEGEND,
  TUNNEL_COLOR,
  AGE_LEGEND,
  CATEGORY_LEGEND,
  CONSTRUCTION_COLOR,
  DISTRICT_HEAT_LEGEND,
  EV_CHARGING_LEGEND,
  ZONING_LEGEND,
  PUBLIC_BUILDINGS_LEGEND,
  GRID_LEGEND,
  DH_PRIORITY_COLOR,
  HIGH_STANDARD_COLOR,
  ZONING_PENDING_COLOR,
  CHARGER_USE_RAMP,
  HEATING_LEGEND,
  INSULATION_LEGEND,
  PIPE_COLOR,
  PIPE_PLANNED_COLOR,
  PIPE_UNCONNECTED_COLOR,
  PIPE_UNDER_CONSTRUCTION_COLOR,
  STREET_UNPIPED_COLOR,
  POWER_RAMP,
  EXPORT_RAMP,
  SOLAR_RAMP,
  type ColorMode,
} from "../map/colorModes";
import "./layerLegend.css";

const DIVERGING_POWER_GRADIENT = [...[...EXPORT_RAMP].reverse(), ...POWER_RAMP].join(",");
const SOLAR_GRADIENT = SOLAR_RAMP.join(",");

/** The legend for a map layer: its buckets or colour ramp, plus the marks it draws
 * (pipes, chargers, zones). Shown as a chip on the map for a view, and inside the
 * drawer for a planning tool. */
export function LayerLegend({ mode }: { mode: ColorMode }) {
  const legends: Partial<Record<ColorMode, typeof CATEGORY_LEGEND>> = {
    category: CATEGORY_LEGEND,
    heating: HEATING_LEGEND,
    groundHeat: GROUND_HEAT_LEGEND,
    districtHeat: DISTRICT_HEAT_LEGEND,
    evCharging: EV_CHARGING_LEGEND,
    zoning: ZONING_LEGEND,
    publicBuildings: PUBLIC_BUILDINGS_LEGEND,
    grid: GRID_LEGEND,
    age: AGE_LEGEND,
    insulation: INSULATION_LEGEND,
  };
  const legend = legends[mode] ?? null;

  return (
    <div className="layer-legend">
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
      {mode === "groundHeat" && <HeatUseLegend />}
      {mode === "districtHeat" && (
        <div className="legend">
          {[
            { label: "Piped street", color: PIPE_COLOR },
            { label: "Pipes being laid", color: PIPE_UNDER_CONSTRUCTION_COLOR },
            { label: "Planned extension", color: PIPE_PLANNED_COLOR },
            { label: "Planned, not connected", color: PIPE_UNCONNECTED_COLOR },
            { label: "Street without pipes", color: STREET_UNPIPED_COLOR },
          ].map((line) => (
            <div className="legend-row" key={line.label}>
              <span className="swatch line-swatch" style={{ background: line.color }} />
              <span>{line.label}</span>
            </div>
          ))}
          {[
            { label: "Heat source", fill: PIPE_COLOR, stroke: "#fff" },
            { label: "Heat source being built", fill: PIPE_UNDER_CONSTRUCTION_COLOR, stroke: "#fff" },
            { label: "Heat within reach", fill: "#fff", stroke: PIPE_COLOR },
          ].map((dot) => (
            <div className="legend-row" key={dot.label}>
              <span className="swatch" style={{ background: dot.fill, border: `2px solid ${dot.stroke}`, borderRadius: "50%", boxShadow: "0 0 0 1px var(--line)" }} />
              <span>{dot.label}</span>
            </div>
          ))}
          <div className="legend-row">
            <span className="swatch" style={{ background: `repeating-linear-gradient(135deg, ${DH_PRIORITY_COLOR} 0 3px, transparent 3px 7px)`, border: `1px solid ${DH_PRIORITY_COLOR}` }} />
            <span>District-heat priority zone</span>
          </div>
        </div>
      )}
      {mode === "zoning" && (
        <div className="legend">
          <div className="legend-row">
            <span className="swatch" style={{ background: "#f2c14e", opacity: 0.95 }} />
            <span>Stronger colour: extra floors allowed</span>
          </div>
          <div className="legend-row">
            <span className="swatch" style={{ background: `repeating-linear-gradient(135deg, ${DH_PRIORITY_COLOR} 0 3px, transparent 3px 7px)` }} />
            <span>District-heat priority zone</span>
          </div>
          <div className="legend-row">
            <span className="swatch" style={{ background: `repeating-linear-gradient(45deg, ${HIGH_STANDARD_COLOR} 0 3px, transparent 3px 7px)` }} />
            <span>High-standard zone</span>
          </div>
          <div className="legend-row">
            <span className="swatch line-swatch" style={{ background: ZONING_PENDING_COLOR }} />
            <span>Change on the way</span>
          </div>
        </div>
      )}
      {mode === "evCharging" && (
        <div className="legend power-legend">
          <div className="power-gradient" style={{ background: `linear-gradient(to right, ${CHARGER_USE_RAMP.join(",")})` }} />
          <div className="power-gradient-labels">
            <span>charger with room</span>
            <span>full</span>
          </div>
          <div className="legend-row">
            <span className="swatch" style={{ background: "#1baf7a", border: "2px solid #1a1a1a", borderRadius: "50%" }} />
            <span>Municipal charger (circle)</span>
          </div>
          <div className="legend-row">
            <span className="swatch" style={{ background: "#1baf7a", border: "1px solid #52514e", borderRadius: 1 }} />
            <span>Private charger (square)</span>
          </div>
          <div className="legend-row">
            <span className="swatch" style={{ background: "#fff", boxShadow: "0 0 0 2px #fff, 0 0 0 4px #1a1a1a", borderRadius: "50%" }} />
            <span>Fast-charging hub (outer ring)</span>
          </div>
          <div className="legend-row">
            <span className="swatch" style={{ background: "#fff", boxShadow: "0 0 0 2px #fff, 0 0 0 4px #7a4fd1", borderRadius: "50%" }} />
            <span>Lorry charging park (violet ring)</span>
          </div>
        </div>
      )}
      <div className="legend">
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
          <div className="legend-row">
            <span className="swatch" style={{ background: "#b6b4ac" }} />
            <span>No solar</span>
          </div>
        </div>
      )}
    </div>
  );
}

/** The Ground heat layer's second legend: the atlas zones drawn under the buildings. */
function HeatUseLegend() {
  return (
    <div className="legend" title="Canton Zurich's heat-use atlas: where heat may be taken from the ground">
      {HEAT_USE_LEGEND.map((entry) => (
        <div className="legend-row" key={entry.bucket}>
          <span className="swatch" style={{ background: entry.color, opacity: 0.45 }} />
          <span>{entry.label}</span>
        </div>
      ))}
      <div className="legend-row">
        <span className="swatch line-swatch" style={{ background: TUNNEL_COLOR }} />
        <span>Tunnel (boreholes keep clear)</span>
      </div>
    </div>
  );
}
