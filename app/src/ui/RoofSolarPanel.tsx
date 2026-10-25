import { useMemo, useSyncExternalStore } from "react";
import { GRID_FULL_FOR_SOLAR } from "../sim/gridLimits";
import { ROOF_BUILD_WITHIN_MONTHS, ROOF_RENT_RANGE_CHF_PER_M2, ROOF_RENT_STEP_CHF_PER_M2 } from "../config/roofContracts";
import type { Building } from "../data/types";
import { mapFocus } from "../map/mapFocus";
import { formatDate } from "../sim/calendar";
import { simClock } from "../sim/engine";
import { roofContracts, type RoofContract } from "../sim/roofContracts";
import { useSimDay } from "../sim/store";
import { formatCHF } from "./format";
import "./districtHeatPanel.css";
import { ToolPanel } from "./ToolPanel";
import { ToolListGroup, ToolListRow, ToolTile } from "./ToolList";
import { Facts } from "./CardParts";
import { ROOF_SOLAR_LEGEND } from "../map/colorModes";
import { PlotLink } from "./PlotLink";

function monthYear(ms: number): string {
  return formatDate(ms).replace(/^\d+ /, "");
}

function useRoofContracts(): number {
  return useSyncExternalStore(
    (l) => roofContracts.subscribe(l),
    () => roofContracts.getVersion(),
  );
}

/** The rent offered to roof owners (shared with the roof solar advisor's page). */
export function RentSlider() {
  useRoofContracts();
  const rent = roofContracts.getRent();
  const [min, max] = ROOF_RENT_RANGE_CHF_PER_M2;
  return (
    <label className="dh-size">
      <span>
        Rent offered <strong>CHF {rent.toFixed(2)}</strong> per m² of roof a year
      </span>
      <input type="range" min={min} max={max} step={ROOF_RENT_STEP_CHF_PER_M2} value={rent} onChange={(e) => roofContracts.setRent(Number(e.target.value))} />
    </label>
  );
}

/** A roof's contract, in the building panel: where it stands, or what an offer would mean. */
export function RoofContractCard({ building, now }: { building: Building; now: number }) {
  useRoofContracts();
  const c = roofContracts.latest(building.egid);
  const eligibility = roofContracts.eligibility(building, now);
  const quote = roofContracts.quote(building, now);

  if (c?.status === "built") {
    return (
      <div className="public-orders">
        <div className="info-row">
          <span>The utility's solar</span>
          <span className="info-value">
            {(c.capacityKw ?? 0).toFixed(0)} kWp{(c.installedAtMs ?? 0) > now ? ` · from ${monthYear(c.installedAtMs ?? 0)}` : ""}
          </span>
        </div>
        <div className="info-row">
          <span>Rent paid to the owner</span>
          <span className="info-value">{formatCHF(c.rentChfPerM2 * (c.areaM2 ?? 0) * 100)} a year</span>
        </div>
      </div>
    );
  }
  if (c?.status === "accepted") {
    return (
      <div className="public-orders">
        <p className="dh-note">The owner accepted CHF {c.rentChfPerM2.toFixed(2)} per m². Build by {monthYear(c.buildByMs ?? now)}, or the contract lapses.</p>
        {quote?.gridFull ? (
          <p className="dh-note grid-full">{GRID_FULL_FOR_SOLAR}</p>
        ) : (
          <div className="dh-actions">
            <button className="dh-order" onClick={() => roofContracts.build(building.egid, simClock.getSimTimeMs())}>
              Build {quote ? `${quote.capacityKw.toFixed(0)} kWp for ${formatCHF(quote.costRp)}` : "the array"}
            </button>
          </div>
        )}
      </div>
    );
  }
  if (c?.status === "offered") {
    return (
      <div className="public-orders">
        <p className="dh-note">
          Offered CHF {c.rentChfPerM2.toFixed(2)} per m² on {formatDate(c.offeredAtMs)}. The owner is thinking it over.
        </p>
      </div>
    );
  }
  return (
    <div className="public-orders">
      {c?.status === "ownSolar" && <p className="dh-note">The owner put up solar of their own instead — the contract is off.</p>}
      {!eligibility.ok ? (
        <p className="dh-note">{eligibility.reason}</p>
      ) : (
        quote && (
          <>
            <RentSlider />
            <div className="info-row">
              <span>Array</span>
              <span className="info-value">
                {quote.capacityKw.toFixed(0)} kWp on {Math.round(quote.areaM2)} m²
              </span>
            </div>
            <div className="info-row" title="The price the owner would pay, less the federal payment every installation gets">
              <span>Build cost</span>
              <span className="info-value">{formatCHF(quote.costRp)}</span>
            </div>
            <div className="info-row" title="A typical year's output, valued at what the utility would otherwise pay for the power (the market's underlying price this year)">
              <span>A year's output</span>
              <span className="info-value">
                {Math.round(quote.yieldKWh / 1000)} MWh · {formatCHF(quote.valueRp)}
              </span>
            </div>
            <div className="info-row">
              <span>Rent and upkeep</span>
              <span className="info-value">{formatCHF(quote.rentRp + quote.upkeepRp)} a year</span>
            </div>
            <div className="info-row" title="Output value less rent, upkeep and the build cost spread over 25 years">
              <span>Net for the utility</span>
              <span className={`info-value ${quote.netRp >= 0 ? "good" : "bad"}`}>
                {quote.netRp >= 0 ? "+" : "−"}
                {formatCHF(Math.abs(quote.netRp))} a year
              </span>
            </div>
            <div className="dh-actions">
              <button className="dh-order" onClick={() => roofContracts.offer(building, simClock.getSimTimeMs())}>
                Offer {formatCHF(quote.rentRp)} a year for the roof
              </button>
            </div>
          </>
        )
      )}
    </div>
  );
}

