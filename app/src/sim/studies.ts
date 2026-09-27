/**
 * What the municipality can find out, at a price. The world itself is open to inspection — every
 * building, dwelling and bill — but causes and motives aren't: how much a subsidy actually changed,
 * and what each group of voters thinks. Those take a study:
 *
 *  - An evaluation of a subsidy programme looks at the households paid over the last few years and
 *    estimates how many of them would not have acted without the money — the rest are free riders.
 *    It's grounded in the truth (additionality.ts records, for every subsidised decision, whether
 *    the subsidy changed it), but a study only interviews a sample, and its method has its own
 *    error: the answer comes with a margin.
 *  - An opinion survey reports how each group of voters feels, as of when it was in the field —
 *    with a margin too.
 *
 * Both cost money when commissioned (the treasury's campaigns-and-programmes line) and deliver their
 * results some months later.
 */

import { BLOC_ORDER, type Bloc } from "../config/approval";
import {
  EVALUATION_COST_CHF,
  EVALUATION_LOOKBACK_YEARS,
  EVALUATION_METHOD_ERROR,
  EVALUATION_MONTHS,
  EVALUATION_SAMPLE_SIZE,
  SURVEY_COST_CHF,
  SURVEY_MONTHS,
  SURVEY_NOISE_POINTS,
} from "../config/studies";
import { resetAdditionality, subsidisedDecisions, type SubsidyCategory } from "./additionality";
import { approval } from "./approval";
import { simClock } from "./engine";
import { hashSeed, mulberry32 } from "./rng";
import { treasury } from "./treasury";

const MONTH_MS = (365.25 * 24 * 60 * 60_000) / 12;
const YEAR_MS = 12 * MONTH_MS;

export interface EvaluationResult {
  /** Households paid in the period looked at. */
  paid: number;
  paidRp: number;
  /** The estimated share whose choice the subsidy changed, and the margin (both 0-1). */
  additionalShare: number;
  margin: number;
}

export interface EvaluationStudy {
  id: number;
  category: SubsidyCategory;
  commissionedAtMs: number;
  readyAtMs: number;
  /** The period it looks at: the last few years before it was commissioned. */
  fromMs: number;
  result: EvaluationResult | null; // null until delivered
}

export interface OpinionSurvey {
  id: number;
  commissionedAtMs: number;
  readyAtMs: number;
  /** Each group's approval as the survey found it, and the margin (points). Null until delivered. */
  result: { levels: Record<Bloc, number>; margin: number } | null;
}

function normalish(rng: () => number): number {
  // Sum of uniforms: close enough to a standard normal for a study's error.
  return (rng() + rng() + rng() + rng() - 2) * Math.sqrt(3);
}

class Studies {
  private evaluations: EvaluationStudy[] = [];
  private surveys: OpinionSurvey[] = [];
  private nextId = 1;
  private seed = "studies";
  private unsubscribeClock: (() => void) | null = null;
  private readonly listeners = new Set<() => void>();
  private version = 0;

  init(seed: string): void {
    this.evaluations = [];
    this.surveys = [];
    this.nextId = 1;
    this.seed = seed;
    resetAdditionality();
    this.unsubscribeClock?.();
    this.unsubscribeClock = simClock.subscribe(() => this.advance(simClock.getSimTimeMs()));
    this.notify();
  }

  // --- evaluations ---

  commissionEvaluation(category: SubsidyCategory, atMs: number): EvaluationStudy {
    const study: EvaluationStudy = {
      id: this.nextId++,
      category,
      commissionedAtMs: atMs,
      readyAtMs: atMs + EVALUATION_MONTHS * MONTH_MS,
      fromMs: atMs - EVALUATION_LOOKBACK_YEARS * YEAR_MS,
      result: null,
    };
    this.evaluations.push(study);
    treasury.recordPayout("programs", atMs, EVALUATION_COST_CHF * 100, `evaluation-${study.id}`);
    this.notify();
    return study;
  }

  /** The latest evaluation of a category (delivered or under way), if any. */
  latestEvaluation(category: SubsidyCategory): EvaluationStudy | null {
    const list = this.evaluations.filter((s) => s.category === category);
    return list[list.length - 1] ?? null;
  }

  private evaluate(study: EvaluationStudy): EvaluationResult {
    const decisions = subsidisedDecisions(study.category, study.fromMs, study.commissionedAtMs);
    const paid = decisions.length;
    const paidRp = decisions.reduce((sum, d) => sum + d.subsidyRp, 0);
    if (paid === 0) return { paid, paidRp, additionalShare: 0, margin: 0 };
    const trueShare = decisions.filter((d) => d.additional).length / paid;
    const sample = Math.min(paid, EVALUATION_SAMPLE_SIZE);
    const samplingSe = paid > sample ? Math.sqrt((Math.max(0.05, trueShare) * Math.max(0.05, 1 - trueShare)) / sample) : 0;
    const rng = mulberry32(hashSeed(this.seed, "evaluation", String(study.id)));
    const estimate = trueShare + normalish(rng) * samplingSe + (rng() * 2 - 1) * EVALUATION_METHOD_ERROR;
    return { paid, paidRp, additionalShare: Math.min(1, Math.max(0, estimate)), margin: 1.96 * samplingSe + EVALUATION_METHOD_ERROR };
  }

  // --- opinion surveys ---

  commissionSurvey(atMs: number): OpinionSurvey {
    const survey: OpinionSurvey = { id: this.nextId++, commissionedAtMs: atMs, readyAtMs: atMs + SURVEY_MONTHS * MONTH_MS, result: null };
    this.surveys.push(survey);
    treasury.recordPayout("programs", atMs, SURVEY_COST_CHF * 100, `survey-${survey.id}`);
    this.notify();
    return survey;
  }

  latestSurvey(): OpinionSurvey | null {
    return this.surveys[this.surveys.length - 1] ?? null;
  }

  /** The latest survey that has delivered its result. */
  latestSurveyResult(): OpinionSurvey | null {
    for (let i = this.surveys.length - 1; i >= 0; i--) if (this.surveys[i].result) return this.surveys[i];
    return null;
  }

  // --- time ---

  /** Delivers every study whose fieldwork is done. A survey reads opinion as it stands when it
   * finishes, so this runs on the clock, not when someone happens to look. */
  advance(nowMs: number): void {
    let changed = false;
    for (const study of this.evaluations) {
      if (!study.result && nowMs >= study.readyAtMs) {
        study.result = this.evaluate(study);
        changed = true;
      }
    }
    for (const survey of this.surveys) {
      if (!survey.result && nowMs >= survey.readyAtMs) {
        const levels = approval.getBlocLevels();
        const rng = mulberry32(hashSeed(this.seed, "survey", String(survey.id)));
        const found = {} as Record<Bloc, number>;
        for (const b of BLOC_ORDER) found[b] = Math.min(100, Math.max(0, levels[b] + normalish(rng) * (SURVEY_NOISE_POINTS / 2)));
        survey.result = { levels: found, margin: SURVEY_NOISE_POINTS };
        changed = true;
      }
    }
    if (changed) this.notify();
  }

  // --- subscription ---

  subscribe(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  getVersion(): number {
    return this.version;
  }

  private notify(): void {
    this.version++;
    this.listeners.forEach((l) => l());
  }
}

export const studies = new Studies();
