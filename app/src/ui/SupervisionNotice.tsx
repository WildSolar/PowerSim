import { useSyncExternalStore } from "react";
import { debt } from "../sim/debt";
import { SPENDING_FROZEN_NOTE } from "../sim/fiscalRules";

/** A banner while the canton has frozen spending (debt.ts). */
export function SupervisionNotice() {
  useSyncExternalStore(
    (l) => debt.subscribe(l),
    () => debt.getVersion(),
  );
  if (!debt.isSupervised()) return null;
  return (
    <p className="dh-warning" style={{ margin: "4px 0 8px" }}>
      {SPENDING_FROZEN_NOTE}
    </p>
  );
}
