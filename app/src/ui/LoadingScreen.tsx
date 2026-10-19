import { useEffect, useState } from "react";
import "./loadingScreen.css";

// What the new department is busy with while the town loads — in turn, a new one every couple of
// seconds, starting with the most important.
const LINES = [
  "Getting the office coffee machine to work…",
  "Installing bureaucracy…",
  "Finding the key to the archive…",
  "Counting every boiler in town…",
  "Reading the gas meters…",
  "Asking the canton for permission to ask…",
  "Untangling the grid…",
  "Polishing the solar panels…",
  "Filing the filing system…",
  "Stamping things, in triplicate…",
  "Convening a commission to plan the meeting…",
  "Translating the minutes into four languages…",
  "Teaching the heat pumps to purr…",
  "Waiting for the PostAuto…",
  "Checking the weather in every corner of town…",
  "Sharpening the red pencils…",
];
const LINE_MS = 2200;

/** While a town loads: the department settling in, and how far the real work has got. */
export function LoadingScreen({ note, progress }: { note: string | null; progress: number | null }) {
  const [index, setIndex] = useState(0);
  useEffect(() => {
    const id = setInterval(() => setIndex((i) => (i + 1) % LINES.length), LINE_MS);
    return () => clearInterval(id);
  }, []);

  return (
    <div className="loading-screen" role="status" aria-live="polite">
      <div className="loading-card">
        <span className="loading-mark" aria-hidden="true" />
        <div className="loading-kicker">Commune Zéro · taking office</div>
        <p className="loading-line" key={index}>
          {LINES[index]}
        </p>
        <div className="loading-bar" aria-hidden="true">
          <span style={progress === null ? undefined : { width: `${Math.round(Math.min(1, Math.max(0, progress)) * 100)}%` }} className={progress === null ? "indeterminate" : ""} />
        </div>
        <div className="loading-note">{note ?? "Opening the town's files…"}</div>
      </div>
    </div>
  );
}
