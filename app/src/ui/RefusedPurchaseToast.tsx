import { useEffect, useState } from "react";
import { onPurchaseRefused, type RefusedPurchase } from "../sim/fiscalRules";
import { formatCHF } from "./format";
import "./inbox.css";

/** Says why an order didn't go through: the treasury hasn't the money. Click it for the Treasury,
 * where borrowing is. */
export function RefusedPurchaseToast({ onOpenTreasury }: { onOpenTreasury: () => void }) {
  const [refused, setRefused] = useState<RefusedPurchase | null>(null);
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | null = null;
    const unsubscribe = onPurchaseRefused((r) => {
      setRefused(r);
      if (timer) clearTimeout(timer);
      timer = setTimeout(() => setRefused(null), 9000);
    });
    return () => {
      unsubscribe();
      if (timer) clearTimeout(timer);
    };
  }, []);
  if (!refused) return null;
  return (
    <button
      className="inbox-toast important refused-toast"
      onClick={() => {
        onOpenTreasury();
        setRefused(null);
      }}
      title="Open the Treasury"
    >
      <span>
        Not enough money: this costs {formatCHF(refused.costRp)}, the treasury has {formatCHF(Math.max(0, refused.balanceRp))}. Borrow first — Town hall → Treasury →
        Borrowing.
      </span>
    </button>
  );
}
