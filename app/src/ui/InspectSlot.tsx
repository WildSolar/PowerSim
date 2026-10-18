import { useSyncExternalStore } from "react";
import type { ColorMode } from "../map/colorModes";
import { districtHeat } from "../sim/districtHeat";
import { grid } from "../sim/grid";
import { publicCharging } from "../sim/publicCharging";
import { wind } from "../sim/wind";
import { carParks } from "../sim/carParks";
import { agriPv } from "../sim/agriPv";
import { AgriPvFieldCard } from "./AgriPvPanel";
import { CarParkCard } from "./CarParksPanel";
import { NetworkInspectCard } from "./DistrictHeatPanel";
import { ChargerCard } from "./EvChargingPanel";
import { StationCard } from "./GridPanel";
import { WindSiteCard } from "./WindPanel";

/** What's picked in the planning tool that's open — a charger, a station, a network, a wind site, a car park, a field —
 * as a key, or null. A building picked in the same tool shows the building's own panel instead; App
 * keeps the two from standing at once. */
export function useInspected(mode: ColorMode): string | null {
  const charger = useSyncExternalStore(
    (l) => publicCharging.subscribe(l),
    () => publicCharging.getSelectedId(),
  );
  const station = useSyncExternalStore(
    (l) => grid.subscribe(l),
    () => grid.getSelectedId(),
  );
  const network = useSyncExternalStore(
    (l) => districtHeat.subscribe(l),
    () => districtHeat.getPicked(),
  );
  const site = useSyncExternalStore(
    (l) => wind.subscribe(l),
    () => wind.getSelectedId(),
  );
  const lot = useSyncExternalStore(
    (l) => carParks.subscribe(l),
    () => carParks.getSelectedId(),
  );
  const field = useSyncExternalStore(
    (l) => agriPv.subscribe(l),
    () => agriPv.getSelectedId(),
  );
  if (mode === "evCharging" && charger) return `charger:${charger}`;
  if (mode === "grid" && station !== null) return `station:${station}`;
  if (mode === "districtHeat" && network) return `network:${network.sourceId ?? network.segmentId}`;
  if (mode === "wind" && site) return `wind:${site}`;
  if (mode === "carParks" && lot) return `carPark:${lot}`;
  if (mode === "agriPv" && field) return `agriPv:${field}`;
  return null;
}

/** Lets go of whatever is picked in every planning tool (a building was picked instead). */
export function clearInspected(): void {
  if (publicCharging.getSelectedId() !== null) publicCharging.select(null);
  if (grid.getSelectedId() !== null) grid.select(null);
  if (districtHeat.getPicked()) districtHeat.pickNetwork(null);
  if (wind.getSelectedId() !== null) wind.select(null);
  if (carParks.getSelectedId() !== null) carParks.select(null);
  if (agriPv.getSelectedId() !== null) agriPv.select(null);
}

/** The card for what's picked in the open tool. */
export function InspectSlot({ mode }: { mode: ColorMode }) {
  if (mode === "evCharging") return <ChargerCard />;
  if (mode === "grid") return <StationCard />;
  if (mode === "districtHeat") return <NetworkInspectCard />;
  if (mode === "wind") return <WindSiteCard />;
  if (mode === "carParks") return <CarParkCard />;
  if (mode === "agriPv") return <AgriPvFieldCard />;
  return null;
}
