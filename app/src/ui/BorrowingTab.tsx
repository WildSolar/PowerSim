import { useState, useSyncExternalStore } from "react";
import {
  BANK_LOAN_TERMS_YEARS,
  DEBT_LIMIT_YEARS,
  FEDERAL_LOAN_PROCESSING_MONTHS,
  FEDERAL_LOAN_TERM_YEARS,
  GREEN_BOND_EARMARK_MONTHS,
  GREEN_BOND_SUBSCRIPTION_MONTHS,
  GREEN_BOND_TERM_YEARS,
} from "../config/borrowing";
import { formatDate } from "../sim/calendar";
import { debt, type Loan } from "../sim/debt";
import { simClock } from "../sim/engine";
import { interestRates } from "../sim/interestRates";
import { useSimDay } from "../sim/store";
import { treasury } from "../sim/treasury";
import { formatCHF } from "./format";
import "./borrowing.css";

const KIND_LABEL: Record<Loan["kind"], string> = { bank: "Bank loan", greenBond: "Green bond", federal: "Federal decarbonisation loan" };
const STEP_RP = 100_000 * 100; // CHF 100,000

function pct(x: number): string {
  return `${x.toFixed(2)}%`;
}

function monthYear(atMs: number): string {
  return formatDate(atMs).replace(/^\d+ /, "");
}

/** Borrowing: the market, the department's standing, the ways to borrow, and what is owed. */
export function BorrowingTab() {
  useSyncExternalStore(
    (l) => debt.subscribe(l),
    () => debt.getVersion(),
  );
  useSyncExternalStore(
    (l) => treasury.subscribe(l),
    () => treasury.getVersion(),
  );
  useSimDay();
  const now = simClock.getSimTimeMs();
  const market = debt.marketPct(now);
  const yearAgo = interestRates.history(now, 12)[0]?.pct ?? market;
  const rating = debt.rating();
  const upgrade = debt.nextUpgrade();
  const debtRp = debt.debtRp(now);
  const limitRp = debt.limitRp(now);
  const years = debt.debtYears(now);
  const balance = debt.balanceRp(now);
  const blocked = debt.borrowingBlocked(now);

  return (
    <div className="panel-typography borrowing">
      <h2>🏦 Borrowing</h2>
      <p className="measures-intro">
        Investments — grid, district heating, chargers, solar on public buildings — may be paid with borrowed money; they don't count as running
        spending. Subsidies, campaigns and interest do, and should be covered by income. Too much debt and the canton steps in.
      </p>

      <div className="borrow-summary">
        <div>
          <span className="borrow-label">Market rate</span>
          <span className="borrow-value">{pct(market)}</span>
          <span className="borrow-note">a year ago {pct(yearAgo)}</span>
        </div>
        <div>
          <span className="borrow-label">Credit rating</span>
          <span className="borrow-value">{rating.label}</span>
          <span className="borrow-note">
            +{pct(rating.spreadPct)} on the market
            {upgrade && ` · ${upgrade.label} from ${monthYear(upgrade.atMs)} if debt stays this low`}
          </span>
        </div>
        <div>
          <span className="borrow-label">Debt</span>
          <span className="borrow-value">{formatCHF(debtRp)}</span>
          <span className="borrow-note">{years.toFixed(1)} years of income</span>
        </div>
      </div>
      <div className="borrow-gauge" title={`The canton's limit: debt worth ${DEBT_LIMIT_YEARS} years of income (${formatCHF(limitRp)})`}>
        <div style={{ width: `${Math.min(100, (debtRp / Math.max(1, limitRp)) * 100)}%`, background: years >= DEBT_LIMIT_YEARS ? "var(--bad)" : years >= 3 ? "#e0a030" : "var(--ink-3)" }} />
      </div>
      <div className="borrow-note" style={{ marginBottom: 8 }}>
        Limit {formatCHF(limitRp)} ({DEBT_LIMIT_YEARS} years of income: {formatCHF(debt.incomeRp(now))} a year).
        {balance !== null && balance < 0 ? ` The balance is ${formatCHF(balance)}: the overdraft costs ${pct(debt.overdraftRatePct(now))} a year.` : ""}
      </div>
      {debt.isSupervised() && (
        <p className="dh-warning">
          Under cantonal supervision: no new borrowing, spending measures or orders until debt falls below {formatCHF(limitRp * 0.8)}.
        </p>
      )}

      <BankLoan now={now} blocked={blocked} />
      <GreenBond now={now} />
      <FederalLoan now={now} />

      <h3 className="borrow-section">What the department owes</h3>
      <LoanList now={now} />
    </div>
  );
}

