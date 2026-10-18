import { useMemo, useState, useSyncExternalStore } from "react";
import type { Building, MunicipalityDataset } from "../data/types";
import { agriPv } from "../sim/agriPv";
import { allocationApprovalFactor, approval } from "../sim/approval";
import { BASELINE_YEAR, formatDate, toDateMs, toSimTimeMs } from "../sim/calendar";
import { debt, type LoanKind } from "../sim/debt";
import { districtHeat } from "../sim/districtHeat";
import { bookedFinances, departmentUtilityRp, departmentUtilityShareRp, utilityProfitRp } from "../sim/finances";
import { grid } from "../sim/grid";
import { existsAt } from "../sim/lifetime";
import { MEASURE_BY_ID } from "../sim/measureCatalog";
import { monthRecords } from "../sim/monthRecords";
import { publicCharging } from "../sim/publicCharging";
import { stock } from "../sim/stock";
import { useSimDay } from "../sim/store";
import { PAYOUT_CATEGORIES, PAYOUT_LABEL, treasury, type PayoutCategory } from "../sim/treasury";
import { wind } from "../sim/wind";
import { zoning } from "../sim/zoning";
import { formatCHF } from "./format";
import { useStockBuildings } from "./useStock";

type IncomeKind = "allocation" | "utility" | "levy" | "borrowing";
type EntryKind = IncomeKind | PayoutCategory;

interface Entry {
  atMs: number;
  kind: EntryKind;
  detail: string;
  /** In (positive) or out (negative), Rp. */
  amountRp: number;
}

const INCOME_LABEL: Record<IncomeKind, string> = {
  allocation: "Government allocation",
  utility: "Municipal utility (your share)",
  levy: "Value-capture levy (zoning)",
  borrowing: "Borrowed",
};

const LOAN_LABEL: Record<LoanKind, string> = { bank: "Bank loan", greenBond: "Green bond", federal: "Federal decarbonisation loan" };

function kindLabel(kind: EntryKind): string {
  return kind in INCOME_LABEL ? INCOME_LABEL[kind as IncomeKind] : PAYOUT_LABEL[kind as PayoutCategory];
}

function addressOf(egid: string): string {
  return stock.lookup(egid)?.address ?? `building ${egid}`;
}

function loanLabel(id: string): string {
  const loan = debt.getLoans().find((l) => l.id === id);
  return loan ? LOAN_LABEL[loan.kind] : id;
}

/** What a payout was for, from what it was booked against. */
function describePayout(category: PayoutCategory, ref: string): string {
  const after = (prefix: string) => ref.slice(prefix.length);
  if (ref === "overdraft") return "Overdraft";
  if (ref.startsWith("roof-contract:")) return `The utility's array on ${addressOf(after("roof-contract:"))}`;
  if (ref.startsWith("district-heat-source:")) {
    const s = districtHeat.getSources().find((x) => x.id === after("district-heat-source:"));
    return s ? `${s.label} · ${s.name}` : "A heat plant";
  }
  if (ref === "district-heat-line") return "A direct district heating line";
  if (ref === "district-heat-network") return "Pipes for a district heating extension";
  if (ref.startsWith("grid-battery-")) return `Neighbourhood battery · area ${grid.getArea(Number(after("grid-battery-")))?.name ?? ""}`;
  if (ref.startsWith("grid-")) return `Reinforcing the station · area ${grid.getArea(Number(after("grid-")))?.name ?? ""}`;
  if (ref.startsWith("zoning-")) return zoning.getChanges().find((c) => String(c.id) === after("zoning-"))?.title ?? "A zoning change";
  if (ref.startsWith("agri-pv-")) return agriPv.getDesignations().find((d) => String(d.id) === after("agri-pv-"))?.title ?? "An Agri-PV zone";
  if (ref === "wind-study") return "The wind study";
  if (ref.startsWith("wind-zoning:")) return `Zoning plan · wind site ${wind.getSite(after("wind-zoning:"))?.name ?? ""}`;
  if (ref.startsWith("wind-permit:")) return `Permit and impact assessment · wind site ${wind.getSite(after("wind-permit:"))?.name ?? ""}`;
  if (ref.startsWith("wind-build:")) return `Turbines · wind site ${wind.getSite(after("wind-build:"))?.name ?? ""}`;
  if (ref.startsWith("evaluation-")) return "An evaluation study";
  if (ref.startsWith("survey-")) return "An opinion survey";
  if (ref.startsWith("removals-")) return `Carbon removal for ${after("removals-")}`;
  if (category === "interest" || category === "debtRepayment") return loanLabel(ref);
  const site = publicCharging.getSite(ref);
  if (site) return site.name;
  const measure = MEASURE_BY_ID.get(ref);
  if (measure) return measure.title;
  if (stock.lookup(ref)) return addressOf(ref);
  return ref;
}

