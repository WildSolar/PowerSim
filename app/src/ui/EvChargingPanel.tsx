import { useMemo, useState, useSyncExternalStore, type ReactNode } from "react";
import { CardKind, CardSection, Facts, NowLine } from "./CardParts";
import { BUILD_SPEC, MAX_FILL, MAX_SITE_POINTS, UPGRADE_MONTHS, QOS_CURVE, QOS_FLOOR, type ChargingKind, type QosKind } from "../config/charging";
import { CHARGER_BUILDING_COLOR, CHARGER_USE_RAMP, COVERAGE_COLOR, EV_CHARGING_LEGEND } from "../map/colorModes";
import { formatDate, toDateMs, toSimTimeMs } from "../sim/calendar";
import { simClock } from "../sim/engine";
import { existsAt } from "../sim/lifetime";
import {
  buildCostRp,
  buildMonthsFor,
  qosKindOf,
  pointsAt,
  qosReachM,
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
import { PortsPicker } from "./PortsPicker";
import { ShareBar, ToolListGroup, ToolListRow, ToolTile } from "./ToolList";

const YEAR_MS = 365.25 * 24 * 60 * 60_000;
const QUARTER_HOUR_MS = 15 * 60_000;
const HISTORY_YEARS = 8;

const SITE_KIND_NAME: Record<ChargingKind, string> = { ac: "On-street charger", dc: "Fast-charging hub", fleet: "Lorry charging park" };
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

/** "1 point", "4 points". */
function pointsLabel(n: number): string {
  return `${n} point${n === 1 ? "" : "s"}`;
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
interface RankedSite {
  site: ChargingSite;
  users: number;
  capacity: number;
}

/** A charger's dot in a list, in its colour on the map: room to spare, filling up, full. */
function fillColor(fill: number): string {
  return fill >= 1 ? CHARGER_USE_RAMP[2] : fill >= 0.7 ? CHARGER_USE_RAMP[1] : CHARGER_USE_RAMP[0];
}
const EV_ACCESS_COLOR = Object.fromEntries(EV_CHARGING_LEGEND.map((e) => [e.bucket, e.color]));

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
    <InspectCard kicker={site.shop ? "Charger in a shop's car park" : SITE_KIND_NAME[site.kind]} title={site.name} onClose={() => publicCharging.select(null)}>
      <SiteDetails key={site.id} site={site} now={now} />
    </InspectCard>
  );
}

const WINDOW_LABEL = { night: "at night", solar: "in solar hours" } as const;

/** A site's price, as a fact: one price — or, at the municipality's own once the windows differ, each
 * window's with the share of its energy sold at it (and why a window sells nothing, where that isn't
 * plain). */
function priceFact(site: ChargingSite, now: number): ReactNode {
  if (site.owner !== "municipal") return `${sitePriceRpPerKWh(site, now)} Rp/kWh`;
  const { prices, shares, solarDays } = sitePriceWindows(site, now);
  if (prices.night === prices.standard && prices.solar === prices.standard) return `${prices.standard} Rp/kWh`;
  const street = site.kind === "ac" && !site.shop;
  const why: Record<"night" | "solar", string | null> = {
    night: site.shop ? "the shop is closed at night" : prices.night > prices.standard ? "dearer than by day" : null,
    solar:
      solarDays === 0
        ? "no solar hours this year yet"
        : street && prices.solar > Math.min(prices.standard, prices.night)
          ? "cars here charge in the evening or overnight"
          : null,
  };
  return (
    <>
      <div>
        {prices.standard} Rp/kWh by day<span className="bp-sub"> · {percent(shares.standard, 1)} of its energy</span>
      </div>
      {(["night", "solar"] as const)
        .filter((w) => prices[w] !== prices.standard)
        .map((w) => (
          <div key={w}>
            {prices[w]} Rp/kWh {WINDOW_LABEL[w]}
            <span className="bp-sub">
              {" "}
              · {percent(shares[w], 1)}
              {shares[w] < 0.005 && why[w] ? ` — ${why[w]}` : ""}
            </span>
          </div>
        ))}
    </>
  );
}

