// Borrowing (sim/debt.ts, sim/interestRates.ts): the market's rates, the four ways the energy
// department can borrow, and the canton's limits. Informed placeholders.

// --- The market rate (what a well-rated Swiss municipality pays for a 10-year loan) ---

export const RATE_START_PCT = 1.2;
// The level rates drift back to, itself moving slowly over the decades (from -> to, by year).
export const RATE_LONG_RUN_PCT: [number, number] = [1.6, 2.2];
export const RATE_LONG_RUN_YEARS = 25;
export const RATE_REVERSION_PER_MONTH = 0.03;
export const RATE_NOISE_PCT_PER_MONTH = 0.08;
// Now and then rates jump (an inflation scare, a crisis): this chance a month, by this much, fading
// away with this half-life.
export const RATE_SHOCK_CHANCE_PER_MONTH = 0.01;
export const RATE_SHOCK_PCT: [number, number] = [1, 2.5];
export const RATE_SHOCK_HALF_LIFE_MONTHS = 24;
export const RATE_MIN_PCT = 0;
export const RATE_MAX_PCT = 7;

// --- Credit rating: lenders charge more the more indebted the department is ---
// By debt as years of income (operating income before discretionary spending, see debt.ts).
export const RATINGS: { label: string; uptoYears: number; spreadPct: number }[] = [
  { label: "AAA", uptoYears: 1, spreadPct: 0.1 },
  { label: "AA", uptoYears: 2, spreadPct: 0.25 },
  { label: "A", uptoYears: 3, spreadPct: 0.5 },
  { label: "BBB", uptoYears: 4, spreadPct: 1 },
  { label: "BB", uptoYears: Number.POSITIVE_INFINITY, spreadPct: 2 },
];

// --- The canton's limits ---

// Debt beyond this many years of income puts the department under cantonal supervision: no new
// borrowing, no new spending measures or orders. It lifts once debt is back under this share of it.
export const DEBT_LIMIT_YEARS = 5;
export const SUPERVISION_EXIT_SHARE = 0.8;
// Before a year's accounts exist, income is taken as this many times the government's allocation.
export const PROVISIONAL_INCOME_ALLOCATIONS = 2.5;
// Debt worries taxpayers: from this many years of income, every group's resting approval falls,
// up to this many points at the limit (weighted like the overspending penalty).
export const DEBT_WORRY_FROM_YEARS = 1.5;
export const DEBT_MAX_PENALTY_POINTS = 10;

// --- Bank loans ---

export const BANK_LOAN_TERMS_YEARS = [5, 10, 20];
// Shorter loans are a little cheaper, longer ones a little dearer, than the 10-year rate.
export const BANK_TERM_PREMIUM_PCT: Record<number, number> = { 5: -0.2, 10: 0, 20: 0.35 };

// --- Overdraft: a negative balance is covered automatically, expensively ---

export const OVERDRAFT_PREMIUM_PCT = 3;

// --- Green bonds, sold to the town's own residents ---

export const GREEN_BOND_TERM_YEARS = 10;
// Residents accept a little less than the market for a local, green cause.
export const GREEN_BOND_DISCOUNT_PCT = 0.4;
// How much residents subscribe: up to this much per resident, more when the climate-minded are happy.
export const GREEN_BOND_CHF_PER_RESIDENT = 400;
export const GREEN_BOND_DEMAND_RANGE: [number, number] = [0.5, 1.3];
export const GREEN_BOND_SUBSCRIPTION_MONTHS = 2;
export const GREEN_BOND_MIN_MONTHS_APART = 12;
// The money is earmarked: as much must go into green investment within this long, or the paper
// calls it greenwashing and the climate-minded turn away.
export const GREEN_BOND_EARMARK_MONTHS = 24;
export const GREEN_BOND_ISSUE_GOODWILL = { climate: 3, tenants: 1 } as const;
export const GREEN_BOND_GREENWASHING_POINTS = -5;

// --- Federal decarbonisation loans ---

export const FEDERAL_LOAN_RATE_PCT = 0.25;
export const FEDERAL_LOAN_TERM_YEARS = 20;
// Up to this share of the decarbonisation investments of the last twelve months...
export const FEDERAL_LOAN_SHARE_OF_INVESTMENT = 0.5;
// ...and at most this much a calendar year (per resident).
export const FEDERAL_LOAN_CHF_PER_RESIDENT_YEAR = 100;
export const FEDERAL_LOAN_PROCESSING_MONTHS = 3;
