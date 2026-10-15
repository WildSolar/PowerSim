/**
 * The price ceiling on the household tariff. The municipal utility is a monopoly for the households
 * it supplies, so the federal regulator (ElCom) holds its price to its costs: the power it buys, the
 * grid's upkeep and the concession fee it pays the town, plus a reasonable return on what it has
 * invested (config/tariff.ts). A typical household's average price over that can't be published.
 * The costs are taken as they stand when the tariff is published, so a dearer market raises the
 * ceiling with it.
 */

import { TARIFF_CAP_MARGIN } from "../config/tariff";
import { GRID_UPKEEP_RP_PER_KWH } from "../config/market";
import { concessionRpPerKWh } from "./finances";
import { market } from "./market";

export interface PriceCap {
  /** The most a typical household may pay on average (Rp/kWh). */
  capRpKWh: number;
  /** What it covers, per kWh: the power, the grid, the concession fee. */
  wholesaleRpKWh: number;
  gridRpKWh: number;
  concessionRpKWh: number;
}

export function householdPriceCap(atMs: number): PriceCap {
  const wholesaleRpKWh = market.price("wholesale", atMs);
  const concessionRpKWh = concessionRpPerKWh();
  return {
    capRpKWh: (wholesaleRpKWh + GRID_UPKEEP_RP_PER_KWH + concessionRpKWh) * (1 + TARIFF_CAP_MARGIN),
    wholesaleRpKWh,
    gridRpKWh: GRID_UPKEEP_RP_PER_KWH,
    concessionRpKWh,
  };
}
