import { useSyncExternalStore, type ReactNode } from "react";
import {
  BookOpen,
  MessageSquare,
  Cloud,
  CloudMoon,
  CloudRain,
  CloudSnow,
  CloudSun,
  Landmark,
  Menu,
  Moon,
  Sun,
} from "lucide-react";
import type { MunicipalityDataset } from "../data/types";
import { PAUSE_LABEL, PAUSE_SPEED, RUNNING_SPEEDS, setSpeed } from "../sim/timeControls";
import { ghiWm2 } from "../sim/pv";
import { useReportCardYear, useSimDay, useSimSpeed, useSimTime } from "../sim/store";
import { formatDate, formatTime, formatWeekday, toDateMs } from "../sim/calendar";
import { weatherAt, type WeatherCondition } from "../sim/weather";
import { approval } from "../sim/approval";
import { simClock } from "../sim/engine";
import { debt } from "../sim/debt";
import { cachedEmissionsForYear } from "../sim/emissions";
import { scoreSoFar, yearPoints } from "../sim/score";
import { parThrough } from "../sim/par";
import { dayNightStatus } from "./dayNightDisplay";
import { CONDITION_LABEL } from "./weatherDisplay";
import { formatCHF } from "./format";
import { useLiveTreasury } from "./useLiveTreasury";
import { BASELINE_YEAR } from "./useYearEmissions";
import { InboxButton } from "./InboxPanel";
import "./topBar.css";

const SPEEDS = [{ label: PAUSE_LABEL, name: "Pause", hint: "Space pauses and resumes", value: PAUSE_SPEED }, ...RUNNING_SPEEDS];
const MONTH_MS = (365.25 * 24 * 60 * 60_000) / 12;
const TREND_MONTHS = 6;

function WeatherIcon({ condition, night }: { condition: WeatherCondition; night: boolean }) {
  const props = { size: 16, strokeWidth: 1.75, "aria-hidden": true } as const;
  switch (condition) {
    case "clear":
      return night ? <Moon {...props} /> : <Sun {...props} />;
    case "partly-cloudy":
      return night ? <CloudMoon {...props} /> : <CloudSun {...props} />;
    case "rain":
      return <CloudRain {...props} />;
    case "snow":
      return <CloudSnow {...props} />;
    default:
      return <Cloud {...props} />;
  }
}

/** CHF in millions once it gets large, so the headline number stays short. */
function compactChf(rp: number): string {
  const chf = rp / 100;
  if (Math.abs(chf) >= 1_000_000) return `CHF ${(chf / 1_000_000).toLocaleString("de-CH", { minimumFractionDigits: 2, maximumFractionDigits: 2 })} M`;
  return formatCHF(rp);
}

function Kpi({ label, value, sub, tone, title, onClick, tour }: { label: string; value: ReactNode; sub?: ReactNode; tone?: "good" | "bad"; title?: string; onClick?: () => void; tour?: string }) {
  const body = (
    <>
      <span className="kpi-label">{label}</span>
      <span className={`kpi-value${tone ? ` ${tone}` : ""}`}>{value}</span>
      {sub !== undefined && <span className="kpi-sub">{sub}</span>}
    </>
  );
  return onClick ? (
    <button className="kpi kpi-button" title={title} onClick={onClick} data-tour={tour}>
      {body}
    </button>
  ) : (
    <div className="kpi" title={title} data-tour={tour}>
      {body}
    </div>
  );
}

function Clock() {
  const simTimeMs = useSimTime();
  const speed = useSimSpeed();
  const weather = weatherAt(simTimeMs);
  const dayNight = dayNightStatus(simTimeMs);
  const insolation = Math.round(ghiWm2(simTimeMs));
  return (
    <div className="tb-clock" data-tour="clock">
      <div className="tb-date">
        <span className="tb-day">
          {formatWeekday(simTimeMs)}, {formatDate(simTimeMs)}
        </span>
        <span className="tb-time">{formatTime(simTimeMs)}</span>
      </div>
      <div className="tb-weather" title={`${dayNight.label} · ${CONDITION_LABEL[weather.condition]} · insolation ${insolation} W/m²`}>
        <WeatherIcon condition={weather.condition} night={dayNight.dayFraction < 0.5} />
        <span className="tb-temp">{Math.round(weather.tempC)}°C</span>
      </div>
      <div className="tb-speed" role="group" aria-label="Speed" data-tour="speed">
        {SPEEDS.map((s) => (
          <button
            key={s.value}
            title={s.value === PAUSE_SPEED ? `${s.name} (${s.hint})` : `${s.name}: ${s.hint} (key ${RUNNING_SPEEDS.indexOf(s as (typeof RUNNING_SPEEDS)[number]) + 1}; Tab cycles the speeds)`}
            aria-label={s.name}
            aria-pressed={s.value === speed}
            className={s.value === speed ? "active" : ""}
            onClick={() => setSpeed(s.value)}
          >
            {s.label}
          </button>
        ))}
      </div>
    </div>
  );
}

