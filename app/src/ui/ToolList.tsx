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
