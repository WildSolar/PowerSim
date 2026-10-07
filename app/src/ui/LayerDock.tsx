import { useState, type ComponentType } from "react";
import {
  Building,
  BrickWall,
  CalendarClock,
  ChevronsLeft,
  ChevronsRight,
  Drill,
  EvCharger,
  Factory,
  Flame,
  LandPlot,
  Map as MapIcon,
  PanelsTopLeft,
  School,
  Sun,
  UtilityPole,
  Zap,
} from "lucide-react";
import type { ColorMode } from "../map/colorModes";
import "./layerDock.css";

interface LayerDef {
  mode: ColorMode;
  label: string;
  Icon: ComponentType<{ size?: number; strokeWidth?: number; "aria-hidden"?: boolean }>;
}

/** Views only colour the map: how things are. */
const VIEWS: LayerDef[] = [
  { mode: "none", label: "Plain map", Icon: MapIcon },
  { mode: "category", label: "Building type", Icon: Building },
  { mode: "age", label: "Age", Icon: CalendarClock },
  { mode: "insulation", label: "Insulation", Icon: BrickWall },
  { mode: "heating", label: "Heating", Icon: Flame },
  { mode: "groundHeat", label: "Ground heat", Icon: Drill },
  { mode: "power", label: "Power draw", Icon: Zap },
  { mode: "solar", label: "Solar", Icon: Sun },
];

/** Planning tools are where the municipality builds and decides on the map. */
const TOOLS: LayerDef[] = [
  { mode: "districtHeat", label: "District heating", Icon: Factory },
  { mode: "evCharging", label: "EV charging", Icon: EvCharger },
  { mode: "grid", label: "Grid", Icon: UtilityPole },
  { mode: "zoning", label: "Zoning", Icon: LandPlot },
  { mode: "publicBuildings", label: "Public buildings", Icon: School },
  { mode: "roofSolar", label: "Roof solar", Icon: PanelsTopLeft },
];

const TOOL_MODES = new Set<ColorMode>(TOOLS.map((t) => t.mode));

/** Whether a layer is a planning tool (it opens a drawer) rather than a view. */
export function isToolLayer(mode: ColorMode): boolean {
  return TOOL_MODES.has(mode);
}

export function layerLabel(mode: ColorMode): string {
  return [...VIEWS, ...TOOLS].find((l) => l.mode === mode)?.label ?? "";
}

const COMPACT_KEY = "gg:dockCompact";

function readCompact(): boolean {
  try {
    return localStorage.getItem(COMPACT_KEY) === "1";
  } catch {
    return false;
  }
}

/** The left dock: views above, planning tools below. Picking the active tool again
 * closes it (back to the plain map). It folds to an icon rail. */
export function LayerDock({ mode, onChange }: { mode: ColorMode; onChange: (mode: ColorMode) => void }) {
  const [compact, setCompact] = useState(readCompact);
  const toggleCompact = () => {
    setCompact((c) => {
      try {
        localStorage.setItem(COMPACT_KEY, c ? "0" : "1");
      } catch {
        // per-viewer convenience only
      }
      return !c;
    });
  };

  const item = (l: LayerDef, tool: boolean) => (
    <li key={l.mode}>
      <button
        className={l.mode === mode ? "active" : ""}
        aria-pressed={l.mode === mode}
        title={compact ? l.label : undefined}
        onClick={() => onChange(tool && l.mode === mode ? "none" : l.mode)}
      >
        <l.Icon size={16} strokeWidth={1.75} aria-hidden />
        {!compact && <span>{l.label}</span>}
      </button>
    </li>
  );

  return (
    <nav className={`layer-dock${compact ? " compact" : ""}`} aria-label="Map layers">
      <h3 className="dock-heading">{compact ? "View" : "Views"}</h3>
      <ul>{VIEWS.map((l) => item(l, false))}</ul>
      <h3 className="dock-heading">{compact ? "Plan" : "Plan & build"}</h3>
      <ul>{TOOLS.map((l) => item(l, true))}</ul>
      <button className="dock-fold" onClick={toggleCompact} title={compact ? "Show labels" : "Fold to icons"} aria-label={compact ? "Show labels" : "Fold to icons"}>
        {compact ? <ChevronsRight size={16} aria-hidden /> : <ChevronsLeft size={16} aria-hidden />}
      </button>
    </nav>
  );
}
