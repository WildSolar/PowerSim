/**
 * In-game wiki content — plain data rather than JSX so a future session can add
 * or edit a section without touching WikiPanel.tsx at all. Keep entries here in
 * sync with what's actually implemented: when a new device/mechanic lands, add
 * or update its section here in the same change (see CLAUDE.md).
 *
 * Write for the player: what they see, what drives it, and what they can do about
 * it — about any Swiss municipality, not one in particular. Leave out how the code
 * does it; a note() says plainly where the game simplifies.
 *
 * Sections are listed in WIKI_GROUPS (at the bottom), which decides where each one
 * shows in the wiki's contents; a new section must be added to a group. A section
 * name in escaped straight quotes inside a text (\"When things wear out\") becomes a
 * link to that section — the name must match its title, or the part of the title
 * before a colon. Ordinary quotations use typographic quotes (‘ ’, “ ”).
 */

export interface WikiBlock {
  type: "p" | "list" | "note";
  text?: string; // "p" | "note"
  items?: string[]; // "list"
}

export interface WikiSection {
  id: string;
  title: string;
  blocks: WikiBlock[];
}

export interface WikiGroup {
  id: string;
  title: string;
  /** One line under the group's name on the wiki's front page. */
  blurb: string;
  /** Section ids, in reading order. */
  sections: string[];
}

function p(text: string): WikiBlock {
  return { type: "p", text };
}
function list(items: string[]): WikiBlock {
  return { type: "list", items };
}
function note(text: string): WikiBlock {
  return { type: "note", text };
}

