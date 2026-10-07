import { useMemo, useSyncExternalStore } from "react";
import { ROOF_BUILD_WITHIN_MONTHS, ROOF_RENT_RANGE_CHF_PER_M2, ROOF_RENT_STEP_CHF_PER_M2 } from "../config/roofContracts";
import type { Building } from "../data/types";
import { mapFocus } from "../map/mapFocus";
import { formatDate } from "../sim/calendar";
import { simClock } from "../sim/engine";
import { roofContracts, type RoofContract } from "../sim/roofContracts";
import { useSimDay } from "../sim/store";
import { formatCHF } from "./format";
import "./districtHeatPanel.css";
import { SupervisionNotice } from "./SupervisionNotice";

function monthYear(ms: number): string {
  return formatDate(ms).replace(/^\d+ /, "");
}

function useRoofContracts(): number {
  return useSyncExternalStore(
    (l) => roofContracts.subscribe(l),
    () => roofContracts.getVersion(),
  );
}

function RentSlider() {
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
        <div className="dh-actions">
          <button className="dh-order" onClick={() => roofContracts.build(building.egid, simClock.getSimTimeMs())}>
            Build {quote ? `${quote.capacityKw.toFixed(0)} kWp for ${formatCHF(quote.costRp)}` : "the array"}
          </button>
        </div>
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
      {c?.status === "ownSolar" && <p className="dh-note">Your offer prompted the owner to put up solar of their own.</p>}
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
            <div className="info-row" title="What its output saves buying power at today's wholesale price">
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
            {quote.batteryKwh !== null && <p className="dh-note">The grid here is full at summer middays: the array needs a {quote.batteryKwh} kWh grid-friendly battery (included).</p>}
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

function nameOf(b: Building | undefined, egid: string): string {
  return b?.address ?? `Building ${egid}`;
}

/** The Roof solar layer's panel: the rent the utility offers, offering it to every large roof at
 * once, the roofs whose owners accepted (to build), and the utility's arrays. */
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
      pending: all.filter((c) => c.status === "offered").length,
      accepted: all.filter((c) => c.status === "accepted"),
      built,
      inService: built.filter((c) => (c.installedAtMs ?? Infinity) <= now),
      ownSolar: all.filter((c) => c.status === "ownSolar").length,
      declined: contracts.filter((c) => c.status === "declined").length,
      yearlyCostRp: roofContracts.yearlyCostRp(now),
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [now, version, buildings]);
  const estimate = useMemo(() => roofContracts.offerAllEstimate(now), [now, version]); // eslint-disable-line react-hooks/exhaustive-deps
  const kwp = (cs: RoofContract[]) => cs.reduce((sum, c) => sum + (c.capacityKw ?? 0), 0);
  const select = (egid: string) => {
    onSelectBuilding(egid);
    const b = lookup.get(egid);
    if (b) mapFocus.focusBuilding(b);
  };

  return (
    <div className="district-heat-panel">
      <h3 className="panel-title">Roof solar</h3>
      <SupervisionNotice />
      <p className="dh-note">
        Rent large roofs and put the utility's own solar on them. An owner can accept, decline, or be prompted to build their own. The utility pays the build cost — the
        owner's price, less the federal payment — and keeps what the array makes, against the rent and its upkeep.
      </p>

      <RentSlider />
      <p className="dh-note">Owners want different rents — most somewhere around CHF 1–4 per m². Offer more and more say yes, but each array earns less.</p>
      <label className="dh-check">
        <input type="checkbox" checked={roofContracts.getAutoBuild()} onChange={(e) => roofContracts.setAutoBuild(e.target.checked)} />
        Build as soon as an owner accepts
      </label>

      <div className="info-row">
        <span>Large roofs without solar</span>
        <span className="info-value">{stats.eligible.length}</span>
      </div>
      {stats.eligible.length > 0 && (
        <p className="dh-note">
          At this rent, about {estimate.accepting} owners would likely accept: around {Math.round(estimate.capacityKw)} kWp, costing{" "}
          {formatCHF(estimate.costRp)} to build{roofContracts.getAutoBuild() ? " — paid as they accept" : ""}.
        </p>
      )}
      <div className="dh-actions">
        <button className="dh-order" disabled={stats.eligible.length === 0} onClick={() => roofContracts.offerAll(simClock.getSimTimeMs())}>
          Offer all {stats.eligible.length} a contract
        </button>
      </div>
      <p className="dh-note">Or click a roof on the map to see what an array there would mean, and offer just that one.</p>

      <h4 className="dh-subtitle">Contracts</h4>
      <div className="info-row">
        <span>Offers awaiting an answer</span>
        <span className="info-value">{stats.pending}</span>
      </div>
      <div className="info-row">
        <span>The utility's arrays</span>
        <span className="info-value">
          {stats.built.length} · {Math.round(kwp(stats.built))} kWp
        </span>
      </div>
      {stats.built.length > stats.inService.length && <p className="dh-note">{stats.built.length - stats.inService.length} still being installed.</p>}
      <div className="info-row">
        <span>Rent and upkeep</span>
        <span className="info-value">{formatCHF(stats.yearlyCostRp)} a year</span>
      </div>
      <div className="info-row">
        <span>Owners who built their own</span>
        <span className="info-value">{stats.ownSolar}</span>
      </div>
      <div className="info-row">
        <span>Offers declined</span>
        <span className="info-value">{stats.declined}</span>
      </div>

      {stats.accepted.length > 0 && (
        <>
          <h4 className="dh-subtitle">Accepted — to build within {ROOF_BUILD_WITHIN_MONTHS} months</h4>
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
                <div className="dh-actions">
                  <button className="dh-order" onClick={() => roofContracts.build(c.egid, simClock.getSimTimeMs())}>
                    Build{q ? ` for ${formatCHF(q.costRp)}` : ""}
                  </button>
                </div>
              </div>
            );
          })}
        </>
      )}

      {stats.built.length > 0 && (
        <>
          <h4 className="dh-subtitle">The utility's arrays</h4>
          {[...stats.built]
            .sort((a, b) => (b.capacityKw ?? 0) - (a.capacityKw ?? 0))
            .slice(0, 12)
            .map((c) => (
              <div className="info-row" key={c.id}>
                <button className="dh-link" onClick={() => select(c.egid)}>
                  {nameOf(lookup.get(c.egid), c.egid)}
                </button>
                <span className="info-value">{(c.capacityKw ?? 0).toFixed(0)} kWp</span>
              </div>
            ))}
          {stats.built.length > 12 && <p className="dh-note">and {stats.built.length - 12} more.</p>}
        </>
      )}
    </div>
  );
}
