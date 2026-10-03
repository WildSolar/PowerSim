import { useEffect } from "react";
import { X } from "lucide-react";
import { CHANGELOG, CURRENT_RELEASE, VERSION_LABEL, type Release } from "../changelog";
import { GAME_VERSION } from "../sim/saveGame";
import "./changelog.css";

const SEEN_KEY = "cz:lastSeenRelease";

/** Whether this browser's player hasn't yet looked at the current release's notes. */
export function hasUnseenRelease(): boolean {
  try {
    return localStorage.getItem(SEEN_KEY) !== VERSION_LABEL;
  } catch {
    return false;
  }
}

function markSeen(): void {
  try {
    localStorage.setItem(SEEN_KEY, VERSION_LABEL);
  } catch {
    // a per-browser convenience only
  }
}

function releaseDate(release: Release): string {
  if (!release.date) return "In development";
  return new Date(`${release.date}T12:00:00Z`).toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric", timeZone: "UTC" });
}

const GROUPS: { key: "added" | "changed" | "fixed"; label: string }[] = [
  { key: "added", label: "New" },
  { key: "changed", label: "Changed" },
  { key: "fixed", label: "Fixed" },
];

/** "What's new": every release, newest first. */
export function ChangelogPanel({ onClose }: { onClose: () => void }) {
  useEffect(markSeen, []);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.stopPropagation();
        onClose();
      }
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [onClose]);

  return (
    <div className="changelog" role="dialog" aria-label="What's new">
      <header className="cl-head">
        <div>
          <div className="cl-kicker">Commune Zéro</div>
          <div className="cl-version">
            Version {VERSION_LABEL} <span>· build {GAME_VERSION}</span>
          </div>
        </div>
        <button className="cl-close" onClick={onClose} aria-label="Close">
          <X size={18} strokeWidth={1.75} aria-hidden />
        </button>
      </header>
      <div className="cl-body">
        <div className="cl-page">
          <h1>What's new</h1>
          {CHANGELOG.map((release) => (
            <article key={release.version} className={`cl-release${release === CURRENT_RELEASE ? " current" : ""}`}>
              <div className="cl-release-head">
                <h2>{release.version}</h2>
                <span className={`cl-date${release.date ? "" : " dev"}`}>{releaseDate(release)}</span>
              </div>
              {release.title && <div className="cl-title">{release.title}</div>}
              {release.summary && <p className="cl-summary">{release.summary}</p>}
              {GROUPS.map(({ key, label }) =>
                release[key]?.length ? (
                  <section key={key} className="cl-group">
                    <h3>{label}</h3>
                    <ul>
                      {release[key]!.map((item, i) => (
                        <li key={i}>{item}</li>
                      ))}
                    </ul>
                  </section>
                ) : null,
              )}
            </article>
          ))}
        </div>
      </div>
    </div>
  );
}
