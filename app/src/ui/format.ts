export function formatWatts(w: number): string {
  const abs = Math.abs(w);
  if (abs >= 1_000_000) return `${(w / 1_000_000).toFixed(2)} MW`;
  if (abs >= 1_000) return `${(w / 1_000).toFixed(1)} kW`;
  return `${Math.round(w)} W`;
}

export function formatKWh(kWh: number): string {
  const abs = Math.abs(kWh);
  if (abs >= 1_000) return `${(kWh / 1_000).toFixed(2)} MWh`;
  if (abs >= 10) return `${kWh.toFixed(1)} kWh`;
  return `${kWh.toFixed(2)} kWh`;
}

/** Rappen (1/100 CHF, the unit every tariff price is entered in) to a Swiss-
 * formatted CHF string — full cents for everyday bills, rounded to francs once
 * a total gets into the thousands (a whole-building yearly bill) where cents
 * stop being meaningful. */
export function formatCHF(rp: number): string {
  const chf = rp / 100;
  const decimals = Math.abs(chf) >= 1_000 ? 0 : 2;
  return `CHF ${chf.toLocaleString("de-CH", { minimumFractionDigits: decimals, maximumFractionDigits: decimals })}`;
}

/** formatCHF, in millions from a million up (CHF 2.72 M). */
export function formatCHFCompact(rp: number): string {
  const chf = rp / 100;
  if (Math.abs(chf) < 1_000_000) return formatCHF(rp);
  return `CHF ${(chf / 1_000_000).toLocaleString("de-CH", { minimumFractionDigits: 2, maximumFractionDigits: 2 })} M`;
}

export function formatCO2(kg: number): string {
  const abs = Math.abs(kg);
  if (abs >= 1_000_000) return `${(kg / 1_000_000).toFixed(2)} kt CO₂`;
  if (abs >= 1_000) return `${(kg / 1_000).toFixed(1)} t CO₂`;
  return `${kg.toFixed(0)} kg CO₂`;
}
