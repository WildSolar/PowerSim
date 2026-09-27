// Studies the municipality can commission (sim/studies.ts). Placeholders.

// An evaluation of a subsidy programme: how many of the households paid would not have acted
// without the money. It looks at the last few years, interviews a sample of them, and its method
// has an error of its own on top of the sampling error.
export const EVALUATION_COST_CHF = 30_000;
export const EVALUATION_MONTHS = 4;
export const EVALUATION_LOOKBACK_YEARS = 3;
export const EVALUATION_SAMPLE_SIZE = 150;
export const EVALUATION_METHOD_ERROR = 0.05; // ± share, on top of sampling

// An opinion survey: each group of voters' approval, with a margin (points).
export const SURVEY_COST_CHF = 15_000;
export const SURVEY_MONTHS = 2;
export const SURVEY_NOISE_POINTS = 4;
