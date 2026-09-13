import { formatDate } from "../sim/calendar";
import "./renewalLog.css";

export interface RenewalLogEntry {
  installedAtMs: number;
  note: string;
}

export interface RenewalLogSectionProps {
  title: string;
  entries: RenewalLogEntry[];
}

/** A player-facing log of past stock-renewal decisions (see heatingRenewal.ts;
 * EV/solar renewal will reuse this same component once they exist) — most
 * recent first, nothing rendered at all once a building/dwelling has no events
 * yet. */
export function RenewalLogSection({ title, entries }: RenewalLogSectionProps) {
  if (entries.length === 0) return null;
  const mostRecentFirst = [...entries].reverse();
  return (
    <>
      <h2 style={{ fontSize: 14, marginTop: 14 }}>{title}</h2>
      <div className="renewal-log">
        {mostRecentFirst.map((entry) => (
          <div className="renewal-log-entry" key={entry.installedAtMs}>
            <div className="renewal-log-date">{formatDate(entry.installedAtMs)}</div>
            <div className="renewal-log-note">{entry.note}</div>
          </div>
        ))}
      </div>
    </>
  );
}
