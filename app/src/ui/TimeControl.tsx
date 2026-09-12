import { simClock } from "../sim/engine";
import { useSimTime, useSimSpeed } from "../sim/store";
import { formatDate, formatTime } from "../sim/calendar";
import { weatherAt } from "../sim/weather";
import { CONDITION_ICON, CONDITION_LABEL } from "./weatherDisplay";
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
  const weather = weatherAt(simTimeMs);

  return (
    <div className="time-control">
      <div className="clock-readout">
        {formatDate(simTimeMs)} · {formatTime(simTimeMs)}
      </div>
      <div className="weather-readout">
        <span>{CONDITION_ICON[weather.condition]}</span>
        <span>{CONDITION_LABEL[weather.condition]}</span>
        <span className="weather-temp">{Math.round(weather.tempC)}°C</span>
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
