import { useSyncExternalStore } from "react";
import type { Building } from "../data/types";
import { stock } from "../sim/stock";

const subscribe = (listener: () => void) => stock.subscribe(listener);
const getSnapshot = () => stock.getAll();

/** Every building that has existed or is planned (see sim/stock.ts) — a new array
 * whenever the stock changes. Filter by existsAt/visibleAt for a point in time. */
export function useStockBuildings(): Building[] {
  return useSyncExternalStore(subscribe, getSnapshot);
}
