import { useMemo, useState, useSyncExternalStore } from "react";
import { BUILD_SPEC, MAX_FILL, QOS_CURVE, QOS_FLOOR, type ChargingKind, type QosKind } from "../config/charging";
import { COVERAGE_COLOR } from "../map/colorModes";
import { formatDate, toDateMs, toSimTimeMs } from "../sim/calendar";
import { simClock } from "../sim/engine";
import { existsAt } from "../sim/lifetime";
import {
  buildCostRp,
  buildMonthsFor,
  qosKindOf,
  qosReachM,
  sizesFor,
  upgradeCostRp,
  publicCharging,
  siteCapacityAt,
  sitePriceRpPerKWh,
  sitePriceWindows,
  workChargingShareAt,
  type ChargingSite,
  type VehicleCounts,
} from "../sim/publicCharging";
import { fleets } from "../sim/fleet";
import { mapFocus } from "../map/mapFocus";
import { useSimDay } from "../sim/store";
import { chargingTariff } from "../sim/chargingTariff";
import { tariffStore } from "../sim/tariffStore";
import { formatCHF } from "./format";
import { useStockBuildings } from "./useStock";
import "./districtHeatPanel.css";
import "./evChargingPanel.css";
import { InspectCard } from "./InspectCard";
import { ToolPanel } from "./ToolPanel";

const YEAR_MS = 365.25 * 24 * 60 * 60_000;
const QUARTER_HOUR_MS = 15 * 60_000;
const HISTORY_YEARS = 8;

const KIND_LABEL: Record<ChargingKind, string> = { ac: "On-street", dc: "Fast charging", fleet: "Lorries and vans only" };
/** "200 m", "1 km", "1.5 km". */
function distanceLabel(m: number): string {
  return m >= 1000 ? `${Number((m / 1000).toFixed(1))} km` : `${m} m`;
}

/** How far a kind of charger reaches, for the player: full quality up to here, nothing from there. */
/** When a site is busiest, by how the vehicles relying on it charge (publicCharging.ts's sessions). */
function busiestLabel(site: ChargingSite): string {
  if (site.kind === "ac" && !site.shop) return "Evenings and overnight";
  if (site.shop) return "Shopping hours";
  return "During the day";
}

function reachLabel(kind: QosKind): string {
  const how = kind === "ac" ? "on foot" : "by road";
  return `best within ${distanceLabel(QOS_CURVE[kind].plateauM)} ${how}, fading out by ${distanceLabel(qosReachM(kind))}`;
}

const BUILD_HINT: Record<ChargingKind, string> = {
  ac: `Cars and vans charging overnight — ${reachLabel("ac")}`,
  dc: `Cars and vans, and lorries — ${reachLabel("dc")}`,
  fleet: "Businesses' lorries and vans only, across the town",
};
const KIND_ICON: Record<ChargingKind, string> = { ac: "", dc: "⚡ ", fleet: "🚚 " };

function percent(part: number, total: number): string {
  return total > 0 ? `${Math.round((part / total) * 100)}%` : "–";
}

/** "12 cars, 3 vans, 1 lorry" — the kinds present only. */
function vehicleList(v: VehicleCounts): string {
  const parts: string[] = [];
  if (v.car > 0) parts.push(`${v.car} car${v.car === 1 ? "" : "s"}`);
  if (v.van > 0) parts.push(`${v.van} van${v.van === 1 ? "" : "s"}`);
  if (v.truck > 0) parts.push(`${v.truck} ${v.truck === 1 ? "lorry" : "lorries"}`);
  return parts.length > 0 ? parts.join(", ") : "none yet";
}

/** Selects a charger picked from a list and brings it into view on the map. */
function focusSite(site: ChargingSite): void {
  publicCharging.select(site.id);
  mapFocus.request({ lon: site.lon, lat: site.lat });
}

/** A price rounded to the franc thousand, for build buttons. */
function priceTag(rp: number): string {
  return formatCHF(Math.round(rp / 100_000) * 100_000);
}

