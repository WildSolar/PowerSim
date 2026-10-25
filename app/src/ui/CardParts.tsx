import type { ReactNode } from "react";
import "./panels.css";

// The pieces every card on the right is made of (a building, a home, a charger, a station, a network,
// a wind site, a car park, a field), so they read alike: what it is in a line, what it has as a short
// list of facts, what it does this moment in one line, then sections — what could change here, its
// charts — and the longer things folded away.

/** What it is, in a line under the title: "Apartment building · 4 homes · built 1961". */
export function CardKind({ children }: { children: ReactNode }) {
  return <p className="bp-kind">{children}</p>;
}

export interface Fact {
  label: string;
  value: ReactNode;
  /** A hover explanation, for the label. */
  title?: string;
}

/** What it has now, as label and value. Facts with no value (null, false, undefined) are left out. */
export function Facts({ facts }: { facts: (Fact | null | false | undefined)[] }) {
  const shown = facts.filter((f): f is Fact => !!f && f.value !== null && f.value !== undefined && f.value !== false);
  if (shown.length === 0) return null;
  return (
    <dl className="bp-facts">
      {shown.map((f) => (
        <div key={f.label} className="bp-fact-pair">
          <dt title={f.title}>{f.label}</dt>
          <dd>{f.value}</dd>
        </div>
      ))}
    </dl>
  );
}

/** What it does this moment, in one line. */
export function NowLine({ children, title }: { children: ReactNode; title?: string }) {
  return (
    <div className="bp-now" title={title}>
      <span className="bp-now-label">Right now</span>
      <span>{children}</span>
    </div>
  );
}

/** A section of a card, under a small heading. */
export function CardSection({ title, children }: { title: string; children: ReactNode }) {
  return (
    <>
      <h3 className="section-heading">{title}</h3>
      {children}
    </>
  );
}

/** Something longer, folded away until asked for. */
export function Folded({ summary, children, open }: { summary: string; children: ReactNode; open?: boolean }) {
  return (
    <details className="bp-more" open={open}>
      <summary>{summary}</summary>
      {children}
    </details>
  );
}