export const WIKI_SECTIONS: WikiSection[] = [
  // --- Getting started --------------------------------------------------------------------
  {
    id: "overview",
    title: "Overview",
    blocks: [
      p(
        "In Commune Zéro you run the energy department of a real Swiss municipality: its electricity utility, its district heating, and its say over buildings, zoning and transport. The goal is net zero by 2050 — without losing the voters or emptying the treasury on the way.",
      ),
      p(
        "The town on the map is the real one. Every building comes from the federal building register, with its real address, age, size, homes and heating; so are the solar panels, the public chargers, the share of electric cars and the businesses' vans and lorries at the start. From there the town lives on: people heat, cook, charge and commute, systems wear out and get replaced, new buildings go up. You can't decide for anyone — but your measures, prices and building projects change what people choose.",
      ),
      p(
        "Click any building to look inside: what heats it, what it draws right now, what its occupants pay, and what has changed over the years. Click a home in it to go down to single appliances.",
      ),
      p(
        "A new game opens with a short briefing — the goal, how you stay in office, what you control — and a checklist of first steps in the corner, each with a button that takes you there. Close it once you know your way around; the game menu brings it back.",
      ),
      p(
        "The bar across the top shows the date and the speed, and the three numbers that matter most: the treasury, public approval, and last year's emissions against the first year's. On the left of the map are its layers (see \"Map layers\"). Everything that isn't on the map — measures, the accounts, prices and statistics — is in the Town hall, top right. The game pauses while the Town hall or this wiki is open, and carries on at the same speed when you close them.",
      ),
      note(
        "Where there is no real data — who owns an electric car, when someone runs the dishwasher — the game fills in plausible households. They aren't the people who really live there, but together they behave the way a town does.",
      ),
    ],
  },
  {
    id: "saving",
    title: "Saving your game",
    blocks: [
      p(
        "The game menu (☰, top right) saves your run. The game pauses while the menu is open. There are two ways to keep a run:",
      ),
      list([
        "In this browser: give the save a name and save it; it appears under Load game on the start screen. You can overwrite a save with the current state, or delete it. These saves live in this browser on this device only — clearing the browser's site data deletes them.",
        "As a save string: the whole run as a block of text, to copy or download as a file and keep anywhere. Paste it, or open the file, under Load game on the start screen — on any device.",
      ]),
      p(
        "Every time you close a Year in Review, the game also saves itself to an autosave, which the next one replaces. The start screen's Continue picks up the latest save in this browser in one click.",
      ),
      p(
        "If something in the game breaks, it pauses and offers to save your run — in this browser as “Before the crash”, and as a file — so you can reload and carry on from there. The Feedback button (top right, and in the game menu) sends a report: a few words of yours, where you were in the game, and, if you like, your save, so the problem can be seen exactly as you saw it.",
      ),
      p(
        "A loaded game picks up exactly where it was saved, paused: the same town, the same households and their pending decisions, the same accounts, votes, letters and paper.",
      ),
      note(
        "For now a save only loads into the version of the game that made it (the version is shown in the game menu and on the start screen). A save from another version is listed but can't be loaded.",
      ),
    ],
  },
  {
    id: "controls",
    title: "Keyboard controls",
    blocks: [
      list([
        "Space — pause or resume (at the speed you paused from).",
        "Tab — the next speed (Slow → Medium → Fast, then Slow again); while paused, resumes at the next speed.",
        "1 / 2 / 3 — Slow, Medium or Fast.",
        "W A S D — move the map, relative to the way you're facing.",
        "Q / E — turn the view left or right.",
        "R / F — tilt the view toward the horizon or toward straight down.",
        "Esc — close whatever is on top: the Year in Review, the game menu, the wiki, the inbox or the Town hall, a charger you're placing, a home (back to its building), a building, a selected charger, and finally the map layer (back to the plain map).",
      ]),
      note("The time keys work everywhere except over the Year in Review; the map keys only on the map. None of them do anything while you're typing in a text field."),
    ],
  },
  {
    id: "map-layers",
    title: "Map layers",
    blocks: [
      p(
        "The dock on the left of the map has two kinds of layer. Views only colour the map, to show how things are; their legend sits in the map's lower left. Planning tools are where you act on the map: each opens a drawer beside the dock with its figures, its orders and its legend. Picking the open tool again closes it. The arrows at the foot of the dock fold it to a row of icons if you want more map.",
      ),
      p("Views:"),
      list([
        "Plain map — just the buildings.",
        "Building type — homes only, homes with other uses, no homes, or special buildings.",
        "Age — when each building was built; buildings built during the game stand out.",
        "Insulation — each building's energy class (see \"Insulation & energy classes\").",
        "Heating — what heats each building, updated as systems are replaced.",
        "Ground heat — where a ground-source heat pump could go, over the canton's map of what the ground allows (see \"Where a heat pump may go\").",
        "Power draw — what each building draws from the grid right now, or feeds into it from its solar panels.",
        "Solar — how much solar each building carries, updated as panels go up.",
      ]),
      p("Planning tools:"),
      list([
        "District heating — who is connected, who could be, the pipes and the heat sources; extend the network and add heat sources here (see \"District heating network\" and \"Heat for district heating\").",
        "EV charging — where households could charge an electric car, and every public charger by how full it is; build chargers here (see \"Public charging\").",
        "Grid — the transformer areas and how loaded they are; reinforce them or add batteries here (see \"The electricity grid\").",
        "Zoning — the zoning plan, parcel by parcel; change it here (see \"Zoning\").",
        "Public buildings — the municipality's own buildings and what they carry; order solar and chargers for them here (see \"Public buildings\").",
        "Roof solar — large roofs by where a roof contract stands; rent them and put the utility's solar on them here (see \"Roof contracts\").",
      ]),
    ],
  },
  {
    id: "time",
    title: "Time, weather & sun",
    blocks: [
      p(
        "The clock starts at today's date and runs forward. Pick a speed in the top bar: Slow (a minute a second — watch lights and appliances switch on and off), Medium (an hour a second) or Fast (a day a second). The speed only changes how fast you see things happen, never what happens.",
      ),
      p(
        "The sun follows its real path for the town's latitude, through the day and the seasons. The weather follows the season, with warm, cold, cloudy, rainy or snowy spells that last a few days. Hover over the weather in the top bar for whether it is day or night and how strong the sunshine is.",
      ),
      p(
        "The weather matters: cold days drive up heating, and with it the evening peak on the grid; sunshine drives the solar panels; snow on panels stops them until it melts.",
      ),
      note("When a new year begins, the clock pauses by itself and the Year in Review opens, so a long fast-forward never skips past it."),
    ],
  },
  {
    id: "year-in-review",
    title: "Year in Review",
    blocks: [
      p(
        "When a year ends, the game pauses and the Year in Review opens — the town's annual report for the year just gone. Across the top: the year's CO₂, the treasury at year end, approval and how it moved, and the years left until 2050. Below:",
      ),
      list([
        "Emissions: the year's CO₂ by source, against the first year (see \"Emissions & net zero\").",
        "Money: the year's accounts — income and spending line by line, largest first, and the net result (see \"Municipal finances\").",
        "Headlines: the local paper's lead story of each month.",
        "Electricity used: what the town used it for.",
        "Heat delivered: how much heat each kind of system delivered, for space heating and hot water.",
        "What changed: every heating replacement of the year — “14× Oil boiler → Ground heat pump”, marked ‘like for like’ where nothing changed — insulation upgrades, new solar and batteries, and buildings completed or torn down.",
      ]),
      note(
        "The heating figures count every fuel, so they don’t add up with the electricity figures. Closing the report doesn't restart the clock: pick a speed when you're ready.",
      ),
    ],
  },

  // --- Governing ---------------------------------------------------------------------------
  {
    id: "measures",
    title: "Measures",
    blocks: [
      p(
        "Town hall → Measures lists everything the municipality can enact, in four kinds: subsidies (money for households and owners that act), infrastructure (things the municipality builds itself), information (campaigns and advice that help people decide), and laws (bans, mandates and standards). They are grouped by topic — heating, buildings and solar, mobility, grid and power, advice and campaigns, carbon removal — and the kinds narrow the list further; ‘Enacted or on the way’ shows only your own.",
      ),
      p(
        "Each card says where a measure stands and how it is doing, or how people would take it. Click it for its options, its costs, what is known about its effect, and the button to enact, change or repeal it.",
      ),
      list([
        "Lead time: nothing happens the day you decide. A subsidy takes a month or two to set up; a law can take one to three years. Changing a measure starts a new lead time, and the old settings stay in force until then. Repealing is immediate.",
        "Cost: a subsidy costs money only when someone actually takes it up; a campaign costs a little every month it runs; infrastructure costs what it costs when it is built.",
        "Subsidies buy speed: a grant tips owners who were undecided, and brings replacements forward (see \"Switching early\"). But it is also paid to everyone who would have acted anyway.",
        "Laws are cheap, but act only when something is replaced anyway — and they can be voted down. A strict standard can even backfire: a demanding minimum for renovations puts off owners who would have done a smaller upgrade.",
        "Information measures help people judge their options more sharply, so they act on clear savings and stop chasing marginal ones.",
        "Mobility measures act slowly: a bicycle network, better public transport or parking management shift a little of how people get around each time a household rethinks it. The car always keeps a share.",
        "Green power cuts the emissions of the electricity the town uses; a climate campaign nudges households a little toward the greener option when it's a close call. District heating is made clean by building clean heat sources, not by a measure (see \"Heat for district heating\").",
      ]),
      p(
        "The canton and the Confederation act on their own schedule too: a ban on new fossil heating, an end to new petrol and diesel car sales, a renovation standard. Many cantons already require a renewable system when a fossil heating system is replaced (canton Zurich since 2022), so on Easy and Normal the canton's rule is in force from the start; Hard imagines it arriving later. You have no say and pay nothing, but they change what people decide. Each is announced years ahead — the Town hall's Overview shows what is coming — so you can plan around it rather than duplicate it.",
      ),
      note(
        "The difficulty you chose sets how early the canton and the Confederation act: earlier on Easy, later or not at all on Hard. A solar or battery measure counts from the month after it takes effect.",
      ),
    ],
  },
  {
    id: "approval",
    title: "Public approval",
    blocks: [
      p(
        "Everything you decide is judged by the people who live in the town. Approval is one number, in the top bar, but behind it are groups who feel differently: homeowners, tenants, drivers and commuters, businesses, and climate-minded residents. A heat pump grant pleases homeowners; a ban on petrol cars angers drivers. Nobody tells you exactly who thinks what — you learn it from how the number moves, from the expected reaction shown on each measure, from letters, and from opinion surveys.",
      ),
      list([
        "Decisions land at once: enacting a measure moves opinion straight away, in proportion to how each group feels about it. Repealing gives most of that back, but looks indecisive.",
        "Then opinion settles: while a measure is in force, each group drifts toward a level set by everything in force. Popular measures add up less and less, and people take what they like for granted — goodwill fades to about half over the years, while resentment stays. With nothing contentious in force, every group rests at a modest 55.",
        "Votes: the big bans always go to a public vote, and other laws do when they are contested. Beforehand, polls show where support stands (polls can be wrong). On the day, the town clerk writes to you with the result, and the measure shows it. If the voters reject a measure, it is struck down — money already spent stays spent — approval takes a hit, and you can't put it forward again for two years. If they back you, it gets a small boost.",
        "Spending: taxpayers accept about what the energy department takes in each year — the government's allocation, plus its share of the utility's profit last year (running spending only; investments don't count). Spend well beyond it and every group grows resentful, taxpayers and businesses most. Grants that mostly pay people who would have acted anyway are the usual way to overspend.",
        "Consequences: approval below 25% for six months gets you recalled, and every four years (the first in 2030) there is an election: below 50% on election day, the voters choose someone else. Either ends the game. Elections are announced: the Overview shows when the next one is, and the paper follows the mood. Approval also nudges the government's yearly allocation up or down a little.",
      ]),
      note(
        "Approval reacts to what you decide, not to how things turn out: nobody thanks you for falling emissions. Prices are the exception — people judge the tariff you publish, and keep judging it while it is in force (see \"Tariffs & energy prices\"). Measures imposed by the canton or the Confederation cost you nothing. The difficulty sets how strongly opinion moves.",
      ),
    ],
  },
  {
    id: "information",
    title: "What you know — and what it takes to find out",
    blocks: [
      p(
        "The town itself is open to you: every building and home, its appliances, its bills, what it heats with and when that changed, every charger and how full it is, and the town-wide figures in Town hall → Statistics and the Year in Review. What isn't open is why things happen — the part a real municipality has to work out.",
      ),
      list([
        "How much a subsidy changes: each subsidy shows its uptake — how many took it, and what it cost. But many of them would have done the same without the money. An evaluation study (in the subsidy's details) estimates how many it actually changed, over the last three years: it takes a few months, costs money, and gives its answer with a margin of error, as a real study would.",
        "What people think: approval is one number. How each group feels takes an opinion survey (Town hall → Overview) — a snapshot as of its fieldwork, a few points either way, and it ages.",
        "Why someone chose what they did: building and home panels say what happened and, briefly, why. The options each owner weighed, what they cost and how the owner leaned are in the decision log — open only in transparency mode, which you choose when you start a game.",
      ]),
      note(
        "Studies measure the real thing: for every subsidy paid, the game knows whether that household would have chosen the same without it. A study samples those decisions, with its margin of error; transparency mode lets you see them all.",
      ),
    ],
  },
  {
    id: "letters",
    title: "Letters & the local paper",
    blocks: [
      p("The town writes to you. Letters arrive in the inbox (top right); a short notice pops up when one comes in, and the game keeps running."),
      list([
        "Reactions: a decision a group feels strongly about brings a letter within days — thanks or objections — and a measure going to a public vote brings letters from both camps.",
        "Moods: now and then a group writes about how it feels, more often the further it is from content, naming what weighs on it most (a measure, or the department's spending). The tone is a fair hint at its mood; an opinion survey is the precise tool.",
        "Reports: what goes wrong in town reaches the town hall — a heat pump refused (by the grid, the ground or the neighbours' quiet), new boilers allowed despite a fossil ban, households with nowhere to charge. Reports inform; they don't move approval themselves.",
        "Requests (📌): now and then someone asks for something concrete, by a deadline — public chargers near a street, district heating along a street next to the network, a reinforced transformer station, solar on a public building, or a measure their group wants. Answer in time and the group gains goodwill (a few approval points, fading over time); let it lapse and it loses a little. If someone else solves it — a private charging operator, an owner's own panels — the problem is gone but nobody thanks you. The Requests tab lists them all with their deadlines; letters about a place can show it on the map.",
      ]),
      p(
        "At the start of every month, the local paper reports on the month before: a lead story and a handful of headlines — votes and elections first, then decisions, the grid's readings, what was built, installed or refused, requests answered or ignored, milestones. It leans with the public mood: supportive when approval is high, critical when it is low. The Year in Review lists the year's lead stories.",
      ),
      note("The senders and organisations are invented; they stand for the kinds of people and groups a town hears from."),
    ],
  },
  {
    id: "emissions",
    title: "Emissions & net zero",
    blocks: [
      p(
        "The goal is net zero by 2050. At the end of each year the town's CO₂ is added up from five sources, less any carbon removed, and compared with the first year of the game — the baseline every later year is measured against.",
      ),
      list([
        "Electricity: what the town draws from the grid, less the solar it feeds back, times how clean Swiss electricity is that year. The national grid gets cleaner over the decades whatever you do; your levers are how much the town draws, and green power as the default for its customers.",
        "Gas and oil heating: the fuel actually burned for heating. Every boiler replaced by a heat pump or district heat takes its share away.",
        "District heating: the oil and gas its boilers burn, and the electricity its heat pumps use (see \"Heat for district heating\"). Wood and waste heat count as clean.",
        "Transport: the petrol and diesel burned by households' cars and businesses' vans and lorries. Public transport, cycling and walking count as zero.",
      ]),
      p(
        "Some emissions can't be avoided within a town's reach: the national grid is still not clean in 2050, a few buildings have no alternative to their boiler, and old cars and lorries run on for years. As in Swiss climate law, that rest is balanced with carbon removal — CO₂ taken back out of the air by biochar, direct air capture or capture at a waste-to-energy plant. The ‘Carbon removal contracts’ measure buys them, but only for that rest: removals count once the town's own emissions are down to a fifth of what they were at the start. From then on the contract buys each year for whatever is left, up to the share you choose. Before that it costs nothing — the first four fifths have to be cut. They are paid each January for the year before, at the price of the day: around CHF 450 a tonne today, about CHF 200 by 2050.",
      ),
      p(
        "Net zero is reached in the first year whose emissions, less removals, come to nothing — and reaching it by 2050 is winning the game (see \"Score & the end of the game\").",
      ),
      note(
        "Only what is burned or drawn from the grid counts — not what it took to make a heat pump, a battery or a building. Removal prices are estimates; the technologies are young.",
      ),
    ],
  },
  {
    id: "score",
    title: "Score & the end of the game",
    blocks: [
      p(
        "Every year from the second on scores points: its cut in emissions per resident — net of carbon removal — against the first year, in percent. A year 40% below the start scores 40; a year above it scores below zero. The score is the sum through 2050. So an early cut counts in every year after it, and towns of any size compare, since it is measured per resident.",
      ),
      list([
        "Par: what the town would score if you did nothing at all — the grid getting cleaner, things wearing out and being replaced, technology getting cheaper. The top bar, the Overview and the Year in Review show your score against par so far: that difference is what your decisions did.",
        "Winning: reach net zero by 2050. The Year in Review marks the year it happens; every year after it scores in full as long as it holds.",
        "Finishing early: when a year closes at net zero, its Year in Review offers to finish the run there. The years left until 2050 then count in full, 100 points each, and the score is final. Or keep playing: every year still scores what it achieves, and each later year-end at net zero offers the finish again.",
        "Books in order: you can only finish early if the net zero looks set to last — the department not under the canton's supervision, not in overdraft, and owing no more than three years of its income (what lenders rate A or better; see \"Borrowing & debt\"). A net zero reached on borrowed money has to show it holds while the debt comes down: play on, and each year at net zero still scores in full.",
        "Losing: below 50% approval on election day, or below 25% for six months on end (see \"Public approval\"). The score so far stands; the years you didn't get to score nothing.",
        "The end: after the Year in Review of 2050, or when you finish early, the run is over, and you see how it went — the score, par, the year of net zero, and the cut year by year. You can keep exploring the town afterwards; nothing more is scored, and the voters can no longer end it.",
      ]),
      note(
        "Par is worked out for each town and difficulty with the game itself, for games that start in the same year. Where there isn't one, the score is shown on its own.",
      ),
    ],
  },

  // --- Money -------------------------------------------------------------------------------
  {
    id: "municipal-finances",
    title: "Municipal finances",
    blocks: [
      p(
        "The energy department has one treasury, shown in the top bar; click it for the accounts. Money comes in from three places: a yearly allocation from the municipality's general budget (paid a twelfth at the start of each month, sized by the population), the department's share of what its electricity utility earns, and smaller items — sales at its own public chargers, the zoning levy, and money it borrows (see \"Borrowing & debt\").",
      ),
      p(
        "Money goes out only when something actually happens: the day a household installs a subsidised heat pump, buys a subsidised electric car, insulates or puts up panels, the municipal grant is paid. A grant nobody takes up costs nothing — but it is also paid to everyone who would have done the same anyway. Finding the level that tips the undecided without overpaying the rest is the art of subsidy planning.",
      ),
      p(
        "Building things — district heating pipes, public chargers, grid reinforcement, a zoning change — is paid the day it is ordered. Campaigns and programmes cost a little every month.",
      ),
      p(
        "The utility settles each month once it is over: what customers paid for electricity and district heat, less the power it bought, the cost of making district heat (fuel, the heat pumps' power, heat bought from incinerators), the solar it paid for, and the upkeep of the grid, the pipes, the heat plants and the chargers. Like Swiss municipal utilities, it hands three quarters of its profit to the town's general account; your department keeps a quarter. A loss stays with the department. Each month's share reaches the treasury a few days after the month ends; the year's accounts are closed on 31 December. You set the utility's prices in Town hall → Prices, once a year; what it pays for power follows the market (see \"Tariffs & energy prices\").",
      ),
      note(
        "Federal and cantonal grants — the ones every heat pump, solar system and renovation already gets — aren't municipal money; only your own top-up is. Gas, oil and petrol are bought from outside suppliers, never through the utility. The department's share of the utility profit (about CHF 1.4 million a year at the starting prices) and the allocation (about CHF 3.3 million) are small next to a serious subsidy programme, so what you fund matters.",
      ),
    ],
  },
  {
    id: "borrowing",
    title: "Borrowing & debt",
    blocks: [
      p(
        "Like a Swiss municipality's accounts, spending comes in two kinds. Investments — grid reinforcement and batteries, district heating pipes and heat plants, public chargers, solar on public buildings — build something that lasts: they may be paid with borrowed money, and they don't count toward the overspending taxpayers resent. Running spending — subsidies, campaigns, programmes, studies, zoning plans and interest — should be covered by income.",
      ),
      list([
        "Bank loans: an amount and a term of 5, 10 or 20 years, repaid in equal monthly instalments (Town hall → Treasury → Borrowing). The rate is the market rate plus a margin for the department's credit rating, fixed for the life of the loan; longer loans cost a little more. Loans can be repaid early.",
        "The overdraft: if the balance falls below zero, it is covered automatically — at a steep premium, charged every month.",
        "Green bonds: sold to the town's own residents for ten years, with interest every year and the money repaid at the end. Residents accept a little less interest for a local green cause, and buy as much as they want — a couple of hundred francs each at most, more when the climate-minded are content, so a bond may raise less than offered. They only hold so much of the town's green bonds at once: until earlier ones are repaid, each new one raises less. Offering one goes down well. The money is earmarked: within two years as much has to go into green investment, or the paper calls it greenwashing and the climate-minded turn away. At most one a year.",
        "Federal decarbonisation loans: 0.25% over 20 years, but only against decarbonisation investments already made — up to half of the last twelve months' — and only so much a year; the money arrives after three months.",
      ]),
      p(
        "The market rate starts near today's (about 1.2%) and drifts over the years, with the occasional jump nobody sees coming. Borrowing when money is cheap pays off. Debt is measured in years of income: the more years it would take to repay, the lower the rating and the dearer new money. Lenders are quick to downgrade and slow to forgive: the rating falls as soon as debt rises, but climbs back only a notch at a time, each once debt has stayed low enough for a year. From about a year and a half of income, homeowners and businesses start to worry. Beyond five years, the canton puts the department under supervision: no new borrowing, no new spending measures and no new orders until debt is back under four years — measures already in force run on, and laws and prices stay yours.",
      ),
      note(
        "The federal loan programme is invented for the game; the real federal climate programmes are mostly grants. The treasury shows cash: what you build isn't written down in value over the years.",
      ),
    ],
  },
  {
    id: "tariff",
    title: "Tariffs & energy prices",
    blocks: [
      p(
        "Town hall → Prices is where the municipal utility’s tariff is set. Like a Swiss utility, you publish it once a year: next year’s tariff by the end of August, taking effect on 1 January. Until the deadline you can publish again. If you haven’t published one when the deadline comes, the game stops and asks: keep this year’s prices, or set new ones there and then. In your first year you have until the end of December.",
      ),
      list([
        "Electricity: a day rate and a cheaper night rate (21:00–06:00). Households who can wait — about a third of electric car owners — charge their car at night.",
        "Solar feed-in: what panels earn for power fed back into the grid. A higher price makes solar pay for more owners — and costs the utility.",
        "District heating: what the network’s heat costs its customers, and earns the utility.",
        "Public charging: what the municipality’s own chargers charge — on-street, fast and at lorry charging parks. Private operators set their own (see \"Public charging\").",
        "Dynamic tariff: whether households may choose a price that follows the grid’s load through the day, and how far it swings (see \"The dynamic tariff\").",
      ]),
      p(
        "Before you publish, the page shows what a typical household would pay for its electricity in a year, against this year and against the Swiss average, and how people are likely to take it.",
      ),
      p(
        "People care about their bill (see \"Public approval\"). The day you publish, the change lands like any decision: a rise stings, a cut is welcomed. And for as long as a tariff is in force, people compare it with what households pay elsewhere in Switzerland: a dear tariff keeps weighing on approval, a cheap one helps a little — people resent paying too much more than they reward paying less. Tenants and homeowners mind most, businesses a little less, and homeowners also watch what their panels earn.",
      ),
      p(
        "What you can’t set are the energy markets: heating oil, gas, petrol and diesel, and the wholesale electricity the utility buys. They follow world prices, including the federal CO₂ levy on heating fuels, and drift slowly over the years — until now and then a supply crisis sends them soaring, easing again over a year or two. Nobody sees one coming. Dear fuel makes heat pumps and electric cars look better to anyone choosing at the time; dear wholesale power squeezes the utility’s profit, unless you pass it on — and the Swiss average rises with it, so people are more forgiving when everyone’s bill goes up.",
      ),
      p("The same page shows the market prices now and a year ago, and where technology prices are heading (see \"Technology prices over time\")."),
      note(
        "A decision is made at the prices of its day and never revisited: a change only affects the decisions that follow. The grid’s upkeep per kWh is a fixed cost of the utility, not something you set. People judge the tariff by its typical bill, not by what each of them actually pays.",
      ),
    ],
  },

  {
    id: "dynamic-tariff",
    title: "The dynamic tariff",
    blocks: [
      p(
        "Next to the time-of-use tariff you can offer a dynamic one (Town hall → Prices). Its price changes through the day by a rule fixed in advance: dearest when the town’s grid is expected to be busiest — the evening peak — and cheapest when it’s quiet: at night and, in summer, at midday when the panels are producing. Over a day it averages out to the time-of-use tariff; you choose how far it swings either side. The page shows a winter and a summer day of it before you publish.",
      ),
      p(
        "Nobody has to take it. On 1 January each household weighs what it would save against the bother of switching, and each building’s owner does the same for its heat pump, which has its own meter. The page estimates how many would sign up.",
      ),
      list([
        "Electric cars: the car charges itself in the cheapest hours of the night, full by morning. A household whose car charges as soon as it’s plugged in saves the most — this is who signs up first.",
        "Heat pumps: they run harder while power is cheap and ease off when it’s dear; the house holds the warmth. It pays most for large buildings.",
        "Washing machines: some loads are started by timer in the cheapest hour of the day.",
        "Everyone else: a household with nothing to shift pays about the same either way, so few bother.",
      ]),
      p(
        "What it does: load moves out of the evening peak into the night, which eases the grid where it’s tightest (see \"The electricity grid\"). What it costs: the utility earns less from the households who shift, since they buy when power is cheap. A wider swing moves more load and wins more households — and widens that gap. Each home’s panel says whether it is on the dynamic tariff.",
      ),
      note(
        "The price follows the expected load, not what the town actually draws. If very many cars charge in the same cheap hours, those hours get busy — the price won’t notice. Businesses stay on the time-of-use tariff.",
      ),
    ],
  },

  // --- How people decide -----------------------------------------------------------------
  {
    id: "stock-renewal",
    title: "When things wear out",
    blocks: [
      p(
        "Heating systems, cars, bikes and building envelopes don't last forever. Each wears out on its own schedule — a heating system after about 18–22 years on average, a car after about 14, a bike after 8–10 — some sooner, some later, so replacements trickle in every year rather than all at once. That is when the town changes: most owners only rethink what they have when it gives out.",
      ),
      p("When something wears out, its owner chooses what replaces it the way real owners do:"),
      list([
        "What is possible: district heating only if a pipe runs in the street (see \"District heating network\"), a heat pump only where the ground and the neighbours allow (see \"Where a heat pump may go\"), an electric car only with somewhere to charge (see \"Public charging\") — unless petrol and diesel cars are banned, when a household without a charger goes electric anyway and gets by with fast chargers and charging at work.",
        "What it costs over its life: the price less any grants, plus what it costs to run at the prices of the day.",
        "Whether it's worth the bother: owners stay with what they know unless something else is clearly better — a single house won't chase a small saving the way a large block's management might.",
        "Leaning: some owners lean green, some stick to what they know, and a close call can go either way. Information measures make owners judge more sharply; a climate campaign tips close calls a little.",
      ]),
      p(
        "Staying with the same kind of system is cheaper than switching: a first oil heating needs a tank and a chimney, a first gas heating a gas connection, a first ground heat pump its boreholes, a first district heating connection a pipe to the street. Once a building has one, it tends to keep it — so every switch you win lasts decades.",
      ),
      p(
        "Each building's panel keeps its heating history — what wore out, what replaced it and why, including when the obvious choice wasn't possible — and each home's panel the same for its cars and bikes.",
      ),
      note(
        "Laws act at this moment: a ban on new fossil heating changes only the next replacement, not the boilers already running. To speed things up, see \"Switching early\".",
      ),
    ],
  },
  {
    id: "early-switch",
    title: "Switching early",
    blocks: [
      p(
        "Most owners replace a boiler or a car only when it wears out. But now and then an owner with a working oil or gas boiler, or a petrol or diesel car, looks into switching early. They compare keeping it — its running costs, and repairs that grow as it ages — with switching now: the new one's price less grants, its running costs, and the hassle of replacing something that still works. Owners who are actively looking are more open than usual.",
      ),
      list([
        "Grants make owners likelier to look into it at all, and likelier to go through with it: a heat pump grant brings boiler replacements forward. That is what money buys — speed.",
        "The heat pump grant and the electric car grant can be targeted (‘Who gets it’, in the grant's details): paid to everyone, most of whom would have switched anyway, or only to owners who replace a working boiler or car early. Targeted, far fewer people get it — so it costs much less and is a little less popular — but almost every franc changes what someone does.",
        "Energy advice (the information measures) also gets more owners looking.",
        "Cars rarely switch early: a paid-off car only costs its fuel, so it takes a large scrappage bonus — and a charger within reach.",
      ]),
      note("Every early switch is shown on the building's or home's panel, like any replacement."),
    ],
  },
  {
    id: "technology-prices",
    title: "Technology prices over time",
    blocks: [
      p(
        "Prices don't stand still. Every price starts at today's, and from then on each technology drifts toward its own long-run level — fastest at first, then settling. Every decision is made at the prices of its day, so a boiler or car replaced in 2040 is chosen at 2040 prices.",
      ),
      list([
        "Getting cheaper: electric vehicles most of all, as batteries keep falling in price — an electric lorry heads toward half today's price, an electric car or van toward about three quarters; public and depot chargers; rooftop solar (toward 70%); home and neighbourhood batteries (toward 70%); heat pumps less, since installation is much of their price (air heat pumps toward 80%, ground ones toward 88%).",
        "Getting dearer: petrol and diesel vehicles and gas and oil boilers creep up, and so does building work — insulation and district heating pipes — with construction costs.",
        "Cheaper panels also bring more owners to consider solar at all.",
      ]),
      p(
        "Town hall → Prices shows each technology's price now against the start, and where it is heading ten years out. Grants stay the amounts you set, so as a technology gets cheaper the same grant covers more of it — and a grant that tipped decisions early on may end up paying people who would have switched anyway.",
      ),
      note(
        "These are plausible paths, not forecasts. Only prices change: efficiencies stay as they are (except solar panels, which keep improving), and fuel and electricity prices are yours to set.",
      ),
    ],
  },

  // --- The town ------------------------------------------------------------------------------
  {
    id: "buildings",
    title: "The buildings",
    blocks: [
      p(
        "Every building on the map is real: its place, outline, address, age, floors, use, homes and heating come from the federal building and dwelling register (GWR). Only buildings standing today are included. A building's panel is titled with its address.",
      ),
      p(
        "What a building is used for decides what runs in it: homes get households with their appliances, cars and bikes; shops, offices, schools and factories get a business's energy use (see \"Businesses & industry\"); and many buildings have both — shops on the ground floor, flats above.",
      ),
      note("A few small structures, such as bus shelters, are left out because there is no outline to draw them with."),
    ],
  },
  {
    id: "growth",
    title: "Town growth & renewal",
    blocks: [
      p(
        "The town doesn't stand still. Old buildings are replaced and new ones built, at the pace the municipality really built at over the last fifteen years, according to the building register.",
      ),
      p(
        "Replacement: a building is safe for its first 30 years; after that, its chance of being replaced rises every year. Neighbours built in the same year often go with it — a housing estate is usually one project. A replacement keeps the address and the footprint but holds 20–30% more homes, with extra floors where needed (never towering over its surroundings).",
      ),
      p(
        "Growth: new buildings go up on vacant building land — zoned for building and still open; parks, sports fields, playgrounds, allotments and cemeteries stay free, as do clearances along roads, rail, forest and water. Each is sized and turned like the buildings around it. When the vacant land runs out, growth has to come from replacing old buildings with denser ones, and slows down. The zoning plan steers where and how much (see \"Zoning\").",
      ),
      list([
        "New buildings mostly get heat pumps — fossil heating isn't allowed in new buildings — and district heating where a pipe runs in the street.",
        "They are insulated to today's standard and carry at least the rooftop solar the building code requires, often the whole roof.",
        "Their heating, insulation and solar are decided when the permit is granted, under the rules of that day.",
        "Each project takes months to permit and one to two years to build. Meanwhile the site shows as an amber construction site and draws no power.",
      ]),
      note(
        "Building plots are fitted into the free space as simple rectangles, not real designs. Panels registered on a building that is torn down go with it.",
      ),
    ],
  },
  {
    id: "zoning",
    title: "Zoning",
    blocks: [
      p(
        "The zoning plan decides what may be built where, and how much — one of the municipality's strongest levers. The game starts with the town's real plan, parcel by parcel: residential, mixed, centre, work and public-use zones. Open the Zoning tool to see it, and click parcels to pick them, or pick every parcel of a zone at once.",
      ),
      list([
        "Rezoning a parcel to another use changes what gets built on its open land, and what its old buildings become when they are replaced: a factory in what is now a residential zone becomes flats — and comes up for replacement sooner, because it no longer fits. Public-use land stays as it is.",
        "Densifying (one or two floors more than the plan allows today) lets new and replacement buildings go higher and hold more homes, and makes replacing old buildings there pay sooner. You can take the extra floors back, too.",
        "A district heating priority zone allows no new oil or gas heating at all. A new building on a street with a district heating pipe must connect; one replacing its heating may still choose a heat pump. The District heating tool shows these zones too, so extensions can follow them.",
        "A high-standard zone requires new and replacement buildings to reach Minergie-P, with a full roof of solar panels.",
      ]),
      p(
        "Before you submit a change, the drawer shows what it would touch — the area, the buildings and homes, the open building land — what the planning costs, and how people are likely to take it. The change is paid when submitted and comes into force about eighteen months later, after the planning procedure. It is political: each group reacts at once (tenants welcome more homes, neighbours and homeowners dislike densification, businesses resent losing work zones, the climate-minded like energy zones and compact building), and a contested change — or any change covering 15% or more of the town's zoned land — goes to a public vote first, which can strike it down. On the map, a parcel with a change on the way is outlined in yellow, densified parcels are shaded stronger, and energy zones are striped.",
      ),
      p(
        "Zoning creates land value, and the municipality takes a share: a levy of 25% of the gain when a project's permit is granted — on the extra floor space densification allows, and on the rise in land value when a plot is rezoned to a more valuable use (work to residential, say). The rezoning gain belongs to the land, so it is levied once, with the plot's first project. It shows in the treasury as the zoning levy.",
      ),
      note(
        "Land values, planning costs and how strongly each group reacts are rough estimates. New building land outside today's zones isn't possible (federal law makes it rare), and new homes don't yet bring costs of their own — schools, roads — beyond their energy use.",
      ),
    ],
  },
  {
    id: "public-buildings",
    title: "Public buildings",
    blocks: [
      p(
        "The municipality owns buildings of its own — schools, sports halls and the like — and can lead by example on them. The Public buildings tool shows them all, coloured by what they carry: solar, chargers, both or neither. Its drawer lists them; click one, there or on the map, to see it and order for it. A public building's own panel has the same orders.",
      ),
      list([
        "Solar: the full usable roof, ordered directly, paid by the treasury (less the federal payment every installation gets) and generating a few months later. Or automatically, a few buildings a year, with the ‘Solar on public buildings’ measure.",
        "Chargers: a public charging site in the building's car park, with 4, 8 or 12 points, ordered directly. Or automatically with the ‘Chargers at public buildings’ measure, which starts where most households nearby are missing a charger. Either way they are municipal chargers like any other (see \"Public charging\").",
        "Once every public building has what a programme provides, the measure has nothing left to do: it is greyed out, and one already in force winds up by itself — without the approval cost of a repeal, and any vote on it is called off.",
      ]),
      note("The register doesn't say who owns a building, so every public-use building counts as the municipality's — churches and the hospital included."),
    ],
  },
  {
    id: "commercial",
    title: "Businesses & industry",
    blocks: [
      p(
        "Shops, offices, schools, churches, sports halls, hospitals and factories use energy on their own rhythm — office hours, long shop hours, a church quiet except on Sunday morning, a hospital around the clock — in proportion to their floor area. Business use is usually the biggest share of the town's electricity.",
      ),
      note(
        "Factories are the least predictable: their real shifts aren't public, so they run long hours with some days busier than others. Garages, storage, farm buildings and buildings the register doesn't describe use no business energy at all.",
      ),
    ],
  },

  // --- Heating -----------------------------------------------------------------------------------
  {
    id: "climate-control",
    title: "Heating & cooling",
    blocks: [
      p(
        "How much heat a building needs depends on the cold outside, the size of its walls and roof, and how well they are insulated — an old stone house loses heat several times faster than a new one (see \"Insulation & energy classes\"). People and equipment inside give off some warmth for free.",
      ),
      p(
        "What delivers the heat matters. A heat pump runs on electricity, and needs less of it the milder the weather: an air heat pump works hardest on the coldest days, while a ground-source one hardly notices, as the ground stays around 10°C all year. Oil and gas boilers burn fuel; district heat arrives ready to use. What heats each building at the start is what the register records; it changes as systems are replaced (see \"When things wear out\").",
      ),
      p(
        "Air conditioning is still rare in Switzerland but growing; newer and larger buildings are likelier to have it. Heating and cooling follow the day's average temperature, so one cold hour in a mild week doesn't switch the heating on.",
      ),
    ],
  },
  {
    id: "water-heating",
    title: "Hot water",
    blocks: [
      p(
        "Where the register records electric hot water — an electric boiler or a heat pump — each home draws power for its morning and evening showers, about 2.5–4 kWh a day. A building that gets a heat pump for its heating gets its hot water from it too.",
      ),
      note("Hot water from a heat pump is counted like hot water from a plain electric boiler, so the heat pump's saving there doesn't show."),
    ],
  },
  {
    id: "insulation",
    title: "Insulation & energy classes",
    blocks: [
      p(
        "How much heat a building loses depends on its envelope — walls, windows, roof. Every building has an energy class from it: Unrenovated, Partly insulated, Current standard, Minergie or Minergie-P. Existing buildings start in the class their age suggests; a new building gets the class the rules of its permit require. The Insulation view colours buildings by class.",
      ),
      p(
        "Every few decades an owner reconsiders the envelope. Like a heating replacement, it's a cost-benefit choice: the work beyond the maintenance that is due anyway, less the federal building programme grant and any municipal top-up, against what heating would cost afterwards with the building's own heating system at today's prices. An upgrade to a better class lowers the building's heat demand for good.",
      ),
      note(
        "Because the payoff is lower heating bills, insulating pays off on an oil- or gas-heated house and much less on one already heated by a heat pump — cheap heat makes insulation a poorer investment.",
      ),
    ],
  },
  {
    id: "heat-pump-siting",
    title: "Where a heat pump may go",
    blocks: [
      p(
        "Not every building can have every heat pump. Two things decide it, both public, so every building's panel shows them under its heating (‘For a new heat pump’).",
      ),
      list([
        "The ground. The canton maps where heat may be taken from the ground. In a groundwater protection zone around a drinking-water well, nothing may be taken. Over a gravel aquifer that could supply drinking water — often much of a valley floor — no boreholes may be drilled; groundwater may be used instead, but only by large systems (from about 190 kW of heating: a large building, or several together), with wells, a water-rights concession and a yearly fee. Elsewhere boreholes are allowed, in some areas with conditions (casing, depth limits) that make them about 15% dearer. Boreholes also keep clear of tunnels.",
        "Noise. An air heat pump's outdoor unit must stay under the night limit at the neighbours' windows — 45 dB in residential zones, 50 dB in mixed, centre and work zones. What counts is how loud the unit is (bigger buildings need bigger, louder ones), how close the neighbours are and how sensitive the zone is. Anything over the limit has to come off: a quieter model and a careful spot (up to 5 dB, about CHF 2,500 on a house), a sound hood (up to 10 dB, about CHF 7,000), or the unit indoors with air ducts (up to 20 dB, about CHF 20,000 in an existing building, little in a new one). Beyond that, an air heat pump isn't permitted. Units get a little quieter over the years.",
      ]),
      p(
        "Both shape every heating decision: an option the site rules out isn't on offer, and noise measures and borehole conditions add to the price. A building replacing a heat pump with its like keeps its boreholes or wells and its permitted spot. Rezoning a residential parcel to a mixed or work zone allows 5 dB more; densifying brings neighbours closer. The Ground heat view shows the canton's map, and what it means for each building.",
      ),
      p(
        "If a fossil heating ban is in force — the canton's, or a district heating priority zone — and nothing else is possible (no heat pump fits, because of the ground, the noise or a full grid, and no district heating reaches the building), the owner may install a new gas or oil heating as an exception, as cantonal energy law allows. The building's heating history says so. Bringing district heating to such streets, or room on the grid, is the way out.",
      ),
      note(
        "The distance to the neighbours is judged from the nearest buildings with homes or workplaces, not from a real site plan. The ground map comes from canton Zurich's heat-use atlas; where there is no such map, the ground restricts nothing.",
      ),
    ],
  },
  {
    id: "district-heat",
    title: "District heating network",
    blocks: [
      p(
        "District heat reaches a building through pipes under its street, so a building can switch to it only if a street it borders is piped (a corner building has two chances) and those pipes lead to a heat source in service. It still has to want to: owners connect when their heating is next replaced, if district heat is the better deal, and new buildings when they are permitted. Once connected, a building stays: a first connection costs around CHF 22,000 for a house, while renewing a connected building's substation costs around CHF 9,000. Every network in the game runs hot enough for radiators and hot water, so a connected building needs nothing else.",
      ),
      p(
        "A town starts with the networks it really has — their plants, what they run on and how big they are, as their operators report them. Some run on wood or waste heat with an oil boiler for the coldest days; some on oil or gas alone. Whatever pipes hang together form one network: when two meet, they share their heat sources. The municipal utility runs them all: it sells the heat at the district heating price (Town hall → Prices), pays for making it and for the upkeep of the pipes and plants, so a network full of customers earns money while a long pipe past few buildings costs it.",
      ),
      p(
        "Every network has boilers for whatever its clean sources can't deliver, so a network never runs out of heat — only out of clean heat. On a cold day the clean sources run flat out and the boilers make up the rest, burning oil (or gas). Each network's card in the District heating tool shows its clean sources against its winter peak. A source sized at half the peak already covers most of the year's heat, since the coldest days are few; covering the whole peak keeps the boilers cold. See \"Heat for district heating\" for adding sources.",
      ),
      p(
        "To extend the pipes, open the District heating tool and click streets: each click picks one stretch between two junctions (click again to drop it), and the buildings it would newly reach light up in orange. An extension must connect to the network or a heat source, directly or through the other streets you picked; a picked street that doesn't shows in red until the gap is closed. Every street the network could run along is shaded grey. The drawer shows the extension's length, cost and build time, and how much heat the buildings it reaches use a year — in total and per metre of pipe, the figure planners judge an extension by. Ordering pays the whole cost at once; the pipes are laid over the following months, and buildings along them can connect as soon as they are done.",
      ),
      p(
        "The drawer also shows how much of the town's heated building stock the networks serve and could serve — by number of buildings, floor area and heat demand — and how much of last year's district heat came from clean sources.",
      ),
      note(
        "Where the pipes run today isn't public, so the starting networks are reconstructed from the buildings the register records as district-heated, each joined to the nearest registered plant along the streets — plausible, not exact. Where a plant didn't report its size, it is taken as half again the winter peak of the buildings connected at the start; a clean source with a fossil boiler beside it is taken to carry a little over half. Garages, sheds and buildings heated by wood never connect and show in pale grey. Costs are estimates: CHF 2,000 per metre of street (half again more on main roads), CHF 10 per metre a year in upkeep, and a tenth of the heat lost on the way.",
      ),
    ],
  },
  {
    id: "district-heat-sources",
    title: "Heat for district heating",
    blocks: [
      p(
        "New heat sources are ordered in the District heating tool, under New heat. Each feeds in at the street junction nearest to it: if the pipes don't reach there, extend them to it — or build a new network from it, street by street. A town with no district heating at all starts that way. A plant takes one to two years to build, longer with a trunk line, and is paid when ordered. Where the size is yours to choose, bigger plants cost less per MW.",
      ),
      list([
        "Incinerator waste heat. A waste incineration plant within reach can sell the town some of its heat — what it doesn't already deliver or turn into electricity. A heat exchanger station, and a trunk line if the plant stands outside the town; the heat is bought per kWh, cheaply.",
        "Industrial waste heat. Now and then a factory writes to offer the heat its processes throw away — cooling water, exhaust. Its size is what the factory has; the utility pays for the connection, then a fixed sum a year. The offers stay open, and show on the map.",
        "Waste water. A treatment plant's cleaned water stays at 10–20 °C all year: a heat pump on it gives cheap, steady heat. The plant is public, so there is nothing to pay for the heat itself — only the heat pump, its power, and a trunk line if the plant is outside the town. How much it can give depends on the plant.",
        "Groundwater. A heat pump on wells into the aquifer, anywhere the canton allows groundwater use (shaded on the map while you place it) — but not in the protection zones around drinking-water wells. A few MW at most per plant, and a yearly water-rights fee.",
        "Rivers and lakes. A heat pump on a river or lake, standing no more than 100 m from the water. The water never runs out, so the size is yours.",
        "Wood. A wood chip combined heat and power plant, anywhere in the municipality: heat for the network and power for the grid. To stay renewable, new wood plants together may burn no more than the town's own forest grows — in many towns, not much. And its neighbours mind the lorries and the chimney: homeowners and tenants within 300 m hold it against you for as long as it runs, more the more homes are near.",
      ]),
      p(
        "Running costs differ: waste heat costs least to run, then the heat pumps (their electricity, at the market price), then wood (the chips, less the power it sells). A network uses its sources in that order, and the boilers last. Every source also has upkeep, whether it runs or not. Heat pumps count the emissions of the electricity they use; wood and waste heat count as clean, as in the national inventory; the boilers count their oil or gas.",
      ),
      note(
        "Where heat could come from is real: the incinerators, treatment plants and industrial heat demand are the federal energy office's, the aquifers the canton's, and the forest and the water the land survey's. Which factories offer their heat, and how much, is the game's guess from their branch. Sizes, prices and costs are estimates. Deep geothermal heat isn't in the game yet: in Switzerland it is still about a decade away.",
      ),
    ],
  },

  // --- Electricity & solar -------------------------------------------------------------------
  {
    id: "grid",
    title: "The electricity grid",
    blocks: [
      p(
        "Power reaches every building through the transformer station serving its neighbourhood, and each station can carry only so much. The cables run along the streets, so a building hangs off the station nearest to it by road — not necessarily the nearest as the crow flies — and an area follows its streets. Each area is served by a station of standard size with some headroom over the town's demand at the start.",
      ),
      p(
        "Twice a year the utility reads its meters: after the winter (the highest draw, on the coldest evenings when heat pumps, cooking and cars plugging in come together) and after the summer (the highest feed-in, on the sunniest middays when rooftop solar pushes power back up the line). The Grid tool colours every building by how loaded its station was at the last reading, marks the stations and outlines the area each one serves; pick a station or any building to highlight its area. The drawer ranks the areas and shows each one's peaks against its capacity.",
      ),
      p(
        "An area whose peak is over its station's capacity — either way — is overloaded, and new connections there wait until a reading shows room again:",
      ),
      list([
        "Over the winter peak: no new heat pumps, wallboxes or business depot chargers (replacing one keeps its connection). Households charge in public instead, if they can.",
        "Over the summer feed-in: a new solar array over 30 kWp connects only with a grid-friendly battery that keeps its feed-in to half its rating (see \"Home batteries\"). Household systems and what the building code requires still connect.",
        "New buildings are always connected.",
      ]),
      p(
        "After each reading the utility reinforces the worst overloaded area out of its upkeep budget — but demand outruns that. The rest is up to you, paid from the treasury: reinforcing an area (the next station size up, with its cables; ready after nine months) or adding a neighbourhood battery (250 kW, 500 kW or 1 MW, storing two hours; it covers its power of the peak either way, is ready after six months, and gets cheaper over the years).",
      ),
      p(
        "Reinforcing everywhere is expensive, so three measures buy time by shaving the peaks: heat pump load control lets the utility switch enrolled heat pumps off in turns at peak times (half of them off at any one moment, briefly, hardly noticed); a smart charging programme has electric cars charge at night rather than as soon as they are plugged in; and a solar feed-in limit caps what panels deliver at 70% (or less) of their rating, which costs little energy but shaves the sunny-midday peak. A battery subsidy tied to grid-friendly operation does the same for the systems it pays for. They slow overloading down; in the long run, reinforcement is the answer.",
      ),
      note(
        "Where the real stations stand isn't public, so they are placed from the buildings themselves, on the nearest street; their sizes and the costs are estimates. A new building joins its area's outline on the map with the next reading. The grid is checked at the two readings only — voltage and cables aren't modelled.",
      ),
    ],
  },
  {
    id: "solar",
    title: "Solar power",
    blocks: [
      p(
        "Every solar installation at the start is real, from the federal register, at its registered size. From there, more appear as owners decide to put panels up. Panels follow the sun through the day and the seasons, produce less under cloud, and stop under snow until it melts.",
      ),
      p(
        "Every year, each building without panels has a chance that its owner seriously considers them. That chance grows for a few years after the heating is replaced (a natural moment to think about the roof), the more neighbours already have panels, with the municipality's solar campaign, and as panels get cheaper (see \"Technology prices over time\"). Buildings over 200 years old are treated as protected and don't get panels.",
      ),
      p(
        "An owner who considers it compares a system covering the usable part of the roof with going without: its price (cheaper per kWp the bigger it is), less the federal payment every installation gets and any municipal subsidy, against the electricity it would save and what it earns feeding the rest into the grid at the feed-in price. Panels get more efficient over the years, so the same roof holds more later. A municipal subsidy is paid from the treasury the day a building installs.",
      ),
      note("A building puts up panels once; they last about as long as the game. Panels on a building that is torn down go with it."),
    ],
  },
  {
    id: "roof-contracts",
    title: "Roof contracts",
    blocks: [
      p(
        "Many large roofs stay bare even where panels would pay: the owner lacks the cash, the time, or the interest. The utility can step in — rent the roof and put its own solar on it, as many Swiss utilities do. Open the Roof solar tool: it shows every roof of a building over 300 m² by where it stands, and the drawer sets the rent you offer, per m² of roof the panels cover, a year.",
      ),
      list([
        "Offering: click a roof to see what an array there would mean — its size, what it costs to build, what a year of its output saves, the rent and the upkeep — and offer it, or offer every eligible roof at once (the drawer estimates how many would say yes, and what building their arrays would cost).",
        "The answer comes within weeks. Some owners take your letter as a prompt to look into solar themselves, and put up their own if it pays. The rest weigh your rent against what they want for their roof — which differs from owner to owner, most somewhere around CHF 1–4 per m². Offer more and more say yes; but every franc of rent comes out of what the array earns. A no means you can't ask again for three years.",
        "Building: once an owner accepts, you have a year to build — at once, if the drawer's box is ticked. You pay what the owner would have paid, less the federal payment every installation gets, as an investment you may borrow for. The panels are in service about four months later; in a full grid area a large array comes with a grid-friendly battery.",
        "Earning: the arrays are the utility's. It pays no feed-in for what they make; their power saves buying from the wider grid at the wholesale price. Against that it pays the rent and the arrays' upkeep, every year. Big roofs pay well; small ones barely cover their costs.",
      ]),
      note(
        "What each owner wants for their roof is the game's guess, as is how many look into solar of their own. Contracts run as long as the panels; owners never cancel them, and the arrays last the game.",
      ),
    ],
  },
  {
    id: "home-batteries",
    title: "Home batteries",
    blocks: [
      p(
        "Many new solar systems come with a battery, about 1 kWh per kWp of panels. It charges from the building's surplus in the day and covers its own use into the evening and night, as long as the charge lasts — so less goes up the line at midday and less is drawn at the evening peak, most of all in summer.",
      ),
      list([
        "Who has one: some existing systems, likelier the more recent they are. An owner installing solar weighs panels alone against panels with a battery: the battery earns the full electricity price on what it shifts into the evening rather than the lower feed-in price, but costs about CHF 9,000 for 10 kWh today (getting cheaper), and owners also value being less dependent on the grid. About half of new home systems come with one, and owners of systems without one now and then add one.",
        "Grid-friendly operation: the battery charges from the top of the midday peak, then tops up for the evening, and the system never feeds in more than half its rating — anything beyond that once the battery is full is lost. It is the condition for connecting an array over 30 kWp where the summer feed-in is over capacity (see \"The electricity grid\"), public buildings included, and it can be the condition of the municipality's battery subsidy.",
        "The home battery subsidy pays per kWh, for batteries bought with new panels or added to existing ones — tied to grid-friendly operation or not.",
        "With a solar feed-in limit in force, a battery saves some of what the limit would otherwise cut off.",
      ]),
      p("A building's panel shows its battery's size, whether it runs grid-friendly, and what it is doing right now; Town hall → Statistics counts them."),
      note("Bills don't count the energy a battery shifts; its value shows in the owner's decision to buy one, and its effect on the grid in the readings."),
    ],
  },

  // --- Getting around ----------------------------------------------------------------------------
  {
    id: "mobility",
    title: "Cars, bikes & getting around",
    blocks: [
      p(
        "Each home has one or two people with their own way of getting around — by car, by bike, or by public transport and on foot — and a car or bike can be electric or not.",
      ),
      p(
        "How people get around changes slowly. Every 5–10 years a life event — a new job, a child, a move — makes someone rethink it. The town starts with the Swiss average from the federal mobility survey (about 69% car, 11% bike and on foot, 20% public transport); the mobility measures — a bicycle network, better public transport, parking management — shift each such rethink a little.",
      ),
      p(
        "Separately, a car wears out after about 14 years and a bike after 8–10, and is replaced by the same kind. Whether the new one is electric is a real choice, made like a heating replacement (see \"When things wear out\"): the price less grants, the running costs (electricity against petrol, at the prices in Town hall → Prices), and how the owner leans. The electric share at the start is the town's real one, from the federal vehicle register.",
      ),
      p(
        "An electric car needs somewhere to charge. A home that can charge at home pays the household electricity price; one that can't — most flats — needs a public charger with room in reach, pays its price and puts up with the hassle. With no such charger, an electric car isn't an option for it (see \"Public charging\"). About a third of electric car owners wait for the night rate, if the car will still be charged by morning; a day's driving takes 6–16 kWh.",
      ),
      p("A home's panel shows how its people get around, and every change of car, bike or habit."),
      note("E-bikes use too little electricity to show, and an ordinary bike almost always wins over an e-bike on price."),
    ],
  },
  {
    id: "public-charging",
    title: "Public charging",
    blocks: [
      p(
        "Whether a home can charge at home — its own parking space, a wallbox allowed — is fixed: most house owners can, only about a third of flats can. The rest can run an electric car only with a public charger they can rely on in reach: an on-street charger within about 300 m (it charges overnight, so it must be a walk away), or a fast-charging hub within 1.5 km (a weekly errand). Without one, an electric car is ruled out when their car is next replaced.",
      ),
      p(
        "With one, the household weighs the electric car as always (see \"Cars, bikes & getting around\"), but its running cost is the charger's price plus the hassle of charging in public — more the further away the charger, and more as it fills up. An empty on-street charger next door makes an electric car about as good a deal as a petrol one, so where chargers are, and what they cost, tips many decisions.",
      ),
      list([
        "On-street chargers are cheap to build and to charge at, but serve only the streets around them, and a busy one means nights without a free spot.",
        "Fast-charging hubs cost ten times as much and charge more per kWh, but serve everyone within 1.5 km, hold far more vehicles per point, and being busy hardly matters. Where on-street chargers are full, people turn to a hub. Your own hubs charge what you set: cheap, they win over many households — and fill up.",
        "Lorry charging parks are for businesses' lorries and vans only: four or eight high-power bays with room for about four lorries each, serving the whole town. Only the municipality builds them. Around 30 Rp/kWh, they fill up; at 40, only lorries without a depot use them.",
        "Room: an on-street point serves about 3 cars that rely on it, a fast-charging point about 30. A van takes about two cars' room, a lorry about twenty. A vehicle stays with the charger it picked until it is replaced, and a full charger takes no new ones.",
      ]),
      p(
        "The town starts with its real public chargers, run privately. Private operators react every New Year: where people would have gone electric with an on-street charger close by but found none with room, they add points or open new on-street sites. They charge 45 Rp/kWh on-street and 55 Rp/kWh at fast chargers, and leave hubs to you.",
      ),
      p(
        "To build your own, open the EV charging tool, pick a kind and size, and click where it should go; it lands at the nearest street, and a blue circle shows who it would serve:",
      ),
      list([
        "On-street: 4 points for CHF 60,000, 8 for 100,000 or 12 for 135,000, ready in 4–6 months. It can be enlarged later, for the difference plus CHF 15,000, in three months.",
        "Fast-charging hub: 4 points for CHF 600,000 (12 months) or 8 for 1.05 million (14 months); enlarging costs the difference plus CHF 80,000.",
        "Lorry charging park: 4 bays for CHF 1.2 million (12 months) or 8 for 2.1 million (15 months); enlarging costs the difference plus CHF 150,000.",
      ]),
      p(
        "A charger is paid the day it is ordered; after that, the municipality earns what it sells and pays its upkeep. Building big from the start is cheaper, if the demand is there; build costs follow technology prices. Chargers at the municipality's own buildings are ordered in the Public buildings tool. The right-to-charge law obliges landlords to allow wallboxes, so some households who couldn't charge at home now can.",
      ),
      p(
        "The EV charging tool shows every charger from green (room to spare) to red (full), larger for more points: yours as circles, private ones as squares, with a black ring around a hub and a violet one around a lorry park. Buildings are coloured by what most of their households could do. The coverage toggles shade where on-street chargers, hubs or lorry parks reach, so the gaps stand out. The drawer shows how the town's households stand, how many wanted an electric car last year but had nowhere to charge, and for the charger you click: who runs it, its price, who relies on it, how busy it is and its use year by year.",
      ),
      note("Charging distances, how many cars a point serves, the hassle and the chargers' costs are estimates. Public charging isn't on a home's bill, and charging at work isn't part of the game."),
    ],
  },
  {
    id: "fleets",
    title: "Businesses' vans & lorries",
    blocks: [
      p(
        "Businesses run vans and lorries too. How many are registered in the town, and how many are electric, comes from the federal vehicle register where it is available (otherwise the Swiss average for a town of its size); they are spread over the buildings by floor area and use — warehouses, industry and workshops get the most, shops fewer, offices few. About one in eight is a lorry. A building's panel lists its vans and lorries, and where the electric ones charge.",
      ),
      p(
        "Each vehicle lasts about ten years and is replaced by the same kind of decision as a household's car, only more businesslike. An electric van costs more to buy but far less to run, above all when it charges overnight in its own yard at the night rate — once a charger is installed: a wallbox for a van (about CHF 3,000), a high-power charger and usually a stronger connection for a lorry (about CHF 80,000). Most vehicles at industry and warehouses have a yard, fewer at shops and offices. Without one, a business needs a public charger with room — a van on-street, at a hub or a lorry park, a lorry only at a hub or a lorry park.",
      ),
      p(
        "Lorries pay the heavy vehicle fee (LSVA) on diesel — about CHF 18,000 a year for a local delivery lorry — and electric lorries are exempt through 2030. Until then an electric lorry is the cheaper choice for a business with a depot. A lorry without one needs room at a hub (where it takes about twenty cars' worth) or a lorry charging park, which only you build. Vans without a yard rarely go electric: charging in public costs them more than the diesel they save.",
      ),
      list([
        "Their electricity counts as car charging — in the business's yard, or at the public charger.",
        "Their diesel counts toward transport emissions.",
        "A federal end to new petrol and diesel car sales covers vans, not lorries.",
      ]),
      note(
        "How the vehicles spread over the buildings, the share with a yard, prices and mileages (a van 18,000 km a year, a lorry 45,000) are estimates. What happens to the LSVA exemption after 2030 is undecided; the game assumes electric lorries pay the full fee from 2031. Company cars are counted with the households' cars.",
      ),
    ],
  },

  // --- Households & numbers ------------------------------------------------------------------
  {
    id: "appliances",
    title: "Household appliances",
    blocks: [
      p("Every home runs everyday appliances, each on its own rhythm:"),
      list([
        "Fridge — switches on and off every 20–40 minutes, day and night.",
        "Lighting — on mostly in the morning and evening, rarely at night.",
        "Other plug loads — routers, chargers and standby: a small, steady draw, a little higher in the day.",
        "Cooking — short bursts around breakfast, lunch and above all dinner.",
        "Washing and drying — on about one day in three, a load of 1.5–2.5 hours sometime in the day.",
      ]),
      note("Washing machines don't wait for the night rate; only electric cars do."),
    ],
  },
  {
    id: "finances",
    title: "Bills",
    blocks: [
      p(
        "Every building and home has a bill: for the last day, the last full month, or the last twelve months — finished periods only, like a real bill.",
      ),
      list([
        "Electricity: each kWh at the rate of its hour, so a household that charges its car at night pays less. A home on the dynamic tariff pays the dynamic price of each moment instead (see \"The dynamic tariff\").",
        "Solar: power fed into the grid is credited at the feed-in price, usually lower than the price of power drawn.",
        "Heating fuel: a building heated with oil, gas or district heat gets its own line — litres of oil, kWh of gas or heat — at the market price of oil and gas and the district heating price you set. A heat pump shows up as electricity.",
        "Shared costs: a home pays for its own appliances plus its share, by floor area, of the building's heating, cooling and solar — the way a Swiss service-charge statement splits them. A shop's energy is billed to the building, never to the flats.",
      ]),
      note("Bills cover electricity, heating fuel and district heat. Petrol, public transport, wood and public charging don't appear on them."),
    ],
  },
  {
    id: "statistics",
    title: "Statistics & history",
    blocks: [
      p(
        "Each building's and home's panel shows its last 24 hours — energy by use (heating, appliances, car charging and so on) and a live power chart — and its history over the last days, weeks and months.",
      ),
      p(
        "Town hall → Statistics does the same for the whole town: energy by use for a day, week, month or year — once with businesses and once without, since business use dwarfs the rest — the town's power draw and solar output, and its energy history. It also shows how residents get around, and the share of electric cars and bikes, at the start and now.",
      ),
      note("History shows finished days, weeks and months only, so its bars don't change once drawn."),
    ],
  },
];

