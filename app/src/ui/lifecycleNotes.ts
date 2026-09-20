import type { Building } from "../data/types";
import { formatDate } from "../sim/calendar";
import { underConstructionAt } from "../sim/lifetime";
import { stock } from "../sim/stock";

/** Player-facing lines about a building's place in the town's growth (see sim/stock.ts):
 * where it came from, whether it is still a construction site, and what replaces it. */
export function lifecycleNotes(building: Building, simTimeMs: number): string[] {
  const notes: string[] = [];

  if (building.origin === "new") {
    notes.push(`A new building on a previously vacant plot${building.builtAtMs !== undefined ? `, completed ${formatDate(building.builtAtMs)}` : ""}.`);
  } else if (building.origin === "renewal") {
    const replaced = (building.replacesEgids ?? []).map((egid) => stock.lookup(egid)).filter((b): b is Building => b !== undefined);
    const what = replaced.map((b) => `${b.address ?? `building ${b.egid}`} (built ${b.constructionYear ?? "unknown"}, ${b.dwellings.length} dwelling${b.dwellings.length === 1 ? "" : "s"})`);
    notes.push(`Replaced ${what.join(", ") || "an older building"}${building.builtAtMs !== undefined ? `; completed ${formatDate(building.builtAtMs)}` : ""}.`);
  }

  if (underConstructionAt(building, simTimeMs) && building.builtAtMs !== undefined) {
    notes.push(`Under construction — due for completion ${formatDate(building.builtAtMs)}.`);
  } else if (building.constructionStartMs !== undefined && building.constructionStartMs > simTimeMs) {
    notes.push(`Permitted — work starts ${formatDate(building.constructionStartMs)}.`);
  }

  if (building.demolishedAtMs !== undefined) {
    const successor = building.replacedByEgid ? stock.lookup(building.replacedByEgid) : undefined;
    const when = formatDate(building.demolishedAtMs);
    const tail = successor ? `; a replacement (${successor.dwellings.length} dwellings, ${successor.floorCount ?? "?"} floors) follows` : "";
    notes.push(building.demolishedAtMs <= simTimeMs ? `Demolished ${when}${tail}.` : `Scheduled for demolition ${when}${tail}.`);
  }
  return notes;
}
