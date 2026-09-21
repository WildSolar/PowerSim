import { useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import type { MunicipalityDataset } from "../data/types";
import { toDateMs, toSimTimeMs } from "../sim/calendar";
import { cachedCumulativeBalanceRp, computeCumulativeBalanceRp } from "../sim/finances";
import { existsAt } from "../sim/lifetime";
import { useSimDay } from "../sim/store";
import { allocationApprovalFactor, approval } from "../sim/approval";
import { treasury } from "../sim/treasury";
import { BASELINE_YEAR } from "./useYearEmissions";

const DAY_MS = 24 * 60 * 60_000;
const SETTLE_DELAY_MS = 3000; // give the Year in Review first go at computing the year just ended

export interface LiveTreasury {
  /** Where the treasury stands right now, or null while last year's accounts are still being settled. */
  balanceRp: number | null;
  /** The overall government's allocation for this year (credited on 1 January). */
  budgetRp: number;
  /** Subsidies paid out so far this year, as decisions happened. */
  paidOutRp: number;
}

/** The treasury as of right now: last year's closing balance, plus this year's government
 * allocation, less the subsidies paid out so far. Electricity operations settle once a year
 * (see finances.ts), so they only show up in the balance from the next year on. */
export function useLiveTreasury(dataset: MunicipalityDataset): LiveTreasury {
  const simDay = useSimDay();
  useSyncExternalStore(
    (listener) => treasury.subscribe(listener),
    () => treasury.getVersion(),
  );
  const bookedVersion = treasury.getBookedVersion();
  const year = new Date(toDateMs(simDay)).getUTCFullYear();
  const yearStartMs = toSimTimeMs(Date.UTC(year, 0, 1));

  const datasetRef = useRef(dataset);
  datasetRef.current = dataset;

  const [openingRp, setOpeningRp] = useState<number | null>(null);
  useEffect(() => {
    if (year <= BASELINE_YEAR) {
      setOpeningRp(treasury.openingBalanceRp());
      return;
    }
    const cached = cachedCumulativeBalanceRp(year - 1, BASELINE_YEAR);
    if (cached !== null) {
      setOpeningRp(cached);
      return;
    }
    setOpeningRp(null);
    let cancelled = false;
    const timer = setTimeout(async () => {
      const { buildings, powerPlants } = datasetRef.current;
      const balance = await computeCumulativeBalanceRp(buildings, powerPlants, year - 1, BASELINE_YEAR, () => cancelled);
      if (!cancelled) setOpeningRp(balance);
    }, SETTLE_DELAY_MS);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [year, bookedVersion]);

  const budgetRp = useMemo(() => {
    const dwellings = dataset.buildings.reduce((sum, b) => sum + (existsAt(b, yearStartMs) ? b.dwellings.length : 0), 0);
    return treasury.allocationRp(dwellings, allocationApprovalFactor(approval.atYearStart(year)));
  }, [dataset.buildings, yearStartMs, year]);

  const paidOutRp = treasury.paidOutTotal(yearStartMs, simDay + DAY_MS);
  return { balanceRp: openingRp === null ? null : openingRp + budgetRp - paidOutRp, budgetRp, paidOutRp };
}
