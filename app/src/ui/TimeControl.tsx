import { simClock } from "../sim/engine";
import { useSimTime, useSimSpeed } from "../sim/store";
import "./timeControl.css";

const SPEEDS: { label: string; value: number }[] = [
  { label: "II", value: 0 },
  { label: "×1", value: 1 },
  { label: "×60", value: 60 },
  { label: "×720", value: 720 },
  { label: "×3600", value: 3600 },
];

export function TimeControl() {
  const simTimeMs = useSimTime();
  const speed = useSimSpeed();

  const dayMs = 24 * 60 * 60_000;
  const day = Math.floor(simTimeMs / dayMs) + 1;
  const hours = Math.floor((simTimeMs % dayMs) / 3_600_000);
  const minutes = Math.floor((simTimeMs % 3_600_000) / 60_000);

  return (
    <div className="time-control">
      <div className="clock-readout">
        Day {day}, {String(hours).padStart(2, "0")}:{String(minutes).padStart(2, "0")}
      </div>
      <div className="speed-buttons">
        {SPEEDS.map((s) => (
          <button key={s.value} className={s.value === speed ? "active" : ""} onClick={() => simClock.setSpeed(s.value)}>
            {s.label}
          </button>
        ))}
      </div>
    </div>
  );
}