/** The same, compact ("CHF 60k", "CHF 1.05M"), for the narrow size buttons. */
function shortPriceTag(rp: number): string {
  const chf = rp / 100;
  return chf >= 1_000_000 ? `CHF ${Number((chf / 1_000_000).toFixed(2))}M` : `CHF ${Math.round(chf / 1000)}k`;
}

type OwnerFilter = "all" | "municipal" | "private";
type KindFilter = "all" | ChargingKind;
const OWNER_FILTERS: { id: OwnerFilter; label: string }[] = [
  { id: "all", label: "All" },
  { id: "municipal", label: "Municipal" },
  { id: "private", label: "Private" },
];
const KIND_FILTERS: { id: KindFilter; label: string }[] = [
  { id: "all", label: "All kinds" },
  { id: "ac", label: "On-street" },
  { id: "dc", label: "Fast" },
  { id: "fleet", label: "Lorry" },
];
const BUSIEST_COUNT = 6;

const COVERAGE_KINDS: QosKind[] = ["ac", "shop", "dc", "fleet"];
const COVERAGE_LABEL: Record<QosKind, string> = { ac: "On-street", shop: "Shops", dc: "Fast charging", fleet: "Lorry parks" };
const NONE_YET: Record<QosKind, string> = {
  ac: "No on-street chargers yet",
  shop: "No chargers in shops' car parks",
  dc: "No fast-charging hubs yet",
  fleet: "No lorry charging parks yet",
};

function formatMWh(kWh: number): string {
  return kWh >= 10_000 ? `${Math.round(kWh / 1000)} MWh` : `${(kWh / 1000).toFixed(1)} MWh`;
}

function monthYear(simTimeMs: number): string {
  return formatDate(simTimeMs).replace(/^\d+ /, "");
}

/** The simulated time to the quarter hour — live enough for "charging right now". */
function useSimQuarterHour(): number {
  return useSyncExternalStore(
    (callback) => simClock.subscribe(callback),
    () => Math.floor(simClock.getSimTimeMs() / QUARTER_HOUR_MS) * QUARTER_HOUR_MS,
  );
}

function UsageBar({ used, capacity }: { used: number; capacity: number }) {
  const share = capacity > 0 ? used / capacity : 0;
  const level = share >= 1 ? " full" : share >= 0.7 ? " busy" : "";
  return (
    <div className="dh-bar">
      <div className={`ev-bar-fill${level}`} style={{ width: `${Math.min(100, share * 100)}%` }} />
    </div>
  );
}

/** How full a site was at each of the last New Years (against the shaded full mark). */
function UsageHistory({ site, now }: { site: ChargingSite; now: number }) {
  const year = new Date(toDateMs(now)).getUTCFullYear();
  const columns = [];
  for (let y = year - HISTORY_YEARS + 1; y <= year; y++) {
    const at = y === year ? now : toSimTimeMs(Date.UTC(y + 1, 0, 1)) - 1;
    if (at < 0 && y !== year) continue; // before the game started
    const capacity = siteCapacityAt(site, at);
    columns.push({ year: y, fill: capacity > 0 ? publicCharging.usersAt(site.id, at) / capacity : 0, open: capacity > 0 });
  }
  const max = Math.max(1, ...columns.map((c) => c.fill));
  return (
    <div className="ev-history">
      {columns.map((c) => (
        <div
          className="ev-history-col"
          key={c.year}
          title={`${c.year === year ? "Now" : `End of ${c.year}`}: ${c.open ? `${Math.round(c.fill * 100)}% full` : "not open"}`}
        >
          <div className="ev-history-plot">
            <div className="ev-history-capacity" style={{ height: c.open ? `${(1 / max) * 100}%` : 0 }} />
            <div className="ev-history-users" style={{ height: `${(c.fill / max) * 100}%` }} />
          </div>
          <span className="ev-history-year">{String(c.year).slice(2)}</span>
        </div>
      ))}
    </div>
  );
}

/** The card for the charger picked on the map or in a list: who runs it, who relies on it, how
 * full it is and was, and — the municipality's own — enlarging it. */