/** A charger's card: what it is in a line, its facts (price, reach, who relies on it, how full, what it
 * sells), who is plugged in this moment, how full it was year by year, and — the municipality's own —
 * enlarging it. */
function SiteDetails({ site, now }: { site: ChargingSite; now: number }) {
  const stats = publicCharging.stats(site, now);
  const building = now < site.openedAtMs;
  const pending = site.expansions.filter((e) => e.atMs > now);
  const planned = publicCharging.plannedPoints(site);
  const owner = site.owner === "municipal" ? "run by the municipality" : site.id.startsWith("real-") ? "run privately" : "run by a private operator";
  const inUse = building ? { pluggedIn: 0, charging: 0 } : publicCharging.pointsInUseAt(site, now);
  const canEnlarge = site.owner === "municipal" && planned < MAX_SITE_POINTS;
  const [enlargeTo, setEnlargeTo] = useState(Math.min(MAX_SITE_POINTS, planned + 4));
  const toPoints = Math.max(planned + 1, Math.min(MAX_SITE_POINTS, enlargeTo));

  return (
    <>
      <CardKind>
        {pointsLabel(building ? site.points : stats.points)} × {site.powerKw} kW · {owner}
        {building ? ` · opens ${formatDate(site.openedAtMs)}` : ""}
      </CardKind>
      <Facts
        facts={[
          { label: "Price", value: priceFact(site, now), title: site.owner === "municipal" ? "Set in the tariff, under Prices. A cheaper price at night or in the town's solar hours moves charging there." : undefined },
          site.kind !== "fleet" && {
            label: "Reach",
            value: reachLabel(qosKindOf(site)),
            title: `How much of a household's charging it can do at best: ${Math.round(QOS_CURVE[qosKindOf(site)].ceiling * 100)}%, less the further away along the streets, and less as it fills up. The blue lines on the map show how far it reaches.`,
          },
          !building && { label: "Relying on it", value: vehicleList(stats.vehicles), title: "Vehicles that do some or all of their charging here" },
          !building && {
            label: "How full",
            value: (
              <>
                {percent(stats.users, stats.capacity)}
                <UsageBar used={stats.users} capacity={stats.capacity} />
              </>
            ),
            title: `How much of its room the vehicles relying on it take: one charging all its needs here takes more than one charging part of them here, a van about twice a car's, a lorry many times. The fuller it gets, the less use it is to anyone — a busy charger means hunting for a free spot — and past ${Math.round(MAX_FILL * 100)}% it takes nobody new.${site.owner === "municipal" && site.kind !== "ac" ? " Cheaper prices at night or in solar hours spread its use out of the busy hours and give it room for more." : ""}`,
          },
          !building && { label: "Busiest", value: busiestLabel(site) },
          !building && {
            label: "Sells",
            value: (
              <>
                {Math.round(stats.kWhPerDay)} kWh a day
                {stats.kWhLastYear >= 1000 && <span className="bp-sub"> · {formatMWh(stats.kWhLastYear)} in the last 12 months</span>}
              </>
            ),
          },
          !building &&
            site.owner === "municipal" && {
              label: "Earns",
              value: (
                <>
                  {formatCHF(stats.revenueLastYearRp)} in the last 12 months<span className="bp-sub"> · upkeep {formatCHF(stats.upkeepPerYearRp)} a year</span>
                </>
              ),
            },
        ]}
      />
      {!building && (
        <NowLine title="Vehicles at a charge point right now. Those relying on a charger don't charge there every day: on the street a car plugs in in the evening and stays until morning, at a hub it stops for about half an hour. So even a charger with no room left stands empty much of the day.">
          {inUse.pluggedIn} of {pointsLabel(stats.points)} in use{inUse.pluggedIn > 0 ? ` · ${inUse.charging} charging` : ""}
        </NowLine>
      )}

      {!building && (
        <CardSection title="How full, year by year">
          <UsageHistory site={site} now={now} />
        </CardSection>
      )}

      {(pending.length > 0 || canEnlarge) && (
        <CardSection title="What could change here">
          {pending.map((e) => (
            <p className="dh-note" key={e.atMs}>
              {site.owner === "municipal" ? "Adding" : "The operator is adding"} {pointsLabel(e.points)} — ready {monthYear(e.atMs)}.
            </p>
          ))}
          {canEnlarge && (
            <>
              <p className="dh-note">Enlarge it, to at most {MAX_SITE_POINTS} points — the more at once, the less each costs:</p>
              <PortsPicker
                value={toPoints}
                min={planned + 1}
                max={MAX_SITE_POINTS}
                buying={toPoints - planned}
                costRp={upgradeCostRp(site.kind, planned, toPoints, now)}
                months={UPGRADE_MONTHS[site.kind]}
                onChange={setEnlargeTo}
                onOrder={() => publicCharging.upgrade(site.id, toPoints, simClock.getSimTimeMs())}
                orderLabel={`Enlarge to ${toPoints} points`}
              />
            </>
          )}
        </CardSection>
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
  const [buildPoints, setBuildPoints] = useState<Record<ChargingKind, number>>({ ac: BUILD_SPEC.ac.points, dc: BUILD_SPEC.dc.points, fleet: BUILD_SPEC.fleet.points });
  const [kindFilter, setKindFilter] = useState<KindFilter>("all");
  // Every open charger, fullest first; the filters pick from these.
  const ranked: RankedSite[] = useMemo(
    () =>
      publicCharging
        .getSites()
        .filter((s) => siteCapacityAt(s, simDay) > 0)
        .map((s) => ({ site: s, users: publicCharging.usersAt(s.id, simDay), capacity: siteCapacityAt(s, simDay) }))
        .sort((a, b) => b.users / b.capacity - a.users / a.capacity || b.users - a.users),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [simDay, version],
  );
  const sites = publicCharging.getSites();
  const underConstruction = sites.filter((s) => s.openedAtMs > simDay);
  const municipalFull = ranked.filter(({ site, users, capacity }) => site.owner === "municipal" && users >= capacity && publicCharging.plannedPoints(site) === pointsAt(site, simDay));
  const shown = ranked.filter(({ site }) => (ownerFilter === "all" || site.owner === ownerFilter) && (kindFilter === "all" || site.kind === kindFilter));
  const siteRow = ({ site, users, capacity }: RankedSite, detail?: string) => (
    <ToolListRow
      key={site.id}
      color={fillColor(users / capacity)}
      title={`${KIND_ICON[site.kind]}${site.name}`}
      figure={percent(users, capacity)}
      detail={detail ?? `${SITE_KIND_NAME[site.kind]} · ${pointsLabel(pointsAt(site, simDay))} · ${site.owner === "municipal" ? "the town's" : "private"}`}
      selected={site.id === selectedId}
      onClick={() => focusSite(site)}
    />
  );
  const access = town.byAccess;

  const overview = (
    <>
      {sites.length === 0 && (
        <p className="dh-note">
          Households without a parking space of their own can only go electric if there&apos;s a public charger near enough. Build some, and set what they charge under
          Prices.
        </p>
      )}
      <div className="tool-tiles">
        <ToolTile
          label="Public chargers"
          value={`${town.usage.points} points`}
          sub={`at ${town.usage.sites} site${town.usage.sites === 1 ? "" : "s"}${underConstruction.length > 0 ? ` · ${underConstruction.length} being built` : ""}`}
          title="The charge points open to the public, the town's own and private operators' together"
        />
        <ToolTile
          label="How full"
          value={percent(town.usage.users, town.usage.capacity)}
          sub="all of them together"
          title={`How much of the public chargers' room is taken, all of them together: a van needs about twice a car's, a lorry many times. A charger past full takes nobody new — at ${Math.round(MAX_FILL * 100)}% it's closed to newcomers.`}
        />
        <ToolTile
          label="Charging publicly"
          value={`${town.usage.vehicles.car} car${town.usage.vehicles.car === 1 ? "" : "s"}`}
          sub={town.usage.vehicles.van + town.usage.vehicles.truck > 0 ? vehicleList({ car: 0, van: town.usage.vehicles.van, truck: town.usage.vehicles.truck }) : "no vans or lorries"}
          title="Electric cars of households without home charging, and businesses' vans and lorries without a yard to charge in, that rely on public chargers"
        />
        <ToolTile
          label="Lacked charging"
          value={String(town.unmet)}
          sub="bought petrol or diesel instead, 12 mo."
          title="Households and businesses that bought a petrol or diesel vehicle in the last 12 months but would have gone electric with an empty public charger next door. They show on the map. Private operators build on-street chargers where this gathers; lorries need a fast-charging hub, which they leave to the municipality."
        />
      </div>

      <ToolListGroup title="Needs you" limit={4}>
        {municipalFull.map((r) => siteRow(r, r.users >= r.capacity * MAX_FILL ? "Full — takes nobody new; enlarge it on its card" : "Full — enlarge it on its card"))}
      </ToolListGroup>

      <h4 className="tool-list-heading">How households could charge</h4>
      <ShareBar
        label="Households by how they could charge"
        shares={[
          { label: "Wallbox", value: access.home, color: EV_ACCESS_COLOR.home, title: "Households with a wallbox at home" },
          { label: "Very good", value: access.q4, color: EV_ACCESS_COLOR.q4, title: "No wallbox; the public chargers around could do 75% or more of their charging" },
          { label: "Good", value: access.q3, color: EV_ACCESS_COLOR.q3, title: "No wallbox; public chargers could do 50–75% of their charging" },
          { label: "Fair", value: access.q2, color: EV_ACCESS_COLOR.q2, title: "No wallbox; public chargers could do 25–50% of their charging" },
          { label: "Poor", value: access.q1, color: EV_ACCESS_COLOR.q1, title: "No wallbox; public chargers could do 10–25% of their charging" },
          { label: "Too little", value: access.none, color: EV_ACCESS_COLOR.none, title: "No wallbox, and too little public charging around to rely on" },
        ]}
      />
      <Facts
        facts={[
          {
            label: "Could put in a wallbox",
            value: percent(access.mayInstall, town.households),
            title: "Households without a wallbox that have their own parking space and may put one in — or may by the right to charge. They weigh its cost against public charging when they buy an electric car.",
          },
          {
            label: "Can charge at work",
            value: `${percent(workChargingShareAt(simDay), 1)} of drivers`,
            title: "Drivers whose employer has chargers in its car park — more each year, and more with a workplace charging programme. It adds to whatever public charging they have near home.",
          },
          meters.offered && {
            label: "On the charging tariff",
            value: `${meters.on.toLocaleString("en-GB")} of ${meters.eligible.toLocaleString("en-GB")}`,
            title: "Households with a wallbox and an electric car who put their wallbox on the charging tariff's own meter this year (Town hall → Prices).",
          },
          { label: "Business vans", value: `${town.fleet.vans} · ${percent(town.fleet.vansElectric, town.fleet.vans)} electric`, title: "Businesses' vans — the town's total is from the federal vehicle register" },
          { label: "Lorries", value: `${town.fleet.trucks} · ${percent(town.fleet.trucksElectric, town.fleet.trucks)} electric`, title: "Businesses' lorries — the town's total is from the federal vehicle register" },
        ]}
      />

      <div className="ev-coverage" title="Show how far each kind of charger reaches along the streets — the stronger the colour, the better the charging there (chargers being built included)">
        <span className="ev-coverage-label">Reach on the map</span>
        {COVERAGE_KINDS.map((kind) => (
          <button
            key={kind}
            className={`ev-coverage-toggle${coverage.has(kind) ? " on" : ""}`}
            disabled={!sites.some((s) => qosKindOf(s) === kind)}
            title={sites.some((s) => qosKindOf(s) === kind) ? reachLabel(kind) : NONE_YET[kind]}
            onClick={() => publicCharging.toggleCoverage(kind)}
          >
            <span className="ev-coverage-swatch" style={{ background: COVERAGE_COLOR[kind] }} />
            {COVERAGE_LABEL[kind]}
          </button>
        ))}
      </div>

      {sites.length > 0 && (
        <>
          <h4 className="tool-list-heading">Chargers</h4>
          <div className="ev-filters" role="group" aria-label="Which chargers">
            {OWNER_FILTERS.map((f) => (
              <button key={f.id} className={`ev-filter${ownerFilter === f.id ? " on" : ""}`} aria-pressed={ownerFilter === f.id} onClick={() => setOwnerFilter(f.id)}>
                {f.label}
              </button>
            ))}
            <span className="tool-filter-sep" aria-hidden />
            {KIND_FILTERS.map((f) => (
              <button key={f.id} className={`ev-filter${kindFilter === f.id ? " on" : ""}`} aria-pressed={kindFilter === f.id} onClick={() => setKindFilter(f.id)}>
                {f.label}
              </button>
            ))}
          </div>
          {shown.length === 0 && underConstruction.length === 0 && <p className="dh-note">None of these yet.</p>}
          <ToolListGroup title="Full" limit={4}>
            {shown.filter((r) => r.users >= r.capacity).map((r) => siteRow(r))}
          </ToolListGroup>
          <ToolListGroup title="Filling up (70%+)" limit={4}>
            {shown.filter((r) => r.users < r.capacity && r.users >= r.capacity * 0.7).map((r) => siteRow(r))}
          </ToolListGroup>
          <ToolListGroup title="Room to spare" limit={3}>
            {shown.filter((r) => r.users < r.capacity * 0.7).map((r) => siteRow(r))}
          </ToolListGroup>
          <ToolListGroup title="Being built" limit={3}>
            {underConstruction
              .filter((s) => (ownerFilter === "all" || s.owner === ownerFilter) && (kindFilter === "all" || s.kind === kindFilter))
              .map((s) => (
                <ToolListRow
                  key={s.id}
                  color={CHARGER_BUILDING_COLOR}
                  title={`${KIND_ICON[s.kind]}${s.name}`}
                  figure={`ready ${monthYear(s.openedAtMs)}`}
                  detail={`${SITE_KIND_NAME[s.kind]} · ${pointsLabel(s.points)}`}
                  selected={s.id === selectedId}
                  onClick={() => focusSite(s)}
                />
              ))}
          </ToolListGroup>
          <p className="dh-note tool-list-hint">Fullest first. Click a charger here or on the map: its card shows who relies on it, and when.</p>
        </>
      )}
    </>
  );

  const build = (
    <>
      <h4 className="tool-list-heading">Build public chargers</h4>
      {placing ? (
        <>
          <p className="dh-note">
            Click on the map where the{" "}
            {placing.kind === "ac" ? `${placing.points === 1 ? "on-street charger" : `${placing.points} on-street chargers`}` : `${BUILD_SPEC[placing.kind].label.toLowerCase()} (${pointsLabel(placing.points)})`} should
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
            return (
              <div className="ev-build-card" key={kind}>
                <span className="ev-build-name">{spec.label}</span>
                <span className="ev-build-detail">
                  {spec.powerKw} kW each · {BUILD_HINT[kind]}
                </span>
                <PortsPicker
                  value={buildPoints[kind]}
                  min={1}
                  max={MAX_SITE_POINTS}
                  buying={buildPoints[kind]}
                  costRp={buildCostRp(kind, simDay, buildPoints[kind])}
                  months={buildMonthsFor(kind, buildPoints[kind])}
                  onChange={(n) => setBuildPoints((p) => ({ ...p, [kind]: n }))}
                  onOrder={() => publicCharging.startPlacing(kind, buildPoints[kind])}
                  orderLabel="Place it on the map"
                />
              </div>
            );
          })}
          <p className="dh-note tool-list-hint">
            A bigger site costs less a point, and has room for more; several smaller ones reach more of the town. The town&apos;s chargers sell at the prices set
            under Prices; their upkeep is paid from the treasury. To enlarge one, up to {MAX_SITE_POINTS} points, click it on the map.
          </p>
        </div>
      )}

      <ToolListGroup title="Being built" limit={4}>
        {underConstruction.map((s) => (
          <ToolListRow
            key={s.id}
            color={CHARGER_BUILDING_COLOR}
            title={`${KIND_ICON[s.kind]}${s.name}`}
            figure={`ready ${monthYear(s.openedAtMs)}`}
            detail={`${SITE_KIND_NAME[s.kind]} · ${pointsLabel(s.points)}`}
            selected={s.id === selectedId}
            onClick={() => focusSite(s)}
          />
        ))}
      </ToolListGroup>
    </>
  );

  return <ToolPanel mode="evCharging" title="EV charging" overview={overview} build={build} buildActive={!!placing} />;
}
