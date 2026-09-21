import type { BuildingGroup } from "../config/stock";
import type { Building } from "../data/types";

/** The building's use, reduced to the groups new construction is drawn from. Null for
 * ancillary structures (garages, sheds, silos, farm buildings) — replaced along with a
 * neighbouring project but never a template for new construction. */
export function buildingGroup(building: Building): BuildingGroup | null {
  const c = building.buildingClass ?? "";
  if (/einer Wohnung|zwei\s+Wohnungen/.test(c)) return "houseSingle";
  if (/drei oder mehr|Gemeinschaften/.test(c)) return "apartments";
  if (/Büro|Einzelhandel|Hotel/.test(c)) return "commercial";
  if (/Industrie/.test(c)) return "industrial";
  if (/Schul|Sport|Kult|Kranken|Museen/.test(c)) return "public";
  return null;
}
