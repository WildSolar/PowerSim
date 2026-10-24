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
    version: "0.10.0",
    date: null,
    added: [
      "Agri-PV: choose the kind of installation for your own fields, and see what each does. A field's card compares the kinds it takes: size, output, how much comes in winter, what its hours are worth, the CO₂ it saves, and a chart of its average summer and winter day. Businesses and cooperatives now build whichever kind pays best for them.",
      "Cheaper hours at your own chargers (Town hall → Prices): a price at night and one in solar hours, for on-street chargers, hubs and lorry parks. Once cheaper, every on-street car charges overnight instead of in the evening (or in the solar hours, on a day its driver is at home), some drivers stop at a hub in the solar hours or late in the evening, and lorries charge at their midday break or overnight. Use spread out of the busy hours gives a hub or a lorry park room for more; a charger's card shows its prices and how much it sells at each.",
      "Solar hours: the hours your town's own solar and wind are forecast to make more than it uses. Utility-controlled wallboxes charge in them when the car is at home — every weekend, some weekdays — and so do staff cars charging with the sun at work. A cheaper charging price in solar hours can make the charging tariff worth more.",
      "A charging tariff (Town hall → Prices): households put their wallbox on its own meter at a charging price you set, with a monthly meter fee, and charge at night only — or whenever the utility decides, for a discount on the network fee that the rest of the town makes up. Those with a wallbox and an electric car sign up on 1 January if it pays for them; the evening peak falls, and electric cars get cheaper to run.",
      "Charging at work in the town: every building has its jobs (from the federal business statistics), and the staff who drive an electric car to an employer with chargers charge there on working days — residents and commuters alike. A morning hump around 8, shown on the building's card, in the statistics and on the grid. The workplace charging programme can now also spread it over the middle of the day, with the sun.",
      "Nine more towns in the canton of Zürich: Dietikon, Dübendorf, Opfikon, Kloten, Bülach, Küsnacht, Hinwil, Wald and Stammheim — from towns of nearly thirty thousand to a handful of wine-growing villages.",
    ],
    changed: [
      "How a decision is likely to be received is now one clear scale of five steps, with a gauge: very unpopular, unpopular, neutral, popular, very popular. When some groups feel strongly for it and others strongly against, ‘splits opinion’ comes on top, instead of a ‘Divisive’ that said nothing about which way the balance tipped.",
      "The Agri-PV drawer is easier to keep track of in towns with a lot of farmland. Four figures at the top. A ‘Needs you’ list: your permitted fields, fields whose farmer said yes, and the next vote. The zones are summed up in a line. Your own fields, businesses' or cooperatives' can be shown on their own. The Build tab lists fields whose farmer agreed first.",
      "Agri-PV kinds now differ more. Fixed rows face south at 30°, like a good roof, and only they hold snow. Vertical rows are the cheapest to build and keep up, tracking rows the dearest.",
      "The utility's own power — Agri-PV fields, wind turbines, arrays on rented roofs — saves buying power at the market price of the hours it comes, not the month's average. Solar at a sunny noon is worth less, morning and evening power more.",
      "Chargers show how full they are in percent — on their card, year by year, across the town and in the statistics — instead of in ‘cars' worth’.",
      "Electricity's CO₂ depends on when it's used: Swiss power is dirtiest on winter nights, when much is imported, and cleanest at sunny middays. Each kWh now counts at the grid's intensity of the moment — the year's average stays as it was. Solar fed in at a summer noon counts for less, a heat pump's winter power for more, and moving use into sunny hours saves CO₂.",
      "Emissions in more detail: for cars, vans and lorries each, the petrol or diesel they burn and what charging the electric ones emits, taken out of the electricity. In the Year in Review, the Overview and the emissions chart.",
      "A fast-charging point serves about 50 cars that rely on it, up from 30 — as many as a busy real station — and a car charges there at about 60 kW on average (a van about 50), as vehicles slow down while their battery fills, so a stop takes about half an hour.",
      "Electric lorries no longer stall in 2031. As Parliament decided in October 2026, they pay the heavy vehicle fee (LSVA) from 2031 at a discount that steps down — 70%, 50, 30, 20, 10% — and in full only from 2036, instead of all of it at once.",
      "Not every lorry can go electric yet: its route has to suit an electric one — about one in seven today, most by the mid-2030s, nearly all by 2045. Electric lorries now catch on more slowly at first, and then steadily.",
    ],
    fixed: [
      "Winning a public vote on a small Agri-PV zone no longer gives the same approval boost as a vote on a law: a vote now counts as much as what is at stake, so a field of a few hectares hardly moves approval, either way. Putting many small fields forward one by one no longer pays.",
      "Households weighing the dynamic tariff reckon with what their electric car actually charges (about 2,200 kWh a year), not nearly twice that.",
      "Electric cars charge at home as they're actually driven: about 2,200 kWh a year at 12,000 km, where they used to draw nearly twice that. They plug in two or three nights a week rather than every night, and those who wait for the night rate charge at some time in the night instead of all at 21:00 — so home charging no longer stops dead at midnight. Less power for the town, a smaller evening peak.",
      "Businesses' electric vans and lorries charge at their depot during the night rate they pay for, spread through the night, instead of all as soon as they're back in the evening.",
      "A public charger's card shows who is plugged in right now — on the street, cars stay overnight once they've charged — and when it's busiest. A full charger no longer looks unused just because nobody happened to be charging at that moment.",
      "Large towns no longer stutter at top speed: the map now updates only the buildings that changed instead of redrawing the whole town, the month's statistics are counted in smaller pieces between frames, and the clock in the top bar redraws ten times a second rather than on every frame. Large towns play smoothly; every town gains a little.",
      "The decision log no longer looks as if owners install gas or oil despite the ban: when an owner weighs replacing a working boiler early and decides to keep it, that option now reads ‘Keep the current oil boiler’, and the outcome ‘kept — weighed switching early’. A gas or oil heating installed under the ban's exception (no heat pump possible, no district heating) shows why.",
    ],
  },
  {
    version: "0.9.0",
    date: "2026-10-19",
    title: "The open beta",
    summary:
      "Commune Zéro opens to everyone, at its own address: commune-zero.ch. Finished runs go on a leaderboard, feedback goes straight from the game to us, and a good run can be shared in a click. The inbox sorts what needs you from what can wait, Statistics opens on the town at a glance, and the game has sound. Underneath, the climate warms, summers bring heatwaves and air conditioning, and Agri-PV permits got harder to win. Six towns to start with — more will follow.",
    added: [
      "A leaderboard: at the end of a run that reaches 2050 (or hands over early), put it on the board for its town, difficulty, starting year and version, under a name of your choice. Leaderboard on the start screen shows every board.",
      "Feedback is sent straight from the game — no mail program or account needed — with your game attached if you like. Have a GitHub account? The form can also open an issue there. About & credits lists the contact address.",
      "Share your result from the end screen — your phone's or browser's share menu, WhatsApp, X, Bluesky, Facebook, LinkedIn, Reddit or e-mail — with a line about your run and a link to the game. Or tell a friend about the game any time: on the start screen, and in the game menu.",
      "Sound: soft clicks, a chime when a letter wants your attention, a chord for the Year in Review — and calm ambient music, made as it plays. Game menu → Sound turns each on or off with its own volume (the music starts off); M mutes everything.",
      "The start screen says plainly that this is a beta, and takes your feedback from right there.",
      "Saves carry over to fix releases: a run saved in 0.9.0 loads into 0.9.1 and every later 0.9 release.",
      "Green bonds can be rolled over: when one falls due within the year, the finance advisor says so, and on their page you can replace it with a new ten-year bond at today's rate — as much as residents will subscribe, the treasury repaying the rest. It adds no debt and carries no earmark.",
      "The installed capacity chart shows, as a dashed line, how much of the town's solar and wind its utility and the town own: their turbines, the arrays on public buildings and rented roofs, the car-park canopies and Agri-PV fields.",
    ],
    changed: [
      "The game has moved to its own address: commune-zero.ch. Saves and settings are kept by the browser per address, so a run saved on the old one (wildsolar.github.io) doesn't show here — sorry, and thank you for playing the early beta.",
      "The climate warms over the years — about a third of a degree a decade, summers faster — and summers bring heatwaves, more often and hotter as time goes on. Winters need a little less heating.",
      "Air conditioning matters now: homes cool on hot days, offices, shops, hotels and hospitals whenever it is warm and they are open, and each hot summer makes it more common — about a third of homes by 2050. A building on a ground-source heat pump cools through its probes for next to nothing. Cooling takes two or three percent of the town's power by the 2040s, mostly at sunny middays.",
      "Agri-PV permits are no formality any more: the canton refuses about one in eight outright, nearly half of those granted are appealed, and the courts strike about a third of those down.",
      "Debt is measured against the department's income averaged over the last three years, so one poor year for the utility no longer cuts what you may borrow at once.",
      "The inbox has four tabs: Votes (what is going to the ballot, the polls and the next election, the results), Requests (with the time each has left), Advisors & projects (reports, your projects' permits and answers, the canton's and the utility's notices) and Letters. Only the first three pop up and count on the inbox button; reactions, moods and complaints wait quietly under Letters. The local paper is gone — what only it reported now comes by letter — and the Year in Review lists the year's votes instead of its headlines.",
      "Fewer complaints: the same complaint comes at most every six months, saying how many households it concerned.",
      "Statistics and Charts are one page: Town hall → Statistics opens on the town at a glance — its power over the last 24 hours, the town then and now with a link to each chart, and its energy over the last month or year, heat included, with how much its own solar and wind covered — and lists the charts below. It opens at once, instead of working out the town's history again each time.",
      "The roof solar advisor's page has the rent slider, and a button to offer the contract to all the roofs it found at once.",
      "The district heating advisor proposes longer runs of connected streets — about a fifth longer.",
      "The Treasury's Accounts, Ledger and Borrowing are listed down the side, as on the Measures and Advisors pages.",
      "The Town hall, the inbox and the wiki replace each other: opening one closes whichever was open.",
      "Loading a town is a little more entertaining: the department settles in while it counts the year so far.",
      "The government's allocation is paid on the last day of each month, rather than the first.",
      "Par is computed again for every town and difficulty — Bonstetten's for the first time.",
    ],
    fixed: [
      "The treasury at year end shown in the Year in Review now matches the top bar: December's allocation, interest and instalments count in the year they belong to.",
      "The advisors' pages no longer say the treasury can't pay for a proposal you haven't acted on.",
      "Residents no longer ask for a measure the voters have just turned down, which couldn't be enacted again in time; and when a vote is called off because its measure was wound up, the town clerk now says so.",
      "Texts brought up to date throughout — measures, advisors, the tutorial and the wiki: what the advisors also do, the grid's hold on your own large arrays, carbon removal measured against your first year rather than 2026, and a few leftovers from earlier versions.",
    ],
  },
  {
    version: "0.8.0",
    date: "2026-10-19",
    title: "Advisors, owners and the grid",
    summary:
      "Advisors get their own page in the Town hall, where you act on their proposals directly — and they unlock things: firms' waste heat, the best roofs and chargers first. Owners who find solar pays no longer all build at once; three new measures — a Solar check, PV loans, solar cooperatives — and PV Contracting help those who hold back. Feed-in follows the federal minimum by plant size and counts in the energy price ceiling, Swissgrid pays towards the grid for new solar, and your own large arrays wait where the grid is full.",
    added: [
      "Advisors have their own page in the Town hall, one sub-page each — greyed out while not retained, and retained or let go right there. The latest report stays on the advisor's page, and you can act on it directly: offer a roof's owner the contract (and build once they accept), order the chargers the mobility advisor proposes, order the pipes the district heating advisor proposes — or look at each on the map first. Each proposal shows what has become of it since. An advisor's letter now just says the report has come, with a link to it.",
    ],
    changed: [
      "Owners who find solar pays don't all put panels up at once: most put it off, as nothing forces the question, and many can't pay for an array up front — apartment owners often can't agree, and businesses want a quick payback. More owners look into it, so the town still gains solar, but at a steadier, more realistic pace. A building's panel says why its owner held back. Three new measures help: a Solar check (a free visit, quote in hand), PV loans for the part an owner can't pay up front, and support for a solar cooperative that puts panels on the roofs of owners who held back. Those owners also accept a roof contract for much less rent.",
      "Solar feed-in follows the federal minimum by plant size: 6 Rp/kWh under 30 kW, the same on the first 30 kW up to 150 kW, none above — big roofs, car-park canopies and Agri-PV fields get the market price. What solar fed in costs the utility above its market value now counts towards the energy price ceiling, as the regulator allows, and the Swiss average your households compare with carries the same cost — so passing it on no longer looks like overcharging.",
      "Swissgrid compensation: for every kW of new solar on the town's grid, Swissgrid pays CHF 59 into the treasury each spring, towards the reinforcements solar makes necessary. Reinforcing for heat pumps and chargers is still yours to pay.",
      "Your own large solar arrays respect the grid: where a transformer area is already over capacity at summer middays, the utility's arrays on rented roofs, solar on public buildings and canopies over the town's car parks can't be offered, ordered or built until you reinforce the area — their cards say so, and the programmes pass those roofs by. (They used to go up with a battery instead.)",
      "Advisors do more than write: the district heating advisor is how you find firms with waste heat to sell — they no longer write on their own (a data centre still does) — and each yearly report lists them to take up; the roof solar advisor makes the ‘Solar on public buildings’ programme go to the roofs that pay back best; and the mobility advisor makes the ‘Chargers at public buildings’ programme go where the demand is. Without them, both programmes pick in no particular order.",
      "The Roof solar tool is now called PV Contracting, and a roof has to be a little bigger to be worth a contract: a building of 360 m² or more, up from 300.",
      "PV Contracting: roofs are offered one at a time — the offer to every large roof at once is gone. And the utility no longer builds the moment an owner accepts unless you tick the box: accepted roofs wait in the drawer for you to build them.",
      "Clearer lists in the Car parks, Agri-PV and Wind tools: each entry shows its colour on the map, its name in full with its size, and where it stands on a line of its own — grouped by state (the town's car parks, those with a canopy, private ones; fields in service, being built, in their permit), long groups folded after a few.",
    ],
  },
  {
    version: "0.7.0",
    date: "2026-10-18",
    title: "Prices, fields and who drives",
    summary:
      "Your electricity price now works as on a real Swiss bill: an energy price you set and a network fee the regulator sets, with feed-in at the federal reference price, a dynamic tariff on the next day's market prices, and big businesses free to leave for the open market. Advisors write once a year with what to do next. Agri-PV gets its own tool and a road like a wind park's — zone, permit, build — with farmers who may say no, and cooperatives and the town itself among the developers. Public transport near home shapes who drives, and a data centre may come to town with heat to spare.",
    added: [
      "Advisors: retain a roof solar, mobility, district heating or finance advisor for a yearly fee, and each writes once a year with what it found — the best roofs for the utility's solar, where the next chargers should go, the streets your network should reach next, and what next year's power will cost before you set your prices. Each pick opens its planning tool there.",
      "Electric van and lorry grant, a new measure: a flat sum for each electric van or lorry a business buys, set separately for each.",
      "Wiki: “All topics” at the top of the contents, and in each article's heading, takes you back to the overview of every topic.",
      "A data centre may come to town: in some municipalities, years into the game, one goes up on open land in a work zone. It draws as much power as thousands of homes — certified renewable, so it adds nothing to the town's emissions — and a year after it opens it offers its waste heat to the utility for next to nothing: a large, cheap, steady source for district heating, through a heat pump.",
      "Agri-PV has its own tool. A field now goes a road like a wind park: you zone it, then someone takes it up and applies for the permit — which may be appealed, and now and then struck down — and builds. Besides businesses buying the power, energy cooperatives may take fields up and sell the power at the feed-in price, and you can develop a zoned field yourself: permit and panels from the treasury, the power the utility's own. The farmer has the last word: no one knows beforehand who would have panels over their field, a no stands for three years, and more farmers come round as acceptance grows.",
    ],
    changed: [
      "The electricity price is now in two parts, as on a real Swiss bill: the energy price, which you set, and the network fee, which the regulator sets cost-plus — the grid's running costs, a small return and the capital cost of what you've built, with what it over- or under-collects handed back over three years. You choose the network fee's shape: a monthly base fee per meter, and how much cheaper the night rate is. The energy price ceiling now holds the energy price alone. Bills show the base fee, and the utility's accounts the energy and network revenue apart.",
      "The dynamic tariff passes on the next day's market prices, published the day before — each hour's day-ahead price and your margin, plus the network fee, flat — so every day has its own shape: deep midday troughs on sunny days, spikes on still winter evenings. Households on it plan their charging, heating and washing day by day.",
      "Solar feed-in follows the federal rules: each quarter's reference market price, weighted by when solar produces — falling as the region's panels crowd into the same sunny hours — with a federal minimum for small plants. What you set is a bonus on top.",
      "Large businesses — 100 MWh a year or more at one site — may buy their energy on the open market, and many already do. Each October, those still in basic supply weigh your energy price for next year against a supplier's offer, and leave for good if the market is cheaper by enough. They still pay the network fee. The Prices tab shows how many have left and the market's offer.",
      "Wholesale power moves every year: the utility buys most of a year's power ahead, a third in each of the three years before, and the rest month by month — so the market's ups and downs reach it smoothed, not flattened. The Prices tab shows what next year's power, mostly bought already, will cost.",
      "Where people live shapes how they get around: the better a home is served by public transport — by the federal quality classes, from a busy station close by to a bus that hardly comes — the likelier its people take it, and the likelier the rest drive. The town's overall split stays the same; cars, and the need for chargers, gather where public transport is thin. A home's panel shows its class.",
      "Zoning is now a view: it shows the town's plan as it is. Rezoning, extra floors, district heating priority zones and high-standard zones are gone, and with them the zoning levy.",
      "Carbon removal contracts are bought and paid month by month, rather than in one bill each January: from the year after a counted year gets the town down to the line, each month buys a twelfth of what that year left, up to the share set.",
    ],
  },
  {
    version: "0.6.0",
    date: "2026-10-17",
    title: "Car parks, district heat and the numbers",
    summary:
      "Solar canopies over the town's car parks: build them over your own, help private owners with a subsidy, or make them by law. District heating's heat pumps now run on the town's own electricity, river and lake ones struggling in the cold, and a network's card tells you when its boilers start. Wood heating is a system of its own. Thirteen new charts show what the town has built and how it lives with it, and the approval chart marks what you decided.",
    added: [
      "Solar over car parks: a new Car parks tool shows every open-air car park of about 20 spaces and up. Cover the town's own with a solar canopy, directly or a few a year by measure; owners of private ones decide for themselves, helped by a new subsidy — or made to by a solar duty for large car parks. Canopies feed into their transformer area.",
      "District heating: a network's card adds up its clean sources against its winter peak — the room left before the boilers start, or how much of the peak they make and their heat over a year (projected).",
      "Carbon removal contracts: the measure shows what they would cost at the share you set, and how far the town's emissions still are from the point where they apply.",
      "New charts: solar and wind built (rooftop, car parks, Agri-PV, wind), batteries, district heating pipes and the share of buildings, floor area and heat demand they reach, each network's clean share, public charging's room against what's taken, the share of households with a wallbox and how good public charging is for the rest, buildings by heating system and by insulation, heat pumps' capacity, how full the transformers are, electric cars, vans and lorries, and the treasury's balance and debt.",
      "The approval chart marks your measures — enacted, changed, repealed or struck down — so you can see what moved it.",
    ],
    changed: [
      "District heating's heat pumps draw their power from the town's own electricity: the utility buys it hour by hour with the rest (midday solar can run them; a cold spell adds to the dearest hours), it shows in the electricity chart and the Year in Review's electricity by use, and it counts with the town's electricity in the emissions rather than district heating's. A river or lake heat pump does worse in winter, when the water is coldest.",
      "Wood heating is now a heating system of its own: the buildings the register lists as heating with wood — logs, pellets or chips, in a boiler or a stove — burn wood pellets, wear out and are replaced like any other heating (by wood again, or by a heat pump, district heat or a boiler). It counts as clean. New wood heating isn't installed where there was none.",
      "Solar on public buildings fits the roofs that pay back best first, rather than in no particular order.",
      "Chargers at public buildings spread out: once a site is placed, the households around it count as served, and the next one never goes within about 300 m of a site still being built. Private operators, too, no longer count demand a site just ordered will meet.",
      "Churches are no longer counted among the municipality's buildings: no solar or chargers of the town's on them, and their roofs can be rented like any other.",
      "Private operators build out public charging faster: new sites where fewer would-be drivers gather, more of them a year, bigger expansions — and up to two shops' car parks a year.",
      "District heating: an incinerator or a treatment plant can be drawn on in stages — what you don't take stays on offer, though each stage pays its own fixed costs and trunk line.",
      "Grid: about a quarter fewer transformer stations, each serving a bit more — bigger ones in large towns.",
      "Home and neighbourhood batteries get cheaper faster, to about half today's price in the long run.",
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

/** The game is in beta (the start screen says so, and asks for feedback). */
export const IS_BETA = true;

/** The public version, as the game shows it: "0.1.0", or "0.1.0-dev" while in development. */
export const VERSION_LABEL: string = CURRENT_RELEASE.date ? CURRENT_RELEASE.version : `${CURRENT_RELEASE.version}-dev`;
