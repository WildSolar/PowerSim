import { PAUSE_SPEED, RUNNING_SPEEDS, setSpeed } from "../sim/timeControls";
import { ghiWm2 } from "../sim/pv";
import { useSimTime, useSimSpeed } from "../sim/store";
import { formatDate, formatTime, formatWeekday } from "../sim/calendar";
import { weatherAt } from "../sim/weather";
import { dayNightStatus } from "./dayNightDisplay";
import { CONDITION_ICON, CONDITION_LABEL } from "./weatherDisplay";
import "./timeControl.css";

const SPEEDS = [{ label: "II", value: PAUSE_SPEED }, ...RUNNING_SPEEDS];

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
        {formatWeekday(simTimeMs)}, {formatDate(simTimeMs)} · {formatTime(simTimeMs)}
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
          <button
            key={s.value}
            title={s.value === PAUSE_SPEED ? "Pause / resume (Space)" : "Cycle speed (Tab)"}
            className={s.value === speed ? "active" : ""}
            onClick={() => setSpeed(s.value)}
          >
            {s.label}
          </button>
        ))}
      </div>
    </div>
  );
}