function TreasuryKpi({ dataset, onOpen }: { dataset: MunicipalityDataset; onOpen: () => void }) {
  const { balanceRp, budgetRp, allocationSoFarRp, utilityRp, utilityMonths, paidOutRp, receivedRp, borrowedRp } = useLiveTreasury(dataset);
  useSyncExternalStore(
    (l) => debt.subscribe(l),
    () => debt.getVersion(),
  );
  const owedRp = debt.getLoans().reduce((sum, l) => sum + (l.status === "active" ? l.outstandingRp : 0), 0);
  const supervised = debt.isSupervised();
  const lines = [
    `Allocation so far: +${formatCHF(allocationSoFarRp)} of ${formatCHF(budgetRp)}`,
    ...(utilityMonths > 0 ? [`Utility, ${utilityMonths} month${utilityMonths === 1 ? "" : "s"} settled: ${utilityRp >= 0 ? "+" : "−"}${formatCHF(Math.abs(utilityRp))}`] : []),
    `Paid out so far: −${formatCHF(paidOutRp)}`,
    ...(borrowedRp > 0 ? [`Borrowed this year: +${formatCHF(borrowedRp)}`] : []),
    ...(receivedRp > 0 ? [`Zoning levy so far: +${formatCHF(receivedRp)}`] : []),
    ...(owedRp > 0 ? [`Debt (${debt.rating().label}): ${formatCHF(owedRp)}`] : []),
    "Click for the accounts and borrowing",
  ];
  return (
    <Kpi
      tour="treasury"
      label="Treasury"
      value={balanceRp === null ? "…" : compactChf(balanceRp)}
      tone={balanceRp !== null && balanceRp < 0 ? "bad" : undefined}
      sub={supervised ? <span className="kpi-flag bad">canton supervises</span> : owedRp > 0 ? `debt ${compactChf(owedRp)}` : `−${compactChf(paidOutRp)} paid out`}
      title={lines.join("\n")}
      onClick={onOpen}
    />
  );
}

/** "in 16 months", "next month", "this month". */
function electionIn(months: number): string {
  if (months <= 0) return "this month";
  if (months === 1) return "next month";
  return `in ${months} mo`;
}

function ApprovalKpi() {
  useSyncExternalStore(
    (listener) => approval.subscribe(listener),
    () => approval.getVersion(),
  );
  const current = approval.getApproval();
  const history = approval.getHistory();
  const latest = history[history.length - 1];
  const past = latest ? ([...history].reverse().find((p) => p.atMs <= latest.atMs - TREND_MONTHS * MONTH_MS) ?? history[0]) : undefined;
  const delta = past ? current - past.approval : 0;
  const election = approval.nextElectionMs();
  const monthsToElection = election !== null ? Math.max(0, Math.ceil((election - simClock.getSimTimeMs()) / MONTH_MS)) : Infinity;
  useSimDay(); // the countdown moves on
  const trend = Math.abs(delta) < 1 ? "steady" : `${delta > 0 ? "▲" : "▼"} ${Math.abs(Math.round(delta))} pts`;
  return (
    <Kpi
      tour="approval"
      label="Approval"
      value={`${Math.round(current)}%`}
      tone={current >= 60 ? "good" : current < 40 ? "bad" : undefined}
      sub={
        <>
          {/* Steady goes without saying when there's an election to count down to. */}
          {(trend !== "steady" || election === null) && <span className={delta < -1 ? "bad" : delta > 1 ? "good" : undefined}>{trend}</span>}
          {trend !== "steady" && election !== null && " · "}
          {election !== null && <span className={monthsToElection <= 6 ? "warn" : undefined}>election {electionIn(monthsToElection)}</span>}
        </>
      }
      title={`Public approval of the municipality's energy policy; below 50% on election day, or below 25% for six months, ends the game.${election !== null ? `\nNext election: ${formatDate(election).replace(/^\d+ /, "")}` : ""}`}
    />
  );
}

/** Last full year's emissions against the first year's — read from the Year in Review's
 * results, so it shows once a year has been counted. */
