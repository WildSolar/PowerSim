import { useMemo, useSyncExternalStore } from "react";
import { AC_SIZES, BUILD_SPEC, CARS_PER_POINT, REACH_M, type ChargingKind } from "../config/charging";
import { COVERAGE_COLOR } from "../map/colorModes";
import { formatDate, toDateMs, toSimTimeMs } from "../sim/calendar";
import { simClock } from "../sim/engine";
import { existsAt } from "../sim/lifetime";
import { buildCostRp, buildMonthsFor, upgradeCostRp, publicCharging, siteCapacityAt, sitePriceRpPerKWh, type ChargingSite, type VehicleCounts } from "../sim/publicCharging";
import { fleets } from "../sim/fleet";
import { useSimDay } from "../sim/store";
import { formatCHF } from "./format";
import { useStockBuildings } from "./useStock";
import "./districtHeatPanel.css";
import "./evChargingPanel.css";

const YEAR_MS = 365.25 * 24 * 60 * 60_000;
const QUARTER_HOUR_MS = 15 * 60_000;
const HISTORY_YEARS = 8;

const KIND_LABEL: Record<ChargingKind, string> = { ac: "On-street", dc: "Fast charging", fleet: "Lorries and vans only" };
const BUILD_HINT: Record<ChargingKind, string> = {
  ac: "Cars and vans within 300 m, charging overnight",
  dc: "Cars and vans within 1.5 km, and lorries",
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

/** A price rounded to the franc thousand, for build buttons. */
function priceTag(rp: number): string {
  return formatCHF(Math.round(rp / 100_000) * 100_000);
}

/** The same, compact ("CHF 60k"), for the narrow size buttons. */
function shortPriceTag(rp: number): string {
  return `CHF ${Math.round(rp / 100_000)}k`;
}

const COVERAGE_LABEL: Record<ChargingKind, string> = { ac: "On-street", dc: "Fast charging", fleet: "Lorry parks" };
const NONE_YET: Record<ChargingKind, string> = { ac: "No on-street chargers yet", dc: "No fast-charging hubs yet", fleet: "No lorry charging parks yet" };

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

/** The cars relying on a site at each of the last New Years, against its room for them then. */
function UsageHistory({ site, now }: { site: ChargingSite; now: number }) {
  const year = new Date(toDateMs(now)).getUTCFullYear();
  const columns = [];
  for (let y = year - HISTORY_YEARS + 1; y <= year; y++) {
    const at = y === year ? now : toSimTimeMs(Date.UTC(y + 1, 0, 1)) - 1;
    if (at < 0 && y !== year) continue; // before the game started
    columns.push({ year: y, users: publicCharging.usersAt(site.id, at), capacity: siteCapacityAt(site, at) });
  }
  const max = Math.max(1, ...columns.map((c) => Math.max(c.users, c.capacity)));
  return (
    <div className="ev-history">
      {columns.map((c) => (
        <div
          className="ev-history-col"
          key={c.year}
          title={`${c.year === year ? "Now" : `End of ${c.year}`}: ${c.users} cars, room for ${c.capacity}`}
        >
          <div className="ev-history-plot">
            <div className="ev-history-capacity" style={{ height: `${(c.capacity / max) * 100}%` }} />
            <div className="ev-history-users" style={{ height: `${(c.users / max) * 100}%` }} />
          </div>
          <span className="ev-history-year">{String(c.year).slice(2)}</span>
        </div>
      ))}
    </div>
  );
}

function SiteDetails({ site, now }: { site: ChargingSite; now: number }) {
  const stats = publicCharging.stats(site, now);
  const building = now < site.openedAtMs;
  const pending = site.expansions.filter((e) => e.atMs > now);
  const planned = publicCharging.plannedPoints(site);
  const owner = site.owner === "municipal" ? "The municipality" : site.id.startsWith("real-") ? "Private (in the federal register)" : "Private operator";
  const inUse = building ? 0 : publicCharging.pointsInUseAt(site, now);

  return (
    <div className="ev-site">
      <div className="ev-site-head">
        <span className="ev-site-name">{site.name}</span>
        <button className="ev-close" onClick={() => publicCharging.select(null)} title="Deselect">
          ✕
        </button>
      </div>
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
      <div className="info-row">
        <span>Price</span>
        <span className="info-value">{sitePriceRpPerKWh(site)} Rp/kWh</span>
      </div>
      {building ? (
        <p className="dh-note">Being built — opens {formatDate(site.openedAtMs)}.</p>
      ) : (
        <>
          <div className="info-row">
            <span>Relying on it</span>
            <span className="info-value">{vehicleList(stats.vehicles)}</span>
          </div>
          <div
            className="info-row"
            title={`Each charge point serves about ${CARS_PER_POINT[site.kind]} cars that rely on it; a van takes about two cars' room, a lorry about twenty. A full site takes no new vehicles.`}
          >
            <span>Room taken</span>
            <span className="info-value">
              {Math.round(stats.users)} / {stats.capacity} cars' worth ({percent(stats.users, stats.capacity)})
            </span>
          </div>
          <UsageBar used={stats.users} capacity={stats.capacity} />
          <div className="info-row" style={{ marginTop: 6 }}>
            <span>Charging right now</span>
            <span className="info-value">
              {inUse} of {stats.points} points
            </span>
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
          <h4 className="ev-history-title">Room taken, year by year (cars' worth)</h4>
          <UsageHistory site={site} now={now} />
        </>
      )}
      {pending.map((e) => (
        <p className="dh-note" key={e.atMs}>
          {site.owner === "municipal" ? "Adding" : "The operator is adding"} {e.points} points — ready {monthYear(e.atMs)}.
        </p>
      ))}
      {site.owner === "municipal" && site.kind === "ac" && planned < AC_SIZES[AC_SIZES.length - 1] && (
        <>
          <h4 className="ev-history-title">Enlarge (ready in a few months)</h4>
          <div className="ev-sizes">
            {AC_SIZES.filter((size) => size > planned).map((size) => (
              <button key={size} onClick={() => publicCharging.upgrade(site.id, size, simClock.getSimTimeMs())}>
                <span className="ev-build-name">To {size} points</span>
                <span className="ev-build-detail">{shortPriceTag(upgradeCostRp(planned, size, now))}</span>
              </button>
            ))}
          </div>
        </>
      )}
    </div>
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
  const now = useSimQuarterHour();
  const buildings = useStockBuildings();
  const placing = publicCharging.getPlacing();
  const coverage = publicCharging.getCoverage();
  const selectedId = publicCharging.getSelectedId();
  const selected = selectedId ? publicCharging.getSite(selectedId) : undefined;

  const town = useMemo(() => {
    const standing = buildings.filter((b) => existsAt(b, simDay));
    let households = 0;
    const byAccess = { home: 0, public: 0, fastOnly: 0, full: 0, none: 0 };
    for (const access of publicCharging.householdAccess(standing, simDay).values()) {
      households += access.households;
      byAccess.home += access.atHome;
      byAccess[access.others] += access.households - access.atHome;
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

  const busiest = useMemo(
    () =>
      publicCharging
        .getSites()
        .filter((s) => siteCapacityAt(s, simDay) > 0)
        .map((s) => ({ site: s, users: publicCharging.usersAt(s.id, simDay), capacity: siteCapacityAt(s, simDay) }))
        .sort((a, b) => b.users / b.capacity - a.users / a.capacity || b.users - a.users)
        .slice(0, 5),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [simDay, version],
  );
  const underConstruction = publicCharging.getSites().filter((s) => s.openedAtMs > simDay);

  return (
    <div className="district-heat-panel ev-charging-panel">
      <h3 className="panel-title">EV charging</h3>
      <div className="ev-coverage" title="Show where each kind of charger reaches — everything inside the shaded area has one in reach (chargers being built included)">
        <span className="ev-coverage-label">Coverage</span>
        {(["ac", "dc", "fleet"] as ChargingKind[]).map((kind) => (
          <button
            key={kind}
            className={`ev-coverage-toggle${coverage.has(kind) ? " on" : ""}`}
            disabled={!publicCharging.getSites().some((s) => s.kind === kind)}
            title={publicCharging.getSites().some((s) => s.kind === kind) ? undefined : NONE_YET[kind]}
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
      <div className="info-row" title="Electric cars of households without home charging, and businesses' vans and lorries without a yard to charge in, each booked to the public charger it relies on">
        <span>Charging publicly</span>
        <span className="info-value">{vehicleList(town.usage.vehicles)}</span>
      </div>
      <div className="info-row" title="A van takes about two cars' room at a charger, a lorry about twenty">
        <span>Room taken (cars' worth)</span>
        <span className="info-value">
          {Math.round(town.usage.users)} / {town.usage.capacity}
        </span>
      </div>
      <UsageBar used={town.usage.users} capacity={town.usage.capacity} />

      <div className="ev-access" title="Of every household in the municipality, whether or not it has an electric car yet">
        <div className="info-row">
          <span>Households that can charge at home</span>
          <span className="info-value">{percent(town.byAccess.home, town.households)}</span>
        </div>
        <div className="info-row">
          <span>…else an on-street charger with room</span>
          <span className="info-value">{percent(town.byAccess.public, town.households)}</span>
        </div>
        <div className="info-row">
          <span>…only a fast-charging hub</span>
          <span className="info-value">{percent(town.byAccess.fastOnly, town.households)}</span>
        </div>
        <div className="info-row">
          <span>…only full chargers nearby</span>
          <span className="info-value">{percent(town.byAccess.full, town.households)}</span>
        </div>
        <div className="info-row">
          <span>…no charger nearby</span>
          <span className="info-value">{percent(town.byAccess.none, town.households)}</span>
        </div>
      </div>
      <div className="info-row" title="Households and businesses that bought a petrol or diesel vehicle in the last 12 months but would have gone electric with a public charger close by. Private operators build on-street chargers where this gathers; lorries need a fast-charging hub, which they leave to the municipality.">
        <span>Wanted an EV, no charger (12 mo.)</span>
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

      {selected ? (
        <SiteDetails site={selected} now={now} />
      ) : (
        <p className="dh-note">Click a charger on the map to see how it's used.</p>
      )}

      <h4 className="dh-subtitle">Build public chargers</h4>
      {placing ? (
        <>
          <p className="dh-note">
            Click on the map where the {placing.kind === "ac" ? `${placing.points} on-street chargers` : BUILD_SPEC[placing.kind].label.toLowerCase()} should
            go — placed at the nearest street. The blue circle shows who {placing.kind === "ac" ? "they'd" : "it'd"} serve (
            {REACH_M[placing.kind] >= 1000 ? `${REACH_M[placing.kind] / 1000} km` : `${REACH_M[placing.kind]} m`}).
          </p>
          <div className="dh-actions">
            <button onClick={() => publicCharging.startPlacing(null)}>Cancel</button>
          </div>
        </>
      ) : (
        <div className="ev-build">
          <div className="ev-build-card">
            <span className="ev-build-name">{BUILD_SPEC.ac.label}</span>
            <span className="ev-build-detail">
              {BUILD_SPEC.ac.powerKw} kW each · {BUILD_HINT.ac}
            </span>
            <div className="ev-sizes">
              {AC_SIZES.map((size) => (
                <button key={size} onClick={() => publicCharging.startPlacing("ac", size)}>
                  <span className="ev-build-name">{size} points</span>
                  <span className="ev-build-detail">{shortPriceTag(buildCostRp("ac", simDay, size))}</span>
                  <span className="ev-build-detail">{buildMonthsFor("ac", size)} months</span>
                </button>
              ))}
            </div>
          </div>
          {(["dc", "fleet"] as ChargingKind[]).map((kind) => {
            const spec = BUILD_SPEC[kind];
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
            The municipality's chargers sell at the prices set in the tariff, and their upkeep is paid from the treasury.
          </p>
        </div>
      )}

      {busiest.length > 0 && (
        <>
          <h4 className="dh-subtitle">Busiest chargers</h4>
          {busiest.map(({ site, users, capacity }) => (
            <button
              key={site.id}
              className={`ev-list-row${site.id === selectedId ? " selected" : ""}`}
              onClick={() => publicCharging.select(site.id)}
            >
              <span className="ev-list-name">
                {KIND_ICON[site.kind]}
                {site.name}
              </span>
              <span className="info-value">{percent(users, capacity)}</span>
            </button>
          ))}
        </>
      )}

      {underConstruction.length > 0 && (
        <>
          <h4 className="dh-subtitle">Being built</h4>
          {underConstruction.map((s) => (
            <button key={s.id} className={`ev-list-row${s.id === selectedId ? " selected" : ""}`} onClick={() => publicCharging.select(s.id)}>
              <span className="ev-list-name">{s.name}</span>
              <span className="info-value">ready {monthYear(s.openedAtMs)}</span>
            </button>
          ))}
        </>
      )}
    </div>
  );
}
