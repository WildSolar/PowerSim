import { Fragment } from "react";
import { COST_TRENDS, type CostTrendId } from "../config/costTrends";
import { priceFactor } from "../sim/costTrends";
import { useSimDay } from "../sim/store";

const YEAR_MS = 365.25 * 24 * 3_600_000;
const OUTLOOK_YEARS = 10;

const GROUPS: { title: string; ids: CostTrendId[] }[] = [
  { title: "Vehicles", ids: ["carEV", "carICE", "bikeElectric", "vanEV", "vanDiesel", "truckEV", "truckDiesel"] },
  { title: "Heating", ids: ["airHeatPump", "groundHeatPump", "districtHeating", "gasBoiler", "oilBoiler"] },
  { title: "Buildings", ids: ["solar", "insulation"] },
  { title: "Infrastructure", ids: ["chargerAc", "chargerDc", "chargerFleet", "depotCharger", "districtHeatPipes"] },
];

function change(factor: number): string {
  const pct = Math.round((factor - 1) * 100);
  return pct === 0 ? "±0%" : `${pct > 0 ? "+" : "−"}${Math.abs(pct)}%`;
}

/** How technology prices have moved since the start of the game, and where they're heading
 * (costTrends.ts) — not something the municipality sets, but what every decision is priced at. */
export function TechnologyPrices() {
  const simDay = useSimDay();
  const later = simDay + OUTLOOK_YEARS * YEAR_MS;
  return (
    <div className="tariff-control tech-prices">
      <div className="tariff-title">Technology prices</div>
      <p className="tech-prices-note">
        Market prices, compared with the start of the game. Nobody sets them; every purchase is priced at them, and subsidies stay the amounts you set.
      </p>
      <div className="tech-prices-grid">
        <span />
        <span className="tech-prices-head">Now</span>
        <span className="tech-prices-head">In {OUTLOOK_YEARS} years</span>
        {GROUPS.map((group) => (
          <Fragment key={group.title}>
            <span className="tech-prices-group">{group.title}</span>
            {group.ids.map((id) => {
              const now = priceFactor(id, simDay);
              const then = priceFactor(id, later);
              return (
                <Fragment key={id}>
                  <span>{COST_TRENDS[id].label}</span>
                  <span className={`tech-prices-value${now < 0.995 ? " down" : now > 1.005 ? " up" : ""}`}>
                    {change(now)}
                  </span>
                  <span className={`tech-prices-value${then < 0.995 ? " down" : then > 1.005 ? " up" : ""}`}>
                    {change(then)}
                  </span>
                </Fragment>
              );
            })}
          </Fragment>
        ))}
      </div>
    </div>
  );
}