/** The wiki's contents: every section, grouped by what it is about. */
export const WIKI_GROUPS: WikiGroup[] = [
  {
    id: "start",
    title: "Getting started",
    blurb: "What the game is, how to find your way around, and how time passes.",
    sections: ["overview", "controls", "map-layers", "time", "year-in-review", "saving"],
  },
  {
    id: "governing",
    title: "Governing",
    blurb: "What you can decide, what people think of it, and what you are aiming for.",
    sections: ["measures", "approval", "information", "letters", "emissions", "score"],
  },
  {
    id: "money",
    title: "Money",
    blurb: "The treasury, the utility, borrowing, and the prices you set.",
    sections: ["municipal-finances", "borrowing", "tariff", "dynamic-tariff"],
  },
  {
    id: "decisions",
    title: "How people decide",
    blurb: "When owners replace things, and what tips their choice.",
    sections: ["stock-renewal", "early-switch", "technology-prices"],
  },
  {
    id: "town",
    title: "The town",
    blurb: "Its buildings, how it grows, the zoning plan, and the municipality's own buildings.",
    sections: ["buildings", "growth", "zoning", "public-buildings", "commercial"],
  },
  {
    id: "heating",
    title: "Heating",
    blurb: "How buildings are heated and insulated, where a heat pump may go, and district heating.",
    sections: ["climate-control", "water-heating", "insulation", "heat-pump-siting", "district-heat", "district-heat-sources"],
  },
  {
    id: "electricity",
    title: "Electricity & solar",
    blurb: "The local grid, rooftop solar, and the batteries that smooth both.",
    sections: ["grid", "solar", "roof-contracts", "home-batteries"],
  },
  {
    id: "mobility",
    title: "Getting around",
    blurb: "Cars and bikes, public charging, and businesses' vans and lorries.",
    sections: ["mobility", "public-charging", "fleets"],
  },
  {
    id: "households",
    title: "Households & numbers",
    blurb: "What runs in a home, what it pays, and the statistics that add it all up.",
    sections: ["appliances", "finances", "statistics"],
  },
];