function AmountSlider({ value, max, onChange }: { value: number; max: number; onChange: (v: number) => void }) {
  const steps = Math.max(1, Math.floor(max / STEP_RP));
  return (
    <div className="borrow-amount">
      <input type="range" min={1} max={steps} step={1} value={Math.min(steps, Math.max(1, Math.round(value / STEP_RP)))} onChange={(e) => onChange(Number(e.target.value) * STEP_RP)} />
      <span>{formatCHF(Math.min(value, steps * STEP_RP))}</span>
    </div>
  );
}

function BankLoan({ now, blocked }: { now: number; blocked: string | null }) {
  const [amount, setAmount] = useState(2_000_000 * 100);
  const [term, setTerm] = useState(10);
  const headroom = debt.headroomRp(now);
  const max = Math.min(headroom, 50_000_000 * 100);
  const principal = Math.min(amount, Math.floor(max / STEP_RP) * STEP_RP);
  const rate = debt.bankRatePct(term, now);
  const payment = debt.monthlyPaymentRp({ kind: "bank", principalRp: principal, ratePct: rate, termYears: term });
  return (
    <div className="borrow-card">
      <div className="borrow-card-head">
        <strong>Bank loan</strong>
        <span className="borrow-note">repaid in equal monthly instalments; the rate is fixed for its life</span>
      </div>
      {blocked ? (
        <p className="borrow-note">{blocked}</p>
      ) : (
        <>
          <AmountSlider value={amount} max={max} onChange={setAmount} />
          <div className="borrow-terms">
            {BANK_LOAN_TERMS_YEARS.map((t) => (
              <button key={t} className={t === term ? "active" : ""} onClick={() => setTerm(t)}>
                {t} years · {pct(debt.bankRatePct(t, now))}
              </button>
            ))}
          </div>
          <div className="borrow-note">
            {formatCHF(payment)} a month for {term} years — {formatCHF(payment * term * 12 - principal)} in interest.
          </div>
          <button className="measure-enact" disabled={principal <= 0} onClick={() => debt.takeBankLoan(principal, term, simClock.getSimTimeMs())}>
            Borrow {formatCHF(principal)}
          </button>
        </>
      )}
    </div>
  );
}

function GreenBond({ now }: { now: number }) {
  const offer = debt.greenBondOffer(now);
  const [amount, setAmount] = useState(3_000_000 * 100);
  const max = Math.max(STEP_RP, Math.ceil((offer.maxRp * 1.5) / STEP_RP) * STEP_RP);
  const requested = Math.min(amount, max);
  const raised = Math.min(requested, offer.maxRp);
  return (
    <div className="borrow-card">
      <div className="borrow-card-head">
        <strong>Green bond for residents</strong>
        <span className="borrow-note">
          {GREEN_BOND_TERM_YEARS} years, interest yearly, repaid at the end; residents accept a little less than the market for a local green cause
        </span>
      </div>
      {offer.blocked ? (
        <p className="borrow-note">{offer.blocked}</p>
      ) : (
        <>
          <AmountSlider value={amount} max={max} onChange={setAmount} />
          <div className="borrow-note">
            At {pct(offer.ratePct)}. Residents are expected to subscribe about {formatCHF(offer.maxRp)} — the more content the climate-minded, the more{offer.heldRp > 0 ? `, and less while they still hold ${formatCHF(offer.heldRp)} of earlier green bonds` : ""}.
            {requested > offer.maxRp ? ` Offering more than that raises only what they subscribe (${formatCHF(raised)}).` : ""} The subscription runs{" "}
            {GREEN_BOND_SUBSCRIPTION_MONTHS} months. The money is earmarked: as much has to go into green investment within {GREEN_BOND_EARMARK_MONTHS / 12} years,
            or it will be called greenwashing.
          </div>
          <button className="measure-enact" onClick={() => debt.issueGreenBond(requested, simClock.getSimTimeMs())}>
            Offer {formatCHF(requested)} to residents
          </button>
        </>
      )}
    </div>
  );
}

