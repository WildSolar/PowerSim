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

      <div className="tariff-divider" />

      <div className="tariff-row">
        <span className="tariff-label">Solar feed-in</span>
        <input
          type="number"
          min={0}
          max={40}
          step={1}
          value={tariff.feedInPriceRpKWh}
          onChange={(e) => tariffStore.set({ feedInPriceRpKWh: Number(e.target.value) })}
        />
        <span className="tariff-unit">Rp/kWh</span>
      </div>
      <div className="tariff-row">
        <span className="tariff-label">Oil price</span>
        <input
          type="number"
          min={0}
          max={300}
          step={1}
          value={tariff.oilPriceRpPerLiter}
          onChange={(e) => tariffStore.set({ oilPriceRpPerLiter: Number(e.target.value) })}
        />
        <span className="tariff-unit">Rp/L</span>
      </div>
      <div className="tariff-row">
        <span className="tariff-label">Gas price</span>
        <input
          type="number"
          min={0}
          max={40}
          step={1}
          value={tariff.gasPriceRpKWh}
          onChange={(e) => tariffStore.set({ gasPriceRpKWh: Number(e.target.value) })}
        />
        <span className="tariff-unit">Rp/kWh</span>
      </div>
      <div className="tariff-row">
        <span className="tariff-label">District heating</span>
        <input
          type="number"
          min={0}
          max={40}
          step={1}
          value={tariff.districtHeatingPriceRpKWh}
          onChange={(e) => tariffStore.set({ districtHeatingPriceRpKWh: Number(e.target.value) })}
        />
        <span className="tariff-unit">Rp/kWh</span>
      </div>
      <div className="tariff-row" title="At the municipality's own on-street chargers">
        <span className="tariff-label">Public charging</span>
        <input
          type="number"
          min={0}
          max={120}
          step={1}
          value={tariff.publicChargingAcRpKWh}
          onChange={(e) => tariffStore.set({ publicChargingAcRpKWh: Number(e.target.value) })}
        />
        <span className="tariff-unit">Rp/kWh</span>
      </div>
      <div className="tariff-row" title="At the municipality's own fast-charging hubs">
        <span className="tariff-label">Fast charging</span>
        <input
          type="number"
          min={0}
          max={150}
          step={1}
          value={tariff.publicChargingDcRpKWh}
          onChange={(e) => tariffStore.set({ publicChargingDcRpKWh: Number(e.target.value) })}
        />
        <span className="tariff-unit">Rp/kWh</span>
      </div>
      <div className="tariff-row" title="At the municipality's own lorry charging parks">
        <span className="tariff-label">Lorry charging</span>
        <input
          type="number"
          min={0}
          max={150}
          step={1}
          value={tariff.publicChargingFleetRpKWh}
          onChange={(e) => tariffStore.set({ publicChargingFleetRpKWh: Number(e.target.value) })}
        />
        <span className="tariff-unit">Rp/kWh</span>
      </div>
      <div className="tariff-row">
        <span className="tariff-label">Petrol price</span>
        <input
          type="number"
          min={0}
          max={400}
          step={1}
          value={tariff.petrolPriceRpPerLiter}
          onChange={(e) => tariffStore.set({ petrolPriceRpPerLiter: Number(e.target.value) })}
        />
        <span className="tariff-unit">Rp/L</span>
      </div>

      <div className="tariff-divider" />
      <div className="tariff-title">Municipal utility costs</div>
      <div className="tariff-row">
        <span className="tariff-label">Wholesale price</span>
        <input
          type="number"
          min={0}
          max={40}
          step={1}
          value={tariff.wholesalePriceRpKWh}
          onChange={(e) => tariffStore.set({ wholesalePriceRpKWh: Number(e.target.value) })}
        />
        <span className="tariff-unit">Rp/kWh</span>
      </div>
      <div className="tariff-row">
        <span className="tariff-label">Grid maintenance</span>
        <input
          type="number"
          min={0}
          max={40}
          step={1}
          value={tariff.gridMaintenanceRpKWh}
          onChange={(e) => tariffStore.set({ gridMaintenanceRpKWh: Number(e.target.value) })}
        />
        <span className="tariff-unit">Rp/kWh</span>
      </div>
    </div>
  );
}