/** Every movement of money: the treasury's own records (payouts, levies, loans), the government's
 * allocation month by month, and the utility's months (the department's share of each). */
function ledger(buildings: Building[], nowMs: number): Entry[] {
  const entries: Entry[] = [];
  for (const p of treasury.getPayouts()) {
    if (p.atMs > nowMs) continue;
    entries.push({ atMs: p.atMs, kind: p.category, detail: describePayout(p.category, p.egid), amountRp: -p.amountRp });
  }
  for (const r of treasury.getReceipts()) {
    if (r.atMs > nowMs) continue;
    entries.push(
      r.kind === "borrowing"
        ? { atMs: r.atMs, kind: "borrowing", detail: loanLabel(r.ref), amountRp: r.amountRp }
        : { atMs: r.atMs, kind: "levy", detail: addressOf(r.ref), amountRp: r.amountRp },
    );
  }

  // The allocation: a twelfth at the start of each month.
  const booked = new Map(bookedFinances().map((f) => [f.year, f]));
  const nowYear = new Date(toDateMs(nowMs)).getUTCFullYear();
  for (let year = BASELINE_YEAR; year <= nowYear; year++) {
    let yearly = booked.get(year)?.governmentAllocationRp;
    if (yearly === undefined) {
      const yearStartMs = toSimTimeMs(Date.UTC(year, 0, 1));
      const dwellings = buildings.reduce((sum, b) => sum + (existsAt(b, yearStartMs) ? b.dwellings.length : 0), 0);
      yearly = treasury.allocationRp(dwellings, allocationApprovalFactor(approval.atYearStart(year)));
    }
    for (let m = 0; m < 12; m++) {
      const atMs = toSimTimeMs(Date.UTC(year, m, 1));
      if (atMs > nowMs) break;
      entries.push({ atMs, kind: "allocation", detail: `${formatDate(atMs).replace(/^\d+ /, "")}: a twelfth of ${formatCHF(yearly)}`, amountRp: yearly / 12 });
    }
  }

  // The utility: each settled month's share (the share of the year so far, less the months before —
  // as the treasury counts it), or a booked year in one go where its months weren't kept.
  const byYear = new Map<number, { month: number; profitRp: number; networkKWh: number; publicSolarSavingsRp: number }[]>();
  for (const r of monthRecords.all()) {
    if (!r.utility) continue;
    const year = Math.floor(r.month / 12);
    const list = byYear.get(year) ?? [];
    list.push({ month: r.month % 12, profitRp: utilityProfitRp(r.utility), networkKWh: r.utility.networkKWh, publicSolarSavingsRp: r.utility.publicSolarSavingsRp });
    byYear.set(year, list);
  }
  for (let year = BASELINE_YEAR; year <= nowYear; year++) {
    const months = (byYear.get(year) ?? []).sort((a, b) => a.month - b.month);
    const f = booked.get(year);
    if (f && months.length < 12) {
      entries.push({ atMs: toSimTimeMs(Date.UTC(year + 1, 0, 1)) - 1, kind: "utility", detail: `The year ${year}`, amountRp: departmentUtilityShareRp(f) + f.publicSolarSavingsRp });
      continue;
    }
    const sum = { profitRp: 0, networkKWh: 0, publicSolarSavingsRp: 0 };
    let before = 0;
    for (const m of months) {
      const atMs = toSimTimeMs(Date.UTC(year, m.month + 1, 1));
      if (atMs > nowMs) break;
      sum.profitRp += m.profitRp;
      sum.networkKWh += m.networkKWh;
      sum.publicSolarSavingsRp += m.publicSolarSavingsRp;
      const share = departmentUtilityRp(year, sum);
      entries.push({ atMs, kind: "utility", detail: `${formatDate(toSimTimeMs(Date.UTC(year, m.month, 15))).replace(/^\d+ /, "")} settled`, amountRp: share - before });
      before = share;
    }
  }
  return entries.sort((a, b) => b.atMs - a.atMs);
}

