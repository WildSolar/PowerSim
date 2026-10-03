import { useSyncExternalStore, type ReactNode } from "react";
import type { MunicipalityDataset } from "../data/types";
import { approval } from "../sim/approval";
import { formatDate, toDateMs } from "../sim/calendar";
import { cachedEmissionsForYear } from "../sim/emissions";
import { MEASURE_CATALOG } from "../sim/measureCatalog";
import { measures } from "../sim/measures";
import { studies } from "../sim/studies";
import { treasury } from "../sim/treasury";
import { useReportCardYear, useSimDay } from "../sim/store";
import { formatCHF } from "./format";
import { ExternalOutlook, PublicOpinion, RecentDecisions } from "./MeasuresTab";
import { useLiveTreasury } from "./useLiveTreasury";
import { BASELINE_YEAR, NET_ZERO_TARGET_YEAR } from "./useYearEmissions";
import "./overview.css";

const DAY_MS = 24 * 60 * 60_000;
const YEAR_MS = 365.25 * DAY_MS;

function monthYear(simTimeMs: number): string {
  return formatDate(simTimeMs).replace(/^\w+, \d+ /, "");
}

function Figure({ label, value, children, onClick }: { label: string; value: ReactNode; children?: ReactNode; onClick?: () => void }) {
  return (
    <section className={`ov-figure${onClick ? " clickable" : ""}`} onClick={onClick}>
      <h3>{label}</h3>
      <div className="ov-value">{value}</div>
      {children && <div className="ov-detail">{children}</div>}
    </section>
  );
}

const SECTORS: { key: "electricityKgCO2" | "gasKgCO2" | "oilKgCO2" | "districtHeatingKgCO2" | "mobilityKgCO2"; label: string }[] = [
  { key: "gasKgCO2", label: "Gas heating" },
  { key: "oilKgCO2", label: "Oil heating" },
  { key: "mobilityKgCO2", label: "Petrol and diesel cars" },
  { key: "electricityKgCO2", label: "Electricity" },
  { key: "districtHeatingKgCO2", label: "District heat" },
];

/** The town hall's first page: where the town stands, what is coming, and what was decided lately. */
export function OverviewTab({ dataset, onOpen }: { dataset: MunicipalityDataset; onOpen: (section: "measures" | "treasury") => void }) {
  useSyncExternalStore(
    (l) => measures.subscribe(l),
    () => measures.getVersion(),
  );
  useSyncExternalStore(
    (l) => approval.subscribe(l),
    () => approval.getVersion(),
  );
  useSyncExternalStore(
    (l) => studies.subscribe(l),
    () => studies.getVersion(),
  );
  useReportCardYear();
  const nowMs = useSimDay();
  const { balanceRp, budgetRp } = useLiveTreasury(dataset);
  const spentRp = treasury.operatingPaidOutTotal(nowMs - YEAR_MS, nowMs + DAY_MS);

  const year = new Date(toDateMs(nowMs)).getUTCFullYear();
  const last = year - 1 >= BASELINE_YEAR ? cachedEmissionsForYear(year - 1) : null;
  const baseline = cachedEmissionsForYear(BASELINE_YEAR);
  const change = last && baseline && last.year > BASELINE_YEAR ? (last.totalKgCO2 / baseline.totalKgCO2 - 1) * 100 : null;

  const inEffect = MEASURE_CATALOG.filter((d) => measures.getState(d.id)?.active);
  const onTheWay = MEASURE_CATALOG.filter((d) => measures.getState(d.id)?.pending);
  const votes = MEASURE_CATALOG.flatMap((d) => {
    const v = approval.getVoteInfo(d.id, d, nowMs);
    return v ? [{ def: d, ...v }] : [];
  }).sort((a, b) => a.atMs - b.atMs);
  const election = approval.nextElectionMs();

  return (
    <div className="overview">
      <div className="ov-figures">
        <Figure label="Treasury" value={balanceRp === null ? "…" : formatCHF(balanceRp)} onClick={() => onOpen("treasury")}>
          Running spending in the last 12 months <strong className={spentRp > budgetRp ? "bad" : undefined}>{formatCHF(spentRp)}</strong> against an
          allocation of {formatCHF(budgetRp)} a year.
        </Figure>
        <Figure label="Approval" value={`${Math.round(approval.getApproval())}%`}>
          {election !== null ? `Next election ${monthYear(election)}.` : "No election scheduled."} Very low approval ends the game.
        </Figure>
        <Figure label={last ? `CO₂ in ${last.year}` : "CO₂"} value={last ? `${(last.totalKgCO2 / 1_000_000).toLocaleString("de-CH", { minimumFractionDigits: 1, maximumFractionDigits: 1 })} kt` : "—"}>
          {last
            ? `${change === null ? "The baseline year." : `${change > 0 ? "+" : "−"}${Math.abs(Math.round(change))}% against ${BASELINE_YEAR}.`} The goal: net zero by ${NET_ZERO_TARGET_YEAR}.`
            : `Counted at the end of each year — the first count comes in January ${BASELINE_YEAR + 1}.`}
        </Figure>
        <Figure label="Measures" value={`${inEffect.length} in effect`} onClick={() => onOpen("measures")}>
          {onTheWay.length > 0 ? `${onTheWay.length} on the way. ` : ""}
          {votes.length > 0 ? `${votes.length} public vote${votes.length === 1 ? "" : "s"} ahead.` : "No votes ahead."}
        </Figure>
      </div>

      <div className="ov-columns">
        <div className="ov-column">
          {last && (
            <section className="ov-card">
              <h3>Where the emissions come from, {last.year}</h3>
              <div className="ov-sectors">
                {SECTORS.map((s) => {
                  const share = last.totalKgCO2 > 0 ? last[s.key] / last.totalKgCO2 : 0;
                  return (
                    <div className="ov-sector" key={s.key}>
                      <span>{s.label}</span>
                      <span className="ov-sector-bar">
                        <span style={{ width: `${Math.max(0, share) * 100}%` }} />
                      </span>
                      <span className="ov-sector-value">{(last[s.key] / 1_000_000).toLocaleString("de-CH", { minimumFractionDigits: 1, maximumFractionDigits: 1 })} kt</span>
                    </div>
                  );
                })}
              </div>
            </section>
          )}
          {votes.length > 0 && (
            <section className="ov-card">
              <h3>Votes ahead</h3>
              <ul className="ov-votes">
                {votes.map((v) => (
                  <li key={v.def.id}>
                    <span className="ov-vote-date">{monthYear(v.atMs)}</span>
                    <span>{v.def.title}</span>
                    <span className={`ov-vote-poll ${v.pollYes >= 50 ? "good" : "bad"}`}>{Math.round(v.pollYes)}% yes</span>
                  </li>
                ))}
              </ul>
            </section>
          )}
          <section className="ov-card">
            <PublicOpinion nowMs={nowMs} />
          </section>
        </div>
        <div className="ov-column">
          <section className="ov-card">
            <h3>Canton and federal government</h3>
            <ExternalOutlook nowMs={nowMs} />
          </section>
          <section className="ov-card">
            <h3>Recent decisions</h3>
            <RecentDecisions limit={10} />
          </section>
        </div>
      </div>
    </div>
  );
}
