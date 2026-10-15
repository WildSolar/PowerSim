import type { ReactNode } from "react";
import "./districtHeatPanel.css";
import "./panels.css";
import "./toolPanel.css";

/** The card for one thing picked on a planning tool's map — a charger, a transformer station, a
 * district heating network, a wind site: what it is and does, and what can be done with it. It
 * stands where a building's panel does (on the right), and the two take turns. */
export function InspectCard({ kicker, title, titleExtra, onClose, children }: { kicker: string; title: string; titleExtra?: ReactNode; onClose: () => void; children: ReactNode }) {
  return (
    <div className="panel district-heat-panel inspect-card" role="dialog" aria-label={title}>
      <button className="panel-close" onClick={onClose} aria-label="Close" title="Close (Esc)">
        ×
      </button>
      <span className="inspect-kicker">{kicker}</span>
      <h2>
        {title}
        {titleExtra}
      </h2>
      {children}
    </div>
  );
}
