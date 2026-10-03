/**
 * Decision chains are keyed "egid:rest" (`120150:heating`, `120150:3:mobility-vehicle-car:1`). In a
 * save they are grouped by building, so the building's number is written once rather than once per
 * chain: { "120150": { "heating": …, "3:mobility-vehicle-car:1": … } }.
 */

export type ChainsByBuilding<V> = Record<string, Record<string, V>>;

export function groupByBuilding<V>(entries: Iterable<[string, V]>): ChainsByBuilding<V> {
  const out: ChainsByBuilding<V> = {};
  for (const [key, value] of entries) {
    const i = key.indexOf(":");
    const egid = i < 0 ? key : key.slice(0, i);
    const rest = i < 0 ? "" : key.slice(i + 1);
    (out[egid] ??= {})[rest] = value;
  }
  return out;
}

export function* ungroup<V>(grouped: ChainsByBuilding<V>): Generator<[string, V]> {
  for (const [egid, chains] of Object.entries(grouped)) {
    for (const [rest, value] of Object.entries(chains)) yield [rest === "" ? egid : `${egid}:${rest}`, value];
  }
}
