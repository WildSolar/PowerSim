import { simClock } from "../sim/engine";
import { ghiWm2 } from "../sim/pv";
import { useSimTime, useSimSpeed } from "../sim/store";
import { formatDate, formatTime } from "../sim/calendar";
import { weatherAt } from "../sim/weather";
import { dayNightStatus } from "./dayNightDisplay";
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
  const dayNight = dayNightStatus(simTimeMs);
  const insolationWm2 = ghiWm2(simTimeMs);

  return (
    <div className="time-control">
      <h3 className="panel-title">Info</h3>
      <div className="clock-readout">
        {formatDate(simTimeMs)} · {formatTime(simTimeMs)}
      </div>
      <div className="info-row">
        <span>{dayNight.icon}</span>
        <span>{dayNight.label}</span>
      </div>
      <div className="info-row">
        <span>{CONDITION_ICON[weather.condition]}</span>
        <span>{CONDITION_LABEL[weather.condition]}</span>
        <span className="info-value">{Math.round(weather.tempC)}°C</span>
      </div>
      <div className="info-row">
        <span>🔆</span>
        <span>Insolation</span>
        <span className="info-value">{Math.round(insolationWm2)} W/m²</span>
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
