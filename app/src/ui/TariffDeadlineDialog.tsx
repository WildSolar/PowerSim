import { useSyncExternalStore } from "react";
import { tariffDeadline } from "../sim/tariffDeadline";
import { householdBillChf } from "../sim/tariffApproval";
import { tariffStore } from "../sim/tariffStore";
import "./tariffDeadline.css";

/** Which year's tariff is overdue, if any (the clock waits at its deadline meanwhile). */
export function useTariffDeadline(): number | null {
  return useSyncExternalStore(
    (l) => tariffDeadline.subscribe(l),
    () => tariffDeadline.get(),
  );
}

/** The deadline has come without next year's tariff: keep this year's prices, or go and set new ones. */
export function TariffDeadlineDialog({ year, onOpenPrices }: { year: number; onOpenPrices: () => void }) {
  const sheet = tariffStore.sheetFor(year);
  const bill = Math.round(householdBillChf(sheet)).toLocaleString("en-GB");
  return (
    <div className="td-layer">
      <div className="td-scrim" />
      <div className="td-dialog" role="alertdialog" aria-labelledby="td-title" aria-describedby="td-text">
        <div className="td-kicker">Deadline today</div>
        <h2 id="td-title">The tariff for {year} is due</h2>
        <p id="td-text">
          The utility has to publish next year’s prices today. You haven’t published a tariff for {year} yet. Keep this year’s prices — a typical household
          goes on paying CHF {bill} a year for its electricity — or set new ones now.
        </p>
        <div className="td-actions">
          <button className="td-primary" onClick={() => tariffDeadline.keepPrices()} autoFocus>
            Keep this year’s prices
          </button>
          <button className="td-secondary" onClick={onOpenPrices}>
            Open Prices
          </button>
        </div>
        <p className="td-note">The game waits here until you decide.</p>
      </div>
    </div>
  );
}
