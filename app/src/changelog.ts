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
      "Six real municipalities in canton Zurich to govern — Bonstetten, Regensdorf, Schlieren, Uster, Wädenswil and Wetzikon — built from open data: every building from the federal building register, with its homes, age and heating; the registered solar panels, public chargers, cars and vans; the zoning plan; the streets.",
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
      "Carbon removal contracts, to balance the emissions a town can't avoid — counting once its own emissions are down to a fifth of what they were.",
      "A yearly tariff: publish next year's electricity, feed-in, district heating and charging prices by the end of August — the game stops at the deadline to ask, if you haven't. People react to the change, and keep comparing your prices with the Swiss average.",
      "Vote results: the town clerk writes on the day, and the measure shows how the vote went. A measure the voters reject can't be put forward again for two years.",
      "Keys 1, 2 and 3 pick a speed; the time keys now work while the inbox, the Town hall or the wiki is open.",
      "The treasury fills month by month: the government's allocation comes in twelve instalments, and the utility settles each month's electricity and heat as soon as it's over, instead of everything at the turn of the year.",
      "In the grid layer, areas with a bigger station or a battery on the way are marked in the list of the most loaded.",
      "Transformer areas follow the streets: each building hangs off the station nearest by road, and the map outlines the areas around their buildings.",
      "Mark every letter and paper as read; the approval figure counts down to the next election.",
      "A briefing at the start of every new game, and a getting-started checklist that walks you through the first steps (it can be brought back from the game menu).",
      "If something breaks, the game pauses and offers to save your run before you reload. A Feedback button sends a report, with your save if you like.",
      "Continue on the start screen picks up your latest save; About & credits names the open data and software the game is built on.",
      "Energy markets: heating oil, gas, petrol and wholesale power follow world prices, including the CO₂ levy, with the odd supply crisis sending them soaring.",
      "A dynamic tariff households can choose: its price follows the grid's expected load through the day. Cars on it charge in the cheapest night hours, heat pumps run ahead of the evening peak, and some washing machines wait for a cheap hour.",
      "Finish early: when a year closes at net zero and the books are in order (no supervision, no overdraft, debt at most three years of income), the Year in Review offers to end the run there, the years left until 2050 counting in full.",
    ],
  },
];

export const CURRENT_RELEASE: Release = CHANGELOG[0];

/** The public version, as the game shows it: "0.1.0", or "0.1.0-dev" while in development. */
export const VERSION_LABEL: string = CURRENT_RELEASE.date ? CURRENT_RELEASE.version : `${CURRENT_RELEASE.version}-dev`;
