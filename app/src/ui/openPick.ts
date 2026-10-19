import { mapFocus } from "../map/mapFocus";
import { districtHeat } from "../sim/districtHeat";
import { districtHeatSources } from "../sim/districtHeatSources";
import { simClock } from "../sim/engine";
import type { LetterPick } from "../sim/inbox";
import { stock } from "../sim/stock";

/** Shows an advisor's pick on the map: its planning tool open, the building picked (or the place
 * framed), and a district heating extension planned. */
export function showPickOnMap(pick: LetterPick, onOpenTool: (tool: LetterPick["tool"]) => void, onSelectBuilding: (egid: string) => void): void {
  onOpenTool(pick.tool);
  const building = pick.egid ? stock.lookup(pick.egid) : undefined;
  if (pick.tool === "districtHeat" && pick.segments) districtHeat.selectOnly(pick.segments);
  // A factory's waste heat: its plant planned, so the tool shows what it would take.
  const candidate = pick.candidateId ? districtHeat.getCandidates().find((c) => c.id === pick.candidateId) : undefined;
  if (candidate && districtHeatSources.availableCandidates(simClock.getSimTimeMs()).some((c) => c.id === candidate.id)) districtHeatSources.startDraft(candidate.kind, candidate.id);
  if (building) {
    onSelectBuilding(building.egid);
    mapFocus.focusBuilding(building, 17);
  } else {
    mapFocus.request({ lon: pick.lon, lat: pick.lat, minZoom: 16.5 });
  }
}
