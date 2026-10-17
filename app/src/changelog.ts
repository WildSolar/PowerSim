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
    version: "0.6.0",
    date: null,
    added: [
      "District heating: a network's card adds up its clean sources against its winter peak — the room left before the boilers start, or how much of the peak they make and their heat over a year (projected).",
      "Carbon removal contracts: the measure shows what they would cost at the share you set, and how far the town's emissions still are from the point where they apply.",
      "New charts: solar and wind built (rooftop, Agri-PV, wind), batteries, district heating pipes and the share of buildings, floor area and heat demand they reach, public charging's room against what's taken, and the share of households with a wallbox and how good public charging is for the rest.",
      "Solar on public buildings fits the roofs that pay back best first, rather than in no particular order.",
      "Chargers at public buildings spread out: once a site is placed, the households around it count as served, and the next one never goes within about 300 m of a site still being built. Private operators, too, no longer count demand a site just ordered will meet.",
      "Churches are no longer counted among the municipality's buildings: no solar or chargers of the town's on them, and their roofs can be rented like any other.",
      "More charts: buildings by heating system and by insulation, heat pumps' capacity, how full the transformers are, each district heating network's clean share, electric cars, vans and lorries, and the treasury's balance and debt. The approval chart marks your measures, so you can see what moved it.",
    ],
    changed: [
      "Wood heating is now a heating system of its own: the buildings the register lists as heating with wood — logs, pellets or chips, in a boiler or a stove — burn wood pellets, wear out and are replaced like any other heating (by wood again, or by a heat pump, district heat or a boiler). It counts as clean. New wood heating isn't installed where there was none.",
      "Grid: about a quarter fewer transformer stations, each serving a bit more — bigger ones in large towns.",
      "Home and neighbourhood batteries get cheaper faster, to about half today's price in the long run.",
      "Private operators build out public charging faster: new sites where fewer would-be drivers gather, more of them a year, bigger expansions — and up to two shops' car parks a year.",
      "District heating: an incinerator or a treatment plant can be drawn on in stages — what you don't take stays on offer, though each stage pays its own fixed costs and trunk line.",
    ],
    fixed: [
      "A new game starts with the treasury as it stands that day — the year so far counted while the game loads — instead of catching up month by month.",
      "Charts: an axis stepping in halves (2.5, 7.5…) shows them, instead of rounding two of its labels to the same number.",
    ],
  },
  {
    version: "0.5.1",
    date: "2026-10-17",
    fixed: [
      "The game no longer stalls for a moment at the turn of each month or year: the month's accounts and the grid's meter readings are worked out bit by bit in the background as the month goes by, so little is left to do when it ends, and drivers charging in public take their yearly look at their chargers spread over the year rather than all on New Year's Day.",
    ],
  },
  {
    version: "0.5.0",
    date: "2026-10-17",
    title: "Charging, rooftops and fields",
    summary:
      "Charging an electric car without a charger at home is now a matter of degree — how close the chargers are along the streets, how busy, and whether you can charge at work — and a wallbox is something a household buys when it pays, not something the law hands out. Drivers move to better chargers as they open. Rooftop panels face every way, softening the town's midday peak, and Agri-PV comes in three kinds sized to their fields. Plus a grant for connecting to district heating.",
    added: [
      "Workplace charging: some drivers can charge where they work — more each year as employers equip their car parks, and more with the new workplace charging programme (Town hall → Measures).",
      "Private operators equip large shops' car parks with chargers where people around would go electric with better charging.",
      "District heating connection grant, a new measure: a flat sum off every first connection to district heating, paid as owners connect. It counts with the heat pump grant in the treasury and in evaluation studies.",
      "A home's panel shows where each driver's electric car charges, or how good the charging would be if they went electric.",
    ],
    changed: [
      "Charging an electric car without a charger at home is now a matter of degree: a quality from 0 to 100% made up of the chargers around — best close by and fading with the distance along the streets, not as the crow flies — and of how busy they are, plus charging at work for those who can. Different kinds add up; below 10% an electric car is ruled out. The better the charging, the smaller the hassle that weighs against an electric car.",
      "Charging at home takes a wallbox, and being allowed one isn't having one: a household puts it in when it buys an electric car — CHF 2,500 at a house, 4,000 in a shared car park, more where only the right to charge got the landlord to agree — and only if that beats the public chargers around. The right to charge now widens who may, rather than handing out wallboxes, and the EV charging layer shows green only where most households actually have one.",
      "Drivers charging in public look again every New Year, and when a charger within their reach opens or grows: they move to better chargers, or put in a wallbox, if it saves them CHF 100 a year — so a new charger relieves crowded ones nearby within a month.",
      "Chargers in shops' car parks count as their own kind: a top-up while shopping, reaching further than an on-street charger but doing less.",
      "A car can share its charging among several chargers (and work), and a busy charger takes new cars up to a quarter over its room, worth less the fuller it gets.",
      "EV charging layer: buildings are coloured by the quality of public charging, and the coverage toggles and a charger's reach follow the streets.",
      "Rooftop solar: each building's panels face their own way — south, east, west, flat-roof rows — so the town's roofs no longer all peak at the same moment; the midday peak on the grid is lower, with the same output over the year. Owners weigh panels, and the utility a roof contract, on what that roof would make; home batteries plan their day on their own roof's sun. A building's panel says which way its panels face.",
      "Agri-PV comes in three kinds — vertical rows between the crops, fixed rows over orchards and vines, and rows tracking the sun — each with its own output over the day. A field is built over its whole area, 0.3–0.8 MWp per hectare depending on the kind; its business takes the power up to part of its own use and the utility buys the rest at the feed-in price.",
    ],
  },
  {
    version: "0.4.0",
    date: "2026-10-16",
    title: "The grid, the money, and a guided start",
    summary:
      "The grid is yours to run: reinforce stations when and as far as you choose, store surplus in batteries, and sell what's left hour by hour. The utility pays the town a fixed concession fee, so what you build pays you back in full, and a new ledger and charts show where every franc and kilowatt-hour went. Plus district heating lines off the streets, roofs that can't take panels, and a tutorial for your first weeks in office.",
    added: [
      "District heating: lay a direct line off the streets, from one junction to another along a course you draw — to bring a plant's heat across town the short way, or to join two networks. Its price depends on what it crosses: cheap through fields, dear across roads, under houses or over water.",
      "Grid: choose the size when you reinforce a transformer station. A new station replaces the old one, so one step to the size you need costs less than several small ones; one order per station at a time.",
      "Grid: reinforce overloaded stations automatically after each reading, to the size their peak needs, as long as the treasury has the money — a setting in the Grid tool.",
      "Surplus power: when the town makes more than it uses, the utility sells the surplus on the spot market at that hour's price, which sinks on sunny middays and falls below zero from the early 2030s. Neighbourhood batteries keep surplus for the evening, so the utility sells less cheap and buys less. A new chart shows power bought, sold and shifted.",
      "Charts, a new tab in the Town hall: how the town has changed since you took office — electricity by use and what solar and wind made, heat by heating system, district heat by source (backup boilers included), the share of the roofs' solar potential built, each transformer's peaks against its capacity, the modal split, approval, emissions, spending and the utility's accounts. A small chart icon next to a transformer, a panel or an account opens its chart.",
      "The published game counts visits and a few milestones anonymously (no cookies, nothing about you) — see About & credits.",
      "A tutorial, on the start screen: your first weeks as the newly elected mayor, with your chief of staff showing you the job step by step — the map and its views, the clock, the Town hall and its measures, the planning tools, your mail and your first Year in Review. It highlights what to click, and plays as a small game of its own.",
    ],
    changed: [
      "Rooftop solar: about one roof in five (one in three on buildings from before 1920) can't take panels at all — wrong orientation, shade, too many obstacles, or too small — so even generous incentives no longer cover every roof in town. The rooftop solar chart's potential counts only the roofs that can.",
      "Grid: only on-street chargers load their neighbourhood's transformer station. Fast-charging hubs and lorry charging parks have a transformer of their own, which comes with them.",
      "Grid: the utility no longer reinforces the worst overloaded station by itself — reinforcing is up to you (or the new automatic setting).",
      "District heating priority zones: a building whose street is piped must connect when its heating is next replaced, not only when it's new — district heat is then its only choice.",
      "Treasury → Ledger: every franc in and out, newest first, filterable by kind and year.",
      "Charts: spending can show one kind on its own, and the utility's accounts any single line, month by month (what the power bought costs, for instance).",
      "An order the treasury can't pay is refused — borrow first. Subsidies and running costs can still take the balance below zero, into the costly overdraft.",
      "Planning tools are tidier: each drawer has an Overview tab (the town's figures, the lists, the legend) and a Build tab (what you can order), and whatever you pick — a charger, a transformer station, a heating network, a wind site — opens its own card on the right, like a building's.",
      "A price ceiling: the regulator holds the household electricity price to the utility's costs — power, grid, concession fee — plus a fifth. Prices page shows where you stand; a tariff over it can't be published.",
      "The utility now pays the town a concession fee on every kWh it sells, instead of handing over three quarters of its profit. The fee is set when you take office, at what the town took the year before, so your starting money is unchanged — but from then on everything the utility earns beyond the fee is yours, and so is a loss. What you build now pays you back in full: wind turbines, batteries, district heating plants and pipes, chargers. Solar on public buildings is credited with what it saves them and earns feeding in.",
      "The utility buys power on long-term contracts at the month's wholesale price for what the town draws beyond its own generation, hour by hour, instead of netting the whole month's surplus against it.",
    ],
    fixed: [
      "Grid: a neighbourhood battery being installed shows its size.",
      "Grid: a neighbourhood battery takes the top off a peak only as far as its storage lasts through it, not simply its power — a 500 kWh battery shaves about 200 kW off a 600 kW winter evening peak.",
      "Grid: a station's card shows each peak as measured, and — with a battery in the area — what is left of it on the station, instead of a bare 0 kW when the battery covers it.",
      "Roof contracts: an owner who has an offer to answer, or has accepted one, no longer puts up solar of their own meanwhile — which could leave a Build button that did nothing. The projected net for the utility is planned on a typical year's sun and the market's underlying price, so it no longer jumps with each month's price or year's weather.",
      "Vote results and polls show one decimal, rounded down — a measure that fell just short no longer reads “only 50% voted yes”.",
      "The utility's accounts count the Agri-PV fields' power the way the town's generation does (snow on the panels, a feed-in limit).",
      "District heating: where a river or lake heat pump may stand is shown as one clean area inside the municipality, instead of overlapping blotches.",
      "Streets that met within a couple of metres without being joined — a short connecting piece lost, a street drawn twice side by side — now meet, so pipes can follow them.",
      "District heating: footpaths among the buildings — through a park, down to a block of flats — can carry pipes too, and some short stretches of street that were missing are back.",
    ],
  },
  {
    version: "0.2.0",
    date: "2026-10-07",
    title: "More towns, more heat, more power",
    summary:
      "Five more municipalities to govern, district heating rebuilt around real networks and real heat sources, and three new ways to make clean electricity — the utility's own solar on rented roofs, solar over farmland, and wind.",
    added: [
      "Five more municipalities in canton Zurich: Bonstetten, Regensdorf, Uster, Wädenswil and Wetzikon, alongside Schlieren.",
      "District heating, rebuilt: towns start with their real networks — what each runs on, how big it is — and every network burns oil or gas only for what its clean sources can't cover. Add heat sources of your own: waste heat from an incinerator or a factory that offers it, heat pumps on a waste water plant, groundwater, a river or a lake, or a wood chip plant (as big as the town's forest can feed, and minded by its neighbours). A plant can start a network of its own, so towns without district heating can build one.",
      "Roof contracts: rent large roofs and put the utility's own solar on them. Set the rent in the new Roof solar layer and offer it to one roof or all of them; owners accept, decline, or are prompted to build their own. The utility pays the build cost and keeps what the arrays make.",
      "Agri-PV: zone farmland for solar over the crops in the Zoning tool. It always goes to a vote, and people mind at first; the Agri-PV dialogue brings them round. Businesses with a big electricity use then build fields on the zoned land and take the power themselves.",
      "Wind power: commission a study to find where turbines could stand, then take each site through a zoning plan (always put to the vote), a permit (usually appealed, sometimes struck down in court) and the build. Turbines make most of their power in winter.",
      "Finish early: when a year closes at net zero and the books are in order (no supervision, no overdraft, debt at most three years of income), the Year in Review offers to end the run there, the years left until 2050 counting in full.",
      "A briefing at the start of every new game, and a getting-started checklist that walks you through the first steps (it can be brought back from the game menu).",
      "If something breaks, the game pauses and offers to save your run before you reload. A Feedback button sends a report, with your save if you like.",
      "Continue on the start screen picks up your latest save; About & credits names the open data and software the game is built on.",
    ],
    changed: [
      "The “Clean district heating” measure and the fixed 5 MW supply step are gone: district heating gets cleaner by building clean heat sources.",
      "Cars are scrapped closer to their typical age, and under a ban on new petrol and diesel cars a household without a charger of its own goes electric anyway.",
      "A ban on new petrol and diesel cars meets milder opposition beyond the drivers, and a popular council carries contested votes more easily.",
      "Carbon removal contracts count once the town's own emissions are down to a fifth of what they were (was a tenth), and can cover up to a fifth.",
      "Taxpayers judge running spending against what the department takes in: the government's allocation plus its share of last year's utility profit.",
    ],
    fixed: ["Dates that should show a month and year (the next election, public votes, plants being built) no longer show the day as well."],
  },
  {
    version: "0.1.0",
    date: "2026-10-04",
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
      "A yearly tariff: publish next year's electricity, feed-in, district heating and charging prices by the end of August — the game stops at the deadline to ask, if you haven't. People react to the change, and keep comparing your prices with the Swiss average.",
      "Vote results: the town clerk writes on the day, and the measure shows how the vote went. A measure the voters reject can't be put forward again for two years.",
      "Keys 1, 2 and 3 pick a speed; the time keys now work while the inbox, the Town hall or the wiki is open.",
      "The treasury fills month by month: the government's allocation comes in twelve instalments, and the utility settles each month's electricity and heat as soon as it's over, instead of everything at the turn of the year.",
      "In the grid layer, areas with a bigger station or a battery on the way are marked in the list of the most loaded.",
      "Transformer areas follow the streets: each building hangs off the station nearest by road, and the map outlines the areas around their buildings.",
      "Mark every letter and paper as read; the approval figure counts down to the next election.",
      "Energy markets: heating oil, gas, petrol and wholesale power follow world prices, including the CO₂ levy, with the odd supply crisis sending them soaring.",
      "A dynamic tariff households can choose: its price follows the grid's expected load through the day. Cars on it charge in the cheapest night hours, heat pumps run ahead of the evening peak, and some washing machines wait for a cheap hour.",
    ],
  },
];

export const CURRENT_RELEASE: Release = CHANGELOG[0];

/** The public version, as the game shows it: "0.1.0", or "0.1.0-dev" while in development. */
export const VERSION_LABEL: string = CURRENT_RELEASE.date ? CURRENT_RELEASE.version : `${CURRENT_RELEASE.version}-dev`;
