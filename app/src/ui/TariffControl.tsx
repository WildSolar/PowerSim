import { tariffStore } from "../sim/tariffStore";
import { useTariff } from "../sim/store";
import "./tariffControl.css";

export function TariffControl() {
  const tariff = useTariff();

  return (
    <div className="tariff-control">
      <div className="tariff-title">Time-of-use tariff</div>
      <div className="tariff-row">
        <span className="tariff-label">
          Off-peak
          <span className="tariff-window">
            {tariff.offPeakStartHour}:00–{String(tariff.offPeakEndHour).padStart(2, "0")}:00
          </span>
        </span>
        <input
          type="number"
          min={2}
          max={60}
          step={1}
          value={tariff.offPeakPriceRpKWh}
          onChange={(e) => tariffStore.set({ offPeakPriceRpKWh: Number(e.target.value) })}
        />
        <span className="tariff-unit">Rp/kWh</span>
      </div>
      <div className="tariff-row">
        <span className="tariff-label">
          Peak
          <span className="tariff-window">
            {String(tariff.offPeakEndHour).padStart(2, "0")}:00–{tariff.offPeakStartHour}:00
          </span>
        </span>
        <input
          type="number"
          min={2}
          max={80}
          step={1}
          value={tariff.peakPriceRpKWh}
          onChange={(e) => tariffStore.set({ peakPriceRpKWh: Number(e.target.value) })}
        />
        <span className="tariff-unit">Rp/kWh</span>
      </div>
    </div>
  );
}
