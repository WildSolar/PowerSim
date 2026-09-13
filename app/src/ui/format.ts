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
