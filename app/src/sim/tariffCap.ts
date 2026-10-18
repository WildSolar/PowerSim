/**
 * The price ceiling on the energy price. For the households it supplies (basic supply), the municipal
 * utility is a monopoly, so the federal regulator (ElCom) holds its energy price to its costs: the
 * power it buys for that year — mostly bought ahead already when the tariff is set (market.ts) — and
 * the concession fee it pays the town, plus a reasonable return and its sales costs (config/
 * tariff.ts). A typical household's average energy price over that can't be published. The network
 * fee needs no ceiling: the regulator sets its level outright (networkTariff.ts).
 */

import { ENERGY_SALES_COST_RP_KWH, TARIFF_CAP_MARGIN } from "../config/tariff";
import { concessionRpPerKWh } from "./finances";
import { market } from "./market";

export interface PriceCap {
  /** The most a typical household's energy price may be on average (Rp/kWh). */
  capRpKWh: number;
  /** What it covers, per kWh: the power, the concession fee, the sales costs. */
  wholesaleRpKWh: number;
  concessionRpKWh: number;
  salesRpKWh: number;
}

/** The ceiling on the energy price for `year`'s tariff. */
export function energyPriceCap(year: number): PriceCap {
  const wholesaleRpKWh = market.hedgedPrice(year);
  const concessionRpKWh = concessionRpPerKWh();
  return {
    capRpKWh: (wholesaleRpKWh + concessionRpKWh) * (1 + TARIFF_CAP_MARGIN) + ENERGY_SALES_COST_RP_KWH,
    wholesaleRpKWh,
    concessionRpKWh,
    salesRpKWh: ENERGY_SALES_COST_RP_KWH,
  };
}
