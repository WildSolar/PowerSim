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