const PAGE = 200;

/** The Treasury's ledger: every franc in and out, newest first, by kind and year. */
export function TreasuryLedger({ dataset }: { dataset: MunicipalityDataset }) {
  useSyncExternalStore(
    (l) => treasury.subscribe(l),
    () => treasury.getVersion(),
  );
  const now = useSimDay();
  const buildings = useStockBuildings();
  void dataset;
  const [kind, setKind] = useState<"all" | "in" | "out" | EntryKind>("all");
  const [year, setYear] = useState<"all" | number>("all");
  const [shown, setShown] = useState(PAGE);
  const all = useMemo(() => ledger(buildings, now), [buildings, now]); // eslint-disable-line react-hooks/exhaustive-deps
  const years = [...new Set(all.map((e) => new Date(toDateMs(e.atMs)).getUTCFullYear()))].sort((a, b) => b - a);
  const rows = all.filter(
    (e) =>
      (kind === "all" || (kind === "in" ? e.amountRp > 0 : kind === "out" ? e.amountRp < 0 : e.kind === kind)) &&
      (year === "all" || new Date(toDateMs(e.atMs)).getUTCFullYear() === year),
  );
  const total = rows.reduce((s, e) => s + e.amountRp, 0);

  return (
    <div className="treasury-ledger">
      <div className="ledger-filters">
        <label>
          <span>Show</span>
          <select
            value={kind}
            onChange={(e) => {
              setKind(e.target.value as typeof kind);
              setShown(PAGE);
            }}
          >
            <option value="all">Everything</option>
            <option value="in">Money in</option>
            <option value="out">Money out</option>
            <optgroup label="In">
              {(Object.keys(INCOME_LABEL) as IncomeKind[]).map((k) => (
                <option key={k} value={k}>
                  {INCOME_LABEL[k]}
                </option>
              ))}
            </optgroup>
            <optgroup label="Out">
              {PAYOUT_CATEGORIES.map((c) => (
                <option key={c} value={c}>
                  {PAYOUT_LABEL[c]}
                </option>
              ))}
            </optgroup>
          </select>
        </label>
        <label>
          <span>Year</span>
          <select
            value={String(year)}
            onChange={(e) => {
              setYear(e.target.value === "all" ? "all" : Number(e.target.value));
              setShown(PAGE);
            }}
          >
            <option value="all">All years</option>
            {years.map((y) => (
              <option key={y} value={y}>
                {y}
              </option>
            ))}
          </select>
        </label>
        <span className="ledger-total">
          {rows.length} entr{rows.length === 1 ? "y" : "ies"} · {total >= 0 ? "+" : "−"}
          {formatCHF(Math.abs(total))}
        </span>
      </div>
      <table className="borrow-table treasury-table ledger-table">
        <tbody>
          {rows.slice(0, shown).map((e, i) => (
            <tr key={i}>
              <td className="ledger-date">{formatDate(e.atMs)}</td>
              <td>
                {kindLabel(e.kind)}
                <span className="borrow-note"> · {e.detail}</span>
              </td>
              <td className={e.amountRp >= 0 ? "pos" : "neg"}>
                {e.amountRp >= 0 ? "+" : "−"}
                {formatCHF(Math.abs(e.amountRp))}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      {rows.length > shown && (
        <button className="ledger-more" onClick={() => setShown((n) => n + PAGE)}>
          Show {Math.min(PAGE, rows.length - shown)} more
        </button>
      )}
      {rows.length === 0 && <p className="borrow-note">Nothing here yet.</p>}
    </div>
  );
}
