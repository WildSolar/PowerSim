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
    id: "time",
    icon: "🕐",
    title: "Time, weather & sun",
    blocks: [
      p(
        "The game clock starts at today's real date and runs forward. Use the speed buttons in the Info panel to pause, run at real-time, or fast-forward — up to a simulated day passing in about a second. Every device's power draw is a pure function of the exact simulated moment, so jumping speeds never breaks anything: nothing is \"remembered\" between ticks.",
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
        "Every building's location, footprint, construction year, floor count, heating system, and (where applicable) building-use class come from the real GWR register — nothing about a specific building's identity or attributes is invented.",
      ),
      p(
        "A building's \"Use\" field (EU-standard building class) is what determines whether it gets residential devices, a commercial category, or both — a building can be both (e.g. shops on the ground floor of an apartment block).",
      ),
      note(
        "Only buildings GWR records as currently standing are included — demolished, planned, approved, and under-construction records are filtered out, so every building on the map is really there today.",
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
    id: "ev",
    icon: "🚗",
    title: "Electric vehicle charging",
    blocks: [
      p(
        "EV ownership isn't in the real data (Switzerland doesn't publish it at building level), so it's a seeded random draw per dwelling, biased toward smaller buildings (houses more than apartment blocks) — roughly what you'd expect from parking availability.",
      ),
      p(
        "About 30% of EV-owning households are \"responsive\": they'll delay charging to start once off-peak pricing begins, as long as they can still finish by morning. The rest just plug in when they get home and charge immediately, regardless of price.",
      ),
      p("Each charging session needs 6-16 kWh (a day's typical driving) at a 7.4 kW home wallbox rate."),
    ],
  },
  {
    id: "water-heating",
    icon: "🚿",
    title: "Water heating",
    blocks: [
      p(
        "Whether a building's hot water is electric comes straight from GWR's recorded hot-water energy source — including buildings that use a heat pump for hot water (ground, groundwater, or air-source), not just a plain electric tank.",
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
        "Space heating is real data again: a building has a heat pump if GWR's heating generator or energy source says so (including ground/water/air-source systems even when the generator field is inconsistent). Its power scales with the building's own envelope area (roof + walls) and how far the outdoor temperature sits below a comfort setpoint, divided by a temperature-dependent efficiency (colder outside = less efficient).",
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
    id: "solar",
    icon: "☀️",
    title: "Solar power",
    blocks: [
      p(
        "Every rooftop solar installation is a real, registered plant (from the federal/Pronovo power-plant registry) at its real recorded capacity — nothing about who has solar or how much is simulated.",
      ),
      p(
        "Generation follows real solar geometry (the sun's position at Schlieren's latitude, time of day, and season) attenuated by cloud cover, including short-term flicker from passing clouds on an otherwise sunny day. Snow sitting on a panel after a snowfall blocks generation until it melts, independent of the sky clearing.",
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
        "The \"⚙️ ‹municipality› Control\" button (bottom-left) opens the Control panel's Prices tab: a simple two-rate time-of-use electricity price — a cheaper off-peak rate overnight (21:00-06:00) and a more expensive peak rate during the day — plus four flat prices below it. It's the main lever you can pull directly right now.",
      ),
      p(
        "Only EV charging currently responds to the electricity tariff (see above) — a responsive household will wait for off-peak pricing to begin if that still gets the car charged in time.",
      ),
      p(
        "The four flat prices: what exported solar generation earns (feed-in), and what oil, gas, and district heating cost — oil per liter (how it's actually sold), the other two per kWh. All four feed directly into the Bill sections described next.",
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
        "EV charging cost is already billed to the dwelling that owns the car — EV ownership has always been assigned per dwelling, not per building, even before bills existed. A proper choice between EV/ICE-vehicle/public-transport/bicycle costs is a planned follow-up, not implemented yet.",
      ),
      note("Wood and other unpriced heating sources still get no fuel-cost line — same reasoning as the unmodeled commercial building classes: no price input, no guess."),
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
        "Heating — colored by primary heating system.",
        "Power draw — colored by live net power right now, on a diverging scale from exporting (solar surplus) to importing; recalculates every 1.5 real seconds.",
        "Solar — colored by installed solar capacity, from none to the municipality's largest installation.",
      ]),
    ],
  },
  {
    id: "statistics",
    icon: "📊",
    title: "Statistics & history",
    blocks: [
      p(
        "Building and dwelling panels, plus the Control panel's City stats tab (for the whole municipality), each have a \"Daily energy\" breakdown: total kWh over the last 24h, split by category as a labeled bar list, plus a live \"Net power\" line chart.",
      ),
      p(
        "Further down (or, for the municipality, the Control panel's separate History tab) is \"Historical energy\": beyond the last 24 hours, switch between Day (last 7 days), Week (last 13 weeks), or Month (last 12 months), and pick Total, a stacked breakdown of every category, or any single category (e.g. just EV charging) from the dropdown.",
      ),
      note(
        "Historical bars only ever show fully completed periods — today isn't part of \"last 7 days\" — so every bar is a fixed number computed once and cached, not something that wobbles as time passes.",
      ),
    ],
  },
];