const ROOF_COLOR = Object.fromEntries(ROOF_SOLAR_LEGEND.map((l) => [l.bucket, l.color]));

function nameOf(b: Building | undefined, egid: string): string {
  return b?.address ?? `Building ${egid}`;
}

/** The PV Contracting layer's panel: the rent the utility offers, the roofs whose owners accepted (to
 * build), and the utility's arrays. Roofs are offered one by one, from their cards (or from the roof
 * solar advisor's report). */
export function RoofSolarPanel({ buildings, onSelectBuilding }: { buildings: Building[]; onSelectBuilding: (egid: string) => void }) {
  const version = useRoofContracts();
  const now = useSimDay();
  const lookup = useMemo(() => new Map(buildings.map((b) => [b.egid, b])), [buildings]);
  const stats = useMemo(() => {
    const eligible = roofContracts.eligibleRoofs(now);
    const contracts = roofContracts.getContracts();
    const latest = new Map<string, RoofContract>();
    for (const c of contracts) latest.set(c.egid, c);
    const all = [...latest.values()];
    const built = all.filter((c) => c.status === "built");
    return {
      eligible,
      pending: all.filter((c) => c.status === "offered"),
      accepted: all.filter((c) => c.status === "accepted"),
      built,
      inService: built.filter((c) => (c.installedAtMs ?? Infinity) <= now),
      ownSolar: all.filter((c) => c.status === "ownSolar").length,
      declined: contracts.filter((c) => c.status === "declined").length,
      yearlyCostRp: roofContracts.yearlyCostRp(now),
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [now, version, buildings]);
  const estimate = useMemo(() => roofContracts.acceptanceEstimate(now), [now, version]); // eslint-disable-line react-hooks/exhaustive-deps
  const kwp = (cs: RoofContract[]) => cs.reduce((sum, c) => sum + (c.capacityKw ?? 0), 0);
  const select = (egid: string) => {
    onSelectBuilding(egid);
    const b = lookup.get(egid);
    if (b) mapFocus.focusBuilding(b);
  };

  const share = estimate.roofs > 0 ? Math.round((estimate.accepting / estimate.roofs) * 10) : 0;
  const contractRow = (c: RoofContract, color: string, figure: string, detail: string) => (
    <ToolListRow key={c.id} color={color} title={nameOf(lookup.get(c.egid), c.egid)} figure={figure} detail={detail} selected={false} onClick={() => select(c.egid)} />
  );
  const acceptedRows = stats.accepted.map((c) => {
    const b = lookup.get(c.egid);
    const q = b ? roofContracts.quote(b, now, c.rentChfPerM2) : null;
    return contractRow(
      c,
      ROOF_COLOR.accepted,
      q?.gridFull ? "grid full" : q ? formatCHF(q.costRp) : "",
      q?.gridFull
        ? "Accepted — waits for the grid: reinforce the area first (Grid tool)"
        : `Accepted — build it by ${monthYear(c.buildByMs ?? now)}, or the contract lapses`,
    );
  });
  const installing = stats.built.length - stats.inService.length;

  const overview = (
    <>
      {stats.built.length === 0 && stats.pending.length === 0 && stats.accepted.length === 0 && (
        <p className="dh-note">
          Rent large roofs and put the utility&apos;s own solar on them: it pays the build and keeps what the array makes, against the rent and its upkeep. Set the rent
          and offer contracts under Build.
        </p>
      )}
      <div className="tool-tiles">
        <ToolTile
          label="The utility's arrays"
          value={`${Math.round(kwp(stats.built))} kWp`}
          sub={`on ${stats.built.length} roof${stats.built.length === 1 ? "" : "s"}${installing > 0 ? ` · ${installing} being installed` : ""}`}
          title="The utility's own solar on rented roofs: it keeps what they make"
        />
        <ToolTile
          label="Rent and upkeep"
          value={stats.yearlyCostRp > 0 ? formatCHF(stats.yearlyCostRp) : "none"}
          sub={stats.yearlyCostRp > 0 ? "a year" : "no arrays yet"}
          title="What the utility pays a year for its arrays: the owners' rent and the upkeep"
        />
        <ToolTile
          label="Offers out"
          value={String(stats.pending.length)}
          sub={`${stats.declined} declined · ${stats.ownSolar} built their own`}
          title="Offers the owners are still thinking over. Some decline (for now); some are prompted to build solar of their own instead."
        />
        <ToolTile
          label="Roofs left"
          value={String(stats.eligible.length)}
          sub={`about ${share} in 10 would accept`}
          title="Large roofs without solar, whose owners could be offered a contract — and how many of them would accept at the rent you offer now (Build)"
        />
      </div>

      <ToolListGroup title="Needs you" limit={5}>
        {acceptedRows}
      </ToolListGroup>
      <ToolListGroup title="Offers awaiting an answer" limit={4}>
        {stats.pending.map((c) => contractRow(c, ROOF_COLOR.offered, `CHF ${c.rentChfPerM2.toFixed(2)}/m²`, `Offered ${monthYear(c.offeredAtMs)} · answer by ${monthYear(c.answerAtMs)}`))}
      </ToolListGroup>
      <ToolListGroup title="The utility's arrays" limit={5}>
        {[...stats.built]
          .sort((a, b) => (b.capacityKw ?? 0) - (a.capacityKw ?? 0))
          .map((c) =>
            contractRow(
              c,
              ROOF_COLOR.utility,
              `${(c.capacityKw ?? 0).toFixed(0)} kWp`,
              (c.installedAtMs ?? Infinity) <= now ? `Generating since ${monthYear(c.installedAtMs ?? now)}` : `Being installed · ready ${monthYear(c.installedAtMs ?? now)}`,
            ),
          )}
      </ToolListGroup>
      <p className="dh-note tool-list-hint">Click a roof here or on the map: its card shows its contract, or what an array there would mean.</p>
    </>
  );

  const build = (
    <>
      <h4 className="tool-list-heading">The offer</h4>
      <RentSlider />
      <Facts
        facts={[
          {
            label: "At this rent",
            value: `about ${share} owners in 10 would accept`,
            title: "Owners want different rents — most somewhere around CHF 1–4 per m². Offer more and more say yes, but each array earns less.",
          },
          { label: "Large roofs without solar", value: String(stats.eligible.length) },
        ]}
      />
      <label className="dh-check" title="The utility pays the build cost — the owner's price, less the federal payment — and keeps what the array makes, against the rent and its upkeep">
        <input type="checkbox" checked={roofContracts.getAutoBuild()} onChange={(e) => roofContracts.setAutoBuild(e.target.checked)} />
        Build as soon as an owner accepts
      </label>
      <p className="dh-note tool-list-hint">
        Click a roof on the map to see what an array there would mean, and offer its owner the contract. The roof solar advisor (Town hall → Advisors) ranks the roofs that
        would return the most.
      </p>

      {stats.accepted.length > 0 && (
        <>
          <h4 className="tool-list-heading">Accepted — to build within {ROOF_BUILD_WITHIN_MONTHS} months</h4>
          {stats.accepted.map((c) => {
            const b = lookup.get(c.egid);
            const q = b ? roofContracts.quote(b, now, c.rentChfPerM2) : null;
            return (
              <div className="dh-network" key={c.id}>
                <button className="dh-link" onClick={() => select(c.egid)}>
                  {nameOf(b, c.egid)}
                </button>
                <div className="dh-note">
                  {q ? `${q.capacityKw.toFixed(0)} kWp · ` : ""}build by {monthYear(c.buildByMs ?? now)}
                </div>
                {q?.gridFull ? (
                  <div className="dh-note grid-full">Waits for the grid: the area is full at summer middays — reinforce it first (Grid tool).</div>
                ) : (
                  <div className="dh-actions">
                    <button className="dh-order" onClick={() => roofContracts.build(c.egid, simClock.getSimTimeMs())}>
                      Build{q ? ` for ${formatCHF(q.costRp)}` : ""}
                    </button>
                  </div>
                )}
              </div>
            );
          })}
        </>
      )}
    </>
  );

  return (
    <ToolPanel
      mode="roofSolar"
      title="PV Contracting"
      titleExtra={<PlotLink chart="rooftop-solar" title="Rooftop solar over time" />}
      overview={overview}
      build={build}
    />
  );
}
