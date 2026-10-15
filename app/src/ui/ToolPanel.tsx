import { useEffect, useState, type ReactNode } from "react";
import type { ColorMode } from "../map/colorModes";
import { LayerLegend } from "./LayerLegend";
import { SupervisionNotice } from "./SupervisionNotice";
import "./districtHeatPanel.css";
import "./toolPanel.css";

export type ToolTab = "overview" | "build";

// The tab each tool was left on, for when it's opened again.
const remembered = new Map<ColorMode, ToolTab>();

/** A planning tool's drawer, in two tabs: Overview — what the town has, its numbers and lists, and
 * the map's legend — and Build — what can be ordered. Whatever is picked on the map (a charger, a
 * station, a network, a wind site, a building) opens its own card instead (InspectCard.tsx).
 * `buildActive`: something is being planned (a draft, a selection to order); the drawer turns to
 * Build when it starts. */
export function ToolPanel({
  mode,
  title,
  titleExtra,
  overview,
  build,
  buildActive = false,
}: {
  mode: ColorMode;
  title: string;
  titleExtra?: ReactNode;
  overview: ReactNode;
  build: ReactNode;
  buildActive?: boolean;
}) {
  const [tab, setTab] = useState<ToolTab>(() => remembered.get(mode) ?? "overview");
  useEffect(() => {
    if (buildActive) setTab("build");
  }, [buildActive]);
  useEffect(() => {
    remembered.set(mode, tab);
  }, [mode, tab]);

  return (
    <div className="district-heat-panel tool-panel">
      <h3 className="panel-title">
        {title}
        {titleExtra}
      </h3>
      <div className="tool-tabs" role="tablist" aria-label={`${title}: overview or build`}>
        {(["overview", "build"] as ToolTab[]).map((t) => (
          <button key={t} role="tab" aria-selected={tab === t} className={tab === t ? "active" : ""} data-tour={`tool-tab-${t}`} onClick={() => setTab(t)}>
            {t === "overview" ? "Overview" : "Build"}
          </button>
        ))}
      </div>
      {tab === "overview" ? (
        <div className="tool-tab-body" role="tabpanel">
          {overview}
          <details className="tool-legend" open>
            <summary>Legend</summary>
            <LayerLegend mode={mode} />
          </details>
        </div>
      ) : (
        <div className="tool-tab-body" role="tabpanel">
          <SupervisionNotice />
          {build}
        </div>
      )}
    </div>
  );
}
