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
        "In Commune Zéro you run the energy department of a real Swiss municipality: its electricity utility, its district heating, and its say over buildings, transport and new energy projects. The goal is net zero by 2050 — without losing the voters or emptying the treasury on the way.",
      ),
      p(
        "The town on the map is the real one. Every building comes from the federal building register, with its real address, age, size, homes and heating; so are the solar panels, the public chargers, the share of electric cars and the businesses' vans and lorries at the start. From there the town lives on: people heat, cook, charge and commute, systems wear out and get replaced, new buildings go up. You can't decide for anyone — but your measures, prices and building projects change what people choose.",
      ),
      p(
        "Click any building to look inside: what heats it, what it draws right now, what its occupants pay, and what has changed over the years. Click a home in it to go down to single appliances.",
      ),
      p(
        "New to the game? The tutorial on the start screen is a small game of its own: newly elected, you spend your first weeks in office with your chief of staff, who walks you through the map, the views, the clock, the Town hall, the planning tools and your mail — showing you what to click — up to your first Year in Review.",
      ),
      p(
        "A new game opens with a short briefing — the goal, how you stay in office, what you control — and a checklist of first steps in the corner, each with a button that takes you there. Close it once you know your way around; the game menu brings it back.",
      ),
      p(
        "The bar across the top shows the date and the speed, and the numbers that matter most: the treasury, public approval, last year's emissions and your score. On the left of the map are its layers (see \"Map layers\"). Everything that isn't on the map — measures, the accounts, prices and statistics — is in the Town hall, top right. The game pauses while the Town hall or this wiki is open, and carries on at the same speed when you close them.",
      ),
      note(
        "Where there is no real data — who owns an electric car, when someone runs the dishwasher — the game fills in plausible households. They aren't the people who really live there, but together they behave the way a town does.",
      ),
    ],
  },
  {
    id: "sound",
    title: "Sound & music",
    blocks: [
      p(
        "Buttons click softly, sliders and switches tick, and a letter that wants your attention — a vote, a request, an advisor's report or news of a project — arrives with a short chime; a vote's or an election's result with a lower one. The Year in Review opens on a small chord, and ordering, building or enacting something sounds a short rise. Letters that wait quietly make no sound.",
      ),
      p(
        "The music is calm and slow: a few soft chords in turn, with a bell now and then. It is made as it plays, so it never quite repeats, and it steps back while the Year in Review is open.",
      ),
      p("Game menu → Sound turns the music and the sound effects on or off, each with its own volume; M mutes everything at once. The music starts off. Your choice is kept in this browser, not in your saves."),
      note("Browsers only allow sound once you have clicked or pressed a key, so the game is silent until then."),
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
        "If something in the game breaks, it pauses and offers to save your run — in this browser as “Before the crash”, and as a file — so you can reload and carry on from there. The Feedback button (top right, and in the game menu) sends a report straight from the game: a few words of yours, where you were in the game, and, if you like, your game itself, so the problem can be seen exactly as you saw it. No e-mail or account needed; if you have a GitHub account, you can open an issue there instead (it's public, and can't take your game along).",
      ),
      p(
        "A loaded game picks up exactly where it was saved, paused: the same town, the same households and their pending decisions, the same accounts, votes and letters.",
      ),
      note(
        "A save loads into any release of the same version — a 0.9.0 save into 0.9.1 and later 0.9 releases — so fixes don't cost you your runs. A new version (0.10) starts afresh: its changes to the game are too deep for older saves, which are listed but can't be loaded. The version is shown in the game menu and on the start screen.",
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
        "M — mute all sound, or bring it back (see \"Sound & music\").",
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
        "The dock on the left of the map has two kinds of layer. Views only colour the map, to show how things are; their legend sits in the map's lower left. Planning tools are where you act on the map: each opens a drawer beside the dock in two tabs — Overview, with the town's figures, the lists and the legend, and Build, with what you can order. Whatever you pick on the map or in a list — a charger, a transformer station, a heating network, a wind site, a building — opens its own card on the right, with what it does and what can be done with it. Picking the open tool again closes it. The arrows at the foot of the dock fold it to a row of icons if you want more map.",
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
        "Zoning — the zoning plan, parcel by parcel (see \"Zoning\").",
      ]),
      p("Planning tools:"),
      list([
        "District heating — who is connected, who could be, the pipes and the heat sources; extend the network and add heat sources here (see \"District heating network\" and \"Heat for district heating\").",
        "EV charging — where households could charge an electric car, and every public charger by how full it is; build chargers here (see \"Public charging\").",
        "Grid — the transformer areas and how loaded they are; reinforce them or add batteries here (see \"The electricity grid\").",
        "Public buildings — the municipality's own buildings and what they carry; order solar and chargers for them here (see \"Public buildings\").",
        "PV Contracting — large roofs by where a roof contract stands; rent them and put the utility's solar on them here (see \"Roof contracts\").",
        "Car parks — the open-air car parks big enough for a solar canopy, whose they are and what is built over them; cover the town's own here (see \"Solar over car parks\").",
        "Agri-PV — the farmland outside the building zones, the fields zoned for solar and those taken up; zone fields, or develop one yourself, here (see \"Agri-PV\").",
        "Wind — where turbines could stand, once a study has looked, and each wind park's long road through zoning, permit and the courts (see \"Wind power\").",
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
        "The weather matters: cold days drive up heating, and with it the evening peak on the grid; sunshine drives the solar panels; snow on panels stops them until it melts; hot days switch on the air conditioning.",
      ),
      p(
        "The climate warms as the years go on — about a third of a degree a decade, summers faster — and now and then a summer brings a heatwave: a week or two of clear skies and afternoons well above 30 °C. They come more often, and hotter, the later it gets. Winters need a little less heating; summers more cooling.",
      ),
      note("The weather is the same in every game, year by year, and the same in every town: it doesn't follow the real forecast. The warming is a steady trend; real climate varies far more from one decade to the next."),
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
        "At the ballot box: the year's votes and election, with their results.",
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
        "Consequences: approval below 25% for six months gets you recalled, and every four years (the first in 2030) there is an election: below 50% on election day, the voters choose someone else. Either ends the game. Elections are announced: the Overview and the inbox (Votes) show when the next one is, and the town clerk warns you when approval runs low. Approval also nudges the government's yearly allocation up or down a little.",
      ]),
      note(
        "Approval reacts to what you decide, not to how things turn out: nobody thanks you for falling emissions. Prices are the exception — people judge the tariff you publish, and keep judging it while it is in force (see \"Tariffs & energy prices\"). Measures imposed by the canton or the Confederation cost you nothing. The difficulty sets how strongly opinion moves.",
      ),
    ],
  },
  {
    id: "advisors",
    title: "Advisors",
    blocks: [
      p(
        "Advisors are consultants you retain for a yearly fee, on their own page in the Town hall (Advisors) — one sub-page each, greyed out while not retained. Each starts a few months after you hire it, reports the month after, and from then on once a year, in its own month; a letter tells you a report has come. The report stays on the advisor's page with its ranked list, and each entry can be acted on right there — offer the roof's owner a contract, order the chargers, order the pipes — or shown on the map in its planning tool first. Each entry shows what has become of it since: offered, accepted, built, ordered.",
      ),
      list([
        "Roof solar advisor (CHF 100,000 a year, each March): the ten large roofs where an array of the utility's would return the most for what it costs — the panels less the federal payment, your rent and the upkeep, against the power it saves buying — and how many owners would accept at your rent. Set the rent right on the advisor's page and offer each owner the contract from the report — or all ten at once — (and build once they accept), or open the roof's card on the map. See \"Roof contracts\".",
        "Mobility advisor (CHF 50,000 a year, each February): where a new public charging site would do most good — where most households who wanted an electric car over the past year went without a charger with room, after counting the sites opened or ordered since — and whether vans and lorries need a hub. Order on-street chargers for each spot from the report — pick the size — and a fast-charging hub or a lorry charging park for the vans and lorries, or look at the place on the map. See \"Public charging\".",
        "District heating advisor (CHF 80,000 a year, each April): the firms ready to sell their waste heat — found only this way — and the streets next to your network that would likely bring the most heat per metre of pipe within five years. It counts the buildings along each heating with oil, gas or wood, how likely their heating is to need replacing in that time, and how many owners choose district heat when the pipes are in their street — from the town's own record where there is one. Order each extension from the report, at the cost shown, or see it planned on the map in the District heating tool. See \"District heating network\".",
        "Finance advisor (CHF 60,000 a year, each June, before you set next year's prices): what the utility made over the last twelve months and what your department kept; what next year's power, mostly bought already, will cost and what that does to the utility's result; the price change that would keep it; and where the Swiss average is heading. Its page takes you straight to the prices. When a green bond falls due within the year, it says so, and you can roll the bond over from its page. See \"Tariffs & energy prices\".",
      ]),
      note(
        "Advisors know what a consultant would: prices, bills and the town's own record. Where they look ahead — whose heating will wear out, what next year's power costs — they estimate, from the age of what is installed and the usual lifetimes, and from what the utility has bought; owners still decide for themselves, and a supply crisis can upset any forecast.",
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
    title: "The inbox: votes, requests, advisors and letters",
    blocks: [
      p(
        "The town writes to you, and the inbox (top right) keeps it in four tabs. Votes, Requests and Advisors & projects call for your attention: a short notice pops up as one arrives, and the inbox button counts what you haven't read. Everything else waits quietly under Letters — counted on its tab, never announced. The game keeps running while the inbox is open, and it opens on the first tab with something new.",
      ),
      list([
        "Votes: votes and the election ahead, with today's poll and approval, at the top. The town clerk writes when opponents force a measure to the ballot and again with the result, and with the election's; both camps campaign before a vote; and the clerk warns you when approval runs dangerously low.",
        "Requests (📌): now and then someone asks for something concrete, by a deadline — public chargers near a street, district heating along a street next to the network, a reinforced transformer station, solar on a public building, or a measure their group wants. The tab lists them, the open ones first with the time they have left, marked once it is short. Answer in time and the group gains goodwill (a few approval points, fading over time); let it lapse and it loses a little. If someone else solves it — a private charging operator, an owner's own panels — the problem is gone but nobody thanks you. Their answer, once it is settled, is shown under the request.",
        "Advisors & projects: the reports of the advisors you retain (see \"Advisors\"); news of your own projects — a wind park's or an Agri-PV field's permit and any court ruling, the owners' answers to roof contracts, a firm offering its waste heat; and notices — the canton taking over the department's finances when debt passes the limit (and handing them back), the green bond subscribed and whether its promise was kept, energy prices soaring on world markets.",
        "Letters: reactions to what you decide — thanks or objections, within days — groups writing about their mood, naming what weighs on them most (a fair hint; an opinion survey is the precise tool), complaints about what goes wrong in town — heat pumps refused, new boilers despite a ban, nowhere to charge, each at most every six months and counting everyone it concerned — and news from town, like a data centre on its way.",
      ]),
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
        "Electricity: what the town draws from the grid, less what its solar and wind feed back, each at how clean Swiss electricity is at that moment. It is dirtiest on winter nights, when much of it is imported, and cleanest at sunny middays, when hydro and solar cover everything — on a winter's night two or three times the year's average, at a summer noon a fraction of it. The national grid gets cleaner over the decades whatever you do; your levers are how much the town draws, when, and green power as the default for its customers.",
        "Gas and oil heating: the fuel actually burned for heating. Every boiler replaced by a heat pump or district heat takes its share away. Wood heating counts as clean, as in Switzerland's own inventory: the CO₂ a tree took up is given back.",
        "District heating: the oil and gas its boilers burn, and the electricity its heat pumps use (see \"Heat for district heating\"). Wood and waste heat count as clean.",
        "Transport: the petrol and diesel burned by households' cars and businesses' vans and lorries. Public transport, cycling and walking count as zero.",
      ]),
      p(
        "The Year in Review, the Overview and the emissions chart show the sources in more detail: for cars, vans and lorries each, the petrol or diesel they burn and — taken out of the electricity — what charging the electric ones emits, at home, at public chargers and at businesses' depots. Each kind of vehicle has its own colour, darker for its fuel, lighter for its charging. Charging's share follows how clean the grid is, so it shrinks as the grid gets cleaner and the town's solar grows; an electric vehicle never emits as much as the petrol or diesel one it replaces. Commuters charging at the town's workplaces count too — it is the town's electricity — while their petrol, burned by non-residents, never did.",
      ),
      p(
        "When matters. Solar fed in at a summer noon displaces power that was clean already, so it counts for less than the same kWh in winter; a heat pump's power, drawn mostly in winter, counts for more than its share of the year. Moving use from the evening into the night eases the grid but adds a little CO₂ in winter; moving it into sunny hours does both good.",
      ),
      p(
        "Some emissions can't be avoided within a town's reach: the national grid is still not clean in 2050, a few buildings have no alternative to their boiler, and old cars and lorries run on for years. As in Swiss climate law, that rest is balanced with carbon removal — CO₂ taken back out of the air by biochar, direct air capture or capture at a waste-to-energy plant. The ‘Carbon removal contracts’ measure buys them, but only for that rest: removals count once the town's own emissions are down to a fifth of what they were at the start. From the year after a counted year gets there, the contract buys month by month — a twelfth each month of what that year left, up to the share you choose — and pays each month, at the price of the day: around CHF 450 a tonne today, about CHF 200 by 2050. What a year bought counts against its emissions, never below nothing. Before that it costs nothing — the first four fifths have to be cut.",
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
    id: "leaderboard",
    title: "The leaderboard",
    blocks: [
      p(
        "A run that reaches 2050 — or hands over early at net zero — can go on the leaderboard: at the end, choose a name and submit it. Its place shows at once, and Leaderboard on the start screen (or on the end screen) shows every board.",
      ),
      p(
        "A score only compares within the same town, difficulty and starting year, and the same version of the game (0.9, 0.10, …): balance changes between versions, and par is different for every town and difficulty. So each is a board of its own; older versions' boards stay to look at. Each run goes on once.",
      ),
      p(
        "What is sent: the name, the town, the difficulty, the version, and the run's emissions per resident year by year — from which the leaderboard works the score out again, so a score has to add up. Nothing else about you or your game.",
      ),
      note("Names are filtered for slurs and obscenities in several languages, but not moderated: each is chosen by the player who submitted it. And a score is checked for whether it adds up, not replayed — the leaderboard trusts that players play fair."),
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
        "The energy department has one treasury, shown in the top bar; click it for the accounts. Money comes in from three places: a yearly allocation from the municipality's general budget (paid a twelfth on the last day of each month, sized by the population), the department's share of what its electricity utility earns, and smaller items — sales at its own public chargers, Swissgrid's compensation for new solar (see \"The electricity grid\"), and money it borrows (see \"Borrowing & debt\").",
      ),
      p(
        "Money goes out only when something actually happens: the day a household installs a subsidised heat pump, buys a subsidised electric car, insulates or puts up panels, the municipal grant is paid. A grant nobody takes up costs nothing — but it is also paid to everyone who would have done the same anyway. Finding the level that tips the undecided without overpaying the rest is the art of subsidy planning.",
      ),
      p(
        "Building things — district heating pipes, public chargers, grid reinforcement, an Agri-PV zone or a wind park's zoning plan — is paid the day it is ordered. Campaigns and programmes cost a little every month.",
      ),
      p(
        "The utility settles each month once it is over: what customers paid for electricity and district heat, less the power it bought (the district heating heat pumps' included), the cost of making district heat (fuel, heat bought from incinerators), the solar it paid for, and the upkeep of the grid, the pipes, the heat plants and the chargers. Like Swiss municipal utilities, it pays the town a concession fee on every kWh it sells — set when you took office, at what the town took the year before (three quarters of that year's profit). Everything beyond the fee is your department's, a loss too: so what you build pays you back in full — a wind turbine's power, a battery's savings, the customers a new pipe brings. Solar on public buildings counts as well: what the panels save the buildings and earn feeding in is credited to you. Each month's result reaches the treasury a few days after the month ends; the year's accounts are closed on 31 December. You set the utility's prices in Town hall → Prices, once a year; what it pays for power follows the market (see \"Tariffs & energy prices\").",
      ),
      p(
        "Town hall → Treasury → Ledger lists every franc in and out, newest first: each month's allocation and the utility's month, every subsidy paid (with the building), every order, levy, loan and interest payment. Filter it by kind and by year; its total is what that selection did to the balance.",
      ),
      note(
        "Federal and cantonal grants — the ones every heat pump, solar system and renovation already gets — aren't municipal money; only your own top-up is. Gas, oil and petrol are bought from outside suppliers, never through the utility. The department's share of the utility's profit and the allocation — a few million francs a year in a mid-sized town — are small next to a serious subsidy programme, so what you fund matters.",
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
        "The overdraft: if the balance falls below zero, it is covered automatically — at a steep premium, charged every month. Only what you don't order yourself can take it there — the subsidies households claim, the running costs of what's in force: an order the treasury can't pay is refused. Borrow first.",
        "Green bonds: sold to the town's own residents for ten years, with interest every year and the money repaid at the end. Residents accept a little less interest for a local green cause, and buy as much as they want — a couple of hundred francs each at most, more when the climate-minded are content, so a bond may raise less than offered. They only hold so much of the town's green bonds at once: until earlier ones are repaid, each new one raises less. Offering one goes down well. The money is earmarked: within two years as much has to go into green investment, or it is called greenwashing and the climate-minded turn away. At most one a year. When one falls due, the finance advisor (see \"Advisors\") can roll it over: a new ten-year bond at the day's rate, subscribed as the old one is repaid — as much as residents will take, the treasury repaying the rest. It is the same money lent again, so it adds no debt, carries no earmark, and doesn't count as the year's new bond.",
        "Federal decarbonisation loans: 0.25% over 20 years, but only against decarbonisation investments already made — up to half of the last twelve months' — and only so much a year; the money arrives after three months.",
      ]),
      p(
        "The market rate starts near today's (about 1.2%) and drifts over the years, with the occasional jump nobody sees coming. Borrowing when money is cheap pays off. Debt is measured in years of income — what the department took in before its own spending, averaged over the last three years, so one poor year for the utility doesn't shrink what you may borrow at once: the more years it would take to repay, the lower the rating and the dearer new money. Lenders are quick to downgrade and slow to forgive: the rating falls as soon as debt rises, but climbs back only a notch at a time, each once debt has stayed low enough for a year. From about a year and a half of income, homeowners and businesses start to worry. Beyond five years, the canton puts the department under supervision: no new borrowing, no new spending measures and no new orders until debt is back under four years — measures already in force run on, and laws and prices stay yours.",
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
        "Electricity, the energy price: what the power itself costs households and businesses in basic supply — a day rate and a cheaper night rate (21:00–06:00). This is yours to set, under the regulator's ceiling (below). Households who can wait — about a third of electric car owners — charge their car at night, a timer starting it some time in the night rate so that it's full by morning; the others charge as soon as they get home. Nobody plugs in every night: a car charges two or three nights a week, each time putting back the days since.",
        "Electricity, the network fee: what carrying the power costs, paid on every kWh the grid carries. Its level isn't yours — the regulator sets it, see below — but its shape is: a monthly base fee per meter (each household, and each business), and how much cheaper the night rate is. The higher the base fee, the less each kWh carries — which takes some of the edge off saving power and making your own.",
        "Solar feed-in: what panels earn for power fed back into the grid. The price itself is federal: each quarter's reference market price — the spot price weighted by when solar produces — but never less than a federal minimum, which depends on the plant's size: 6 Rp/kWh for a plant under 30 kW, the same on the first 30 kW of a plant up to 150 kW (so less over its whole output, the bigger it is), and nothing for larger ones — a big roof, a car-park canopy or an Agri-PV field gets the market price alone. As the region's panels crowd into the same sunny hours, that market price sinks, summer most, and by the mid-2030s the minimum is what most quarters pay; in a market crisis it can rise well above it. On top, you may pay a bonus of your own, as most Swiss utilities do for the power's certificate of origin: a higher bonus makes solar pay for more owners — and costs the utility. Owners weighing panels look at the year's price for a plant their size; the utility's accounts pay each quarter's. (A household's bill shows a small plant's price.)",
        "District heating: what the network’s heat costs its customers, and earns the utility.",
        "Public charging: what the municipality’s own chargers charge — on-street, fast and at lorry charging parks — each with a price at night and one in solar hours, if you want those hours cheaper. Private operators set their own (see \"Public charging\").",
        "Dynamic tariff: whether households may choose the next day's market prices instead, and your margin on them (see \"The dynamic tariff\").",
      ]),
      p(
        "Before you publish, the page shows the network fee that follows, the price per kWh all in, and what a typical household would pay for its electricity in a year, base fee included — against this year and against the Swiss average — and how people are likely to take it.",
      ),
      p(
        "The network fee is regulated cost-plus, as ElCom has it. When next year's tariff is due, the grid's allowance for that year is fixed: its running costs on the electricity it carried over the last twelve months, a small return, and the capital cost of the reinforcements and batteries you have paid for, spread over their life. Whatever it collected beyond its allowance in the years before is handed back over the next three, and a shortfall made up the same way — so the grid can't be a source of profit, nor a drain. The base fee raises part of the allowance; the rest comes in per kWh, split between day and night by when the town uses its power.",
      ),
      p(
        "People care about their bill (see \"Public approval\"). The day you publish, the change lands like any decision: a rise stings, a cut is welcomed. And for as long as a tariff is in force, people compare it with what households pay elsewhere in Switzerland: a dear tariff keeps weighing on approval, a cheap one helps a little — people resent paying too much more than they reward paying less. Tenants and homeowners mind most, businesses a little less, and homeowners also watch what their panels earn.",
      ),
      p(
        "What you can’t set are the energy markets: heating oil, gas, petrol and diesel, and the wholesale electricity the utility buys. They follow world prices, including the federal CO₂ levy on heating fuels, and drift slowly over the years — until now and then a supply crisis sends them soaring, easing again over a year or two. Nobody sees one coming. Wholesale power moves every year as well: the utility buys most of a year's power ahead, a third in each of the three years before, at what the forward market asked then, and the rest month by month. So a rise or a fall in the market reaches it spread over three years, smoothed but not flattened — and the Prices tab shows what next year's power, mostly bought already, will cost, so you can see it coming when you set next year's prices. Dear fuel makes heat pumps and electric cars look better to anyone choosing at the time; dear wholesale power squeezes the utility’s profit, unless you pass it on — and the Swiss average rises with it, so people are more forgiving when everyone’s bill goes up.",
      ),
      p(
        "Like Swiss municipal utilities, yours buys its power on long-term contracts, so a sudden spike in the market doesn’t hit it at once. But in an hour when the town makes more than it uses — local solar and wind beyond the town’s own use — the surplus goes to the spot market, at that hour’s price. With the whole region’s panels producing at once, that price sinks on sunny middays, and from the early 2030s it falls below zero on the sunniest: the utility then pays to get rid of the power, on top of the feed-in it pays the panels’ owners. Neighbourhood batteries, a dynamic tariff and smart charging move use into those hours, or keep the surplus for the evening.",
      ),
      p(
        "Large businesses have a choice. A site using 100 MWh a year or more may buy its energy on the open market instead of from your basic supply — and once it has left, it can't come back. It still pays the network fee and the base fee here; only the energy goes elsewhere. At the start, the sites for whom it was worth the bother have left already — in most towns well over half of the businesses' use. Every October, once next year's tariff is out, those still in basic supply compare your energy price with what a supplier offers for next year (the forward price of the year's power and the supplier's margin; the Prices tab shows both), and leave if the market is cheaper by enough to be worth their while. An energy price well above the market's drains them away for good, taking the utility's margin on their power with them; one close to it keeps them. In a market crisis it's the other way round: those who left pay the market's price, and your households don't. Businesses on the open market care less what your tariff says.",
      ),
      p(
        "There is a ceiling on the energy price, though. The utility is the only supplier its households have, so the federal regulator holds its energy price to its costs: the power it buys for that year — mostly bought already when you set the price — and the concession fee it pays the town, plus a reasonable return of a fifth on top and its sales costs — and what solar fed in cost it above that power's market value over the last twelve months (the federal minimum and your bonus), which the regulator counts as part of buying power. Utilities elsewhere pass that on too, so the Swiss average your households compare with carries it as well. A tariff whose typical household energy price is over that can't be published; the page shows where you stand against it. When the market gets dearer, the ceiling rises with it.",
      ),
      p("The same page shows the market prices now and a year ago, and where technology prices are heading (see \"Technology prices over time\")."),
      note(
        "A decision is made at the prices of its day and never revisited: a change only affects the decisions that follow. The grid’s running cost per kWh is a fixed figure, not something you set. People judge the tariff by its typical bill, not by what each of them actually pays. Real bills also carry federal and municipal levies; here they are part of the network fee, and the concession fee the utility pays the town is reckoned on every kWh the grid carries. A business on the open market keeps its tariff's day and night pattern, and its own decisions — a heat pump, an electric van — are weighed at your prices all the same.",
      ),
    ],
  },

  {
    id: "dynamic-tariff",
    title: "The dynamic tariff",
    blocks: [
      p(
        "Next to the time-of-use tariff you can offer a dynamic one (Town hall → Prices). Those on it pay the next day's market prices, published the day before: each hour's day-ahead price on the electricity market and your margin on it, plus the network fee — the same average, flat through the day. The market price sinks when the region's panels are producing, deepest on a clear spring or summer midday (and below zero on the sunniest from the 2030s), and rises in the morning and evening peaks; nights sit in between. Every day is its own: a grey day has no midday trough, a crisis lifts every hour. You choose your margin; the page shows a winter and a summer day of it before you publish.",
      ),
      p(
        "Nobody has to take it. On 1 January each household weighs what it would save against the bother of switching, and each building’s owner does the same for its heat pump, which has its own meter. The page estimates how many would sign up.",
      ),
      list([
        "Electric cars: the car charges itself in the cheapest hours of the night, by that night's prices, full by morning. A household whose car charges as soon as it’s plugged in saves the most — this is who signs up first.",
        "Heat pumps: they run harder while power is cheap and ease off when it’s dear, day by day — on a sunny day, at midday; the house holds the warmth. It pays most for large buildings.",
        "Washing machines: some loads are started by timer in the day's cheapest hour.",
        "Everyone else: a household with nothing to shift pays about the same either way, so few bother.",
      ]),
      p(
        "What it does: load moves out of the evening peak into the night, which eases the grid where it’s tightest (see \"The electricity grid\"). What it costs: the utility earns its margin rather than the time-of-use price on what they use — though what they shift into cheap hours also costs it less to buy. A smaller margin wins more households. Each home’s panel says whether it is on the dynamic tariff.",
      ),
      note(
        "The price follows the market, not what the town itself draws. If very many cars charge in the same cheap hours, those hours get busy on the town's grid — the price won't notice. Businesses stay on the time-of-use tariff. Real day-ahead prices come in 15-minute steps; here, hours.",
      ),
    ],
  },

  {
    id: "charging-tariff",
    title: "The charging tariff",
    blocks: [
      p(
        "You can also offer a charging tariff (Town hall → Prices): a household puts its wallbox on a meter of its own and pays a charging price of your choosing for what the car charges, in return for when it may charge. As with heat pumps, many Swiss utilities already do this.",
      ),
      list([
        "Energy price: per kWh on the charging meter, flat through the day — under the regulator's ceiling like every price in basic supply. The network fee comes on top.",
        "Meter fee: what the second meter costs a month. It keeps those who charge little away.",
        "Night rate only: the wallbox has power only at night; each car's charge starts at some moment in the night rate, full by the time it ends. It pays the night's network fee.",
        "Utility-controlled: the utility decides when each car charges while it's plugged in. On a day with solar hours — when the town's own solar and wind are forecast to make more than it uses — a car that is at home charges in them: every weekend, and on weekdays about one car in four (home office, part-time, retired). Otherwise in the night's quietest hours, most around the middle of the night. You can set a cheaper energy price for what it draws in solar hours, which makes signing up worth more; the Prices tab shows on how many days a year your town has solar hours. It pays the network fee's daily average, less a discount you may give (up to 60%), as utilities give heat pumps. The regulator's allowance stays the same, so the rest of the town makes the discount up in the years after — tenants, who mostly have no wallbox, resent it.",
      ]),
      p(
        "Who signs up: on 1 January each household with a wallbox and an electric car weighs what its charging would cost on the charging meter, the meter fee included, against what it pays now — the night rate if it already waits for it, the day rate if it charges as soon as it gets home — and goes for it if the saving beats the bother: the meter, giving up control, and for those who charge on arrival, that habit. The Prices tab shows how many would, before you publish. A household on the charging tariff weighs the dynamic tariff without its car.",
      ),
      p(
        "What it does: cars on it charge at night instead of in the evening, so the evening peak on the grid falls (see \"The electricity grid\"). A cheap charging price also makes an electric car cheaper to run for anyone with a wallbox, so more go electric. What it costs: the energy sold at your charging price, against the meter fees. Drivers welcome a charging price below what households pay, homeowners a little.",
      ),
      note(
        "Night charging eases the grid, but in winter Swiss power is dirtiest at night, when much of it is imported — so moving charging from the evening into the night adds a little CO₂, while charging in solar hours saves it (see \"Emissions & net zero\"). The solar-hours forecast counts the town's solar and wind as they stood at the end of the year before: what is built during a year counts from the next.",
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
        "What is possible: wood heating only where there is a wood boiler or stove already (it needs a store room and deliveries, and towns discourage new ones for the fine dust), district heating only if a pipe runs in the street (see \"District heating network\"), a heat pump only where the ground and the neighbours allow (see \"Where a heat pump may go\"), an electric car only with somewhere to charge (see \"Public charging\") — unless petrol and diesel cars are banned, when a household without a charger goes electric anyway and gets by with fast chargers and charging at work.",
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
        "Laws act at this moment: a ban on new fossil heating changes only the next replacement, not the boilers already running. To speed things up, see \"Switching early\". The ban has one exception, as in canton Zurich's energy law: where no heat pump may go and no district heating reaches the building, its owner may install gas or oil again — the building's panel says why.",
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
      note("Every early switch is shown on the building's or home's panel, like any replacement. In the decision log (transparency mode), an owner who weighed it and kept their boiler or car shows as ‘Keep the current …’ — keeping what is there, not installing a new one, so a fossil heating ban doesn't rule it out."),
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
        "Growth: new buildings go up on vacant building land — zoned for building and still open; parks, sports fields, playgrounds, allotments and cemeteries stay free, as do clearances along roads, rail, forest and water. Each is sized and turned like the buildings around it. When the vacant land runs out, growth has to come from replacing old buildings with denser ones, and slows down. The zoning plan says what goes where (see \"Zoning\").",
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
        "The zoning plan decides what may be built where. The Zoning view shows the town's real plan, parcel by parcel: residential, mixed, centre, work and public-use zones. Hover over a parcel for its zone and size. It matters to the energy of the town in a few places:",
      ),
      list([
        "Growth: new buildings on open building land are of the kind their zone allows — homes in a residential zone, homes with shops and offices in mixed and centre zones, workshops and halls in a work zone (see \"Town growth & renewal\").",
        "Noise: an air heat pump's outdoor unit has to stay quieter at night in a residential zone than in a mixed, centre or work zone (see \"Where a heat pump may go\").",
        "Outside the building zones lies the farmland, where you can zone fields for solar (see \"Agri-PV\").",
      ]),
      note(
        "The plan stays as it is through the game. Rezoning and densifying take years of town planning in a real municipality, and their pull on the town's energy is slow and indirect, so the game leaves them out; the energy department steers buildings with the laws, grants and programmes in the Town hall instead.",
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
        "Solar: the full usable roof, ordered directly, paid by the treasury (less the federal payment every installation gets) and generating a few months later — unless the grid there is full at summer middays, when a large roof waits until the area is reinforced (see \"The electricity grid\"). Or automatically, a few buildings a year, with the ‘Solar on public buildings’ measure — with the roof solar advisor, the roofs that pay back best first (those where the panels would save and earn the most a year for what they cost, much as an owner would weigh it); without one, in no particular order.",
        "Chargers: a public charging site in the building's car park, with 4, 8 or 12 points, ordered directly. Or automatically with the ‘Chargers at public buildings’ measure: with the mobility advisor, it starts where most households nearby are missing a charger; without one, it goes wherever comes up. Once it has placed a site, the households around it count as served, so the next one goes where the need is next greatest — never within about 300 m of a site still being built. Either way they are municipal chargers like any other (see \"Public charging\").",
        "Once every public building has what a programme provides, the measure has nothing left to do: it is greyed out, and one already in force winds up by itself — without the approval cost of a repeal, and any vote on it is called off.",
      ]),
      note("The register doesn't say who owns a building, so every public-use building counts as the municipality's — the hospital included — except churches, which belong to their parishes."),
    ],
  },
  {
    id: "commercial",
    title: "Businesses & industry",
    blocks: [
      p(
        "Shops, offices, schools, churches, sports halls, hospitals and factories use energy on their own rhythm — office hours, long shop hours, a church quiet except on Sunday morning, a hospital around the clock — in proportion to their floor area. Business use is usually the biggest share of the town's electricity.",
      ),
      p(
        "Now and then a data centre comes to a town with open land in a work zone — in some towns never, in others once, years into your term. The town clerk writes when work starts; it takes two years to build and a few more to fill. It is big: several megawatts of servers and the cooling on top, day and night, as much power as thousands of homes. It buys its energy on the open market, certified renewable, so its power adds nothing to the town's emissions, and it has its own substation, so it loads no neighbourhood's transformer. It pays the network fee like any business, and its concession fee straight to the town. What it means for you is its heat: a year after it opens, it offers its waste heat to the utility for next to nothing (see \"Heat for district heating\").",
      ),
      note(
        "Factories are the least predictable: their real shifts aren't public, so they run long hours with some days busier than others. Garages, storage, farm buildings and buildings the register doesn't describe use no business energy at all. Whether and when a data centre comes, and how big, is the game's draw for each municipality.",
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
        "Heating follows the day's average temperature, so one cold hour in a mild week doesn't switch the heating on.",
      ),
      p(
        "Cooling: air conditioning is still rare in Swiss homes — a few in a hundred, more in new and large buildings — but common in offices, shops, hotels and hospitals. Every hot summer makes it more common: by 2050, about a third of homes cool. A flat needs it on a hot day, once it is warm outside; an office, with its people, computers and the sun on its windows, from a sunny 20 °C, while it is open. A unit cools the rooms people use, and works less efficiently the hotter it gets. It runs when the sun shines, so your solar covers much of it, but it adds to the summer middays on the grid.",
      ),
      p(
        "A ground-source heat pump cools for next to nothing: in summer, water from the probes runs through the floors, and only the pump draws power. Most homes on one use it, and no longer need an air conditioner — gently: it takes the edge off the hottest days.",
      ),
      note("Who has air conditioning isn't on any register, so the game draws it, building by building. Cantonal rules on new air conditioning, and fans, blinds and night-time airing — how most Swiss homes keep cool — aren't in the game."),
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
        "Both shape every heating decision: an option the site rules out isn't on offer, and noise measures and borehole conditions add to the price. A building replacing a heat pump with its like keeps its boreholes or wells and its permitted spot. The Ground heat view shows the canton's map, and what it means for each building.",
      ),
      p(
        "If a fossil heating ban is in force and nothing else is possible (no heat pump fits, because of the ground, the noise or a full grid, and no district heating reaches the building), the owner may install a new gas or oil heating as an exception, as cantonal energy law allows. The building's heating history says so. Bringing district heating to such streets, or room on the grid, is the way out.",
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
        "District heat reaches a building through pipes under its street, so a building can switch to it only if a street it borders is piped (a corner building has two chances) and those pipes lead to a heat source in service. It still has to want to: owners connect when their heating is next replaced, if district heat is the better deal, and new buildings when they are permitted. Once connected, a building stays: a first connection costs around CHF 22,000 for a house, while renewing a connected building's substation costs around CHF 9,000. The district heating connection grant (Town hall → Measures, Heating) takes a flat sum off a first connection — tipping some owners toward district heat, and prompting a few to give up a working boiler early. Every network in the game runs hot enough for radiators and hot water, so a connected building needs nothing else.",
      ),
      p(
        "A town starts with the networks it really has — their plants, what they run on and how big they are, as their operators report them. Some run on wood or waste heat with an oil boiler for the coldest days; some on oil or gas alone. Whatever pipes hang together form one network: when two meet, they share their heat sources. The municipal utility runs them all: it sells the heat at the district heating price (Town hall → Prices), pays for making it and for the upkeep of the pipes and plants, so a network full of customers earns money while a long pipe past few buildings costs it.",
      ),
      p(
        "Every network has boilers for whatever its clean sources can't deliver, so a network never runs out of heat — only out of clean heat. On a cold day the clean sources run flat out and the boilers make up the rest, burning oil (or gas). A source sized at half the peak already covers most of the year's heat, since the coldest days are few; covering the whole peak keeps the boilers cold. A network's card in the District heating tool (click it on the map) adds its clean sources up against its winter peak: the room left before the boilers start, or — if they have to — how much of the peak they make and how much heat they burn a year, projected from the weather. See \"Heat for district heating\" for adding sources.",
      ),
      p(
        "To extend the pipes, open the District heating tool and click streets: each click picks one stretch between two junctions (click again to drop it; footpaths among the buildings count as streets), and the buildings it would newly reach light up in orange. An extension must connect to the network or a heat source, directly or through the other streets you picked; a picked street that doesn't shows in red until the gap is closed. Every street the network could run along is shaded grey. The drawer shows the extension's length, cost and build time, and how much heat the buildings it reaches use a year — in total and per metre of pipe, the figure planners judge an extension by. Ordering pays the whole cost at once; the pipes are laid over the following months, and buildings along them can connect as soon as they are done.",
      ),
      p(
        "Streets aren't the only way across. ‘Lay a direct line’ in the same section runs a pipe off the streets from one street junction to another, along a course you draw: click where it starts, then along its way — every click is a bend, and the last one is where it ends. Each end joins the nearest junction, and one of them has to be on the network (a piped street, a line or a plant's junction). Going round the built-up areas through fields is longer but can come cheaper. Use it to bring a plant's heat across town the short way, or to join two networks without going round by the streets. A line carries heat across, but nobody connects along it.",
      ),
      list([
        "Open land — fields, meadows, woods: under half the price of a metre under a street.",
        "Gardens, yards and car parks in the building zone: about a street's price — the surface has to be put back and the owners agree.",
        "Roads crossed: two and a half times a street's price for each metre of road, dug up under traffic.",
        "Under buildings: six times — a bored tunnel, and the owners' leave.",
        "Across a river or lake: five times.",
      ]),
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
        "New heat sources are ordered in the District heating tool, under New heat. Each feeds in at the street junction nearest to it: if the pipes don't reach there, extend them to it — or build a new network from it, street by street. A town with no district heating at all starts that way. A plant takes one to two years to build, longer with a trunk line, and is paid when ordered. Where the size is yours to choose, bigger plants cost less per MW. A plant you draw on in part — 2 of the 5 MW a treatment plant could give, say — leaves the rest on offer, for another plant there later; each such stage pays its own fixed costs and trunk line, so taking it in steps costs more in all.",
      ),
      list([
        "Incinerator waste heat. A waste incineration plant within reach can sell the town some of its heat — what it doesn't already deliver or turn into electricity. A heat exchanger station, and a trunk line if the plant stands outside the town; the heat is bought per kWh, cheaply.",
        "Industrial waste heat. Some firms throw away heat — cooling water, exhaust — and would sell it, each from a year of its own, when it reviews its energy. Someone has to ask: the district heating advisor (see \"Advisors\") finds the firms ready to sell, in each yearly report, and you can take the heat up from the report. Its size is what the firm has; the utility pays for the heat exchanger and the connection, then a fixed sum a year. Once found, the offer stays open, and shows on the map. Without the advisor, no firm's heat is found.",
        "Data centre waste heat. If a data centre has come to town (see \"Businesses & industry\"), it offers the heat of its cooling water — 25–35 °C all year — for a token payment. A heat pump lifts it to the network's temperature, an easy lift, so it runs on little power: a large, cheap, steady source. Its size is what the data centre gives; the utility pays for the heat pump and the connection.",
        "Waste water. A treatment plant's cleaned water stays at 10–20 °C all year: a heat pump on it gives cheap, steady heat. The plant is public, so there is nothing to pay for the heat itself — only the heat pump, its power, and a trunk line if the plant is outside the town. How much it can give depends on the plant.",
        "Groundwater. A heat pump on wells into the aquifer, anywhere the canton allows groundwater use (shaded on the map while you place it) — but not in the protection zones around drinking-water wells. A few MW at most per plant, and a yearly water-rights fee.",
        "Rivers and lakes. A heat pump on a river or lake, standing no more than 100 m from the water. The water never runs out, so the size is yours — but it is coldest in winter, about 4 °C against 20 °C in late summer, and the heat pump works hardest for its heat just when the network needs the most: it needs about half as much power again for a kWh of heat in February as in August.",
        "Wood. A wood chip combined heat and power plant, anywhere in the municipality: heat for the network and power for the grid. To stay renewable, new wood plants together may burn no more than the town's own forest grows — in many towns, not much. And its neighbours mind the lorries and the chimney: homeowners and tenants within 300 m hold it against you for as long as it runs, more the more homes are near.",
      ]),
      p(
        "Running costs differ: waste heat costs least to run, then the heat pumps (their electricity), then wood (the chips, less the power it sells). A network uses its sources in that order, and the boilers last. Every source also has a yearly upkeep for its size, whether it runs or not. A heat pump's electricity is part of the town's: the utility buys it hour by hour with everyone else's — so midday solar can run it in spring and autumn, and in a winter cold spell it adds to the power bought when power is dearest — and it shows in the town's electricity (Statistics → Electricity, and the Year in Review's electricity by use) and counts with the town's electricity in the emissions. Wood and waste heat count as clean, as in the national inventory; the boilers count their oil or gas. The heat pumps stand on the medium-voltage grid, not on a neighbourhood's transformer station.",
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
        "On-street chargers hang off their neighbourhood's station like the houses around them. A fast-charging hub, a lorry charging park and a district heating plant's heat pumps are big enough to get a transformer of their own on the medium-voltage grid — it comes with them, in their price — so they don't load the neighbourhood's.",
      ),
      p(
        "Twice a year the utility reads its meters: after the winter (the highest draw, on the coldest evenings when heat pumps, cooking and cars plugging in come together) and after the summer (the highest feed-in, on the sunniest middays when rooftop solar pushes power back up the line). The Grid tool colours every building by how loaded its station was at the last reading, marks the stations and outlines the area each one serves; pick a station or any building to highlight its area. The drawer ranks the areas and shows each one's peaks against its capacity.",
      ),
      p(
        "An area whose peak is over its station's capacity — either way — is overloaded, and new connections there wait until a reading shows room again:",
      ),
      list([
        "Over the winter peak: no new heat pumps, wallboxes or business depot chargers (replacing one keeps its connection). Households charge in public instead, if they can.",
        "Over the summer feed-in: an owner's new solar array over 30 kWp connects only with a grid-friendly battery that keeps its feed-in to half its rating (see \"Home batteries\"). Household systems and what the building code requires still connect. Your own large arrays — the utility's on rented roofs, solar on public buildings, canopies over the town's car parks — wait until the area is reinforced: their cards say so, and the programmes pass such roofs by.",
        "New buildings are always connected.",
      ]),
      p(
        "Nobody reinforces the grid but you, paid from the treasury — though Swissgrid shares out what solar costs the grids nationally: for every kW of new solar on the town's grid (rooftops and car-park canopies), it pays CHF 59 each spring for the year before, whether you reinforce or not. Reinforcements for heat pumps and chargers get nothing; what you invest beyond the compensation comes back slowly through the network fee (see \"Tariffs & energy prices\"). For an overloaded area, open the Grid tool: reinforce its station, or add a neighbourhood battery (250 kW, 500 kW or 1 MW, storing two hours; ready after six months, and cheaper over the years). A battery takes the top off the area's peaks, the winter evening draw and the summer midday feed-in alike — at most its power, and only as much as its storage lasts: the evening peak builds over several hours, so a small battery shaves less than its power, and a big one against a small area far less than its power.",
      ),
      p(
        "Reinforcing puts in a new station of the size you choose, cables included, ready after nine months. A new station replaces the old one whatever its size, so going straight to the size you will need costs less than getting there in steps — but the money is spent now. One order per station at a time.",
      ),
      p(
        "Tick ‘Reinforce overloaded stations automatically’ in the Grid tool and it is done for you: after each reading, every overloaded station with nothing on order gets the size its peak needs with a quarter to spare, worst first, as long as the treasury has the money. One it can't pay for waits for the next reading.",
      ),
      p(
        "Neighbourhood batteries also earn their keep: when the town makes more power than it uses — sunny middays, once there is a lot of solar — they take in what they can of the surplus, which would otherwise sell cheap, and give it back in the evening, when the utility would have to buy it (see \"Tariffs & energy prices\"). Each takes in at most its power at any moment, and fills once a day.",
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
        "Roofs face every way: south at 30° on one house, east and west at a shallow tilt on the flat roof next door, south-west on the one after. Each building's panels have their own orientation — its panel shows which — and that sets when in the day they make the most: east in the morning, west into the evening, south around noon. Over a year a south-facing roof makes a little more and an east- or west-facing one a little less — and its owner weighs panels on what their own roof would make, so south roofs go solar a little sooner — but together the town's roofs spread their output over the day, so its midday peak on the grid is lower than if every panel faced the same way.",
      ),
      p(
        "Every year, each building without panels has a chance that its owner seriously considers them. That chance grows for a few years after the heating is replaced (a natural moment to think about the roof), the more neighbours already have panels, with the municipality's solar campaign, and as panels get cheaper (see \"Technology prices over time\"). Buildings over 200 years old are treated as protected and don't get panels.",
      ),
      p(
        "Some roofs never get panels, however good the deal: about one building in five has a roof that faces the wrong way, lies in the shade of its neighbours, trees or the hillside, or is too cluttered with dormers, skylights and chimneys to be worth it — one in three among buildings from before 1920, with their complex roofs and protected streetscapes. So does a roof too small to hold a worthwhile array. Buildings put up while you're in office are designed with panels in mind. Such a roof can't be rented for the utility's solar either, nor a public building's roof given panels.",
      ),
      p(
        "An owner who considers it compares a system covering the usable part of the roof with going without: its price (cheaper per kWp the bigger it is), less the federal payment every installation gets and any municipal subsidy, against the electricity it would save and what it earns feeding the rest into the grid at the feed-in price. Panels get more efficient over the years, so the same roof holds more later. A municipal subsidy is paid from the treasury the day a building installs.",
      ),
      p(
        "Finding that panels pay isn't the same as putting them up. Nothing forces the question the way a broken boiler does, and an array is a sizeable sum, paid up front — the federal payment and any subsidy only come months later. So an owner who finds solar pays still has to clear two hurdles, and an owner who doesn't may look again a year or two later:",
      ),
      list([
        "Now, or later: most put it off — only about a third go ahead there and then. At a natural moment far more do: in the years after the heating was replaced, or with a roof contract offer on the table. A Solar check (an information measure: a free visit, quote in hand) brings it to about half.",
        "The money: a house's owner pays from their savings, which differ from owner to owner; many can't put up a large array's price at once. PV loans (a subsidy measure) lend the difference, up to the amount you set, and the treasury buys down the interest — about 8% of each loan, paid when it is taken. An apartment building's owners have more to spend, but they have to agree — condominium owners among themselves, a landlord who pays while the tenants save — and often don't. A business has the money, but builds only if the array pays back quickly enough for it, typically within 6 to 12 years.",
      ]),
      p(
        "Owners who wanted solar but held back aren't lost. Supporting a solar cooperative (a subsidy measure: a start-up grant, and a grant per kWp) puts residents' savings to work on their roofs: the cooperative asks each such owner once, while their interest is fresh, and builds at no cost to them where the power, sold to the building at a discount, pays back the panels with a little to spare — a handful of roofs a year. They are also the owners most open to the utility renting their roof (see \"Roof contracts\"). A building's panel says why its owner held back, and when.",
      ),
      note("A building puts up panels once; they last about as long as the game. Panels on a building that is torn down go with it. Which roofs are unsuited, and what each owner could pay or would wait for, are the game's draws, not a survey of the real owners."),
    ],
  },
  {
    id: "roof-contracts",
    title: "Roof contracts",
    blocks: [
      p(
        "Many large roofs stay bare even where panels would pay: the owner lacks the cash, the time, or the interest. The utility can step in — rent the roof and put its own solar on it, as many Swiss utilities do. Open the PV Contracting tool: it shows every roof of a building over 360 m² by where it stands, and the drawer sets the rent you offer, per m² of roof the panels cover, a year.",
      ),
      list([
        "Offering: click a roof to see what an array there would mean — its size, what it costs to build, what a year of its output saves, the rent and the upkeep — and offer its owner the contract. Roofs are offered one at a time; the drawer says how many owners in ten would say yes at your rent, and the roof solar advisor (see \"Advisors\") ranks the roofs that would return the most.",
        "The answer comes within weeks. Some owners take your letter as a prompt to look into solar themselves, and put up their own if it pays. The rest weigh your rent against what they want for their roof — which differs from owner to owner, most somewhere around CHF 1–4 per m². Offer more and more say yes; but every franc of rent comes out of what the array earns. Owners who wanted solar of their own but held back — kept putting it off, couldn't raise the money, couldn't agree — ask much less: for them, the contract is the way to panels. A no means you can't ask again for three years.",
        "Building: once an owner accepts, you have a year to build — the drawer lists the roofs waiting, or tick its box to build as soon as an owner accepts. You pay what the owner would have paid, less the federal payment every installation gets, as an investment you may borrow for. The panels are in service about four months later. Where the grid is full at summer middays, neither offer nor build goes ahead until the area is reinforced (see \"The electricity grid\") — an accepted roof waits in the drawer, and lapses after its year if the grid isn't ready.",
        "Earning: the arrays are the utility's. It pays no feed-in for what they make; their power saves buying from the wider grid at the wholesale price — or, at a sunny midday when the town already makes more than it uses, sells at the spot price. Against that it pays the rent and the arrays' upkeep, every year. Big roofs pay well; small ones barely cover their costs.",
      ]),
      note(
        "What each owner wants for their roof is the game's guess, as is how many look into solar of their own. Contracts run as long as the panels; owners never cancel them, and the arrays last the game.",
      ),
    ],
  },
  {
    id: "car-parks",
    title: "Solar over car parks",
    blocks: [
      p(
        "A canopy of solar panels over a car park makes power where it is used, shades the cars, and needs no land that isn't paved already. The Car parks tool shows the town's open-air car parks of about 20 spaces and up — not multi-storey or underground ones, nor parking along the street — coloured by whose they are and what is built over them. Click one to see its card: its spaces, the building it goes with, what a canopy would make and what it would cost.",
      ),
      list([
        "Size: a canopy covers the parking spaces, not the aisles — about 2.7 kWp a space, so a 100-space car park carries some 270 kWp. Its panels lie low, tilted south or in rows facing east and west. It costs more per kWp than a roof, for the steel: about CHF 2,300 per kWp for a small one, falling to CHF 1,500 for the biggest, less the federal one-off payment every installation gets.",
        "The town's own: car parks by its schools, sports halls and the hospital, and those open to everyone that no shop or company goes with. Order a canopy on one from its card, or have a few built each year with the measure ‘Solar over the town's car parks’ — the ones that pay back best first. The treasury pays; what the panels save the building next door and earn feeding in is credited to you, as for \"Public buildings\".",
        "Private ones: a shop's, a company's, a housing estate's. Now and then the owner looks into a canopy: its building takes part of the power by day — up to about half of what it uses — and the rest is sold at the feed-in price. A canopy lasts thirty years, but a business wants its money back within about twelve: worth it if what it saves and earns in that time beats the cost and the upkeep, weighed like every investment (see \"When things wear out\"). The dearer electricity and the better the feed-in price, the better the deal.",
        "The car park solar subsidy: a municipal payment per kWp for a private canopy, on top of the federal one. Business welcomes it.",
        "The solar duty for large car parks: a law that every car park over a size (20, 50 or 100 spaces) must have a canopy within so many years — each owner by its own date in that time, the town's own car parks included, at the treasury's cost. The subsidy still applies to private ones. Owners — business above all — dislike it, the more so the smaller the car parks it reaches and the less time it gives.",
      ]),
      p("Canopies feed into the station of the transformer area they stand in (see \"The electricity grid\"): a big one adds to its summer feed-in, like a big roof would."),
      note(
        "The car parks come from OpenStreetMap: those its mappers have drawn, so a few may be missing, and where a car park's number of spaces isn't recorded it is worked out from its area. Whose a car park is comes from what it is mapped as (for customers, private, open to all) and the building beside it — the game's best guess. A building takes its share of a canopy's power by a rule of thumb rather than hour by hour.",
      ),
    ],
  },
  {
    id: "agri-pv",
    title: "Agri-PV",
    blocks: [
      p(
        "Solar parks on open land are all but impossible in Switzerland: outside the building zones, the land is for farming. Agri-PV is the opening — panels high above the crops, or in rows between them, on fields that stay farmed. As with wind, a field goes a long road: a zone, a permit, the build. The Agri-PV tool shows the town's farmland — the green fields outside the building zones, one parcel's field each, with its local name — and where each one stands.",
      ),
      list([
        "Zoning: click farmland to pick it, and put the picked fields forward as an Agri-PV zone. It costs the planning work, always goes to a public vote, and comes into force two years on. People mind: the landscape and the food land weigh against it, prime cropland most of all (the canton's Fruchtfolgeflächen); the climate-minded and business are for. Part of the opposition stays for as long as the zone is there.",
        "Acceptance: at first, a zone is a hard sell — expect to lose early votes. The Agri-PV dialogue (an information measure: field visits, farmers who already harvest under panels, round tables) brings people round year by year, and every field they get to see in service helps a little. Acceptance softens the opposition to new zones and to those in force alike, though some will always mind — and it brings farmers round too.",
        "The farmer: whoever farms a zoned field has the last word, and no one knows beforehand whether they'd have panels over it. At first about a third would. A developer asks before taking a field up; so can you, from the field's card. A no stands for three years, and the field shows grey on the map until then. As acceptance grows, more farmers come round, so a field turned down early may say yes later. Each farmer also names their own rent for the land, some well above the usual.",
        "The permit: with the farmer's yes, someone takes the field up and applies — for the canton's permit to build outside the building zones, which asks that the farming goes on, and the building permit. It takes a year, and isn't a formality: about one in eight is refused outright, the canton finding the farming wouldn't gain enough to justify building outside the zone. Of those granted, nearly half are appealed, by landscape protection or neighbours; the courts then take one to three years, and strike about a third of them down. A field refused or struck down rests three years before anyone may take it up again.",
        "The build: a year, over the whole field, at CHF 600–1,000 per kWp — the bigger the cheaper, more for tracking and overhead rows — and then a yearly rent to the farmer, and the upkeep.",
      ]),
      p("Three kinds of developer take fields up:"),
      list([
        "Businesses with a big electricity use look into the zoned field nearest to them now and then. They take its power as it comes, under a power purchase agreement, up to about 60% of their own use, instead of buying that energy from the utility (they still pay the network fee); the utility buys the rest at the feed-in price. Whether it pays depends on your prices: the dearer your energy price and the better the feed-in, the better the deal.",
        "Energy cooperatives — residents pooling their savings — look into each free zoned field now and then. They sell all its power to the utility at the feed-in price, and take a field up if that pays for it with a little to spare. They can raise up to about CHF 3 million, so the largest fields are beyond them. Your feed-in bonus is what moves them (see \"Tariffs & energy prices\").",
        "The municipality: pick a zoned field no one has taken up — on the map, or in the tool's Build tab — ask its farmer from the card, and with a yes apply for the permit; once the permit stands, order the panels. Both are paid from the treasury. The field is the utility's own: it pays no feed-in for the power and buys that much less at the wholesale price, while the upkeep and the farmer's rent show in its accounts.",
      ]),
      p("A business or a cooperative builds as soon as its permit stands; you decide when to build yours. For your own fields the town clerk writes how the permit fares (Inbox → Advisors & projects)."),
      p("Each field suits one of three kinds of installation, which sets how much it holds and when in the day it makes the most:"),
      list([
        "Vertical rows — bifacial panels standing between the crops in north–south rows, one face to the east, the other to the west, with wide gaps for the machines: about 0.3 MWp per hectare, making most in the morning and the late afternoon.",
        "Fixed rows over orchards and vines — panels high above the trees, sheltering them, facing south: about 0.8 MWp per hectare.",
        "Tracking rows — panels turning from east to west through the day over a field: about 0.5 MWp per hectare, making the most per kWp, over a long day.",
      ]),
      p("Cropland takes vertical or tracking rows, which leave the machines room; meadows, orchards and vines any of the three. Hover over a field on the map to see which it suits, and how big it would be."),
      p("The fields feed into the town's grid like any solar and count against its emissions."),
      note(
        "The fields are real (the canton's land cover and cadastral parcels, outside the federal building zones); which kind each suits, which businesses and cooperatives invest and when are the game's. How willing each farmer is, and the rent they ask, are the game's too. How fields connect to the grid isn't modelled yet: they feed into the town as a whole.",
      ),
    ],
  },
  {
    id: "wind",
    title: "Wind power",
    blocks: [
      p(
        "A wind turbine makes most of its power in winter, when solar makes least — just when Switzerland is short of electricity. But the road to one is long, and it can fail at every step. Open the Wind tool to take it, one step at a time.",
      ),
      list([
        "The study (a year, CHF 120,000): until then nothing is known. It finds where turbines could stand — at least 400 m from every home, outside the building zones, off the water, with enough wind 125 m up (the federal wind atlas) — grouped into a few sites, each with its wind, its output and the homes within a kilometre. It may find nowhere.",
        "The zoning plan (two years): a special-use zone for the park, which always goes to the voters. The town as a whole is split — the climate-minded for, homeowners against — and the homes within a kilometre of a turbine mind most: the more of the town's homes are that close, the harder the vote. Voted down, the site can be taken up again after four years.",
        "The permit (a year and a half): the environmental impact assessment and the building permit. Then, more often than not, an appeal — landscape and bird protection, neighbours — which takes one to four years in the courts. Sometimes the court upholds it, and the permit is void: the site rests four years, then starts again from the zoning plan.",
        "The build (a year): about CHF 8 million a turbine, half of it paid by the federal investment contribution; the rest is the utility's, an investment it may borrow for.",
      ]),
      p(
        "The turbines are the utility's: what they make saves buying power at the wholesale price (no feed-in is paid for it), against about CHF 190,000 a year of upkeep per turbine. They turn with the weather: windier in winter, and windy when the weather systems bring cloud — when solar is weak. Their output is counted with the town's solar as local generation. The homes within a kilometre keep minding them for as long as they turn.",
      ),
      note(
        "The turbine is a generic modern one for low wind (4.2 MW, 150 m rotor). The sites and their wind are real, from the federal wind atlas; the weather that turns them is the game's, scaled so a year gives what the atlas says. The canton's own wind planning isn't in the game, nor are bird and bat surveys, the military or air traffic — which in reality rule out more sites still.",
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
        "Where someone lives matters too. The federal public transport quality classes grade every place from A (very good: a busy station or tram stop close by) to D (basic), by how near the next stop is and how often it is served; beyond them there is next to no public transport. The better served a home, the likelier its people take public transport — in a town with both very good and very poor service, from about a third of people down to well under a tenth — and the likelier the rest drive. The town as a whole keeps the average split: what changes is where the cars are, and so where chargers are needed, not how many. A home's panel shows its class.",
      ),
      p(
        "Separately, a car wears out after about 14 years and a bike after 8–10, and is replaced by the same kind. Whether the new one is electric is a real choice, made like a heating replacement (see \"When things wear out\"): the price less grants, the running costs (electricity against petrol, at the prices in Town hall → Prices), and how the owner leans. The electric share at the start is the town's real one, from the federal vehicle register.",
      ),
      p(
        "An electric car needs somewhere to charge: at home, with a wallbox, at the household electricity price — or at public chargers and, for some, at work, at their price and with the hassle. A household weighs the two and takes the cheaper; with neither, an electric car isn't an option (see \"Public charging\"). About a third of electric car owners wait for the night rate, if the car will still be charged by morning; a day's driving takes 6–16 kWh.",
      ),
      p("A home's panel shows how its people get around, and every change of car, bike or habit."),
      note(
        "E-bikes use too little electricity to show, and an ordinary bike almost always wins over an e-bike on price. How much likelier public transport is in each class is a rough estimate from the federal mobility survey; the classes themselves are the Federal Office for Spatial Development's.",
      ),
    ],
  },
  {
    id: "public-charging",
    title: "Public charging",
    blocks: [
      p(
        "Charging at home takes a wallbox, and a wallbox takes a parking space of your own and the owner's permission: most house owners may put one in, only about a third of flat-dwellers. The right-to-charge law makes landlords and owners' associations allow it, so more may. Being allowed isn't having one, though: a household puts in a wallbox when it buys an electric car, and only if that pays — about CHF 2,500 at a house, 4,000 in a block of flats' shared car park, 5,500 where only the law got the landlord to agree, spread over the wallbox's 15 years, on top of the electricity at the household price. It keeps the wallbox for its next cars.",
      ),
      p(
        "Public charging competes with that, and for the many who may not put in a wallbox it is the only way. How well it works is a matter of degree: the quality of public charging, from 0 to 100% — roughly, how much of your charging you can do without trouble.",
      ),
      p(
        "Each public charger offers it to the homes around: best close by, fading with the distance along the streets — not as the crow flies, so a railway or a river with no crossing near counts against it:",
      ),
      list([
        "On-street chargers — up to 90%: the car charges overnight while you sleep, so it must be a walk away. Full within about 200 m on foot, gone by 500 m.",
        "Fast-charging hubs — up to 50%: a weekly stop with a wait. Full within about 1 km by road, fading out by 4 km.",
        "Shops' car parks — up to 30%: a top-up while you shop. Within about 500 m by road, fading out by 3 km. Some come with the town, and private operators equip more; you can't build them.",
        "Charging at work — 45%, for drivers whose employer has chargers in its car park: about one in eight today, more each year as employers equip theirs, and more with the workplace charging programme. It doesn't depend on where you live.",
      ]),
      p(
        "A busy charger is less use. Once an on-street charger is more than about 60% full, finding a free spot gets harder, and when full it is worth less than half as much; a hub hardly suffers until it is nearly full. A quarter over its room, a charger takes nobody new.",
      ),
      p(
        "Charging at work also shows up in the town itself — not the residents' (most of them work elsewhere), but that of everyone who works here. Each building has its jobs, from the federal business statistics; of the staff, those who come by car (fewer where public transport is good), drive an electric one and have an employer with chargers charge there on working days, a commute's worth each. Their cars are the region's, so they go electric at the region's pace; the workplace charging programme decides how many employers have chargers. Most charge as soon as they arrive, around 8 in the morning. With the programme set to charge with the sun, load management spreads most of it over the town's solar hours that day (or, on a day without, over the middle of the day), where its own solar has power to spare — a little dearer, but it eases the grid on sunny days. A building's card shows its jobs and the staff cars charging there.",
      ),
      p(
        "How full a charger is counts everyone who relies on it, not who is there at the moment. Nobody charges in public every day: on the street a car plugs in two or three evenings a week and stays until morning, at a hub it stops for about half an hour once a week or so. So a charger with no room left still stands empty much of the day — on the street during the day, at a hub at night. A charger's card shows both: how full it is, and who is plugged in right now.",
      ),
      p(
        "Different kinds of charging add up, each covering part of what the others leave: an on-street charger next door (90%) and charging at work (45%) make 95%. Two of the same kind don't: two hubs do the same job, so only the better one counts.",
      ),
      p(
        "Below 10%, public charging can't be relied on. Above, relying on it costs the chargers' price plus a hassle that shrinks as the quality rises — about CHF 750 a year at 10%, about CHF 130 with an empty on-street charger next door, which makes an electric car about as good a deal as a petrol one. A household that may put in a wallbox takes whichever is cheaper; one that may not has only this, and with too little of it an electric car is ruled out when the car is next replaced. So where chargers are, how busy they are and what they cost tips many decisions — cheap, good public charging even keeps some from putting in a wallbox. A car charging in public does its charging at its chargers in proportion to what each contributes.",
      ),
      p(
        "People don't stay loyal to a charger: once a year, and whenever a charger within their reach opens or grows, those charging in public look again — and move to better chargers, or put in a wallbox, if that saves them at least CHF 100 a year. So a new charger soon takes the pressure off crowded ones nearby, which then have room for newcomers. Businesses' vans and lorries do the same, and may move to a charger in their own yard.",
      ),
      list([
        "On-street chargers are cheap to build and to charge at, but serve only the streets around them, and fill up quickly.",
        "Fast-charging hubs cost ten times as much and charge more per kWh, but serve a wide area, hold far more vehicles per point, and being busy hardly matters. A hub alone makes an electric car a close call for many; with on-street chargers or charging at work besides, it tips the balance. Your own hubs charge what you set: cheap, they win over many households — and fill up.",
        "Lorry charging parks are for businesses' lorries and vans only: four or eight high-power bays with room for about four lorries each, serving the whole town. Only the municipality builds them. Around 30 Rp/kWh, they fill up; at 40, only lorries without a depot use them.",
        "Room: an on-street point serves about 3 cars that rely on it fully, a fast-charging point about 50 — a car doing half its charging there takes half as much room. A van needs about twice a car's room, a lorry about twenty times. A charger's card shows how full it is, in percent.",
      ]),
      p(
        "Your own chargers can charge less at some hours (Town hall → Prices, under your public chargers): at night — the night rate's hours — and in solar hours, when the town's own solar and wind are forecast to make more than it uses (see \"The charging tariff\"). While all three prices are the same, nothing changes. Once one is cheaper, drivers move to it:",
      ),
      list([
        "On the street, every car: it is parked from the evening anyway, so the charger charges it in the night hours before the morning, the cars spread through the night. A cheaper night takes charging out of the evening peak. If the solar hours are cheaper still, drivers who are at home on a day that has them — at weekends, and about one weekday in four — plug in then instead.",
        "At a hub, about four drivers in ten stop by when it's cheaper instead: in the solar hours on a day that has them, or late in the evening. At a shop's car park only in solar hours — the shop is closed at night.",
        "At a lorry park, about half the lorries: at their midday break in solar hours, or overnight.",
      ]),
      p(
        "Use spread out of the busy hours gives a hub or a lorry park room for more — up to half as much again if all of its charging moved — so the same points serve more vehicles. On the street there is no such gain: the cars are parked overnight whichever hours they charge in. Drivers weigh what they expect to pay over the year, so a cheap solar-hours price counts for more in a town with plenty of solar, and they welcome cheaper hours a little (see \"Public approval\"). Charging moved into solar hours saves CO₂; into winter nights it adds a little (see \"Emissions & net zero\"). A charger's card shows its prices and the share of its energy sold at each: the cheaper hours earn less per kWh, unless the room they free brings in more drivers.",
      ),
      p(
        "The town starts with its real public chargers, run privately. Private operators react every New Year: where people would have gone electric with an empty on-street charger next door but didn't, they add points to busy sites or open new on-street ones — and where enough such people are left around a large shop, they equip its car park (two a year at most). They charge 45 Rp/kWh on-street and 55 Rp/kWh at fast chargers, and leave hubs to you.",
      ),
      p(
        "To build your own, open the EV charging tool, pick a kind and size, and click where it should go; it lands at the nearest street, and blue lines show how far along the streets it would reach — the stronger, the better the charging there:",
      ),
      list([
        "On-street: 4 points for CHF 60,000, 8 for 100,000 or 12 for 135,000, ready in 4–6 months. It can be enlarged later, for the difference plus CHF 15,000, in three months.",
        "Fast-charging hub: 4 points for CHF 600,000 (12 months) or 8 for 1.05 million (14 months); enlarging costs the difference plus CHF 80,000.",
        "Lorry charging park: 4 bays for CHF 1.2 million (12 months) or 8 for 2.1 million (15 months); enlarging costs the difference plus CHF 150,000.",
      ]),
      p(
        "A charger is paid the day it is ordered; after that, the municipality earns what it sells and pays its upkeep. Building big from the start is cheaper, if the demand is there; build costs follow technology prices. Chargers at the municipality's own buildings are ordered in the Public buildings tool.",
      ),
      p(
        "The EV charging tool shows every charger from green (room to spare) to red (full), larger for more points: yours as circles, private ones as squares, with a black ring around a hub and a violet one around a lorry park. Buildings are green where most households have a wallbox, and elsewhere coloured by the quality of public charging there, from very good to too little to rely on (charging at work, each person's own, aside). The drawer shows how many households have a wallbox and how many more may put one in. The coverage toggles show how far on-street chargers, shops, hubs and lorry parks reach along the streets, so the gaps stand out. The drawer shows how the town's households stand, how many drivers can charge at work, how many wanted an electric car last year but lacked the charging, and for the charger you click: who runs it, its prices and reach, who relies on it, and how full it is, now and year by year. A home's panel shows, for each of its drivers, where their electric car charges — or, if they went electric, whether they could put in a wallbox and at what cost, how good public charging is, and which they would choose.",
      ),
      note(
        "How much each kind of charging does, how fast it fades, how many cars a point serves, the hassle and the chargers' costs are estimates, as are how many drivers move for a cheaper hour and how much room that frees. Which shop car parks count as shops is read from the chargers' names. Charging at work is drawn where people work, off the town's grid, and public charging isn't on a home's bill.",
      ),
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
        "Each vehicle lasts about ten years and is replaced by the same kind of decision as a household's car, only more businesslike. An electric van costs more to buy but far less to run, above all when it charges overnight in its own yard at the night rate — once a charger is installed: a wallbox for a van (about CHF 3,000), a high-power charger and usually a stronger connection for a lorry (about CHF 80,000). Most vehicles at industry and warehouses have a yard, fewer at shops and offices. Without one, a business relies on public chargers, the same way a household without a charger at home does (see \"Public charging\") — a van on-street, at a hub or a lorry park, a lorry only at a hub or a lorry park.",
      ),
      p(
        "Lorries pay the heavy vehicle fee (LSVA) on diesel — about CHF 18,000 a year for a local delivery lorry. Electric lorries are exempt through 2030; from 2031 they pay it too, at a discount that shrinks each year — 70% in 2031, then 50, 30, 20 and 10% — and in full from 2036. Electric lorries keep getting cheaper meanwhile, so for a business with a depot an electric one stays the cheaper choice.",
      ),
      p(
        "But not every lorry can go electric yet: the day's distance and load have to suit one, and a model of the right size has to be on sale. About one lorry in seven has such a route today, most by the mid-2030s, nearly all by 2045 — until then the others stay diesel, whatever it costs. A lorry without a depot needs room at a hub (where it needs as much as about twenty cars) or a lorry charging park, which only you build; a new charger at a depot needs room on the local grid (see \"The electricity grid\"). Vans without a yard rarely go electric: charging in public costs them more than the diesel they save.",
      ),
      p(
        "The electric van and lorry grant (Town hall → Measures) pays a business a flat sum for each electric van or lorry it buys, set separately for each. It weighs into the same decision, so it tips businesses that were close — and, like any grant, is also paid to those who would have gone electric anyway.",
      ),
      list([
        "Their electricity counts as car charging — in the business's yard, or at public chargers.",
        "Their diesel counts toward transport emissions.",
        "A federal end to new petrol and diesel car sales covers vans, not lorries.",
      ]),
      note(
        "How the vehicles spread over the buildings, the share with a yard, prices and mileages (a van 18,000 km a year, a lorry 45,000) are estimates. The law sets the LSVA discount for 2031; the steps after it are the ones expected until the Federal Council sets them. The share of routes an electric lorry can serve is an estimate. Company cars are counted with the households' cars.",
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
      note("On the time-of-use tariff, washing machines don't wait for the night rate — only electric cars do. On the dynamic tariff, some loads are started in the day's cheapest hour (see \"The dynamic tariff\")."),
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
        "Town hall → Statistics opens on the whole town at a glance: its power over the last 24 hours, by use, against what its solar (and wind) made; the town then and now — homes, how buildings are heated, solar, batteries, electric cars, vans and lorries, how residents get around, overloaded transformers, CO₂ per resident — each with a link to its chart; and its energy over the last month or the last 12 months: electricity by use, how much of it the town's own solar and wind covered, and heat by heating system, with the share from oil and gas. Below At a glance come the charts (see \"Charts\").",
      ),
      note("History shows finished days, weeks and months only, so its bars don't change once drawn."),
    ],
  },
  {
    id: "charts",
    title: "Charts",
    blocks: [
      p(
        "The charts in Town hall → Statistics show how the town has changed since you took office. Pick a chart on the left; hover over it to read the numbers for a month or a year. A small grey chart icon next to a panel's title — the grid, a transformer, district heating, roof solar, wind, the modal split, the accounts, approval — opens the matching chart directly.",
      ),
      list([
        "Electricity — what the town used each month, by what used it (homes, businesses, heat pumps, hot water, cooling, electric cars), and what its solar panels and wind turbines made.",
        "Heat by heating system — the heat buildings got each month, by what heated them.",
        "District heat by source — what the networks' plants made each month, and how much the backup boilers burned.",
        "Rooftop solar — how much of what the town's roofs could carry has been built. “Solar and wind built” shows the rating of the rooftop solar, Agri-PV fields and wind turbines together — the dashed line is the part the town and its utility own: their turbines, the arrays on public buildings and rented roofs, the car-park canopies and Agri-PV fields — and “Batteries” what the homes' and the neighbourhood batteries can store.",
        "Heating systems and insulation — the town's heated buildings by what heats them and by how well they are insulated, counted or by floor area. “Heat pumps” shows how much heat they deliver on a cold winter day: what they draw from the grid when it is coldest grows with it.",
        "A transformer — each winter's peak draw and summer's peak feed-in at one station, against its capacity. “Overloaded transformers” counts the stations over their limit at each reading, and “How full the transformers are” sorts all of them by how close they came to it.",
        "District heating pipes — how long the networks are; “District heating's reach” the share of the heated buildings on district heat, and the share it could serve, by buildings, floor area or heat demand; “Clean district heat” the share of each network's heat its clean sources made, the rest coming from its boilers.",
        "Electric vehicles — the share of residents' cars, business vans and lorries that are electric.",
        "Public charging — how full the public chargers are, all of them together, and how many charge points there are; “Charging an electric car” the share of households with a wallbox, and how good public charging is on average for the rest.",
        "Modal split — how residents get around, with the share of electric cars.",
        "Approval — month by month, against the 50% you need on election day, with a mark wherever you enacted, changed or repealed a measure (or the voters struck one down): hover the month to see which.",
        "Treasury and debt — the balance at the end of each month, and what the town owes, its loans and any overdraft.",
        "Emissions, spending and the utility's accounts — year by year, as each year is counted and booked. Spending can show one kind on its own, and the utility's accounts any one of their lines, month by month — what the power bought costs before and after your turbines and batteries, say.",
      ]),
      note("Monthly charts fill in as each month ends; yearly ones with each Year in Review. Readings of the grid come after each winter and each summer, as in \"The electricity grid\"."),
    ],
  },
];

/** The wiki's contents: every section, grouped by what it is about. */
export const WIKI_GROUPS: WikiGroup[] = [
  {
    id: "start",
    title: "Getting started",
    blurb: "What the game is, how to find your way around, and how time passes.",
    sections: ["overview", "controls", "map-layers", "time", "year-in-review", "saving", "sound"],
  },
  {
    id: "governing",
    title: "Governing",
    blurb: "What you can decide, what people think of it, and what you are aiming for.",
    sections: ["measures", "approval", "information", "advisors", "letters", "emissions", "score", "leaderboard"],
  },
  {
    id: "money",
    title: "Money",
    blurb: "The treasury, the utility, borrowing, and the prices you set.",
    sections: ["municipal-finances", "borrowing", "tariff", "dynamic-tariff", "charging-tariff"],
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
    sections: ["grid", "solar", "roof-contracts", "car-parks", "agri-pv", "wind", "home-batteries"],
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
    sections: ["appliances", "finances", "statistics", "charts"],
  },
];
