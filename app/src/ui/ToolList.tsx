import { useState, type ReactNode } from "react";

/** One group of a tool's list — the town's car parks, the fields being built, a wind site's phase —
 * under a heading with how many there are, and a line summing them up if given. A long group shows
 * its first few, the rest on request. */
export function ToolListGroup({ title, limit = 6, summary, children }: { title: string; limit?: number; summary?: ReactNode; children: ReactNode[] }) {
  const [open, setOpen] = useState(false);
  if (children.length === 0) return null;
  return (
    <div className="tool-list-group">
      <h4 className="tool-list-heading">
        {title}
        <span className="tool-list-count">{children.length}</span>
      </h4>
      {summary && <p className="dh-note tool-list-summary">{summary}</p>}
      {open ? children : children.slice(0, limit)}
      {children.length > limit && (
        <button className="tool-list-more" onClick={() => setOpen(!open)}>
          {open ? "Show fewer" : `Show all ${children.length}`}
        </button>
      )}
    </div>
  );
}

/** One thing in a tool's list: a dot in its colour on the map, its name in full, one figure that
 * matters (labelled), and where it stands on a second line. Click to pick it (its card opens, the map
 * goes there). */
export function ToolListRow({
  color,
  title,
  figure,
  detail,
  selected,
  onClick,
}: {
  color: string;
  title: string;
  figure?: string;
  detail?: string;
  selected: boolean;
  onClick: () => void;
}) {
  return (
    <button className={`tool-list-row${selected ? " selected" : ""}`} aria-pressed={selected} onClick={onClick}>
      <span className="tool-list-dot" style={{ background: color }} aria-hidden />
      <span className="tool-list-title">{title}</span>
      {figure && <span className="tool-list-figure">{figure}</span>}
      {detail && <span className="tool-list-detail">{detail}</span>}
    </button>
  );
}

/** A figure at the top of a tool's drawer: what it counts, the figure, a line under it; what it means
 * on hover. */
export function ToolTile({ label, value, sub, title }: { label: string; value: string; sub?: string; title: string }) {
  return (
    <div className="tool-tile" title={title}>
      <span className="tool-tile-label">{label}</span>
      <span className="tool-tile-value">{value}</span>
      {sub && <span className="tool-tile-sub">{sub}</span>}
    </div>
  );
}

export interface Share {
  label: string;
  value: number;
  color: string;
  /** A hover explanation. */
  title?: string;
}

/** How a whole splits up — the town's households by how they could charge, its buildings by whether
 * they're connected — as one bar in the map's colours, with each part's share named under it. Parts
 * with nothing in them are left out. */
export function ShareBar({ shares, label }: { shares: Share[]; label: string }) {
  const total = shares.reduce((s, x) => s + x.value, 0);
  const shown = shares.filter((s) => s.value > 0);
  if (total <= 0) return null;
  const pct = (v: number) => {
    const p = (v / total) * 100;
    return p > 0 && p < 1 ? "<1%" : `${Math.round(p)}%`;
  };
  return (
    <div className="tool-share" role="img" aria-label={`${label}: ${shown.map((s) => `${s.label} ${pct(s.value)}`).join(", ")}`}>
      <div className="tool-share-bar">
        {shown.map((s) => (
          <span key={s.label} style={{ flexGrow: s.value, background: s.color }} title={`${s.label}: ${pct(s.value)}`} />
        ))}
      </div>
      <div className="tool-share-legend">
        {shown.map((s) => (
          <span key={s.label} className="tool-share-item" title={s.title}>
            <span className="tool-list-dot" style={{ background: s.color }} aria-hidden />
            {s.label} <b>{pct(s.value)}</b>
          </span>
        ))}
      </div>
    </div>
  );
}
