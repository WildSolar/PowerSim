/**
 * Plays the running game forward by itself, for balance tests: the real game with everything on
 * (treasury, debt, votes, elections, the Year in Review's accounts), unlike scenario.ts. Start a game
 * in the browser, then from the console:
 *
 *   window.__x = null; __autoplay({ enact: [{ id: "green-power", year: 2027 }] }).then((r) => (window.__x = r))
 *
 * It steps a month at a time, enacts the plan's measures on 1 January of their year, counts each
 * year as the Year in Review would and closes it, keeps the tariff at the deadline (or publishes the
 * plan's), and reports every year. Stops at game over or after `untilYear`. window.__autoplayProgress
 * says how far it has got.
 */

import { toDateMs } from "../sim/calendar";
import { dataUrl } from "../data/loadDataset";
import type { MunicipalityDataset } from "../data/types";
import { approval } from "../sim/approval";
import { debt } from "../sim/debt";
import { computeEmissionsForYear } from "../sim/emissions";
import { simClock } from "../sim/engine";
import { computeMunicipalFinancesForYear } from "../sim/finances";
import { measures } from "../sim/measures";
import { reportCardStore } from "../sim/reportCardStore";
import { NET_ZERO_TARGET_YEAR, perResidentKg, scoreSoFar } from "../sim/score";
import { stock } from "../sim/stock";
import type { TariffSheet } from "../sim/tariff";
import { tariffDeadline } from "../sim/tariffDeadline";
import { tariffStore } from "../sim/tariffStore";

export interface AutoplayPlan {
  enact: { id: string; params?: Record<string, number | boolean | string>; year: number }[];
  /** Changes to publish for a year's tariff at its deadline (else this year's prices are kept). */
  tariff?: Record<number, Partial<TariffSheet>>;
  untilYear?: number;
}

export interface AutoplayRow {
  year: number;
  approval: number;
  balanceMChf: number | null;
  debtMChf: number;
  rating: string;
  grossKt: number;
  netKt: number;
  perResidentT: number;
  points: number;
  score: number;
  enacted: string[];
  log: string[];
}

const MONTH_MS = (365.25 * 24 * 3_600_000) / 12;
// A message, not a timer: timers crawl in a background tab, and these runs take minutes.
const tick = () =>
  new Promise((resolve) => {
    const channel = new MessageChannel();
    channel.port1.onmessage = () => {
      channel.port1.close();
      resolve(undefined);
    };
    channel.port2.postMessage(null);
  });

function yearOf(ms: number): number {
  return new Date(toDateMs(ms)).getUTCFullYear();
}

export async function autoplay(plan: AutoplayPlan): Promise<AutoplayRow[]> {
  const dataset = (await (await fetch(dataUrl("schlieren.json"))).json()) as MunicipalityDataset;
  const untilYear = plan.untilYear ?? NET_ZERO_TARGET_YEAR;
  const rows: AutoplayRow[] = [];
  const started = Date.now();
  const progress = (msg: string) => Object.assign(window, { __autoplayProgress: `${msg} after ${Math.round((Date.now() - started) / 1000)} s` });
  const pending = [...plan.enact];
  let logFrom = 0;

  const enactDue = (year: number) => {
    for (const e of pending.filter((p) => p.year <= year)) {
      const ok = measures.enact(e.id, e.params ?? {});
      if (!ok) console.warn(`autoplay: ${e.id} not enacted in ${year}`);
      pending.splice(pending.indexOf(e), 1);
    }
  };
  enactDue(yearOf(simClock.getSimTimeMs()));

  for (;;) {
    const before = simClock.getSimTimeMs();
    const target = before + MONTH_MS;
    simClock.pauseAt(target);
    await tick();

    // The tariff deadline holds the clock: publish the plan's, or keep this year's prices.
    const due = tariffDeadline.get();
    if (due !== null) {
      const change = plan.tariff?.[due];
      if (change) tariffStore.publish({ ...tariffStore.sheetFor(due), ...change }, simClock.getSimTimeMs());
      else tariffDeadline.keepPrices();
      simClock.pauseAt(target);
      await tick();
    }

    // The turn of a year: count it, book it, close the Year in Review.
    const completed = reportCardStore.get();
    if (completed !== null) {
      progress(`counting ${completed}`);
      const e = await computeEmissionsForYear(stock.getAll(), dataset.powerPlants, completed);
      await computeMunicipalFinancesForYear(stock.getAll(), dataset.powerPlants, completed);
      reportCardStore.dismiss();
      await tick();
      const now = simClock.getSimTimeMs();
      enactDue(completed + 1);
      const score = scoreSoFar(completed);
      const scored = score.years.find((y) => y.year === completed);
      const balance = debt.balanceRp(now);
      const log = [...measures.getHistory(), ...approval.getLog()].filter((l) => l.atMs >= logFrom && l.atMs < now).map((l) => l.text);
      logFrom = now;
      rows.push({
        year: completed,
        approval: Math.round(approval.getApproval() * 10) / 10,
        balanceMChf: balance === null ? null : Math.round(balance / 1e6) / 100,
        debtMChf: Math.round(debt.debtRp(now) / 1e6) / 100,
        rating: debt.rating().label,
        grossKt: Math.round(e.totalKgCO2 / 1e5) / 10,
        netKt: Math.round(e.netKgCO2 / 1e5) / 10,
        perResidentT: Math.round(perResidentKg(e) / 10) / 100,
        points: scored ? Math.round(scored.points * 10) / 10 : 0,
        score: Math.round(score.total),
        enacted: measures.getActiveMeasures().map((m) => m.def.id),
        log,
      });
      progress(`done ${completed}`);
      if (completed >= untilYear) break;
    }
    if (approval.getGameOver()) {
      progress(`game over: ${approval.getGameOver()?.headline}`);
      rows.push({ year: yearOf(simClock.getSimTimeMs()), approval: approval.getApproval(), balanceMChf: null, debtMChf: 0, rating: "", grossKt: 0, netKt: 0, perResidentT: 0, points: 0, score: Math.round(scoreSoFar().total), enacted: [], log: [approval.getGameOver()?.text ?? ""] });
      break;
    }
  }
  return rows;
}
