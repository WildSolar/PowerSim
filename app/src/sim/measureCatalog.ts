/**
 * Every measure the player can enact. A definition says what the options are, what it
 * costs, how long it takes to bite, and which channels it writes to — see measureTypes.ts.
 * All the numbers here (cost scales, lead times, effect sizes) are judgment calls for the
 * player to balance against, not real prices; edit them here.
 */

import type { MeasureDef } from "./measureTypes";

const CHF = 100; // Rappen per franc

function num(params: Record<string, unknown>, key: string): number {
  return params[key] as number;
}

export const MEASURE_CATALOG: MeasureDef[] = [
  // --- Subsidies --------------------------------------------------------------------------
  {
    id: "solar-subsidy",
    category: "subsidy",
    topic: "buildings",
    subsidyCategory: "solar",
    title: "Solar subsidy",
    summary:
      "A municipal top-up on the federal one-off payment every installation already gets: per kWp installed, plus an optional fixed bonus per installation. Paid when a building actually adopts.",
    params: [
      { kind: "slider", key: "perKwp", label: "Per kWp", min: 0, max: 2000, step: 50, unit: "CHF/kWp", default: 300 },
      { kind: "slider", key: "fixed", label: "Fixed bonus", min: 0, max: 10000, step: 250, unit: "CHF each", default: 0 },
    ],
    leadTimeMonths: 1,
    effects: (p) => ({ solarSubsidyRpPerKwp: num(p, "perKwp") * CHF, solarSubsidyFixedRp: num(p, "fixed") * CHF }),
    approval: () => ({ homeowners: 0.5, tenants: 0.1, business: 0.2, climate: 0.6 }),
  },
  {
    id: "fleet-ev-grant",
    category: "subsidy",
    topic: "mobility",
    subsidyCategory: "vehicle",
    title: "Electric van and lorry grant",
    summary:
      "A municipal grant for a business buying an electric van or lorry, paid when it buys one. An electric lorry still costs about twice a diesel one; a grant closes part of the gap, and the vehicle charges at the business's own yard, or at a fast-charging hub for lorries if there is one.",
    params: [
      { kind: "slider", key: "van", label: "Per electric van", min: 0, max: 20000, step: 1000, unit: "CHF each", default: 6000 },
      { kind: "slider", key: "truck", label: "Per electric lorry", min: 0, max: 150000, step: 5000, unit: "CHF each", default: 40000 },
    ],
    leadTimeMonths: 1,
    effects: (p) => ({ fleetEvVanSubsidyRp: num(p, "van") * CHF, fleetEvTruckSubsidyRp: num(p, "truck") * CHF }),
    approval: () => ({ business: 0.5, climate: 0.4, homeowners: -0.05 }),
  },
  {
    id: "pv-loans",
    category: "subsidy",
    topic: "buildings",
    title: "PV loans",
    summary:
      "Low-interest loans, with a local bank, for owners who find solar pays but can't put up the price: an array is paid up front, and the federal payment only comes months later. An owner borrows what they can't pay themselves, up to the amount set; the treasury buys down the interest — about 8% of each loan, paid when it is taken.",
    params: [{ kind: "slider", key: "max", label: "Most per building", min: 10_000, max: 150_000, step: 5_000, unit: "CHF", default: 40_000 }],
    leadTimeMonths: 3,
    effects: (p) => ({ pvLoanMaxRp: num(p, "max") * CHF }),
    approval: () => ({ homeowners: 0.3, climate: 0.3, business: 0.05 }),
  },
  {
    id: "solar-cooperatives",
    category: "subsidy",
    topic: "buildings",
    title: "Solar cooperative support",
    summary:
      "A start-up grant for a local solar cooperative, and a grant for each kWp it builds. Residents put in their savings; the cooperative approaches owners who wanted solar but didn't build — who kept putting it off, couldn't raise the money or couldn't agree — and puts panels on their roof at no cost to them, selling the power to the building at a discount. It takes on a roof that pays back with a little to spare, a handful a year.",
    params: [{ kind: "slider", key: "perKwp", label: "Grant per kWp", min: 0, max: 800, step: 50, unit: "CHF/kWp", default: 200 }],
    leadTimeMonths: 6,
    effects: (p) => ({ solarCoopSupport: true, solarCoopGrantRpPerKwp: num(p, "perKwp") * CHF }),
    oneOffCostRp: () => 50_000 * CHF,
    approval: () => ({ climate: 0.3, tenants: 0.15, homeowners: 0.1 }),
  },
  {
    id: "car-park-solar-subsidy",
    category: "subsidy",
    topic: "buildings",
    subsidyCategory: "solar",
    title: "Car park solar subsidy",
    summary:
      "A municipal subsidy per kWp for a solar canopy over a private car park — a shop's, a company's, a housing estate's. On top of the federal one-off payment; paid when an owner builds.",
    params: [{ kind: "slider", key: "perKwp", label: "Per kWp", min: 0, max: 1000, step: 50, unit: "CHF/kWp", default: 300 }],
    leadTimeMonths: 1,
    effects: (p) => ({ carParkSolarSubsidyRpPerKwp: num(p, "perKwp") * CHF }),
    approval: () => ({ business: 0.4, homeowners: 0.05, climate: 0.5 }),
  },
  {
    id: "home-battery-subsidy",
    category: "subsidy",
    topic: "buildings",
    subsidyCategory: "battery",
    title: "Home battery subsidy",
    summary:
      "A municipal subsidy per kWh for a battery bought with rooftop solar, or added to an existing system. It can be tied to grid-friendly operation: the battery then charges from the top of the midday peak, so the system never feeds in more than half its rating — easing the summer load on the transformer stations, at some cost in yield to the owner.",
    params: [
      { kind: "slider", key: "perKwh", label: "Per kWh", min: 0, max: 1000, step: 50, unit: "CHF/kWh", default: 300 },
      {
        kind: "choice",
        key: "condition",
        label: "Condition",
        options: [
          { value: "grid", label: "Grid-friendly (feed-in ≤ 50%)" },
          { value: "none", label: "None" },
        ],
        default: "grid",
      },
    ],
    leadTimeMonths: 1,
    effects: (p) => ({ homeBatterySubsidyRpPerKwh: num(p, "perKwh") * CHF, homeBatterySubsidyGridFriendly: p.condition !== "none" }),
    approval: (p) => ({ homeowners: p.condition === "none" ? 0.4 : 0.3, business: 0.1, climate: 0.4 }),
  },
  {
    id: "heat-pump-grant",
    category: "subsidy",
    topic: "heating",
    subsidyCategory: "heating",
    title: "Heat pump grant",
    summary:
      "A flat municipal grant, on top of the cantonal one, for a heat pump. Paid to everyone who installs one, most of whom would have anyway — or only to owners who replace a working oil or gas boiler early, which reaches far fewer people but changes far more of what they do.",
    params: [
      { kind: "slider", key: "amount", label: "Grant", min: 0, max: 20000, step: 500, unit: "CHF each", default: 5000 },
      {
        kind: "choice",
        key: "target",
        label: "Who gets it",
        options: [
          { value: "all", label: "Every heat pump" },
          { value: "early", label: "Only early boiler replacements" },
        ],
        default: "all",
      },
    ],
    leadTimeMonths: 1,
    effects: (p) => ({ heatPumpSubsidyRp: num(p, "amount") * CHF, heatPumpGrantEarlyOnly: p.target === "early" }),
    approval: (p) => (p.target === "early" ? { homeowners: 0.35, tenants: 0.05, business: 0.05, climate: 0.6 } : { homeowners: 0.6, tenants: 0.1, business: 0.1, climate: 0.6 }),
  },
  {
    id: "district-heat-connection-grant",
    category: "subsidy",
    topic: "heating",
    subsidyCategory: "heating",
    title: "District heating connection grant",
    summary:
      "A flat municipal grant towards connecting a building to district heating — the pipe from the street and the substation, about CHF 22,000 for a house, more for a block of flats. Paid to every owner who connects where the pipes run, most of whom would have anyway; it tips those weighing district heat against a heat pump or a new boiler, and prompts some to give up a working boiler early. Buildings already connected don't get it again.",
    params: [{ kind: "slider", key: "amount", label: "Grant", min: 0, max: 20000, step: 500, unit: "CHF each", default: 5000 }],
    leadTimeMonths: 1,
    effects: (p) => ({ dhConnectionSubsidyRp: num(p, "amount") * CHF }),
    approval: () => ({ homeowners: 0.45, tenants: 0.05, business: 0.1, climate: 0.4 }),
  },
  {
    id: "ev-grant",
    category: "subsidy",
    topic: "mobility",
    subsidyCategory: "vehicle",
    title: "Electric car grant",
    summary:
      "A flat municipal grant for an electric car. Paid whenever a household buys one — or only when it replaces a petrol or diesel car that still runs, which reaches few households but pulls their switch forward.",
    params: [
      { kind: "slider", key: "amount", label: "Grant", min: 0, max: 10000, step: 500, unit: "CHF each", default: 3000 },
      {
        kind: "choice",
        key: "target",
        label: "Who gets it",
        options: [
          { value: "all", label: "Every electric car" },
          { value: "early", label: "Only early car replacements" },
        ],
        default: "all",
      },
    ],
    leadTimeMonths: 1,
    effects: (p) => ({ evSubsidyRp: num(p, "amount") * CHF, evGrantEarlyOnly: p.target === "early" }),
    approval: (p) => (p.target === "early" ? { drivers: 0.3, homeowners: 0.1, climate: 0.5 } : { drivers: 0.5, homeowners: 0.2, climate: 0.5 }),
  },
  {
    id: "retrofit-topup",
    category: "subsidy",
    topic: "buildings",
    subsidyCategory: "retrofit",
    title: "Insulation retrofit top-up",
    summary: "A municipal top-up, per m² of building envelope, on the federal building-program grant when an owner upgrades the insulation.",
    params: [{ kind: "slider", key: "perM2", label: "Top-up", min: 0, max: 200, step: 5, unit: "CHF/m²", default: 40 }],
    leadTimeMonths: 2,
    effects: (p) => ({ retrofitSubsidyRpPerM2: num(p, "perM2") * CHF }),
    approval: () => ({ homeowners: 0.6, tenants: 0.2, climate: 0.5 }),
  },

  // --- Infrastructure -----------------------------------------------------------------------
  {
    id: "municipal-solar",
    category: "infrastructure",
    topic: "buildings",
    title: "Solar on public buildings",
    summary:
      "The municipality puts solar on its own schools, halls and other public buildings, a few each year — the roofs that pay back best first, if the roof solar advisor has ranked them; otherwise in no particular order. The panels cost the treasury their price (less the federal payment) and generate from then on. Where the grid is full at summer middays, a large roof waits until the area is reinforced.",
    params: [{ kind: "slider", key: "perYear", label: "Buildings per year", min: 0, max: 20, step: 1, unit: "per year", default: 3 }],
    leadTimeMonths: 6,
    effects: (p) => ({ municipalSolarBuildingsPerYear: num(p, "perYear") }),
    approval: () => ({ climate: 0.6, tenants: 0.1, homeowners: 0.1, business: -0.1 }),
  },
  {
    id: "car-park-solar",
    category: "infrastructure",
    topic: "buildings",
    title: "Solar over the town's car parks",
    summary:
      "The municipality puts solar canopies over its own car parks — by its schools, halls and sports grounds, and the public ones — a few each year, those that pay back best first. The treasury pays the price less the federal payment; what the panels save the building next door and earn feeding in is credited to you. Where the grid is full at summer middays, a car park waits until the area is reinforced.",
    params: [{ kind: "slider", key: "perYear", label: "Car parks per year", min: 0, max: 6, step: 1, unit: "per year", default: 2 }],
    leadTimeMonths: 6,
    effects: (p) => ({ carParkSolarMunicipalPerYear: num(p, "perYear") }),
    approval: () => ({ climate: 0.5, drivers: 0.1, tenants: 0.05 }),
  },

  {
    id: "public-building-chargers",
    category: "infrastructure",
    topic: "mobility",
    title: "Chargers at public buildings",
    summary:
      "The municipality puts public chargers in the car parks of its schools, halls and other public buildings, a few sites each year — first where most households nearby want an electric car but have no charger, if the mobility advisor tells you where; otherwise wherever it comes up. Never right next to a site still being built. They're municipal chargers like any other: bought by the treasury, selling at your public charging price.",
    params: [
      { kind: "slider", key: "perYear", label: "Sites per year", min: 0, max: 10, step: 1, unit: "per year", default: 2 },
      { kind: "choice", key: "points", label: "Charge points per site", options: [{ value: "4", label: "4" }, { value: "8", label: "8" }, { value: "12", label: "12" }], default: "4" },
    ],
    leadTimeMonths: 6,
    effects: (p) => ({ publicBuildingChargerSitesPerYear: num(p, "perYear"), publicBuildingChargerPoints: Number(p.points ?? 4) }),
    approval: () => ({ climate: 0.4, drivers: 0.2, tenants: 0.15 }),
  },
  {
    id: "workplace-charging",
    category: "subsidy",
    topic: "mobility",
    title: "Workplace charging programme",
    summary:
      "Grants and advice for employers to put chargers in their staff car parks. More drivers can then charge at work — a good part of their week's charging, wherever they live — which helps most those without a charger at home or close by. A running cost, in proportion to how many employers it reaches.",
    params: [{ kind: "slider", key: "reach", label: "Employers it reaches", min: 0, max: 60, step: 10, unit: "% of those without chargers", default: 30 }],
    leadTimeMonths: 12,
    effects: (p) => ({ workChargingBoost: num(p, "reach") / 100 }),
    annualCostRp: (p, ctx) => (num(p, "reach") / 100) * ctx.residents * 6 * CHF,
    approval: () => ({ climate: 0.25, drivers: 0.15, business: 0.1 }),
  },

  {
    id: "heat-pump-load-control",
    category: "infrastructure",
    topic: "grid",
    title: "Heat pump load control",
    summary:
      "The utility may switch enrolled heat pumps off for short spells when the grid peaks (ripple control, long practice in Switzerland) — in turns, so a house hardly cools down. It cuts the winter evening peak on every transformer station. A running cost for the control equipment; owners grumble a little.",
    params: [{ kind: "slider", key: "share", label: "Heat pumps enrolled", min: 0, max: 100, step: 10, unit: "%", default: 60 }],
    leadTimeMonths: 12,
    effects: (p) => ({ heatPumpLoadControlShare: num(p, "share") / 100 }),
    annualCostRp: (p) => (num(p, "share") / 100) * 60_000 * CHF,
    approval: (p) => ({ homeowners: -0.15 * (num(p, "share") / 100), climate: 0.1 }),
  },
  {
    id: "smart-charging",
    category: "infrastructure",
    topic: "grid",
    title: "Smart charging programme",
    summary:
      "Wallbox controls and a bonus for households that let the utility charge their electric car off-peak instead of as soon as they plug in. Moves evening charging into the night — the evening peak falls. A running cost for the programme.",
    params: [{ kind: "slider", key: "share", label: "Households signing up", min: 0, max: 100, step: 10, unit: "% of the rest", default: 50 }],
    leadTimeMonths: 6,
    effects: (p) => ({ smartChargingShare: num(p, "share") / 100 }),
    annualCostRp: (p) => (num(p, "share") / 100) * 80_000 * CHF,
    approval: (p) => ({ climate: 0.15, drivers: -0.05 * (num(p, "share") / 100) }),
  },

  // --- Information ----------------------------------------------------------------------------
  {
    id: "solar-outreach",
    category: "information",
    topic: "buildings",
    title: "Solar information campaign",
    summary: "Info events and campaigns that make owners seriously consider solar more often — up to about three times as often at full effort. A running cost, in proportion to the effort.",
    params: [{ kind: "slider", key: "level", label: "Effort", min: 0, max: 100, step: 5, unit: "%", default: 50 }],
    leadTimeMonths: 3,
    effects: (p) => ({ solarOutreachLevel: num(p, "level") }),
    annualCostRp: (p, ctx) => (num(p, "level") / 100) * ctx.residents * 6 * CHF,
    approval: () => ({ climate: 0.3, homeowners: 0.1 }),
  },
  {
    id: "solar-check",
    category: "information",
    topic: "buildings",
    title: "Solar check",
    summary:
      "A free on-site visit for any owner looking into solar: an independent installer's look at the roof, and a quote in hand. Nothing forces an owner to act on solar the way a broken boiler does — most who find it pays put it off. With the check, about half go ahead there and then, against a third.",
    params: [],
    leadTimeMonths: 3,
    effects: () => ({ solarCheck: true }),
    annualCostRp: (_p, ctx) => ctx.residents * 1.5 * CHF,
    approval: () => ({ homeowners: 0.15, climate: 0.15 }),
  },
  {
    id: "energy-consulting",
    category: "information",
    topic: "advice",
    title: "Energy consulting",
    summary:
      "Independent advice for owners and households. It narrows the uncertainty every investment decision (boiler, insulation, vehicle, solar) is made under, so people act on clear savings more readily and stop chasing marginal ones.",
    params: [
      {
        kind: "choice",
        key: "scope",
        label: "Scope",
        options: [
          { value: "basic", label: "Free first consultation" },
          { value: "extensive", label: "Extensive, on-site advice" },
        ],
        default: "basic",
      },
    ],
    leadTimeMonths: 6,
    effects: (p) => ({ uncertaintyMultiplier: p.scope === "extensive" ? 0.6 : 0.85 }),
    oneOffCostRp: () => 50_000 * CHF,
    annualCostRp: (p, ctx) => ctx.residents * (p.scope === "extensive" ? 14 : 4) * CHF,
    approval: () => ({ homeowners: 0.3, tenants: 0.2, business: 0.2, climate: 0.3 }),
  },

  // --- Laws ------------------------------------------------------------------------------------
  {
    id: "solar-mandate",
    category: "law",
    topic: "buildings",
    title: "Solar mandate for new buildings",
    summary:
      "New buildings must carry a share of their roof's usable solar capacity, on top of the building code's own minimum. You can exempt small buildings. Applies to permits from the day it takes effect.",
    params: [
      { kind: "slider", key: "share", label: "Share of usable roof", min: 0, max: 100, step: 10, unit: "%", default: 60 },
      { kind: "slider", key: "minFootprint", label: "Only buildings over", min: 0, max: 1000, step: 50, unit: "m² footprint", default: 0 },
    ],
    leadTimeMonths: 12,
    effects: (p) => ({ newBuildSolarMandatePct: num(p, "share"), newBuildSolarMandateMinFootprintM2: num(p, "minFootprint") }),
    approval: (p) => {
      const share = num(p, "share") / 100;
      return { homeowners: -0.1 - 0.4 * share, business: -0.05 - 0.25 * share, climate: 0.3 + 0.4 * share };
    },
    referendum: "optional",
  },
  {
    id: "insulation-standard",
    category: "law",
    topic: "buildings",
    title: "Insulation standard for new buildings",
    summary: "A stricter envelope standard for new buildings than the building code, up to passive-house grade. Heat demand falls; construction gets no cheaper, but the heating bill does.",
    params: [{ kind: "slider", key: "level", label: "Standard", min: 0, max: 100, step: 10, unit: "% toward passive house", default: 50 }],
    leadTimeMonths: 12,
    effects: (p) => ({ newBuildInsulationLevel: num(p, "level") }),
    approval: (p) => {
      const level = num(p, "level") / 100;
      return { homeowners: -0.1 - 0.3 * level, tenants: -0.05 - 0.15 * level, business: -0.1 - 0.2 * level, climate: 0.3 + 0.4 * level };
    },
    referendum: "optional",
  },
  {
    id: "car-park-solar-duty",
    category: "law",
    topic: "buildings",
    title: "Solar duty for large car parks",
    summary:
      "Every open-air car park over a size must get a solar canopy within so many years — each owner by its own date in that time, the town's own car parks included, paid by the treasury. The subsidy for private car parks still applies.",
    params: [
      {
        kind: "choice",
        key: "minSpaces",
        label: "Car parks of",
        options: [
          { value: "20", label: "20 spaces and up" },
          { value: "50", label: "50 spaces and up" },
          { value: "100", label: "100 spaces and up" },
        ],
        default: "50",
      },
      { kind: "slider", key: "years", label: "Within", min: 2, max: 10, step: 1, unit: "years", default: 5 },
    ],
    leadTimeMonths: 12,
    effects: (p) => ({ carParkSolarDutyMinSpaces: Number(p.minSpaces ?? 50), carParkSolarDutyYears: num(p, "years") }),
    approval: (p) => {
      // Smaller car parks and less time weigh heavier on their owners.
      const reach = { "20": 1, "50": 0.7, "100": 0.45 }[String(p.minSpaces ?? "50")] ?? 0.7;
      const haste = 1 + (5 - num(p, "years")) * 0.08;
      return { business: -0.5 * reach * haste, homeowners: -0.15 * reach * haste, drivers: -0.05, climate: 0.4 + 0.2 * reach };
    },
    referendum: "optional",
  },
  {
    id: "retrofit-minimum",
    category: "law",
    topic: "buildings",
    title: "Minimum standard for renovations",
    summary:
      "An owner who renovates the building envelope must bring it to at least this class — no half-measures. Owners can still leave the envelope alone, so it can slow renovation as well as deepen it.",
    params: [
      {
        kind: "choice",
        key: "minClass",
        label: "Minimum class",
        options: [
          { value: "standard", label: "Current standard" },
          { value: "minergie", label: "Minergie" },
        ],
        default: "standard",
      },
    ],
    leadTimeMonths: 12,
    effects: (p) => ({ retrofitMinClass: p.minClass as "standard" | "minergie" }),
    approval: (p) => ({ homeowners: p.minClass === "minergie" ? -0.7 : -0.5, tenants: -0.3, business: -0.1, climate: 0.4 }),
    referendum: "optional",
  },
  {
    id: "fossil-heating-ban",
    category: "law",
    topic: "heating",
    title: "Ban on new fossil heating",
    summary: "When a building replaces its heating, it may no longer install a gas or oil system. Existing systems run until they wear out.",
    params: [],
    leadTimeMonths: 24,
    effects: () => ({ fossilHeatingInstallBanned: true }),
    approval: () => ({ homeowners: -0.5, tenants: -0.1, business: -0.2, climate: 0.8 }),
    referendum: "mandatory",
  },
  {
    id: "ice-car-ban",
    category: "law",
    topic: "mobility",
    title: "Ban on new petrol and diesel cars",
    summary: "Households may no longer buy a new petrol or diesel car. Existing cars stay on the road until they are replaced.",
    params: [],
    leadTimeMonths: 36,
    effects: () => ({ iceCarPurchaseBanned: true }),
    approval: () => ({ drivers: -0.8, homeowners: -0.1, tenants: -0.1, business: -0.3, climate: 0.8 }),
    referendum: "mandatory",
  },

  // --- More measures ---------------------------------------------------------------------------
  {
    id: "ice-scrappage",
    category: "subsidy",
    topic: "mobility",
    subsidyCategory: "vehicle",
    title: "Scrappage bonus for petrol and diesel cars",
    summary:
      "An extra grant when a household replaces a petrol or diesel car with an electric one, on top of the electric car grant. It pays for exactly the switch that cuts emissions — and, like any grant, also for households that would have gone electric anyway.",
    params: [{ kind: "slider", key: "amount", label: "Bonus", min: 0, max: 10000, step: 500, unit: "CHF each", default: 2000 }],
    leadTimeMonths: 2,
    effects: (p) => ({ iceScrappageBonusRp: num(p, "amount") * CHF }),
    approval: () => ({ drivers: 0.3, climate: 0.5, homeowners: 0.1 }),
  },
  {
    id: "bike-infrastructure",
    category: "infrastructure",
    topic: "mobility",
    title: "Bicycle network",
    summary: "Safe, connected bike lanes. Over the years it nudges more households toward the bicycle whenever they rethink how they get around — a slow, diffuse effect, not a switch. Building and maintaining it costs money every year.",
    params: [{ kind: "slider", key: "level", label: "Network", min: 0, max: 100, step: 10, unit: "% of full build-out", default: 50 }],
    leadTimeMonths: 24,
    effects: (p) => ({ modeShiftToBikePts: (num(p, "level") / 100) * 9 }),
    annualCostRp: (p, ctx) => (num(p, "level") / 100) * ctx.residents * 25 * CHF,
    approval: () => ({ climate: 0.4, tenants: 0.2, homeowners: 0.1, drivers: -0.15 }),
  },
  {
    id: "public-transport",
    category: "infrastructure",
    topic: "mobility",
    title: "Public transport service",
    summary: "More frequent, better-connected buses and trams. Households rethinking how they get around choose public transport more often; the car loses share. It is the most expensive of the mobility measures to run.",
    params: [{ kind: "slider", key: "level", label: "Service level", min: 0, max: 100, step: 10, unit: "% of full build-out", default: 50 }],
    leadTimeMonths: 12,
    effects: (p) => ({ modeShiftToOtherPts: (num(p, "level") / 100) * 7 }),
    annualCostRp: (p, ctx) => (num(p, "level") / 100) * ctx.residents * 90 * CHF,
    approval: () => ({ tenants: 0.4, climate: 0.4, drivers: 0.1, business: 0.1 }),
  },
  {
    id: "parking-management",
    category: "law",
    topic: "mobility",
    title: "Parking management",
    summary: "Paid and limited parking, fewer spaces. Driving becomes less convenient, so households rethinking how they get around choose the bicycle or public transport more often. Drivers dislike it, and businesses worry about customers.",
    params: [{ kind: "slider", key: "strictness", label: "Strictness", min: 0, max: 100, step: 10, unit: "%", default: 50 }],
    leadTimeMonths: 12,
    effects: (p) => ({ modeShiftToBikePts: (num(p, "strictness") / 100) * 3.5, modeShiftToOtherPts: (num(p, "strictness") / 100) * 4.5 }),
    approval: (p) => {
      const s = num(p, "strictness") / 100;
      return { drivers: -0.2 - 0.5 * s, business: -0.05 - 0.25 * s, climate: 0.15 + 0.25 * s, homeowners: -0.05 * s };
    },
    referendum: "optional",
  },
  {
    id: "feed-in-limit",
    category: "law",
    topic: "grid",
    title: "Solar feed-in limit",
    summary:
      "Solar systems may feed at most a share of their rated power into the grid. A panel rarely produces more than about 70% of its rating anyway, so little energy is lost — but the sunny-midday peak on every transformer station drops. Owners of existing and new systems lose a little yield.",
    params: [
      {
        kind: "choice",
        key: "limit",
        label: "Feed-in at most",
        options: [
          { value: "70", label: "70% of rated power" },
          { value: "60", label: "60% of rated power" },
          { value: "50", label: "50% of rated power" },
        ],
        default: "70",
      },
    ],
    leadTimeMonths: 12,
    effects: (p) => ({ feedInLimitPct: Number(p.limit ?? 70) }),
    approval: (p) => ({ homeowners: -0.1 - (70 - Number(p.limit ?? 70)) * 0.01, business: -0.05, climate: -0.05 }),
    referendum: "optional",
  },
  {
    id: "right-to-charge",
    category: "law",
    topic: "mobility",
    title: "Right to charge at home",
    summary:
      "Landlords and owners' associations may no longer refuse a wallbox in the building's car park. Many more flat-dwellers may then put one in when they buy an electric car — at their own cost, a little higher where the landlord drags their feet — which removes the biggest barrier to an electric car in town, though never for all: some buildings have no parking at all. Tenants and drivers like it; property owners bear the disruption.",
    params: [{ kind: "slider", key: "coverage", label: "Households it reaches", min: 0, max: 80, step: 10, unit: "% of those who can't charge at home", default: 50 }],
    leadTimeMonths: 12,
    effects: (p) => ({ homeChargingBoost: num(p, "coverage") / 100 }),
    approval: (p) => {
      const c = num(p, "coverage") / 100;
      return { tenants: 0.1 + 0.3 * c, drivers: 0.1 + 0.2 * c, climate: 0.3, homeowners: -0.1 - 0.3 * c };
    },
    referendum: "optional",
  },
  {
    id: "green-power",
    category: "law",
    topic: "grid",
    title: "Green electricity as the default",
    summary:
      "The utility supplies certified renewable power by default. Emissions attributed to grid electricity fall with the share; the certificates cost the utility a premium on every kWh it buys, which comes out of its result — and so your department's share of it — unless you pass it on in your prices.",
    params: [{ kind: "slider", key: "share", label: "Share of supply", min: 0, max: 100, step: 10, unit: "%", default: 50 }],
    leadTimeMonths: 6,
    effects: (p) => ({ greenPowerShare: num(p, "share") }),
    approval: () => ({ climate: 0.4, homeowners: 0.05, tenants: 0.05 }),
  },
  {
    id: "agri-pv-dialogue",
    category: "information",
    topic: "advice",
    title: "Agri-PV dialogue",
    summary:
      "Field visits, farmers who already harvest under panels, round tables with the farmers' association and the landscape groups. Year by year, people come to accept solar over farmland: more farmers agree to panels over their fields, and the opposition to Agri-PV zones softens — those put forward and those already in force. A running cost.",
    params: [],
    leadTimeMonths: 2,
    effects: () => ({ agriPvDialogue: 1 }),
    annualCostRp: (_p, ctx) => (40_000 + ctx.residents * 1) * CHF,
    approval: () => ({ climate: 0.1, homeowners: 0.02 }),
  },
  {
    id: "climate-awareness",
    category: "information",
    topic: "advice",
    title: "Climate awareness campaign",
    summary: "Events, school programmes, local stories. Households lean a little more toward the greener option in every decision — heating, insulation, cars, solar — when the numbers are close. A running cost, in proportion to the effort.",
    params: [{ kind: "slider", key: "level", label: "Effort", min: 0, max: 100, step: 10, unit: "%", default: 50 }],
    leadTimeMonths: 3,
    effects: (p) => ({ progressiveNudgeRp: (num(p, "level") / 100) * 30_000 }),
    annualCostRp: (p, ctx) => (num(p, "level") / 100) * ctx.residents * 5 * CHF,
    approval: () => ({ climate: 0.3, homeowners: 0.05, drivers: -0.05 }),
  },

  // --- Carbon removal ---------------------------------------------------------------------
  {
    id: "advisor-roof-solar",
    category: "information",
    topic: "advisors",
    title: "Roof solar advisor",
    summary:
      "A consultant who goes through every large roof the utility could rent and writes each March with the ten that would return the most on an array — at your rent, today's panel prices and the market — and how many owners would likely accept. With one retained, ‘Solar on public buildings’ takes the roofs that pay back best first.",
    params: [],
    leadTimeMonths: 3,
    effects: () => ({ advisorRoofSolar: 1 }),
    annualCostRp: () => 100_000 * CHF,
    approval: () => ({}),
  },
  {
    id: "advisor-mobility",
    category: "information",
    topic: "advisors",
    title: "Mobility advisor",
    summary:
      "A consultant who writes each February with where a new public charging site would do most good — where most households who wanted an electric car went without a charger over the past year — and whether vans and lorries need a hub. With one retained, ‘Chargers at public buildings’ goes where the need is greatest first.",
    params: [],
    leadTimeMonths: 3,
    effects: () => ({ advisorMobility: 1 }),
    annualCostRp: () => 50_000 * CHF,
    approval: () => ({}),
  },
  {
    id: "advisor-district-heat",
    category: "information",
    topic: "advisors",
    title: "District heating advisor",
    summary:
      "A consultant who writes each April with the firms ready to sell their waste heat — the only way to find them — and the streets next to your network that would likely bring the most heat per metre of pipe within five years: buildings on oil, gas or wood whose heating is due for replacement, and how many owners here choose district heat.",
    params: [],
    leadTimeMonths: 3,
    effects: () => ({ advisorDistrictHeat: 1 }),
    annualCostRp: () => 80_000 * CHF,
    approval: () => ({}),
  },
  {
    id: "advisor-finance",
    category: "information",
    topic: "advisors",
    title: "Finance advisor",
    summary:
      "A consultant who writes each June, before you set next year's prices: what the utility made, what next year's power — mostly bought already — will cost, the price change that would keep its result, and where the Swiss average is heading.",
    params: [],
    leadTimeMonths: 3,
    effects: () => ({ advisorFinance: 1 }),
    annualCostRp: () => 60_000 * CHF,
    approval: () => ({}),
  },
  {
    id: "carbon-removal",
    category: "infrastructure",
    topic: "removal",
    title: "Carbon removal contracts",
    summary:
      "The municipality pays for CO2 to be taken out of the air — biochar, direct air capture, capture at a waste-to-energy plant — to balance the emissions it can't avoid. Removals count only for the hard-to-avoid rest: once the town's own emissions are down to a fifth of the first year's. From the year after it gets there, they are bought month by month for what is left, up to the share set here, at the price of the day — around CHF 450 a tonne today, getting cheaper — and paid each month. Until then the contract costs nothing.",
    params: [{ kind: "slider", key: "share", label: "Cover up to", min: 1, max: 20, step: 1, unit: "% of the first year's emissions", default: 10 }],
    leadTimeMonths: 6,
    effects: (p) => ({ removalShareOfBaseline: num(p, "share") }),
    costCategory: "removals",
    approval: () => ({ climate: 0.25, business: -0.05 }),
  },
];

export const MEASURE_BY_ID = new Map(MEASURE_CATALOG.map((m) => [m.id, m]));
