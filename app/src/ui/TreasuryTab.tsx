import { useState, useSyncExternalStore } from "react";
import type { MunicipalityDataset } from "../data/types";
import { BASELINE_YEAR, toDateMs, toSimTimeMs } from "../sim/calendar";
import { debt } from "../sim/debt";
import { approval } from "../sim/approval";
import { simClock } from "../sim/engine";
import { bookedFinances, concessionRpPerKWh, operatingIncomeRp, type MunicipalFinances } from "../sim/finances";
import { treasury, type PayoutCategory, type PayoutsByCategory } from "../sim/treasury";
import { useSimDay } from "../sim/store";
import { BorrowingTab } from "./BorrowingTab";
import { TreasuryLedger } from "./TreasuryLedger";
import { formatCHF } from "./format";
import { useLiveTreasury } from "./useLiveTreasury";
import "./borrowing.css";
import { UTILITY_PROFIT_RETAINED_SHARE } from "../config/treasury";
import { PlotLink } from "./PlotLink";

type Section = "accounts" | "ledger" | "borrowing";

/** How the ledger's payout categories read in the accounts. */
const GROUPS: { label: string; categories: PayoutCategory[]; note?: string }[] = [
  { label: "Subsidies", categories: ["solar", "heating", "vehicle", "retrofit"], note: "paid as households decide" },
  { label: "Campaigns, programmes and studies", categories: ["programs"] },
  { label: "Zoning plans", categories: ["zoning"] },
  { label: "Interest", categories: ["interest"] },
  { label: "Investments", categories: ["infrastructure", "districtHeat", "charging", "grid"], note: "may be borrowed for" },
  { label: "Debt repaid", categories: ["debtRepayment"] },
];

function sum(spending: PayoutsByCategory, categories: PayoutCategory[]): number {
  return categories.reduce((s, c) => s + spending[c], 0);
}

/** What the department kept of the utility's year: its profit, less what went to the town. */
function utilityMarginRp(f: MunicipalFinances): number {
  return operatingIncomeRp(f) - f.governmentAllocationRp;
}

/** The Treasury tab: the accounts (this year so far, the last booked year in detail, and every year
 * since the start), and borrowing. */
export function TreasuryTab({ dataset, initialSection = "accounts" }: { dataset: MunicipalityDataset; initialSection?: Section }) {
  const [section, setSection] = useState<Section>(initialSection);
  return (
    <div className="panel-typography treasury-tab">
      <div className="treasury-sections">
        <button className={section === "accounts" ? "active" : ""} onClick={() => setSection("accounts")}>
          🧾 Accounts
        </button>
        <button className={section === "ledger" ? "active" : ""} onClick={() => setSection("ledger")}>
          📒 Ledger
        </button>
        <button className={section === "borrowing" ? "active" : ""} onClick={() => setSection("borrowing")}>
          🏦 Borrowing
        </button>
      </div>
      {section === "accounts" ? <Accounts dataset={dataset} /> : section === "ledger" ? <TreasuryLedger dataset={dataset} /> : <BorrowingTab />}
    </div>
  );
}