export function ChargerCard() {
  useSyncExternalStore(
    (listener) => publicCharging.subscribe(listener),
    () => publicCharging.getVersion(),
  );
  const now = useSimQuarterHour();
  const selectedId = publicCharging.getSelectedId();
  const site = selectedId ? publicCharging.getSite(selectedId) : undefined;
  if (!site) return null;
  return (
    <InspectCard kicker={site.shop ? "Charger in a shop's car park" : `${KIND_LABEL[site.kind]} charger`} title={site.name} onClose={() => publicCharging.select(null)}>
      <SiteDetails site={site} now={now} />
    </InspectCard>
  );
}

const WINDOW_LABEL = { night: "At night", solar: "In solar hours" } as const;

/** A site's price — at the municipality's own, by window once they differ, with the share of its
 * energy in each. */
function PriceRows({ site, now }: { site: ChargingSite; now: number }) {
  if (site.owner !== "municipal") {
    return (
      <div className="info-row">
        <span>Price</span>
        <span className="info-value">{sitePriceRpPerKWh(site, now)} Rp/kWh</span>
      </div>
    );
  }
  const { prices, shares, solarDays } = sitePriceWindows(site, now);
  if (prices.night === prices.standard && prices.solar === prices.standard) {
    return (
      <div className="info-row" title="Set in the tariff, under Prices. A cheaper price at night or in the town's solar hours moves charging there.">
        <span>Price</span>
        <span className="info-value">{prices.standard} Rp/kWh</span>
      </div>
    );
  }
  const sheet = tariffStore.sheetFor(new Date(toDateMs(now)).getUTCFullYear());
  const hours = { night: `${sheet.offPeakStartHour}:00–${sheet.offPeakEndHour}:00`, solar: "when the town's own solar makes more than it uses" };
  // Why a window sells nothing, where that isn't plain.
  const street = site.kind === "ac" && !site.shop;
  const why: Record<"night" | "solar", string | null> = {
    night: site.shop ? "The shop is closed at night." : prices.night > prices.standard ? "Dearer than by day, so nobody charges then." : null,
    solar:
      solarDays === 0
        ? "No solar hours this year yet: on no day are your town's own solar and wind forecast to make more than it uses."
        : street && prices.solar > Math.min(prices.standard, prices.night)
          ? "Cars here charge in the evening or overnight; only drivers at home by day would come in solar hours, and only if they were the cheapest."
          : null,
  };
  return (
    <>
      <div className="info-row" title="Set in the tariff, under Prices: the price outside the night and solar hours, and the share of this charger's energy sold at it">
        <span>Price by day</span>
        <span className="info-value">
          {prices.standard} Rp/kWh · {percent(shares.standard, 1)} of its energy
        </span>
      </div>
      {(["night", "solar"] as const)
        .filter((w) => prices[w] !== prices.standard)
        .map((w) => (
          <div key={w}>
            <div className="info-row" title={`${hours[w]} — and the share of this charger's energy sold at that price`}>
              <span>{WINDOW_LABEL[w]}</span>
              <span className="info-value">
                {prices[w]} Rp/kWh · {percent(shares[w], 1)}
              </span>
            </div>
            {shares[w] < 0.005 && why[w] && <p className="dh-note">{why[w]}</p>}
          </div>
        ))}
    </>
  );
}

