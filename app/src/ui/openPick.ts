import { mapFocus } from "../map/mapFocus";
import { districtHeat } from "../sim/districtHeat";
import type { LetterPick } from "../sim/inbox";
import { stock } from "../sim/stock";

/** Shows an advisor's pick on the map: its planning tool open, the building picked (or the place
 * framed), and a district heating extension planned. */
export function showPickOnMap(pick: LetterPick, onOpenTool: (tool: LetterPick["tool"]) => void, onSelectBuilding: (egid: string) => void): void {
  onOpenTool(pick.tool);
  const building = pick.egid ? stock.lookup(pick.egid) : undefined;
  if (pick.tool === "districtHeat" && pick.segments) districtHeat.selectOnly(pick.segments);
  if (building) {
    onSelectBuilding(building.egid);
    mapFocus.focusBuilding(building, 17);
  } else {
    mapFocus.request({ lon: pick.lon, lat: pick.lat, minZoom: 16.5 });
  }
}