function Accounts({ dataset }: { dataset: MunicipalityDataset }) {
  useSyncExternalStore(
    (l) => treasury.subscribe(l),
    () => treasury.getVersion(),
  );
  useSimDay();
  const live = useLiveTreasury(dataset);
  const now = simClock.getSimTimeMs();
  const allowanceRp = approval.spendingAllowanceRp(now);
  const year = new Date(toDateMs(now)).getUTCFullYear();
  const yearStartMs = toSimTimeMs(Date.UTC(year, 0, 1));
  const soFar = treasury.paidOut(yearStartMs, now + 1);
  const running12 = treasury.operatingPaidOutTotal(now - 365.25 * 24 * 3600e3, now + 1);
  const owed = debt.getLoans().reduce((s, l) => s + (l.status === "active" ? l.outstandingRp : 0), 0);
  const booked = bookedFinances();
  const last = booked[booked.length - 1] ?? null;
  // The utility's own result, before the town's take (the public buildings' solar credit is the department's, not the utility's).
  const utilityProfit = last ? utilityMarginRp(last) + last.profitTransferRp - last.publicSolarSavingsRp : 0;

  // Closing balances, year by year from the opening cash.
  let balance = treasury.openingBalanceRp();
  const rows = booked.map((f) => {
    balance += f.netIncomeRp;
    return { f, closing: balance };
  });

  return (
    <>
      <div className="borrow-summary">
        <div>
          <span className="borrow-label">Balance now</span>
          <span className="borrow-value" style={{ color: live.balanceRp !== null && live.balanceRp < 0 ? "var(--bad)" : undefined }}>
            {live.balanceRp === null ? "…" : formatCHF(live.balanceRp)}
          </span>
          <span className="borrow-note">the utility settles each month</span>
        </div>
        <div>
          <span className="borrow-label">Running spending, 12 months</span>
          <span className="borrow-value" style={{ color: running12 > allowanceRp ? "var(--bad)" : undefined }}>
            {formatCHF(running12)}
          </span>
          <span className="borrow-note">against {formatCHF(allowanceRp)} taken in (allocation and what the utility earned you)</span>
        </div>
        <div>
          <span className="borrow-label">Debt</span>
          <span className="borrow-value">{formatCHF(owed)}</span>
          <span className="borrow-note">
            rating {debt.rating().label}
            {debt.isSupervised() ? " · under supervision" : ""}
          </span>
        </div>
      </div>

      <h3 className="borrow-section">{year} so far</h3>
      <table className="borrow-table treasury-table">
        <tbody>
          <tr>
            <td>
              Government allocation<span className="borrow-note"> · a twelfth each month, of {formatCHF(live.budgetRp)}</span>
            </td>
            <td className="pos">+{formatCHF(live.allocationSoFarRp)}</td>
          </tr>
          {live.utilityMonths > 0 && (
            <tr>
              <td>
                Municipal utility<span className="borrow-note"> · after the town&apos;s take, {live.utilityMonths} month{live.utilityMonths === 1 ? "" : "s"} settled</span>
              </td>
              <td className={live.utilityRp >= 0 ? "pos" : "neg"}>
                {live.utilityRp >= 0 ? "+" : "−"}
                {formatCHF(Math.abs(live.utilityRp))}
              </td>
            </tr>
          )}
          {live.borrowedRp > 0 && (
            <tr>
              <td>Borrowed</td>
              <td className="pos">+{formatCHF(live.borrowedRp)}</td>
            </tr>
          )}
          {live.gridCompensationRp > 0 && (
            <tr>
              <td title="For every kW of new solar on the town's grid, Swissgrid pays towards the reinforcements it makes necessary">Swissgrid&apos;s grid compensation</td>
              <td className="pos">+{formatCHF(live.gridCompensationRp)}</td>
            </tr>
          )}
          {GROUPS.map((g) => {
            const v = sum(soFar, g.categories);
            return v > 0 ? (
              <tr key={g.label}>
                <td>
                  {g.label}
                  {g.note && <span className="borrow-note"> · {g.note}</span>}
                </td>
                <td className="neg">−{formatCHF(v)}</td>
              </tr>
            ) : null;
          })}
          <tr className="treasury-note-row">
            <td colSpan={2} className="borrow-note">
              The utility settles each month once it is over: electricity and district heat sold, power and heat bought, the networks&apos; upkeep.{" "}
              {year > BASELINE_YEAR
                ? `The town takes a concession fee of ${concessionRpPerKWh().toFixed(2)} Rp per kWh sold; the rest of the result, profit or loss, is yours — and with it what your own plants, batteries and pipes earn or save.`
                : "The town takes three quarters of a profit; a loss is all yours."}
            </td>
          </tr>
        </tbody>
      </table>

      {last && (
        <>
          <h3 className="borrow-section">
            The utility in {last.year} <PlotLink chart="utility" title="The utility's accounts over time" />
          </h3>
          <table className="borrow-table treasury-table">
            <tbody>
              <Line label="Electricity sold to consumers (energy)" value={last.energyRevenueRp} />
              <Line label="Network fees and base fees" value={last.networkRevenueRp} />
              <Line label="Solar feed-in paid to owners" value={-last.feedInPaidRp} />
              <Line label="Electricity bought over contracts" value={-last.wholesaleCostRp} />
              <Line label="Surplus sold on the spot market" value={last.surplusSoldRp} />
              <Line label="Grid upkeep" value={-last.gridMaintenanceCostRp} />
              {last.districtHeatRevenueRp > 0 && <Line label="District heat sold" value={last.districtHeatRevenueRp} />}
              {last.districtHeatPurchaseRp > 0 && <Line label="Making district heat (fuel, heat bought)" value={-last.districtHeatPurchaseRp} />}
              {last.districtHeatUpkeepRp > 0 && <Line label="District heating upkeep: pipes, plants, contracts" value={-last.districtHeatUpkeepRp} />}
              {last.publicChargingRevenueRp > 0 && <Line label="Public charging sold (municipal chargers)" value={last.publicChargingRevenueRp} />}
              {last.publicChargingUpkeepRp > 0 && <Line label="Public charger upkeep" value={-last.publicChargingUpkeepRp} />}
              {last.roofContractCostRp > 0 && <Line label="Roof rent and upkeep (utility's solar)" value={-last.roofContractCostRp} />}
              {last.windUpkeepRp > 0 && <Line label="Wind turbine upkeep" value={-last.windUpkeepRp} />}
              {last.agriPvUpkeepRp > 0 && <Line label="Agri-PV upkeep and rent (utility's fields)" value={-last.agriPvUpkeepRp} />}
              <tr className="treasury-total">
                <td>The utility's profit</td>
                <td className={utilityProfit >= 0 ? "pos" : "neg"}>
                  {utilityProfit >= 0 ? "+" : "−"}
                  {formatCHF(Math.abs(utilityProfit))}
                </td>
              </tr>
              {last.profitTransferRp > 0 && (
                <Line
                  label={
                    last.year > BASELINE_YEAR
                      ? `Concession fee to the town (${concessionRpPerKWh().toFixed(2)} Rp per kWh sold)`
                      : `Handed to the town's general account (${Math.round((1 - UTILITY_PROFIT_RETAINED_SHARE) * 100)}% of the profit)`
                  }
                  value={-last.profitTransferRp}
                />
              )}
              {last.publicSolarSavingsRp > 0 && <Line label="Solar on public buildings: bills saved, power fed in" value={last.publicSolarSavingsRp} />}
              <tr className="treasury-total">
                <td>Kept by the energy department</td>
                <td className={utilityMarginRp(last) >= 0 ? "pos" : "neg"}>
                  {utilityMarginRp(last) >= 0 ? "+" : "−"}
                  {formatCHF(Math.abs(utilityMarginRp(last)))}
                </td>
              </tr>
            </tbody>
          </table>
        </>
      )}

      <h3 className="borrow-section">
        Year by year <PlotLink chart="spending" title="Spending over time" />
      </h3>
      {rows.length === 0 ? (
        <p className="borrow-note">The first year's accounts are booked on 31 December.</p>
      ) : (
        <div className="treasury-years-wrap">
          <table className="borrow-table treasury-years">
            <thead>
              <tr>
                <th>Year</th>
                <th title="The department's share of the utility's profit">Utility</th>
                <th title="From the overall government">Allocation</th>
                <th>Borrowed</th>
                <th title="Subsidies, programmes, zoning plans, interest">Running</th>
                <th>Invested</th>
                <th>Repaid</th>
                <th>Balance</th>
              </tr>
            </thead>
            <tbody>
              {rows.map(({ f, closing }) => {
                const running = sum(f.spendingRp, ["solar", "heating", "vehicle", "retrofit", "programs", "zoning", "interest"]);
                // Less Swissgrid's compensation for the new solar on the grid: it pays towards the reinforcements.
                const invested = sum(f.spendingRp, ["infrastructure", "districtHeat", "charging", "grid"]) - (f.gridCompensationRp ?? 0);
                return (
                  <tr key={f.year}>
                    <td>{f.year}</td>
                    <td>{chfM(utilityMarginRp(f))}</td>
                    <td>{chfM(f.governmentAllocationRp)}</td>
                    <td>{chfM(f.borrowedRp)}</td>
                    <td>{chfM(-running)}</td>
                    <td>{chfM(-invested)}</td>
                    <td>{chfM(-f.spendingRp.debtRepayment)}</td>
                    <td className={closing < 0 ? "neg" : ""}>
                      <strong>{chfM(closing)}</strong>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          <p className="borrow-note">CHF millions. Balance: at the end of each year, from {formatCHF(treasury.openingBalanceRp())} at the start.</p>
        </div>
      )}
    </>
  );
}

function Line({ label, value }: { label: string; value: number }) {
  return (
    <tr>
      <td>{label}</td>
      <td className={value >= 0 ? "pos" : "neg"}>
        {value >= 0 ? "+" : "−"}
        {formatCHF(Math.abs(value))}
      </td>
    </tr>
  );
}

function chfM(rp: number): string {
  if (Math.abs(rp) < 500) return "–";
  return (rp / 100 / 1e6).toFixed(2);
}
