/**
 * In-game wiki content — plain data rather than JSX so a future session can add
 * or edit a section without touching WikiPanel.tsx at all. Keep entries here in
 * sync with what's actually implemented: when a new device/mechanic lands, add
 * or update its section here in the same change (see CLAUDE.md).
 */

export interface WikiBlock {
  type: "p" | "list" | "note";
  text?: string; // "p" | "note"
  items?: string[]; // "list"
}

export interface WikiSection {
  id: string;
  icon: string;
  title: string;
  blocks: WikiBlock[];
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
  {
    id: "overview",
    icon: "🗺️",
    title: "Overview",
    blocks: [
      p(
        "Grid & Ground is an electricity-system sandbox for Schlieren, a real Swiss municipality (canton Zürich). Every building on the map is a real building, sourced from the federal/cantonal building and dwelling register (GWR). What you see happening — lights turning on at dusk, a heat pump ramping up on a cold day, an EV charging overnight — is a live simulation running on your device, not a recording.",
      ),
      p(
        "Click any building to inspect it: its real attributes (construction year, heating system, floor count), which simulated devices it has, and how much power it's drawing right now. Click a dwelling inside a residential building to go one level deeper, down to individual appliances.",
      ),
      note(
        "Where real data exists (which buildings have solar, what heats them, how many dwellings), the simulation uses it. Where it doesn't (who owns an EV, exactly when someone runs their dishwasher), it uses a seeded random model tuned to be physically plausible rather than a guess at any one real household.",
      ),
    ],
  },
  {
    id: "controls",
    icon: "⌨️",
    title: "Keyboard controls",
    blocks: [
      list([
        "Space — pause / resume the simulation (resumes at the speed you paused from)",
        "Tab — step to the next speed (×1 → ×60 → ×720 → … → ×86400, then back to ×1); while paused, resumes at the next speed",
        "W A S D — move the map up / left / down / right, relative to the way you're facing",
        "Q / E — rotate the view left / right",
        "R / F — tilt the view toward the horizon / toward straight-down",
      ]),
      note("Keys are ignored while a panel or window (Control, Wiki, Year in Review) is open, or while you're typing in a text field."),
    ],
  },
  {
    id: "time",
    icon: "🕐",
    title: "Time, weather & sun",
    blocks: [
      p(
        "The game clock starts at today's real date and runs forward. Use the speed buttons in the Info panel to pause, run at real-time, or fast-forward — up to a simulated day passing in about a second. Every device's power draw is a pure function of the exact simulated moment, so jumping speeds never breaks anything: nothing is \"remembered\" between ticks.",
      ),
      note(
        "The clock automatically pauses the instant it crosses into a new calendar year and opens that year's \"Year in Review\" report — see below — so a long fast-forward never blows straight past it.",
      ),
      p(
        "The Info panel shows the current date, weekday, and a day/night indicator that fades smoothly through Sunrise and Sunset over roughly an hour, based on the sun's actual elevation at Schlieren's latitude — not a fixed clock time, so it shifts with the seasons like the real sun does.",
      ),
      p(
        "Weather (temperature, cloudiness, rain/snow) follows a seasonal curve for the time of year plus a slower-moving \"weather system\" and day-to-day wobble, so a warm or cloudy spell persists for a few days rather than flickering every reading. Insolation (solar irradiance, in W/m²) follows the sun's position and cloud cover, and is what drives solar panel output.",
      ),
    ],
  },
  {
    id: "buildings",
    icon: "🏠",
    title: "Buildings & data",
    blocks: [
      p(
        "Every building's location, footprint, address, construction year, floor count, heating system, and (where applicable) building-use class come from the real GWR register — nothing about a specific building's identity or attributes is invented. A building's panel is titled with its real street address (from GWR's building-entrance records) rather than its internal federal building ID, falling back to that ID only on the rare building with no address on record.",
      ),
      p(
        "A building's \"Use\" field (EU-standard building class) is what determines whether it gets residential devices, a commercial category, or both — a building can be both (e.g. shops on the ground floor of an apartment block).",
      ),
      note(
        "Only buildings GWR records as currently standing are included — demolished, planned, approved, and under-construction records are filtered out, so every building on the map is really there today. A handful of standing buildings (mostly transit-stop shelters and other inconsequential structures) are also left out because they have no matching cadastral footprint to draw a real shape for — a small accuracy trade for a visually clean map.",
      ),
    ],
  },
  {
    id: "growth",
    icon: "🏗️",
    title: "Town growth & building renewal",
    blocks: [
      p(
        "The town doesn't stand still. Old buildings get replaced and new ones get built, at rates calibrated to what this municipality really did over the last 15 years (its own construction and demolition history in the federal building register).",
      ),
      p(
        "Renewal: a building is safe from replacement for its first 30 years; after that its chance rises every year it ages. When one is replaced, neighbouring buildings of the exact same construction year often go with it — a housing estate is usually one project. A replacement keeps the address and the footprint but holds 20-30% more dwellings, with extra floors as needed (never towering over its surroundings). Its heating, insulation and solar are decided when the permit is issued, not when it's finished.",
      ),
      p(
        "Growth: new buildings appear at random on vacant building land (zoned for building and still open ground — parks, sports fields, playgrounds, allotments and cemeteries are kept free, as are clearances around roads, rail, forest and water). Each is sized and turned like the buildings around it, apart from the occasional small plot filled with something smaller. The pace is steered toward the municipality's historic growth in floor space. When the vacant land runs out, growth has to come from replacing old buildings with denser ones, so the pace slows.",
      ),
      list([
        "A new or replacement building is mostly heat pumps (fossil heating is not permitted in new buildings by default); district heating only where a network already runs nearby",
        "It is insulated to today's standard, and carries at least the rooftop solar the building code requires — often the whole roof",
        "Each project takes months to permit and one to two years to build. In between, the site shows as an amber construction site and draws no power",
        "The Age layer shows every building by construction era, with buildings built during the game in green",
      ]),
      note(
        "Known simplifications: building sites come from zoning and land-cover data (available for canton Zürich today), so a plot's shape is a rectangle fitted into the free space, not a real design. Existing rooftop solar registered on a building disappears with it. Policies to steer all of this (solar mandates, insulation standards, growth and replacement rates) are wired in but have no controls yet.",
      ),
    ],
  },
  {
    id: "home-electronics",
    icon: "🧊",
    title: "Fridge, lighting & other plug loads",
    blocks: [
      p("Every dwelling has three always-on background devices, each running on its own random but realistic schedule:"),
      list([
        "Fridge — cycles on and off every 20-40 minutes regardless of time of day, the way a real compressor does.",
        "Lighting — a probability of being on that rises at dawn and dusk and drops to near-zero overnight.",
        "Other plug loads — a smooth baseline (routers, chargers, standby power) that's a bit higher during the day than overnight.",
      ]),
    ],
  },
  {
    id: "appliances",
    icon: "🍳",
    title: "Cooking & laundry",
    blocks: [
      p(
        "Cooking draws power in short bursts around breakfast, lunch, and especially dinner — dinner is both the most likely and the widest of the three windows.",
      ),
      p(
        "Washer/dryer loads are episodic: each dwelling has roughly a 1-in-3 chance of running a load on any given day, starting sometime in the daytime hours and lasting 1.5-2.5 hours.",
      ),
      note("Washer/dryer timing doesn't yet respond to the tariff — a natural future policy lever, not implemented yet."),
    ],
  },
  {
    id: "mobility",
    icon: "🚗",
    title: "Mobility: cars, bikes & getting around",
    blocks: [
      p(
        "Every dwelling has one or two independent \"mobility slots\" (biased toward two for larger dwellings — a stand-in for a second person in the household with their own way of getting around, not literally a second car). Each slot independently holds a mode — car, bicycle, or public transit/walking/other — and, for car or bike, a vehicle type on top of that: electric or not.",
      ),
      p(
        "A slot's mode changes through stock renewal too, but differently from heating: roughly every 5-10 years (randomly timed, like a heating system's service life), a \"life event\" — a new job, a child, a move — prompts the household to reconsider, and the slot is reassigned to a new mode drawn at random with probabilities matching the municipality's current mix, so the mix as a whole stays put even as individual households change. That current mix comes from the Switzerland-wide 2021 Mikrozensus travel survey (BFS/ARE: about 69% car, 11% foot/bike, 20% public transit) — the best available real proxy, since no per-municipality modal-split data exists. It overstates car use in cities and understates it in rural areas.",
      ),
      p(
        "Separately, a car or bike wears out on its own schedule (about 14 years for a car, 8-10 for a bike) and gets replaced like-for-like — a car for a car, a bike for a bike — but which vehicle type replaces it is a genuine financial decision, using the exact same four-factor process as a heating renewal (see \"Stock renewal\"): purchase price, running cost (electricity vs. petrol/diesel, both player-adjustable in Control → Prices), a household's own indifference band, and a hidden bias. A car's starting electric/non-electric mix comes from Schlieren's real registered vehicle fleet (BFS's per-municipality vehicle register) rather than a guess.",
      ),
      p(
        "Every mode change and vehicle renewal is logged in plain language on the dwelling's own panel, the same way a heating renewal is on a building's.",
      ),
      p(
        "Responsive EV charging works exactly as before: about 30% of EV-owning slots delay charging until off-peak pricing begins, as long as they can still finish by morning; the rest just plug in and charge immediately. Each session needs 6-16 kWh (a day's typical driving) at a 7.4 kW home wallbox rate.",
      ),
      note(
        "An e-bike's charging draw is real but tiny next to a car's, so it isn't separately modeled — a bike slot never adds to a dwelling's power reading, whichever kind it is.",
      ),
      note(
        "Within a bike slot's own renewal decision, a standard bike currently wins the four-factor comparison almost every time — purchase price dominates, and a bike's electricity cost is too small either way to offset a standard bike's much lower price. A known simplification, since precise e-bike cost data wasn't as readily available as the car and heating figures this is otherwise built on.",
      ),
    ],
  },
  {
    id: "water-heating",
    icon: "🚿",
    title: "Water heating",
    blocks: [
      p(
        "Whether a building's hot water is electric starts from GWR's recorded hot-water energy source — including buildings that use a heat pump for hot water (ground, groundwater, or air-source), not just a plain electric tank. A space-heating renewal (see \"Stock renewal\") that installs a heat pump is assumed to bring hot water production along with it from that point on, even if the building's hot water wasn't electric before — the way a real heat-pump install almost always does.",
      ),
      p(
        "Where it applies, each dwelling has its own morning and evening shower-shaped demand curve, sized to land around 2.5-4 kWh/day per dwelling — in line with a real modern electric water heater.",
      ),
      note("A heat-pump-driven water heater and a resistive tank currently use the same wattage model — a heat pump's real advantage (using less electricity per liter heated) isn't reflected yet."),
    ],
  },
  {
    id: "climate-control",
    icon: "🌡️",
    title: "Space heating & air conditioning",
    blocks: [
      p(
        "Space heating starts from real data: a building has a heat pump if GWR's heating generator or energy source says so (including ground/water/air-source systems even when the generator field is inconsistent) — though what's actually installed can change over time now, see \"Stock renewal\" below. Its power scales with the building's own envelope area (roof + walls) and how far the outdoor temperature sits below a comfort setpoint, divided by a temperature-dependent efficiency (colder outside = less efficient, and a ground/water-source pump's efficiency barely moves with outside temperature at all — its reservoir stays close to a stable ~10°C year-round).",
      ),
      p(
        "How much heat a building loses per degree isn't one number for the whole municipality: it comes from a real construction-era curve (GWR's construction year again — pre-1920 masonry loses heat several times faster than a 2020s new-build), nudged down a little for internal heat gains where a building has more occupants or a recognized commercial use (people, appliances, and equipment all give off warmth for free), and finished with a small seeded per-building variation standing in for everything age alone doesn't explain — a particular building's workmanship, an unlisted renovation, general draftiness.",
      ),
      p(
        "Air conditioning has no real ownership data in Switzerland yet, so it's a seeded random draw biased toward newer and larger buildings — reflecting today's low but rising adoption. Its model mirrors the heat pump's (envelope area × comfort-setpoint gap), with a flat efficiency and a capacity cap standing in for real regulatory limits.",
      ),
      p(
        "Both are gated by the day's characteristic (mean) temperature, not the instantaneous reading — so heating doesn't click on for one cold hour in an otherwise mild week, or cooling for one warm afternoon.",
      ),
    ],
  },
  {
    id: "insulation",
    icon: "🧱",
    title: "Insulation & energy classes",
    blocks: [
      p(
        "How much heat a building loses depends on its envelope — walls, windows, roof — summarized as one U-value. Every building has an energy class read off that U-value: Unrenovated, Partly insulated, Current standard, Minergie, or Minergie-P. Existing buildings start in the class their age (and a little luck) implies; a new building starts in the class the building rules and the insulation standard of its permit give it. The Insulation layer on the map colors buildings by class.",
      ),
      p(
        "Every few decades an owner reconsiders the envelope. Like a heating replacement, the choice weighs cost against benefit: the work above the maintenance that is needed anyway, less the federal building-program grant (and any municipal top-up), against what a year of heating would cost afterwards — with that building's own heating system at current prices. The owner also stays put unless an upgrade is clearly better, and a hidden progressive or conservative streak nudges close calls. A retrofit that leaves the building in a better class lowers its heat demand for good.",
      ),
      note(
        "Because the payoff is lower heating cost, a retrofit tends to pay off on an oil- or gas-heated house and much less on one already heated by a heat pump — cheap heat makes insulation a poorer investment. Costs and grants are ballpark figures, not quotes.",
      ),
    ],
  },
  {
    id: "stock-renewal",
    icon: "🔄",
    title: "Stock renewal: when infrastructure gets replaced",
    blocks: [
      p(
        "Every heating system has a service lifetime, and — like real equipment — it doesn't fail on a fixed schedule: each building's current system has a randomly-drawn lifetime centered on a realistic average for its type (roughly 18-22 years), so some buildings renew within the first few years and others not for decades.",
      ),
      p(
        "When a system reaches the end of its life, the replacement is decided by the same four things a real building owner would weigh: what's actually available (a building not already on district heating can't just connect to a network that doesn't reach it — a stand-in until real network data exists), which option is cheapest over its own lifetime at today's prices (install cost minus any subsidy, plus running cost), how carefully that comparison is even worth doing (a single house won't chase a marginally cheaper option the way a large apartment block's management might), and a hidden owner-level leaning that nudges a close call toward or away from renewable options.",
      ),
      p(
        "Every renewal shows up as a \"Heating history\" entry on the building's panel, in plain language — what reached the end of its life, what replaced it, and why (including when the obvious choice wasn't available). Only renewals that have actually happened in the game's timeline appear; nothing about the future is revealed in advance.",
      ),
      note(
        "A renewal decision uses whatever tariff and prices are set at the moment it happens, then never changes again — moving a price slider later doesn't rewrite a past decision, only shapes whichever renewal comes next.",
      ),
      note(
        "Heating and mobility (see \"Mobility\") both renew this way now — mobility's mode tier (car/bike/other) uses a simpler weighted-random choice instead of the four-factor one, since a life event changes what a household needs, not what's cheapest; its nested vehicle-type tier (EV vs. ICE, e-bike vs. standard) uses the identical four-factor process heating does. Solar (see \"Solar adoption\") reuses the same four-factor choice for its own if-to-install decision, but — since a building either has it or doesn't, not choosing between several system types — is triggered differently: an annual chance to reconsider, rather than a fixed service lifetime.",
      ),
    ],
  },
  {
    id: "solar",
    icon: "☀️",
    title: "Solar power",
    blocks: [
      p(
        "Every solar installation present at the start is real: a registered plant from the federal/Pronovo power-plant registry, at its real recorded capacity — nothing about the initial state is simulated. From there, new installations can appear over time on any other building (see \"Solar adoption\" below).",
      ),
      p(
        "Generation follows real solar geometry (the sun's position at Schlieren's latitude, time of day, and season) attenuated by cloud cover, including short-term flicker from passing clouds on an otherwise sunny day. Snow sitting on a panel after a snowfall blocks generation until it melts, independent of the sky clearing.",
      ),
    ],
  },
  {
    id: "solar-adoption",
    icon: "🔆",
    title: "Solar adoption",
    blocks: [
      p(
        "Every building without solar already (and younger than 200 years — old enough to be presumed heritage-protected, a simple stand-in for real protection status) gets an annual chance to seriously consider it. That chance starts low, but rises for a few years after the building's own heating system is renewed (see \"Stock renewal\" — a heat-pump switch is a natural moment to think about solar too), rises further the more nearby buildings already have it (a real, observed \"my neighbor got one\" effect), and can be pushed higher still by the municipality's own outreach effort (Control → Policy).",
      ),
      p(
        "When a building does seriously consider it, the decision itself works like a heating renewal: candidate size is the building's own roof footprint times a randomly-drawn (but expected-value-plausible) usable-roof fraction, times whatever module efficiency is current that year — panels keep getting more efficient over time, so a later install packs more capacity onto the same roof. That candidate is compared, the same four-factor way as every other stock-renewal decision, against staying without: installation cost (which falls per kWp as the system gets bigger, matching how real Swiss PV pricing works) minus subsidies, against the electricity it would actually save and export at today's prices.",
      ),
      p(
        "Subsidies are two-layered: every installation gets Switzerland's real federal one-time payment automatically, and the municipality can add its own top-up on top (Control → Policy) — a real cost, paid out of the municipal treasury the moment a building adopts (see \"Municipal finances\").",
      ),
      note(
        "The self-consumption/export split behind the savings estimate is sampled coarsely (24 points/month, not hour-by-hour), so it's a reasonable approximation of how much a candidate installation would actually be used on-site versus exported — not a precise simulation.",
      ),
      note(
        "A building only ever adopts once — panels last decades, close to the whole game's own horizon, so end-of-life replacement isn't modeled yet.",
      ),
    ],
  },
  {
    id: "commercial",
    icon: "🏢",
    title: "Commercial & industrial buildings",
    blocks: [
      p(
        "GWR's building-use field also identifies offices, shops, industrial buildings, schools, churches, sports halls, and hospitals — each gets its own daily/weekly schedule (business hours, extended retail hours, a near-silent church except Sunday morning, a 24/7 hospital baseline) scaled by the building's own floor area.",
      ),
      note(
        "Industrial demand is the least accurate category by nature — real factories run on batch/shift schedules that are effectively impossible to predict from public data. It's modeled as long \"open\" hours with a high baseline and a slow day-to-day wobble standing in for \"some days a batch runs, some days it doesn't.\"",
      ),
      note(
        "Garages, storage/silos, farms, and the large \"other, unspecified\" building bucket deliberately get no commercial load — real data doesn't support a confident guess for them, and zero is more honest than making one up.",
      ),
    ],
  },
  {
    id: "tariff",
    icon: "💰",
    title: "Electricity tariff & prices",
    blocks: [
      p(
        "The \"⚙️ ‹municipality› Control\" button (bottom-left) opens the Control panel's Prices tab: a simple two-rate time-of-use electricity price — a cheaper off-peak rate overnight (21:00-06:00) and a more expensive peak rate during the day — plus five flat prices below it. It's the main lever you can pull directly right now.",
      ),
      p(
        "Only EV charging currently responds to the electricity tariff (see above) — a responsive household will wait for off-peak pricing to begin if that still gets the car charged in time.",
      ),
      p(
        "The five flat prices: what exported solar generation earns (feed-in), and what oil, gas, district heating, and petrol cost — oil and petrol per liter (how they're actually sold), the other two per kWh. The first four feed directly into the Bill sections described next; petrol (and every electricity price above) instead feeds mobility's vehicle-type renewal decision (see \"Mobility\") — moving it shifts how attractive an EV looks the next time a car in the municipality wears out, the same way changing oil or gas price shifts heating's own renewal decisions.",
      ),
      p(
        "Below those is a second group, \"Municipal utility costs\": the wholesale price the local DSO itself pays for electricity, and what it costs to maintain the local grid. These never appear on a consumer's bill — they're the DSO's own cost side, see \"Municipal finances\" below.",
      ),
    ],
  },
  {
    id: "finances",
    icon: "🧾",
    title: "Your bill",
    blocks: [
      p(
        "Every building and dwelling panel has a Bill section: Day (last 24h), Month (last fully completed calendar month), or Year (the last 12 completed months added together) — like a real bill, these only ever cover finished periods, not \"this month so far.\"",
      ),
      p(
        "Electricity is priced correctly for time-of-use — each moment of consumption is billed at whichever of off-peak/peak applied right then, not an average rate — so a responsive EV owner's bill actually reflects the money they save by waiting for off-peak pricing. Exported solar is credited separately at the feed-in rate, which is normally lower than what you pay to consume.",
      ),
      p(
        "A heat pump's cost shows up as electricity. A building whose real heating source is oil, gas, or district heat instead gets its own priced line, labeled with how much fuel it actually used (liters for oil, kWh for gas/district heat): the same underlying heat-loss demand a heat pump would meet, converted to that fuel (a boiler assumed 85% efficient for oil, 90% for gas; district heat priced as delivered) and billed at whichever price you've set.",
      ),
      p(
        "A dwelling's bill is its own devices (electricity only) plus its floor-area share of the building's shared systems — heat pump/AC electricity, solar credit, and heating-fuel cost — split the way a real Swiss ancillary-costs statement (Nebenkostenabrechnung) allocates shared building costs to tenants. A commercial tenant's own energy use is never split to residential dwellings; it's billed to the building itself.",
      ),
      note(
        "EV charging cost is billed to the dwelling exactly like any other device — mobility's mode and vehicle-type choice (see \"Mobility\") is fully modeled now, but only the electricity side shows up on a bill: a petrol/diesel car's fuel cost, and any cost of public transit or a bike, aren't billed anywhere yet, the same boundary heating draws around wood and other unpriced fuels.",
      ),
      note("Wood and other unpriced heating sources still get no fuel-cost line — same reasoning as the unmodeled commercial building classes: no price input, no guess."),
    ],
  },
  {
    id: "municipal-finances",
    icon: "🏦",
    title: "Municipal finances",
    blocks: [
      p(
        "Alongside emissions, the municipality's other headline resource is money: what its local electricity utility actually keeps after buying power and maintaining the grid, accumulated as a treasury balance from the very first simulated year onward — the budget future policy and infrastructure spending will eventually draw from.",
      ),
      p(
        "Each completed year, the balance moves by: everything consumers paid for grid electricity, minus what was paid out for solar fed in, minus the wholesale cost of the net electricity the municipality had to buy in (consumption less all local solar, real and newly adopted alike), minus grid maintenance, minus any municipal solar subsidies paid out that year (see \"Solar adoption\"). The first two utility costs are set in Control → Prices, under \"Municipal utility costs\"; the solar subsidy is set in Control → Policy.",
      ),
      note(
        "Deliberately electricity only — heating fuel and petrol/diesel are paid straight to an external supplier, never through the municipal utility, so they don't touch this balance even though they're billed to the consumer. Existing cantonal heat-pump and EV subsidies still aren't a municipal cost — they're a program the municipality doesn't control, not something the player has paid for. Solar's own subsidy is the one exception: the municipality's top-up is real money, the federal baseline every installation also gets isn't.",
      ),
      note("Shown in the Year in Review report for now, the same way emissions are — nothing tracks or displays it in real time yet."),
    ],
  },
  {
    id: "map-layers",
    icon: "🗂️",
    title: "Map layers",
    blocks: [
      p("The Layers panel (top-left) recolors every building on the map by a different attribute:"),
      list([
        "Default — a flat neutral color, just the geometry.",
        "Building type — colored by GWR's coarse residential/non-residential category.",
        "Heating — colored by primary heating system, live: a stock-renewal replacement (see \"Stock renewal\") recolors the building within a few seconds, not just at the moment you happen to look at its panel.",
        "Power draw — colored by live net power right now, on a diverging scale from exporting (solar surplus) to importing; recalculates every 1.5 real seconds.",
        "Solar — colored by installed solar capacity, from none to the municipality's largest installation; live, the same way Heating is — a new adoption (see \"Solar adoption\") recolors the building within a few seconds.",
      ]),
    ],
  },
  {
    id: "statistics",
    icon: "📊",
    title: "Statistics & history",
    blocks: [
      p(
        "Building and dwelling panels each have a \"Daily energy\" breakdown: total kWh over the last 24h, split by category as a labeled bar list, plus a live \"Net power\" line chart.",
      ),
      p(
        "The Control panel's City stats tab shows the same idea municipality-wide as a pair of donut charts instead — one of every category, one with commercial/business use excluded (it's usually the biggest slice by far, so the second chart is where the residential categories' own relative sizes actually show up). Switch the period with Day/Week/Month/Year: Day is a live rolling last-24h reading like the building/dwelling panels; Week and Month show the most recently completed calendar week/month; Year sums the last 12 completed months.",
      ),
      p(
        "Further down (or, for the municipality, the Control panel's separate History tab) is \"Historical energy\": beyond the last 24 hours, switch between Day (last 7 days), Week (last 13 weeks), or Month (last 12 months), and pick Total, a stacked breakdown of every category, or any single category (e.g. just EV charging) from the dropdown.",
      ),
      note(
        "Historical bars only ever show fully completed periods — today isn't part of \"last 7 days\" — so every bar is a fixed number computed once and cached, not something that wobbles as time passes.",
      ),
    ],
  },
  {
    id: "emissions",
    icon: "🌍",
    title: "Emissions & net zero",
    blocks: [
      p(
        "The municipality's headline goal is net zero by 2050: every completed calendar year totals up operational CO₂ emissions from four sources — grid electricity, gas heating, oil heating, district heating, and petrol/diesel cars — and compares it against the very first year simulated, which is fixed forever as the baseline.",
      ),
      p(
        "Grid electricity is priced on a net basis — total consumption minus solar exported — at that year's grid carbon intensity, sourced from a real Swiss industry projection (VSE) of how much cleaner the national grid gets over time as it decarbonizes. A given year's intensity is treated as constant: no single municipality's choices move the national grid, so this figure only depends on the calendar year, never on anything you do.",
      ),
      p(
        "Gas, oil, and district heating are priced by how much of each fuel was actually burned for space heating (see \"Stock renewal\"), using standard Swiss combustion emission factors (BAFU). Mobility's contribution is petrol/diesel burned by ICE cars (see \"Mobility\") — public transit, walking, and bikes (electric or not) aren't counted, the same way they aren't billed a fuel cost.",
      ),
      note(
        "This is operational emissions only — what's actually burned or drawn from the grid. Manufacturing footprints (a heat pump, an EV's battery, a solar panel) aren't in scope, and neither are emissions embodied in a building itself. A future update may add these separately rather than blend them into one number.",
      ),
    ],
  },
  {
    id: "year-in-review",
    icon: "🎉",
    title: "Year in Review",
    blocks: [
      p(
        "The instant the clock crosses into a new calendar year, it automatically pauses and a \"Year in Review\" report card opens — a snapshot of the municipality's just-completed year, on top of whatever building or dwelling panel you happen to have open.",
      ),
      p(
        "The report leads with the year's emissions (see \"Emissions & net zero\") — a donut chart split by source, and how it compares to the baseline year — followed by \"Municipal finances\" (see above): the treasury balance and this year's own revenue/cost breakdown. Below that comes a municipality-wide energy breakdown, then two sections specific to heating: \"Heating energy by technology\" — how much heat was actually delivered by each system (air/ground heat pump, gas, oil, district heating) for space heating, and by heat pump vs. direct electric for hot water — and \"Heating renewals this year\", a tally of every stock-renewal replacement that happened during the year (e.g. \"14× Oil boiler → Ground heat pump\"), \"like-for-like\" flagged when a building was replaced with the same kind of system it already had. Last is \"Solar installs this year\" — how many buildings adopted solar (see \"Solar adoption\") and how much capacity, in total, they added.",
      ),
      note(
        "The heating-by-technology totals cover every fuel a building might use, not just electricity, so they're deliberately not directly comparable to the \"Energy by category\" pie above them, which only covers what draws grid power.",
      ),
      note(
        "Closing the report doesn't resume the clock — it stays paused exactly where the year turned over until you pick a speed again, the same as if you'd paused it yourself.",
      ),
    ],
  },
];
