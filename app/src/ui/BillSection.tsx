import { useState } from "react";
import type { BillBreakdown, HeatingFuel } from "../sim/billing";
import type { BillSummary } from "./useBillSummary";
import { formatCHF } from "./format";
import "./panels.css";

const TIERS: { label: string; value: keyof BillSummary; hint: string }[] = [
  { label: "Day", value: "day", hint: "last 24h" },
  { label: "Month", value: "month", hint: "last complete month" },
  { label: "Year", value: "year", hint: "last 12 months" },
];

const HEATING_FUEL_LABEL: Record<Exclude<HeatingFuel, null>, string> = {
  gasBoiler: "🔥 Gas heating",
  oilBoiler: "🛢️ Oil heating",
  districtHeating: "🏭 District heating",
};

/** The unit each fuel's quantity is actually priced/sold in — liters for oil,
 * kWh for gas and district heat (see billing.ts). */
const HEATING_FUEL_UNIT: Record<Exclude<HeatingFuel, null>, string> = {
  gasBoiler: "kWh",
  oilBoiler: "L",
  districtHeating: "kWh",
};

export interface BillSectionProps {
  summary: BillSummary;
}

export function BillSection({ summary }: BillSectionProps) {
  const [tier, setTier] = useState<keyof BillSummary>("day");
  const bill: BillBreakdown = summary[tier];

  return (
    <>
      <div className="tier-buttons">
        {TIERS.map((t) => (
          <button key={t.value} className={t.value === tier ? "active" : ""} onClick={() => setTier(t.value)} title={t.hint}>
            {t.label}
          </button>
        ))}
      </div>
      <div className="device-row">
        <span className="device-name">⚡ Electricity</span>
        <span className="device-watts">{formatCHF(bill.electricityRp)}</span>
      </div>
      {bill.solarCreditRp > 0 && (
        <div className="device-row">
          <span className="device-name">☀️ Solar credit (feed-in)</span>
          <span className="device-watts" style={{ color: "#b8860b" }}>
            -{formatCHF(bill.solarCreditRp)}
          </span>
        </div>
      )}
      {bill.heatingFuel && (
        <div className="device-row">
          <span className="device-name">
            {HEATING_FUEL_LABEL[bill.heatingFuel]}
            <span className="ev-badge">
              {bill.heatingFuelQuantity.toFixed(1)} {HEATING_FUEL_UNIT[bill.heatingFuel]}
            </span>
          </span>
          <span className="device-watts">{formatCHF(bill.heatingFuelRp)}</span>
        </div>
      )}
      <div className="total-row">
        <span>Net bill ({TIERS.find((t) => t.value === tier)!.hint})</span>
        <span>{formatCHF(bill.netRp)}</span>
      </div>
    </>
  );
}