function FederalLoan({ now }: { now: number }) {
  const offer = debt.federalOffer(now);
  const [amount, setAmount] = useState(Number.POSITIVE_INFINITY);
  const principal = Math.min(amount, offer.eligibleRp);
  return (
    <div className="borrow-card">
      <div className="borrow-card-head">
        <strong>Federal decarbonisation loan</strong>
        <span className="borrow-note">
          {pct(debt.federalOfferRate())} for {FEDERAL_LOAN_TERM_YEARS} years, against decarbonisation investments already made (up to half of the last twelve
          months'), within a yearly quota; paid out after {FEDERAL_LOAN_PROCESSING_MONTHS} months
        </span>
      </div>
      {offer.blocked ? (
        <p className="borrow-note">{offer.blocked}</p>
      ) : offer.eligibleRp < STEP_RP ? (
        <p className="borrow-note">
          Nothing to draw right now: {formatCHF(offer.investedRp)} invested in the last twelve months{offer.quotaLeftRp <= 0 ? ", and this year's quota is used up" : ""}.
        </p>
      ) : (
        <>
          <AmountSlider value={principal} max={offer.eligibleRp} onChange={setAmount} />
          <div className="borrow-note">
            Up to {formatCHF(offer.eligibleRp)} now ({formatCHF(offer.investedRp)} invested in the last twelve months; {formatCHF(offer.quotaLeftRp)} of this year's quota left).
          </div>
          <button className="measure-enact" onClick={() => debt.drawFederalLoan(Math.floor(principal / STEP_RP) * STEP_RP, simClock.getSimTimeMs())}>
            Apply for {formatCHF(Math.floor(principal / STEP_RP) * STEP_RP)}
          </button>
        </>
      )}
    </div>
  );
}

function LoanList({ now }: { now: number }) {
  const loans = [...debt.getLoans()].sort((a, b) => (a.status === "repaid" ? 1 : 0) - (b.status === "repaid" ? 1 : 0) || b.orderedAtMs - a.orderedAtMs);
  const balance = debt.balanceRp(now);
  if (loans.length === 0) return <p className="borrow-note">Nothing borrowed yet.</p>;
  return (
    <table className="borrow-table">
      <thead>
        <tr>
          <th>Loan</th>
          <th>Owed</th>
          <th>Rate</th>
          <th>Status</th>
          <th />
        </tr>
      </thead>
      <tbody>
        {loans.map((l) => (
          <tr key={l.id} className={l.status === "repaid" ? "repaid" : ""}>
            <td>
              {KIND_LABEL[l.kind]}
              <div className="borrow-note">
                {formatCHF(l.principalRp)}, {monthYear(l.orderedAtMs)}, {l.termYears} years
              </div>
            </td>
            <td>{formatCHF(l.outstandingRp)}</td>
            <td>{pct(l.ratePct)}</td>
            <td>
              {l.status === "pending"
                ? `${l.kind === "greenBond" ? "subscription until" : "paid out"} ${monthYear(l.startMs)}`
                : l.status === "repaid"
                  ? "repaid"
                  : l.kind === "greenBond"
                    ? `matures ${monthYear(l.startMs + l.termYears * 365.25 * 24 * 3600e3)}`
                    : `${formatCHF(debt.monthlyPaymentRp(l))}/month`}
              {l.earmark && (
                <div className="borrow-note">
                  {l.earmark.status === "open"
                    ? `earmark: ${formatCHF(Math.min(l.principalRp, treasury.investedTotal(l.startMs, now + 1)))} of ${formatCHF(l.principalRp)} invested, by ${monthYear(l.earmark.deadlineMs)}`
                    : l.earmark.status === "met"
                      ? "earmark met"
                      : "earmark missed"}
                </div>
              )}
            </td>
            <td>
              {l.status === "active" && l.kind !== "greenBond" && (
                <button
                  className="borrow-repay"
                  disabled={balance === null || balance < l.outstandingRp}
                  title={balance !== null && balance < l.outstandingRp ? "Not enough in the treasury" : "Repay what is left now"}
                  onClick={() => debt.repayEarly(l.id, simClock.getSimTimeMs())}
                >
                  Repay
                </button>
              )}
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}