function SiteDetails({ site, now }: { site: ChargingSite; now: number }) {
  const stats = publicCharging.stats(site, now);
  const building = now < site.openedAtMs;
  const pending = site.expansions.filter((e) => e.atMs > now);
  const planned = publicCharging.plannedPoints(site);
  const owner = site.owner === "municipal" ? "The municipality" : site.id.startsWith("real-") ? "Private (in the federal register)" : "Private operator";
  const inUse = building ? { pluggedIn: 0, charging: 0 } : publicCharging.pointsInUseAt(site, now);

  return (
    <>
      <div className="info-row">
        <span>Run by</span>
        <span className="info-value">{owner}</span>
      </div>
      <div className="info-row">
        <span>{KIND_LABEL[site.kind]}</span>
        <span className="info-value">
          {building ? site.points : stats.points} × {site.powerKw} kW
        </span>
      </div>
      <PriceRows site={site} now={now} />
      {site.kind !== "fleet" && (
        <div
          className="info-row"
          title={`How much of a household's charging it can do at best: ${Math.round(QOS_CURVE[qosKindOf(site)].ceiling * 100)}%, less the further away along the streets, and less as it fills up. The blue lines on the map show how far it reaches.`}
        >
          <span>Reach</span>
          <span className="info-value">{reachLabel(qosKindOf(site))}</span>
        </div>
      )}
      {building ? (
        <p className="dh-note">Being built — opens {formatDate(site.openedAtMs)}.</p>
      ) : (
        <>
          <div className="info-row" title="Vehicles that do some or all of their charging here">
            <span>Relying on it</span>
            <span className="info-value">{vehicleList(stats.vehicles)}</span>
          </div>
          <div
            className="info-row"
            title={`How much of its room the vehicles relying on it take: one charging all its needs here takes more than one charging part of them here, a van about twice a car's, a lorry many times. The fuller it gets, the less use it is to anyone — a busy charger means hunting for a free spot — and past ${Math.round(MAX_FILL * 100)}% it takes nobody new.${site.owner === "municipal" && site.kind !== "ac" ? " Cheaper prices at night or in solar hours spread its use out of the busy hours and give it room for more." : ""}`}
          >
            <span>How full</span>
            <span className="info-value">{percent(stats.users, stats.capacity)}</span>
          </div>
          <UsageBar used={stats.users} capacity={stats.capacity} />
          <div
            className="info-row"
            style={{ marginTop: 6 }}
            title="Vehicles at a charge point right now. Those relying on a charger don't charge there every day: on the street a car plugs in in the evening and stays until morning, at a hub it stops for about half an hour. So even a charger with no room left stands empty much of the day."
          >
            <span>Plugged in right now</span>
            <span className="info-value">
              {inUse.pluggedIn} of {stats.points} points{inUse.pluggedIn > 0 ? ` · ${inUse.charging} charging` : ""}
            </span>
          </div>
          <div className="info-row">
            <span>Busiest</span>
            <span className="info-value">{busiestLabel(site)}</span>
          </div>
          <div className="info-row">
            <span>Energy per day</span>
            <span className="info-value">{Math.round(stats.kWhPerDay)} kWh</span>
          </div>
          <div className="info-row">
            <span>Last 12 months</span>
            <span className="info-value">{formatMWh(stats.kWhLastYear)}</span>
          </div>
          {site.owner === "municipal" && (
            <>
              <div className="info-row">
                <span>Sales, last 12 months</span>
                <span className="info-value">{formatCHF(stats.revenueLastYearRp)}</span>
              </div>
              <div className="info-row">
                <span>Upkeep per year</span>
                <span className="info-value">{formatCHF(stats.upkeepPerYearRp)}</span>
              </div>
            </>
          )}
          <h4 className="ev-history-title">How full, year by year</h4>
          <UsageHistory site={site} now={now} />
        </>
      )}
      {pending.map((e) => (
        <p className="dh-note" key={e.atMs}>
          {site.owner === "municipal" ? "Adding" : "The operator is adding"} {e.points} points — ready {monthYear(e.atMs)}.
        </p>
      ))}
      {site.owner === "municipal" && sizesFor(site.kind).some((s) => s.points > planned) && (
        <>
          <h4 className="ev-history-title">Enlarge (ready in some months)</h4>
          <div className="ev-sizes">
            {sizesFor(site.kind)
              .filter((size) => size.points > planned)
              .map(({ points }) => (
                <button key={points} onClick={() => publicCharging.upgrade(site.id, points, simClock.getSimTimeMs())}>
                  <span className="ev-build-name">To {points} points</span>
                  <span className="ev-build-detail">{shortPriceTag(upgradeCostRp(site.kind, planned, points, now))}</span>
                </button>
              ))}
          </div>
        </>
      )}
    </>
  );
}

