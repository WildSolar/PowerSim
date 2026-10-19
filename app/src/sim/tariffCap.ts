/**
 * The price ceiling on the energy price. For the households it supplies (basic supply), the municipal
 * utility is a monopoly, so the federal regulator (ElCom) holds its energy price to its costs: the
 * power it buys for that year — mostly bought ahead already when the tariff is set (market.ts) — and
 * the concession fee it pays the town, plus a reasonable return and its sales costs (config/
 * tariff.ts) — and what it paid for solar fed in above that power's market value (the federal minimum
 * and its bonus), spread over what it sells, as the regulator counts the feed-in it must take as a
 * procurement cost. A typical household's average energy price over that can't be published. The
 * network fee needs no ceiling: the regulator sets its level outright (networkTariff.ts).
 */

import { ENERGY_SALES_COST_RP_KWH, TARIFF_CAP_MARGIN } from "../config/tariff";
import { concessionRpPerKWh } from "./finances";
import { market } from "./market";
import { monthRecords } from "./monthRecords";

export interface PriceCap {
  /** The most a typical household's energy price may be on average (Rp/kWh). */
  capRpKWh: number;
  /** What it covers, per kWh: the power, the concession fee, the sales costs. */
  wholesaleRpKWh: number;
  concessionRpKWh: number;
  salesRpKWh: number;
  /** What solar fed in cost above its market value, per kWh sold, over the last twelve months. */
  feedInRpKWh: number;
}

/** What the utility paid for solar fed in above that power's market value over the last twelve
 * settled months, per kWh it sold in basic supply (Rp/kWh). */
export function feedInSurchargeRpKWh(): number {
  const recent = monthRecords.all().filter((r) => r.utility).slice(-12);
  let aboveRp = 0;
  let soldKWh = 0;
  for (const r of recent) {
    const u = r.utility!;
    aboveRp += (u.feedInPaidRp ?? 0) - (u.feedInMarketRp ?? 0);
    soldKWh += u.deliveredKWh;
  }
  return soldKWh > 0 ? Math.max(0, aboveRp / soldKWh) : 0;
}

/** The ceiling on the energy price for `year`'s tariff. */
export function energyPriceCap(year: number): PriceCap {
  const wholesaleRpKWh = market.hedgedPrice(year);
  const concessionRpKWh = concessionRpPerKWh();
  const feedInRpKWh = feedInSurchargeRpKWh();
  return {
    capRpKWh: (wholesaleRpKWh + concessionRpKWh) * (1 + TARIFF_CAP_MARGIN) + ENERGY_SALES_COST_RP_KWH + feedInRpKWh,
    wholesaleRpKWh,
    concessionRpKWh,
    salesRpKWh: ENERGY_SALES_COST_RP_KWH,
    feedInRpKWh,
  };
}
