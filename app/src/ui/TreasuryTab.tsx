import { useState, useSyncExternalStore } from "react";
import type { MunicipalityDataset } from "../data/types";
import { toDateMs, toSimTimeMs } from "../sim/calendar";
import { debt } from "../sim/debt";
import { simClock } from "../sim/engine";
import { bookedFinances, operatingIncomeRp, type MunicipalFinances } from "../sim/finances";
import { treasury, type PayoutCategory, type PayoutsByCategory } from "../sim/treasury";
import { useSimDay } from "../sim/store";
import { BorrowingTab } from "./BorrowingTab";
import { formatCHF } from "./format";
import { useLiveTreasury } from "./useLiveTreasury";
import "./borrowing.css";
import { UTILITY_PROFIT_RETAINED_SHARE } from "../config/treasury";

type Section = "accounts" | "borrowing";

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
  return operatingIncomeRp(f) - f.governmentAllocationRp - f.zoningLevyRp;
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
        <button className={section === "borrowing" ? "active" : ""} onClick={() => setSection("borrowing")}>
          🏦 Borrowing
        </button>
      </div>
      {section === "accounts" ? <Accounts dataset={dataset} /> : <BorrowingTab />}
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
  const year = new Date(toDateMs(now)).getUTCFullYear();
  const yearStartMs = toSimTimeMs(Date.UTC(year, 0, 1));
  const soFar = treasury.paidOut(yearStartMs, now + 1);
  const running12 = treasury.operatingPaidOutTotal(now - 365.25 * 24 * 3600e3, now + 1);
  const owed = debt.getLoans().reduce((s, l) => s + (l.status === "active" ? l.outstandingRp : 0), 0);
  const booked = bookedFinances();
  const last = booked[booked.length - 1] ?? null;

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
          <span className="borrow-note">electricity and heat settle at year end</span>
        </div>
        <div>
          <span className="borrow-label">Running spending, 12 months</span>
          <span className="borrow-value" style={{ color: running12 > live.budgetRp ? "var(--bad)" : undefined }}>
            {formatCHF(running12)}
          </span>
          <span className="borrow-note">against an allocation of {formatCHF(live.budgetRp)}</span>
        </div>
        <div>
          <span className="borrow-label">Debt</span>
          <span className="borrow-value">{formatCHF(owed)}</span>
          <span className="borrow-note">
            rating {debt.rating(now).label}
            {debt.isSupervised() ? " · under supervision" : ""}
          </span>
        </div>
      </div>

      <h3 className="borrow-section">{year} so far</h3>
      <table className="borrow-table treasury-table">
        <tbody>
          <tr>
            <td>Government allocation (1 January)</td>
            <td className="pos">+{formatCHF(live.budgetRp)}</td>
          </tr>
          {live.receivedRp > 0 && (
            <tr>
              <td>Value-capture levy (zoning)</td>
              <td className="pos">+{formatCHF(live.receivedRp)}</td>
            </tr>
          )}
          {live.borrowedRp > 0 && (
            <tr>
              <td>Borrowed</td>
              <td className="pos">+{formatCHF(live.borrowedRp)}</td>
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
              The utility's year — electricity and district heat sold, power and heat bought, the networks' upkeep — is booked on 31 December.
            </td>
          </tr>
        </tbody>
      </table>

      {last && (
        <>
          <h3 className="borrow-section">The utility in {last.year}</h3>
          <table className="borrow-table treasury-table">
            <tbody>
              <Line label="Electricity sold to consumers" value={last.consumerRevenueRp} />
              <Line label="Solar feed-in paid to owners" value={-last.feedInPaidRp} />
              <Line label="Wholesale electricity bought" value={-last.wholesaleCostRp} />
              <Line label="Grid upkeep" value={-last.gridMaintenanceCostRp} />
              {last.districtHeatRevenueRp > 0 && <Line label="District heat sold" value={last.districtHeatRevenueRp} />}
              {last.districtHeatPurchaseRp > 0 && <Line label="District heat bought from the source" value={-last.districtHeatPurchaseRp} />}
              {last.districtHeatUpkeepRp > 0 && <Line label="District heating network upkeep" value={-last.districtHeatUpkeepRp} />}
              {last.publicChargingRevenueRp > 0 && <Line label="Public charging sold (municipal chargers)" value={last.publicChargingRevenueRp} />}
              {last.publicChargingUpkeepRp > 0 && <Line label="Public charger upkeep" value={-last.publicChargingUpkeepRp} />}
              <tr className="treasury-total">
                <td>The utility's profit</td>
                <td className={utilityMarginRp(last) + last.profitTransferRp >= 0 ? "pos" : "neg"}>
                  {utilityMarginRp(last) + last.profitTransferRp >= 0 ? "+" : "−"}
                  {formatCHF(Math.abs(utilityMarginRp(last) + last.profitTransferRp))}
                </td>
              </tr>
              {last.profitTransferRp > 0 && <Line label={`Handed to the town's general account (${Math.round((1 - UTILITY_PROFIT_RETAINED_SHARE) * 100)}%)`} value={-last.profitTransferRp} />}
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

      <h3 className="borrow-section">Year by year</h3>
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
                <th title="Zoning levy">Levies</th>
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
                const invested = sum(f.spendingRp, ["infrastructure", "districtHeat", "charging", "grid"]);
                return (
                  <tr key={f.year}>
                    <td>{f.year}</td>
                    <td>{chfM(utilityMarginRp(f))}</td>
                    <td>{chfM(f.governmentAllocationRp)}</td>
                    <td>{chfM(f.zoningLevyRp)}</td>
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