/** The EV charging layer's own panel: how the town's households could charge an electric car,
 * the public chargers' use, building new municipal ones, and the selected charger's own usage. */
export function EvChargingPanel() {
  const version = useSyncExternalStore(
    (listener) => publicCharging.subscribe(listener),
    () => publicCharging.getVersion(),
  );
  const simDay = useSimDay();
  // The charging tariff this year: who put their wallbox on its meter (decided once a year, cached).
  const meterUptake = tariffStore.sheetFor(new Date(toDateMs(simDay)).getUTCFullYear()).chargingTariffOffered ? chargingTariff.uptakeAt(simDay) : null;
  const meters = { offered: meterUptake !== null, on: meterUptake?.households.size ?? 0, eligible: meterUptake?.eligible ?? 0 };
  const buildings = useStockBuildings();
  const placing = publicCharging.getPlacing();
  const coverage = publicCharging.getCoverage();
  const selectedId = publicCharging.getSelectedId();

  const town = useMemo(() => {
    const standing = buildings.filter((b) => existsAt(b, simDay));
    let households = 0;
    const byAccess = { home: 0, mayInstall: 0, q4: 0, q3: 0, q2: 0, q1: 0, none: 0 };
    for (const access of publicCharging.householdAccess(standing, simDay).values()) {
      households += access.households;
      byAccess.home += access.atHome;
      byAccess.mayInstall += access.mayInstall;
      const q = access.qos;
      byAccess[q >= 0.75 ? "q4" : q >= 0.5 ? "q3" : q >= 0.25 ? "q2" : q >= QOS_FLOOR ? "q1" : "none"] += access.households - access.atHome;
    }
    return {
      households,
      byAccess,
      usage: publicCharging.townUsage(simDay),
      unmet: publicCharging.unmetDemandCount(simDay - YEAR_MS, simDay),
      fleet: fleets.census(standing, simDay),
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [buildings, simDay, version]);

  const [ownerFilter, setOwnerFilter] = useState<OwnerFilter>("all");
  const [kindFilter, setKindFilter] = useState<KindFilter>("all");
  const busiest = useMemo(
    () =>
      publicCharging
        .getSites()
        .filter((s) => siteCapacityAt(s, simDay) > 0)
        .filter((s) => ownerFilter === "all" || s.owner === ownerFilter)
        .filter((s) => kindFilter === "all" || s.kind === kindFilter)
        .map((s) => ({ site: s, users: publicCharging.usersAt(s.id, simDay), capacity: siteCapacityAt(s, simDay) }))
        .sort((a, b) => b.users / b.capacity - a.users / a.capacity || b.users - a.users)
        .slice(0, BUSIEST_COUNT),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [simDay, version, ownerFilter, kindFilter],
  );
  const underConstruction = publicCharging.getSites().filter((s) => s.openedAtMs > simDay);

  const overview = (
    <>
      <div className="ev-coverage" title="Show how far each kind of charger reaches along the streets — the stronger the colour, the better the charging there (chargers being built included)">
        <span className="ev-coverage-label">Coverage</span>
        {COVERAGE_KINDS.map((kind) => (
          <button
            key={kind}
            className={`ev-coverage-toggle${coverage.has(kind) ? " on" : ""}`}
            disabled={!publicCharging.getSites().some((s) => qosKindOf(s) === kind)}
            title={publicCharging.getSites().some((s) => qosKindOf(s) === kind) ? reachLabel(kind) : NONE_YET[kind]}
            onClick={() => publicCharging.toggleCoverage(kind)}
          >
            <span className="ev-coverage-swatch" style={{ background: COVERAGE_COLOR[kind] }} />
            {COVERAGE_LABEL[kind]}
          </button>
        ))}
      </div>

      <div className="info-row">
        <span>Public charging sites</span>
        <span className="info-value">
          {town.usage.sites} · {town.usage.points} points
        </span>
      </div>
      <div className="info-row" title="Electric cars of households without home charging, and businesses' vans and lorries without a yard to charge in, that rely on public chargers">
        <span>Charging publicly</span>
        <span className="info-value">{vehicleList(town.usage.vehicles)}</span>
      </div>
      <div className="info-row" title="How much of the public chargers' room is taken, all of them together: a van needs about twice a car's, a lorry many times">
        <span>How full</span>
        <span className="info-value">{percent(town.usage.users, town.usage.capacity)}</span>
      </div>
      <UsageBar used={town.usage.users} capacity={town.usage.capacity} />

      <div
        className="ev-access"
        title="Of every household in the municipality, whether or not it has an electric car yet. For those without a wallbox: how much of their charging the public chargers around could do — how close they are along the streets, and how busy. Charging at work comes on top, for those who can. A household that may put in a wallbox weighs its cost against relying on public chargers when it buys an electric car."
      >
        <div className="info-row">
          <span>Households with a wallbox</span>
          <span className="info-value">{percent(town.byAccess.home, town.households)}</span>
        </div>
        <div className="info-row">
          <span>Without a wallbox: public charging very good (75%+)</span>
          <span className="info-value">{percent(town.byAccess.q4, town.households)}</span>
        </div>
        <div className="info-row">
          <span>…good (50–75%)</span>
          <span className="info-value">{percent(town.byAccess.q3, town.households)}</span>
        </div>
        <div className="info-row">
          <span>…fair (25–50%)</span>
          <span className="info-value">{percent(town.byAccess.q2, town.households)}</span>
        </div>
        <div className="info-row">
          <span>…poor (10–25%)</span>
          <span className="info-value">{percent(town.byAccess.q1, town.households)}</span>
        </div>
        <div className="info-row">
          <span>…too little to rely on</span>
          <span className="info-value">{percent(town.byAccess.none, town.households)}</span>
        </div>
        <div className="info-row" title="Households without a wallbox that have their own parking space and may put one in — or may by the right to charge. They weigh its cost against public charging when they buy an electric car.">
          <span>Without a wallbox, but may put one in</span>
          <span className="info-value">{percent(town.byAccess.mayInstall, town.households)}</span>
        </div>
      </div>
      <div className="info-row" title="Drivers whose employer has chargers in its car park — more each year, and more with a workplace charging programme. It adds to whatever public charging they have near home.">
        <span>Drivers who can charge at work</span>
        <span className="info-value">{percent(workChargingShareAt(simDay), 1)}</span>
      </div>
      {meters.offered && (
        <div className="info-row" title="Households with a wallbox and an electric car who put their wallbox on the charging tariff's own meter this year (Town hall → Prices).">
          <span>On the charging tariff</span>
          <span className="info-value">
            {meters.on.toLocaleString("en-GB")} of {meters.eligible.toLocaleString("en-GB")}
          </span>
        </div>
      )}
      <div className="info-row" title="Households and businesses that bought a petrol or diesel vehicle in the last 12 months but would have gone electric with an empty public charger next door. Private operators build on-street chargers where this gathers; lorries need a fast-charging hub, which they leave to the municipality.">
        <span>Wanted an EV, lacked charging (12 mo.)</span>
        <span className="info-value">{town.unmet}</span>
      </div>
      <div className="ev-access" title="Businesses' goods vehicles — the town's total is from the federal vehicle register">
        <div className="info-row">
          <span>🚐 Business vans</span>
          <span className="info-value">
            {town.fleet.vans} · {percent(town.fleet.vansElectric, town.fleet.vans)} electric
          </span>
        </div>
        <div className="info-row">
          <span>🚚 Lorries</span>
          <span className="info-value">
            {town.fleet.trucks} · {percent(town.fleet.trucksElectric, town.fleet.trucks)} electric
          </span>
        </div>
      </div>

      {publicCharging.getSites().length > 0 && (
        <>
          <h4 className="dh-subtitle">Busiest chargers</h4>
          <div className="ev-filters">
            {OWNER_FILTERS.map((f) => (
              <button key={f.id} className={`ev-filter${ownerFilter === f.id ? " on" : ""}`} onClick={() => setOwnerFilter(f.id)}>
                {f.label}
              </button>
            ))}
          </div>
          <div className="ev-filters">
            {KIND_FILTERS.map((f) => (
              <button key={f.id} className={`ev-filter${kindFilter === f.id ? " on" : ""}`} onClick={() => setKindFilter(f.id)}>
                {f.label}
              </button>
            ))}
          </div>
          {busiest.length === 0 && <p className="dh-note">No open chargers match these filters yet.</p>}
          {busiest.map(({ site, users, capacity }) => (
            <button
              key={site.id}
              className={`ev-list-row${site.id === selectedId ? " selected" : ""}`}
              onClick={() => focusSite(site)}
            >
              <span className="ev-list-name">
                {KIND_ICON[site.kind]}
                {site.name}
              </span>
              <span className="info-value">{percent(users, capacity)}</span>
            </button>
          ))}
          <p className="dh-note tool-list-hint">Click a charger here or on the map to see how it&apos;s used.</p>
        </>
      )}
    </>
  );

  const build = (
    <>
      <h4 className="dh-subtitle">Build public chargers</h4>
      {placing ? (
        <>
          <p className="dh-note">
            Click on the map where the{" "}
            {placing.kind === "ac" ? `${placing.points} on-street chargers` : `${BUILD_SPEC[placing.kind].label.toLowerCase()} (${placing.points} points)`} should
            go — placed at the nearest street. The blue lines show how far along the streets {placing.kind === "ac" ? "they'd" : "it'd"} reach: the stronger, the
            better the charging there ({reachLabel(placing.kind)}).
          </p>
          <div className="dh-actions">
            <button onClick={() => publicCharging.startPlacing(null)}>Cancel</button>
          </div>
        </>
      ) : (
        <div className="ev-build">
          {(["ac", "dc", "fleet"] as ChargingKind[]).map((kind) => {
            const spec = BUILD_SPEC[kind];
            const sizes = sizesFor(kind);
            if (sizes.length > 1)
              return (
                <div className="ev-build-card" key={kind}>
                  <span className="ev-build-name">{spec.label}</span>
                  <span className="ev-build-detail">
                    {spec.powerKw} kW each · {BUILD_HINT[kind]}
                  </span>
                  <div className="ev-sizes">
                    {sizes.map(({ points }) => (
                      <button key={points} onClick={() => publicCharging.startPlacing(kind, points)}>
                        <span className="ev-build-name">{points} points</span>
                        <span className="ev-build-detail">{shortPriceTag(buildCostRp(kind, simDay, points))}</span>
                        <span className="ev-build-detail">{buildMonthsFor(kind, points)} months</span>
                      </button>
                    ))}
                  </div>
                </div>
              );
            return (
              <button key={kind} onClick={() => publicCharging.startPlacing(kind)}>
                <span className="ev-build-name">{spec.label}</span>
                <span className="ev-build-detail">
                  {spec.points} × {spec.powerKw} kW · {priceTag(buildCostRp(kind, simDay))} · {spec.buildMonths} months
                </span>
                <span className="ev-build-detail">{BUILD_HINT[kind]}</span>
              </button>
            );
          })}
          <p className="dh-note">
            The municipality's chargers sell at the prices set in the tariff, and their upkeep is paid from the treasury. To enlarge one of them, click it on the
            map.
          </p>
        </div>
      )}

      {underConstruction.length > 0 && (
        <>
          <h4 className="dh-subtitle">Being built</h4>
          {underConstruction.map((s) => (
            <button key={s.id} className={`ev-list-row${s.id === selectedId ? " selected" : ""}`} onClick={() => focusSite(s)}>
              <span className="ev-list-name">{s.name}</span>
              <span className="info-value">ready {monthYear(s.openedAtMs)}</span>
            </button>
          ))}
        </>
      )}
    </>
  );

  return <ToolPanel mode="evCharging" title="EV charging" overview={overview} build={build} buildActive={!!placing} />;
}