function EmissionsKpi() {
  const simTimeMs = useSimTime();
  useReportCardYear(); // re-read once the Year in Review has counted the year
  const lastYear = new Date(toDateMs(simTimeMs)).getUTCFullYear() - 1;
  const current = lastYear >= BASELINE_YEAR ? cachedEmissionsForYear(lastYear) : null;
  const baseline = cachedEmissionsForYear(BASELINE_YEAR);
  if (!current) {
    return <Kpi tour="co2" label="CO₂" value="—" sub={`first count Jan ${BASELINE_YEAR + 1}`} title="The town's emissions are counted at the end of each year, in the Year in Review." />;
  }
  const kt = current.netKgCO2 / 1_000_000;
  // The year's cut per resident against the start — the points it scored.
  const cut = baseline && lastYear > BASELINE_YEAR ? yearPoints(current, baseline) : null;
  return (
    <Kpi
      tour="co2"
      label={`CO₂ ${lastYear}`}
      value={`${kt.toLocaleString("de-CH", { maximumFractionDigits: 1, minimumFractionDigits: 1 })} kt`}
      sub={cut === null ? "the baseline" : <span className={cut > 0 ? "good" : "bad"}>{`${cut > 0 ? "−" : "+"}${Math.abs(Math.round(cut))}% per resident`}</span>}
      title={`Net emissions in ${lastYear}${current.removalsKgCO2 > 0 ? ` (after ${(current.removalsKgCO2 / 1_000_000).toLocaleString("de-CH", { maximumFractionDigits: 1 })} kt removed)` : ""}; per resident against ${BASELINE_YEAR}. The goal: net zero by 2050.`}
    />
  );
}

/** The score so far, against par (what doing nothing would have scored by now). */
function ScoreKpi() {
  useSimDay();
  useReportCardYear(); // a new year counted
  const score = scoreSoFar();
  if (score.years.length === 0) {
    return <Kpi tour="score" label="Score" value="—" sub={`first year Jan ${BASELINE_YEAR + 2}`} title="Each year from the second on scores its cut in emissions per resident against the first, in percent." />;
  }
  const last = score.years[score.years.length - 1].year;
  const par = parThrough(last);
  const total = Math.round(score.total);
  const vsPar = par === null ? null : total - Math.round(par);
  return (
    <Kpi
      tour="score"
      label="Score"
      value={String(total)}
      sub={vsPar === null ? `${score.years.length} year${score.years.length === 1 ? "" : "s"}` : <span className={vsPar >= 0 ? "good" : "bad"}>{`${vsPar >= 0 ? "+" : "−"}${Math.abs(vsPar)} vs par`}</span>}
      title={`Each year scores its cut in emissions per resident against ${BASELINE_YEAR}, in percent.${par !== null ? ` Par — what doing nothing would have scored by now — is ${Math.round(par)}.` : ""}${score.netZeroYear !== null ? ` Net zero reached in ${score.netZeroYear}.` : ""}${score.finishedYear !== null ? ` Finished at the end of ${score.finishedYear}: the years left count in full, and the score is final.` : ""}`}
    />
  );
}

export interface TopBarProps {
  dataset: MunicipalityDataset;
  onOpenTreasury: () => void;
  onOpenTownHall: () => void;
  onOpenInbox: () => void;
  onOpenWiki: () => void;
  onFeedback: () => void;
  onMenu: () => void;
}

/** The strip across the top: time and speed, the three numbers that matter, and the way
 * into the town hall, the inbox, the wiki and the menu. */
export function TopBar({ dataset, onOpenTreasury, onOpenTownHall, onOpenInbox, onOpenWiki, onMenu, onFeedback }: TopBarProps) {
  return (
    <header className="top-bar">
      <div className="tb-brand">
        <span className="tb-mark" aria-hidden="true" />
        <span className="tb-name">{dataset.name}</span>
      </div>
      <Clock />
      <div className="tb-kpis">
        <TreasuryKpi dataset={dataset} onOpen={onOpenTreasury} />
        <ApprovalKpi />
        <EmissionsKpi />
        <ScoreKpi />
      </div>
      <div className="tb-actions">
        <InboxButton onOpen={onOpenInbox} />
        <button className="tb-icon-button" onClick={onFeedback} title="Send feedback: what broke, what was unclear, what you think">
          <MessageSquare size={17} strokeWidth={1.75} aria-hidden />
          <span>Feedback</span>
        </button>
        <button className="tb-icon-button" onClick={onOpenWiki} title="Wiki: how the simulation works" data-tour="wiki">
          <BookOpen size={17} strokeWidth={1.75} aria-hidden />
          <span>Wiki</span>
        </button>
        <button className="tb-town-hall" data-tour="townhall" onClick={onOpenTownHall} title="Measures, prices, the accounts and the statistics (the simulation pauses while it's open)">
          <Landmark size={17} strokeWidth={1.75} aria-hidden />
          <span>Town hall</span>
        </button>
        <button className="tb-icon-button" onClick={onMenu} title="Game menu: save, load a save string, main menu" aria-label="Game menu">
          <Menu size={18} strokeWidth={1.75} aria-hidden />
        </button>
      </div>
    </header>
  );
}
