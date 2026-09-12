export function formatWatts(w: number): string {
  const abs = Math.abs(w);
  if (abs >= 1_000_000) return `${(w / 1_000_000).toFixed(2)} MW`;
  if (abs >= 1_000) return `${(w / 1_000).toFixed(1)} kW`;
  return `${Math.round(w)} W`;
}
