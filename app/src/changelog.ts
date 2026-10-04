/**
 * The game's public version and its changelog — plain data, newest release first, shown in game
 * under "What's new" (start screen and game menu). The first entry is the current release; while
 * its `date` is null it is still being made, and the game calls itself "<version>-dev".
 *
 * Versions are 0.MINOR.PATCH during the beta: a new MINOR for new features or balance changes, a
 * PATCH for fixes only. Write for the player — what changed for them, not how (see CLAUDE.md).
 */

export interface Release {
  version: string;
  /** The release date (YYYY-MM-DD), or null while this release is still in development. */
  date: string | null;
  /** A short name or line for the release. */
  title?: string;
  /** A paragraph introducing it, if it needs one. */
  summary?: string;
  added?: string[];
  changed?: string[];
  fixed?: string[];
}

export const CHANGELOG: Release[] = [
  {
    version: "0.1.0",
    date: null,
    title: "The first beta",
    summary:
      "Run the energy department of a real Swiss municipality and take it to net zero by 2050 — with its real buildings, its grid and its voters.",
    added: [
      "A real municipality to govern — Schlieren, in canton Zurich — built from open data: every building from the federal building register, with its homes, age and heating; the registered solar panels, public chargers, cars and vans; the zoning plan; the streets.",
      "A live town: households heat, cook, charge and commute; heating systems, cars and building envelopes wear out and are replaced; new buildings go up and old ones are rebuilt.",
      "Measures in four kinds — subsidies, infrastructure, information and laws — with lead times, running costs and public votes; the canton and the Confederation act on their own schedule.",
      "Public approval behind which five groups feel differently, with votes, elections and recall.",
      "A treasury with a municipal utility, a share of its profit, bank loans, green bonds and federal decarbonisation loans — and canton supervision for too much debt.",
      "Planning tools on the map: extend the district heating network, build public chargers and lorry charging parks, reinforce the grid or add batteries, change the zoning plan, and put solar and chargers on the municipality's own buildings.",
      "Where a heat pump may go: the canton's map of what the ground allows, and noise limits at the neighbours.",
      "Home batteries, early switching, technology prices that change over the years.",
      "Letters from residents and groups, requests with deadlines, and a monthly local paper.",
      "Evaluation studies, opinion surveys, and a transparency mode that shows every decision households make and why.",
      "The Town hall, the Year in Review, statistics, and a wiki explaining how everything works.",
      "Saving: in this browser, as an autosave each year, or as a save string to keep anywhere.",
      "A score: every year from the second on scores its cut in emissions per resident against the first, through 2050 — shown against par, what doing nothing would score.",
      "Winning and losing: reach net zero by 2050 to win; lose an election (below 50%) or a recall and the run ends. Either way, an end screen shows how it went.",
      "Carbon removal contracts, to balance the emissions a town can't avoid — counting once its own emissions are down to a tenth of what they were.",
    ],
  },
];

export const CURRENT_RELEASE: Release = CHANGELOG[0];

/** The public version, as the game shows it: "0.1.0", or "0.1.0-dev" while in development. */
export const VERSION_LABEL: string = CURRENT_RELEASE.date ? CURRENT_RELEASE.version : `${CURRENT_RELEASE.version}-dev`;
