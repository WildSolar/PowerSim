import { approval } from "../sim/approval";
import { measures } from "../sim/measures";
import { ENERGY_CLASS_CATALOG } from "../sim/energyClass";
import { existsAt } from "../sim/lifetime";
import { toSimTimeMs } from "../sim/calendar";
import { stock } from "../sim/stock";
import type { MunicipalityDataset } from "../data/types";
import { EMISSIONS_SOURCE_COLOR } from "../sim/emissions";
import { HEATING_SYSTEM_CATALOG, HEATING_SYSTEM_ORDER, WATER_HEATING_KIND_COLOR } from "../sim/heatingSystems";
import { solarAdoptionTallyForYear } from "../sim/solarAdoption";
import { inbox } from "../sim/inbox";
import { computeRetrofitTally, spaceHeatingKWhFor } from "../sim/yearReport";
import { PAYOUT_CATEGORIES, PAYOUT_LABEL } from "../sim/treasury";
import { CONSUMPTION_CATEGORIES } from "./deviceCategories";
import { formatCHF, formatCO2 } from "./format";
import { PieChart, type PieSlice } from "./PieChart";
import { useYearCategoryEnergy } from "./useYearCategoryEnergy";
import { useYearEmissions, BASELINE_YEAR, NET_ZERO_TARGET_YEAR } from "./useYearEmissions";
import { useYearFinances } from "./useYearFinances";
import { useYearHeatingReport } from "./useYearHeatingReport";
import { finishEarly, getFinishedYear, scoreSoFar, yearPoints } from "../sim/score";
import { handoverCheck } from "../sim/handover";
import { simClock } from "../sim/engine";
import { parThrough } from "../sim/par";
import "./panels.css";
import "./pieChart.css";
import "./reportCard.css";

/** "3 years to go", "1 year to go", or the last one. */
function yearsToGo(left: number): string {
  return left <= 0 ? "the last scored year" : left === 1 ? "1 year to go" : `${left} years to go`;
}

/** A year closed at net zero: the first time, or again — and whether the run can finish here, the
 * years left counting in full (handover.ts). */
function NetZeroBanner({ town, year, onFinish, onKeepPlaying }: { town: string; year: number; onFinish: () => void; onKeepPlaying: () => void }) {
  const score = scoreSoFar(year);
  const first = score.netZeroYear === year;
  const left = NET_ZERO_TARGET_YEAR - year;
  const check = handoverCheck(year, simClock.getSimTimeMs());
  return (
    <div className="yr-netzero">
      {first ? (
        <>
          <strong>Net zero.</strong> In {year}, {town} took out of the air as much as it still emitted — {left > 0 ? `${left} year${left === 1 ? "" : "s"} before the deadline` : "just in time"}.
        </>
      ) : (
        <>
          <strong>Still net zero.</strong> {town} held net zero through {year}.
        </>
      )}
      {check.offered && check.problems.length === 0 && (
        <>
          {" "}
          You can finish here: the {left} year{left === 1 ? "" : "s"} left until {NET_ZERO_TARGET_YEAR} count in full, 100 points each, for a final score of{" "}
          {Math.round(score.total + 100 * left)}. Or keep playing — every year still scores what it achieves, and each later year-end at net zero offers the
          finish again.
          <div className="yr-netzero-actions">
            <button className="yr-close" onClick={onFinish}>
              Finish the run
            </button>
            <button className="yr-netzero-secondary" onClick={onKeepPlaying}>
              Keep playing
            </button>
          </div>
        </>
      )}
      {check.offered && check.problems.length > 0 && (
        <>
          {" "}
          To finish here, with the years left counting in full, the books have to be in order too — but {check.problems.join(", and ")}. Keep playing:
          every year at net zero still scores in full, and the finish is offered at the next year-end that closes at net zero with the books in order.
        </>
      )}
    </div>
  );
}

export interface ReportCardModalProps {
  dataset: MunicipalityDataset;
  year: number;
  onClose: () => void;
}

/** The year-end "report card" — a full page below the top bar, opened automatically when yearEndWatcher.ts
 * pauses the clock at a calendar year boundary. The energy pie, emissions and
 * finances all read yearReport.ts's one shared sampling of the year; the
 * heating technology breakdown and renewal tally come from useYearHeatingReport
 * (the technology pass likewise shared with emissions). solarAdoptionTallyForYear
 * (unlike emissions/finances) is cheap enough to call directly, synchronously,
 * every render — it only ever reads solarAdoption.ts's own cache. */
export function ReportCardModal({ dataset, year, onClose }: ReportCardModalProps) {
  const yearEndMs = toSimTimeMs(Date.UTC(year + 1, 0, 1)) - 1;
  const standing = dataset.buildings.filter((b) => existsAt(b, yearEndMs));
  const development = stock.summaryForYear(year);
  const approvalChange = approval.atYearStart(year + 1) - approval.atYearStart(year);
  const retrofits = computeRetrofitTally(dataset.buildings, year);
  const solarTally = solarAdoptionTallyForYear(dataset.buildings, dataset.powerPlants, year);
  // The local paper's lead story of each month of the year.
  const headlines = inbox.getEditions(Number.POSITIVE_INFINITY).filter((e) => Math.floor(e.month / 12) === year).reverse();

  const { data: overallEnergy, loading: overallLoading } = useYearCategoryEnergy(dataset, year);
  const overallSlices: PieSlice[] = overallEnergy
    ? CONSUMPTION_CATEGORIES.map((c) => ({ key: c.key, label: c.label, icon: c.icon, color: c.color, valueKWh: overallEnergy[c.key] }))
    : [];

  const { data: heatingReport, loading: heatingLoading } = useYearHeatingReport(dataset.buildings, year);
  const spaceSlices: PieSlice[] = heatingReport
    ? HEATING_SYSTEM_ORDER.map((id) => ({
        key: id,
        label: HEATING_SYSTEM_CATALOG[id].label,
        icon: HEATING_SYSTEM_CATALOG[id].icon,
        color: HEATING_SYSTEM_CATALOG[id].color,
        valueKWh: spaceHeatingKWhFor(heatingReport.technology, id),
      }))
    : [];
  const waterSlices: PieSlice[] = heatingReport
    ? [
        {
          key: "heatPump",
          label: "Heat pump",
          icon: "🌬️",
          color: WATER_HEATING_KIND_COLOR.heatPump,
          valueKWh: heatingReport.technology.heatPumpWaterKWh,
        },
        {
          key: "direct",
          label: "Direct electric",
          icon: "🔌",
          color: WATER_HEATING_KIND_COLOR.direct,
          valueKWh: heatingReport.technology.directElectricWaterKWh,
        },
      ]
    : [];
  const totalRenewals = heatingReport ? heatingReport.renewals.reduce((sum, r) => sum + r.count, 0) : 0;

  const { data: emissions, loading: emissionsLoading } = useYearEmissions(dataset, year);
  const emissionSlices: PieSlice[] = emissions
    ? [
        { key: "electricity", label: "Electricity", icon: "⚡", color: EMISSIONS_SOURCE_COLOR.electricity, valueKWh: emissions.current.electricityKgCO2 },
        { key: "mobility", label: "Mobility (petrol/diesel)", icon: "🚗", color: EMISSIONS_SOURCE_COLOR.mobility, valueKWh: emissions.current.mobilityKgCO2 },
        {
          key: "districtHeating",
          label: "District heating",
          icon: "🏭",
          color: EMISSIONS_SOURCE_COLOR.districtHeating,
          valueKWh: emissions.current.districtHeatingKgCO2,
        },
        { key: "gas", label: "Gas heating", icon: "🔥", color: EMISSIONS_SOURCE_COLOR.gas, valueKWh: emissions.current.gasKgCO2 },
        { key: "oil", label: "Oil heating", icon: "🛢️", color: EMISSIONS_SOURCE_COLOR.oil, valueKWh: emissions.current.oilKgCO2 },
      ]
    : [];
  // The change in net emissions per resident against the start (negative: a cut).
  const vsBaselinePct = emissions ? -yearPoints(emissions.current, emissions.baseline) : 0;

  const { data: finances, loading: financesLoading } = useYearFinances(dataset, year);

  const homes = standing.reduce((sum, b) => sum + b.dwellings.length, 0);
  const approvalNow = Math.round(approval.getApproval());
  const signed = (rp: number) => `${rp >= 0 ? "+" : "−"}${formatCHF(Math.abs(rp))}`;
  const loading = <div className="loading-note">Counting the year…</div>;

  const income: LedgerRow[] = finances
    ? [
        { label: "Electricity sold to customers", rp: finances.current.consumerRevenueRp },
        { label: "Government allocation", rp: finances.current.governmentAllocationRp },
        { label: "District heat sold", rp: finances.current.districtHeatRevenueRp },
        { label: "Public charging sold (municipal chargers)", rp: finances.current.publicChargingRevenueRp },
        { label: "Zoning levy", rp: finances.current.zoningLevyRp },
        { label: "Borrowed (loans and bonds)", rp: finances.current.borrowedRp },
      ]
    : [];
  const costs: LedgerRow[] = finances
    ? [
        { label: "Wholesale electricity", rp: finances.current.wholesaleCostRp },
        { label: "Solar feed-in paid", rp: finances.current.feedInPaidRp },
        { label: "Grid upkeep", rp: finances.current.gridMaintenanceCostRp },
        { label: "District heat bought from the source", rp: finances.current.districtHeatPurchaseRp },
        { label: "District heating network upkeep", rp: finances.current.districtHeatUpkeepRp },
        { label: "Public charger upkeep", rp: finances.current.publicChargingUpkeepRp },
        { label: "Utility profit handed to the town", rp: finances.current.profitTransferRp },
        ...PAYOUT_CATEGORIES.map((c) => ({ label: PAYOUT_LABEL[c], rp: finances.current.spendingRp[c] })),
      ]
    : [];

  return (
    <div className="year-review" role="dialog" aria-label={`Year in Review ${year}`}>
      <div className="yr-body">
        <div className="yr-page">
          <header className="yr-head">
            <div>
              <div className="yr-kicker">Year in Review · {dataset.name}</div>
              <h1>{year}</h1>
              <p>
                {standing.length.toLocaleString("de-CH")} buildings, {homes.toLocaleString("de-CH")} homes. The game is paused — pick a speed when you're
                ready.
              </p>
            </div>
            <button className="yr-close" onClick={onClose}>
              Back to the map
            </button>
          </header>

          {emissions && year > BASELINE_YEAR && year <= NET_ZERO_TARGET_YEAR && emissions.current.netKgCO2 <= 0 && getFinishedYear() === null && (
            <NetZeroBanner
              town={dataset.name}
              year={year}
              onFinish={() => {
                finishEarly(year);
                onClose();
              }}
              onKeepPlaying={onClose}
            />
          )}

          <div className="yr-figures">
            <section>
              <h3>CO₂</h3>
              <div className="yr-value">{emissions ? `${(emissions.current.netKgCO2 / 1_000_000).toLocaleString("de-CH", { minimumFractionDigits: 1, maximumFractionDigits: 1 })} kt` : "…"}</div>
              <div className="yr-detail">
                {!emissions ? (
                  "Counting…"
                ) : year === BASELINE_YEAR ? (
                  "The baseline every later year is measured against."
                ) : (
                  <span className={vsBaselinePct <= 0 ? "good" : "bad"}>
                    {vsBaselinePct <= 0 ? "−" : "+"}
                    {Math.abs(vsBaselinePct).toFixed(1)}% per resident against {BASELINE_YEAR}
                  </span>
                )}
              </div>
            </section>
            <section>
              <h3>Treasury at year end</h3>
              <div className="yr-value">{finances ? millions(finances.balanceRp) : "…"}</div>
              <div className="yr-detail">
                {finances ? <span className={finances.current.netIncomeRp >= 0 ? "good" : "bad"}>{finances.current.netIncomeRp >= 0 ? "+" : "−"}{millions(Math.abs(finances.current.netIncomeRp))} over the year</span> : "Counting…"}
              </div>
            </section>
            <section>
              <h3>Approval</h3>
              <div className="yr-value">{approvalNow}%</div>
              <div className="yr-detail">
                {Math.abs(approvalChange) >= 1 ? (
                  <span className={approvalChange > 0 ? "good" : "bad"}>
                    {approvalChange > 0 ? "▲" : "▼"} {Math.abs(Math.round(approvalChange))} points over the year
                  </span>
                ) : (
                  "About where it was a year ago"
                )}
              </div>
            </section>
            <section>
              <h3>Score</h3>
              <div className="yr-value">{emissions && year > BASELINE_YEAR ? Math.round(scoreSoFar(year).total) : "—"}</div>
              <div className="yr-detail">
                {!emissions ? (
                  "Counting…"
                ) : year === BASELINE_YEAR ? (
                  `Scoring starts with ${year + 1}`
                ) : (
                  <>
                    {(() => {
                      const pts = yearPoints(emissions.current, emissions.baseline);
                      const par = parThrough(year);
                      const total = Math.round(scoreSoFar(year).total);
                      return (
                        <>
                          <span className={pts >= 0 ? "good" : "bad"}>
                            {pts >= 0 ? "+" : "−"}
                            {Math.abs(Math.round(pts))} this year
                          </span>
                          {par !== null && ` · ${total - Math.round(par) >= 0 ? "+" : "−"}${Math.abs(total - Math.round(par))} vs par`}
                          {` · ${yearsToGo(NET_ZERO_TARGET_YEAR - year)}`}
                        </>
                      );
                    })()}
                  </>
                )}
              </div>
            </section>
          </div>

          <div className="yr-grid">
            <section className="yr-card">
              <h2>Emissions</h2>
              {emissionsLoading || !emissions ? (
                loading
              ) : (
                <>
                  <PieChart title={`${year} by source`} slices={emissionSlices} formatValue={formatCO2} />
                  <p className="yr-note">
                    {year === BASELINE_YEAR
                      ? "The first year of the game: every later report compares back to it."
                      : `${formatCO2(emissions.current.totalKgCO2)} this year, against ${formatCO2(emissions.baseline.totalKgCO2)} in ${BASELINE_YEAR}.`}{" "}
                    {emissions.current.removalsKgCO2 > 0 &&
                      ` Carbon removal contracts took ${formatCO2(emissions.current.removalsKgCO2)} back out, leaving ${formatCO2(emissions.current.netKgCO2)}. `}
                    {emissions.current.removalsKgCO2 === 0 &&
                      year > BASELINE_YEAR &&
                      measures.getState("carbon-removal")?.active &&
                      ` Carbon removal doesn't count yet: it is for the last tenth, and emissions are still at ${Math.round((emissions.current.totalKgCO2 / emissions.baseline.totalKgCO2) * 100)}% of ${BASELINE_YEAR}'s. `}
                    What is burned, or drawn from the grid less the solar fed back — not what it took to make a heat pump, a battery or a panel.
                  </p>
                </>
              )}
            </section>

            <section className="yr-card">
              <h2>Money</h2>
              {financesLoading || !finances ? (
                loading
              ) : (
                <>
                  <Ledger title="Income" rows={income} sign="+" />
                  <Ledger title="Spending" rows={costs} sign="−" />
                  <div className={`yr-ledger-total ${finances.current.netIncomeRp >= 0 ? "good" : "bad"}`}>
                    <span>Net over the year</span>
                    <span>{signed(finances.current.netIncomeRp)}</span>
                  </div>
                  <p className="yr-note">
                    Federal and cantonal grants aren't municipal money, and gas, oil and petrol are paid to their own suppliers, so neither shows here.
                  </p>
                </>
              )}
            </section>

            {headlines.length > 0 && (
              <section className="yr-card yr-paper">
                <h2>The year in headlines</h2>
                <ul className="yr-headlines">
                  {headlines.map((e) => (
                    <li key={e.id}>
                      <span className="yr-headline-month">{e.dateLabel.split(" ")[0]}</span>
                      <span>{e.lead.headline}</span>
                    </li>
                  ))}
                </ul>
              </section>
            )}

            <section className="yr-card">
              <h2>Electricity used</h2>
              {overallLoading || !overallEnergy ? loading : <PieChart title="By use" slices={overallSlices} />}
            </section>

            <section className="yr-card yr-wide">
              <h2>Heat delivered</h2>
              <p className="yr-note">Every fuel counted, so these totals don't match the electricity figures.</p>
              {heatingLoading || !heatingReport ? (
                loading
              ) : (
                <div className="pie-chart-row">
                  <PieChart title="Space heating" slices={spaceSlices} />
                  <PieChart title="Hot water" slices={waterSlices} />
                </div>
              )}
            </section>

            <section className="yr-card yr-wide">
              <h2>What changed</h2>
              <div className="yr-changes">
                <div>
                  <h3>Heating replaced</h3>
                  {heatingLoading || !heatingReport ? (
                    loading
                  ) : heatingReport.renewals.length === 0 ? (
                    <p className="yr-empty">None this year.</p>
                  ) : (
                    <>
                      <ul className="yr-tally">
                        {heatingReport.renewals.map((r) => (
                          <li key={`${r.previousSystem}>${r.system}`}>
                            <span className="yr-count">{r.count}×</span>
                            <span>
                              {HEATING_SYSTEM_CATALOG[r.previousSystem].label} → {HEATING_SYSTEM_CATALOG[r.system].label}
                              {r.previousSystem === r.system && <span className="yr-tag">like for like</span>}
                            </span>
                          </li>
                        ))}
                      </ul>
                      <p className="yr-sum">{totalRenewals} in all</p>
                    </>
                  )}
                </div>
                <div>
                  <h3>Insulation upgraded</h3>
                  {retrofits.total === 0 ? (
                    <p className="yr-empty">None this year.</p>
                  ) : (
                    <>
                      <ul className="yr-tally">
                        {retrofits.entries.map((r) => (
                          <li key={`${r.from}>${r.to}`}>
                            <span className="yr-count">{r.count}×</span>
                            <span>
                              {ENERGY_CLASS_CATALOG[r.from].label} → {ENERGY_CLASS_CATALOG[r.to].label}
                            </span>
                          </li>
                        ))}
                      </ul>
                      <p className="yr-sum">{retrofits.total} in all</p>
                    </>
                  )}
                </div>
                <div>
                  <h3>Solar</h3>
                  {solarTally.count === 0 ? (
                    <p className="yr-empty">No new panels this year.</p>
                  ) : (
                    <ul className="yr-tally">
                      <li>
                        <span className="yr-count">{solarTally.count}</span>
                        <span>buildings put up panels, {solarTally.totalCapacityKw.toFixed(0)} kWp in all</span>
                      </li>
                      {solarTally.batteriesWithSolar > 0 && (
                        <li>
                          <span className="yr-count">{solarTally.batteriesWithSolar}</span>
                          <span>of them with a home battery</span>
                        </li>
                      )}
                      {solarTally.batteriesAdded > 0 && (
                        <li>
                          <span className="yr-count">{solarTally.batteriesAdded}</span>
                          <span>existing systems added a battery</span>
                        </li>
                      )}
                    </ul>
                  )}
                </div>
                <div>
                  <h3>Building</h3>
                  {development.newBuildings + development.replacementBuildings + development.demolished === 0 ? (
                    <p className="yr-empty">Nothing completed or torn down this year.</p>
                  ) : (
                    <>
                      <ul className="yr-tally">
                        <li>
                          <span className="yr-count">{development.newBuildings}</span>
                          <span>new buildings</span>
                        </li>
                        <li>
                          <span className="yr-count">{development.replacementBuildings}</span>
                          <span>replacements</span>
                        </li>
                        <li>
                          <span className="yr-count">{development.demolished}</span>
                          <span>torn down ({development.dwellingsDemolished} homes)</span>
                        </li>
                        <li>
                          <span className="yr-count">+{development.dwellingsBuilt}</span>
                          <span>homes built, {Math.round(development.gfaBuiltM2).toLocaleString("de-CH")} m²</span>
                        </li>
                      </ul>
                      <p className="yr-sum">
                        Floor space {development.netGrowthPct >= 0 ? "grew" : "shrank"} by {Math.abs(development.netGrowthPct).toFixed(1)}%
                      </p>
                    </>
                  )}
                </div>
              </div>
            </section>
          </div>

          <div className="yr-foot">
            <button className="yr-close" onClick={onClose}>
              Back to the map
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

/** CHF in millions once it reaches a million, so the headline figures stay on one line. */
function millions(rp: number): string {
  const chf = rp / 100;
  return Math.abs(chf) >= 1_000_000 ? `CHF ${(chf / 1_000_000).toLocaleString("de-CH", { minimumFractionDigits: 2, maximumFractionDigits: 2 })} M` : formatCHF(rp);
}

interface LedgerRow {
  label: string;
  rp: number;
}

/** One side of the accounts: the lines that moved money this year, largest first. */
function Ledger({ title, rows, sign }: { title: string; rows: LedgerRow[]; sign: "+" | "−" }) {
  const shown = rows.filter((r) => r.rp > 0).sort((a, b) => b.rp - a.rp);
  const total = shown.reduce((sum, r) => sum + r.rp, 0);
  return (
    <div className="yr-ledger">
      <div className="yr-ledger-head">
        <span>{title}</span>
        <span>
          {sign}
          {formatCHF(total)}
        </span>
      </div>
      {shown.map((r) => (
        <div className="yr-ledger-row" key={r.label}>
          <span>{r.label}</span>
          <span>
            {sign}
            {formatCHF(r.rp)}
          </span>
        </div>
      ))}
    </div>
  );
}
