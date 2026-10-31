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

/** A targeted grant's three amounts (early, fossil at end of life, anything else) against a reference. */
function tiers(params: Record<string, unknown>, reference: number): [number, number, number] {
  return [num(params, "early") / reference, num(params, "fossil") / reference, num(params, "other") / reference];
}

/** How strongly a targeted grant acts: its amounts, by how much of the uptake each usually sees. All
 * three at the reference is 1. */
function tiered(params: Record<string, unknown>, reference: number, early: number, fossil: number, other: number): number {
  const [e, f, o] = tiers(params, reference);
  return early * e + fossil * f + other * o;
}

export const MEASURE_CATALOG: MeasureDef[] = [
  // --- Subsidies --------------------------------------------------------------------------
  {
    id: "solar-subsidy",
    category: "subsidy",
    topic: "solar",
    subsidyCategory: "solar",
    title: "Solar subsidy",
    tagline: "A top-up per kWp on the federal payment, paid when a building adopts.",
    summary:
      "A municipal top-up on the federal one-off payment every installation already gets: per kWp installed, plus an optional fixed bonus per installation, and an optional bonus per kWp for a steep array — 45° or more — which makes more of its power in winter. Few roofs are that steep; a bonus may also lead owners of flat roofs to put their panels on steep frames, with less on the roof and less over the year, but more when it's short. Paid when a building actually adopts.",
    params: [
      { kind: "slider", key: "perKwp", label: "Per kWp", min: 0, max: 2000, step: 50, unit: "CHF/kWp", default: 300 },
      { kind: "slider", key: "fixed", label: "Fixed bonus", min: 0, max: 10000, step: 250, unit: "CHF each", default: 0 },
      { kind: "slider", key: "steep", label: "Bonus for steep arrays (45° or more)", min: 0, max: 2000, step: 50, unit: "CHF/kWp", default: 0 },
    ],
    leadTimeMonths: 1,
    effects: (p) => ({ solarSubsidyRpPerKwp: num(p, "perKwp") * CHF, solarSubsidyFixedRp: num(p, "fixed") * CHF, solarSteepBonusRpPerKwp: num(p, "steep") * CHF }),
    strength: (p) => num(p, "perKwp") / 300 + num(p, "fixed") / 3000 + num(p, "steep") / 3000,
    approval: () => ({ homeowners: 0.5, tenants: 0.1, business: 0.2, climate: 0.6 }),
  },
  {
    id: "fleet-ev-grant",
    category: "subsidy",
    topic: "fleet",
    subsidyCategory: "electricFleet",
    title: "Electric van and lorry grant",
    tagline: "For a diesel replaced early or at the end of its life, and for a first yard charger.",
    summary:
      "A municipal grant for a business replacing a diesel van or lorry with an electric one, paid when it buys. Set an amount for each situation: a diesel that still runs, replaced early, or one at the end of its life. You can also pay towards the first charger in a business's yard, about CHF 3,000 for a van and CHF 80,000 for a lorry. Many firms hold back from the extra money up front even where electric is cheaper over the years, so a grant can be what decides it.",
    params: [
      { kind: "slider", key: "vanEarly", label: "Van: replacing a working diesel early", min: 0, max: 30000, step: 1000, unit: "CHF each", default: 10000 },
      { kind: "slider", key: "vanEnd", label: "Van: diesel at the end of its life", min: 0, max: 30000, step: 1000, unit: "CHF each", default: 5000 },
      { kind: "slider", key: "truckEarly", label: "Lorry: replacing a working diesel early", min: 0, max: 200000, step: 5000, unit: "CHF each", default: 60000 },
      { kind: "slider", key: "truckEnd", label: "Lorry: diesel at the end of its life", min: 0, max: 200000, step: 5000, unit: "CHF each", default: 30000 },
      { kind: "slider", key: "vanCharger", label: "Van: charger in the yard", min: 0, max: 3000, step: 250, unit: "CHF each", default: 0 },
      { kind: "slider", key: "truckCharger", label: "Lorry: charger in the yard", min: 0, max: 80000, step: 5000, unit: "CHF each", default: 0 },
    ],
    leadTimeMonths: 1,
    effects: (p) => ({
      fleetVanGrantEarlyRp: num(p, "vanEarly") * CHF,
      fleetVanGrantEndRp: num(p, "vanEnd") * CHF,
      fleetTruckGrantEarlyRp: num(p, "truckEarly") * CHF,
      fleetTruckGrantEndRp: num(p, "truckEnd") * CHF,
      fleetVanChargerGrantRp: num(p, "vanCharger") * CHF,
      fleetTruckChargerGrantRp: num(p, "truckCharger") * CHF,
    }),
    // The usual purchase is the one at the end of a vehicle's life: that's what most businesses notice.
    strength: (p) => (0.75 * (num(p, "vanEnd") / 6000 + num(p, "truckEnd") / 40000) + 0.25 * (num(p, "vanEarly") / 6000 + num(p, "truckEarly") / 40000) + 0.25 * (num(p, "vanCharger") / 3000 + num(p, "truckCharger") / 40000)) / 2,
    approval: () => ({ business: 0.5, climate: 0.4, homeowners: -0.05 }),
  },
  {
    id: "pv-loans",
    category: "subsidy",
    topic: "solar",
    title: "PV loans",
    tagline: "Low-interest loans for owners who can't put up the price.",
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
    topic: "solar",
    title: "Solar cooperative support",
    tagline: "Residents' savings put panels on roofs that were put off.",
    summary:
      "A start-up grant for a local solar cooperative, and a grant for each kWp it builds. Residents put in their savings; the cooperative approaches owners who wanted solar but didn't build — who kept putting it off, couldn't raise the money or couldn't agree — and puts panels on their roof at no cost to them, selling the power to the building at a discount. It takes on a roof that pays back with a little to spare. A bigger grant brings it more members and savings, and so more roofs a year.",
    params: [{ kind: "slider", key: "perKwp", label: "Grant per kWp", min: 0, max: 800, step: 50, unit: "CHF/kWp", default: 200 }],
    leadTimeMonths: 6,
    effects: (p) => ({ solarCoopSupport: true, solarCoopGrantRpPerKwp: num(p, "perKwp") * CHF }),
    oneOffCostRp: (_p, ctx) => (10_000 + ctx.residents * 2) * CHF,
    strength: (p) => num(p, "perKwp") / 200,
    approval: () => ({ climate: 0.3, tenants: 0.15, homeowners: 0.1 }),
  },
  {
    id: "car-park-solar-subsidy",
    category: "subsidy",
    topic: "solar",
    subsidyCategory: "carParkSolar",
    title: "Car park solar subsidy",
    tagline: "Per kWp for a canopy over a private car park.",
    summary:
      "A municipal subsidy per kWp for a solar canopy over a private car park — a shop's, a company's, a housing estate's. On top of the federal one-off payment; paid when an owner builds.",
    params: [{ kind: "slider", key: "perKwp", label: "Per kWp", min: 0, max: 1000, step: 50, unit: "CHF/kWp", default: 300 }],
    leadTimeMonths: 1,
    effects: (p) => ({ carParkSolarSubsidyRpPerKwp: num(p, "perKwp") * CHF }),
    strength: (p) => num(p, "perKwp") / 300,
    approval: () => ({ business: 0.4, homeowners: 0.05, climate: 0.5 }),
  },
  {
    id: "home-battery-subsidy",
    category: "subsidy",
    topic: "grid",
    subsidyCategory: "battery",
    title: "Home battery subsidy",
    tagline: "Per kWh for a battery with solar. It can be tied to grid-friendly operation.",
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
    strength: (p) => num(p, "perKwh") / 300,
    approval: (p) => ({ homeowners: p.condition === "none" ? 0.4 : 0.3, business: 0.1, climate: 0.4 }),
  },
  {
    id: "heat-pump-grant",
    category: "subsidy",
    topic: "heating",
    subsidyCategory: "heatPump",
    title: "Heat pump grant",
    tagline: "A municipal grant for owners who install a heat pump.",
    summary:
      "A municipal grant for a heat pump, on top of the cantonal one, with an amount for each situation: an owner replacing a working oil or gas boiler early, one whose boiler has reached the end of its life, and anything else, such as a heat pump renewed like for like or a wood boiler replaced. Most who are replacing a boiler anyway would have chosen a heat pump regardless; an early replacement is rarer, and far more of it is your doing. Set them all the same and you have a grant for every heat pump.",
    params: [
      { kind: "slider", key: "early", label: "Replacing a working oil or gas boiler early", min: 0, max: 30000, step: 500, unit: "CHF each", default: 8000 },
      { kind: "slider", key: "fossil", label: "Oil or gas boiler at the end of its life", min: 0, max: 30000, step: 500, unit: "CHF each", default: 3000 },
      { kind: "slider", key: "other", label: "Anything else", min: 0, max: 30000, step: 500, unit: "CHF each", default: 0 },
    ],
    leadTimeMonths: 1,
    effects: (p) => ({ heatPumpGrantEarlyRp: num(p, "early") * CHF, heatPumpGrantFossilRp: num(p, "fossil") * CHF, heatPumpGrantOtherRp: num(p, "other") * CHF }),
    strength: (p) => tiered(p, 5000, 0.3, 0.5, 0.2),
    approvalFollowsSettings: true,
    approval: (p) => {
      const [e, f, o] = tiers(p, 5000);
      return { homeowners: 0.35 * e + 0.15 * f + 0.1 * o, tenants: 0.05 * e + 0.03 * f + 0.02 * o, business: 0.05 * e + 0.03 * f + 0.02 * o, climate: 0.6 * Math.max(e, f, 0.5 * o) };
    },
  },
  {
    id: "district-heat-connection-grant",
    category: "subsidy",
    topic: "heating",
    subsidyCategory: "districtHeat",
    title: "District heating connection grant",
    tagline: "Helps a building connect to the district heating network.",
    summary:
      "A municipal grant towards connecting a building to district heating — the pipe from the street and the substation, about CHF 22,000 for a house, more for a block of flats — with an amount for each situation: an owner giving up a working oil or gas boiler early, one whose boiler has reached the end of its life, and anything else, such as a heat pump or wood boiler replaced. It tips those weighing district heat against the alternatives, and prompts some to give up a working boiler. Buildings already connected don't get it again.",
    params: [
      { kind: "slider", key: "early", label: "Replacing a working oil or gas boiler early", min: 0, max: 30000, step: 500, unit: "CHF each", default: 8000 },
      { kind: "slider", key: "fossil", label: "Oil or gas boiler at the end of its life", min: 0, max: 30000, step: 500, unit: "CHF each", default: 3000 },
      { kind: "slider", key: "other", label: "Anything else", min: 0, max: 30000, step: 500, unit: "CHF each", default: 0 },
    ],
    leadTimeMonths: 1,
    effects: (p) => ({ dhGrantEarlyRp: num(p, "early") * CHF, dhGrantFossilRp: num(p, "fossil") * CHF, dhGrantOtherRp: num(p, "other") * CHF }),
    strength: (p) => tiered(p, 5000, 0.3, 0.5, 0.2),
    approvalFollowsSettings: true,
    approval: (p) => {
      const [e, f, o] = tiers(p, 5000);
      return { homeowners: 0.2 * e + 0.15 * f + 0.1 * o, tenants: 0.02 * e + 0.02 * f + 0.01 * o, business: 0.04 * e + 0.03 * f + 0.03 * o, climate: 0.4 * Math.max(e, f, 0.5 * o) };
    },
  },
  {
    id: "ev-grant",
    category: "subsidy",
    topic: "cars",
    subsidyCategory: "electricCar",
    title: "Electric car grant",
    tagline: "Paid when a household buys an electric car.",
    summary:
      "A municipal grant for an electric car, with an amount for each situation: a household replacing a petrol or diesel car that still runs, one whose car has reached the end of its life, and anything else, such as an electric car replaced by another. An early switch is rare, and pays for exactly what cuts emissions now; a grant at the end of a car's life goes to many households, a good part of whom would have gone electric anyway. Set them all the same and you have a grant for every electric car.",
    params: [
      { kind: "slider", key: "early", label: "Replacing a working petrol or diesel car early", min: 0, max: 15000, step: 500, unit: "CHF each", default: 5000 },
      { kind: "slider", key: "fossil", label: "Petrol or diesel car at the end of its life", min: 0, max: 15000, step: 500, unit: "CHF each", default: 2000 },
      { kind: "slider", key: "other", label: "Anything else", min: 0, max: 15000, step: 500, unit: "CHF each", default: 0 },
    ],
    leadTimeMonths: 1,
    effects: (p) => ({ evGrantEarlyRp: num(p, "early") * CHF, evGrantFossilRp: num(p, "fossil") * CHF, evGrantOtherRp: num(p, "other") * CHF }),
    strength: (p) => tiered(p, 3000, 0.2, 0.6, 0.2),
    approvalFollowsSettings: true,
    approval: (p) => {
      const [e, f, o] = tiers(p, 3000);
      return { drivers: 0.2 * e + 0.2 * f + 0.1 * o, homeowners: 0.1 * e + 0.05 * f + 0.05 * o, climate: 0.5 * Math.max(e, f, 0.5 * o) };
    },
  },
  {
    id: "retrofit-topup",
    category: "subsidy",
    topic: "heating",
    subsidyCategory: "retrofit",
    title: "Insulation retrofit top-up",
    tagline: "Per m² on top of the federal grant, by the class a renovation reaches.",
    summary:
      "A municipal top-up, per m² of building envelope, on the federal building-programme grant when an owner upgrades the insulation — an amount for each class the renovation reaches. Nothing for less than the current standard. The deeper the renovation, the more it costs the owner, and the more of the heat it saves.",
    params: [
      { kind: "slider", key: "standard", label: "Reaching the current standard", min: 0, max: 200, step: 5, unit: "CHF/m²", default: 20 },
      { kind: "slider", key: "minergie", label: "Reaching Minergie", min: 0, max: 200, step: 5, unit: "CHF/m²", default: 40 },
      { kind: "slider", key: "minergieP", label: "Reaching Minergie-P", min: 0, max: 200, step: 5, unit: "CHF/m²", default: 60 },
    ],
    leadTimeMonths: 2,
    effects: (p) => ({ retrofitGrantStandardRpPerM2: num(p, "standard") * CHF, retrofitGrantMinergieRpPerM2: num(p, "minergie") * CHF, retrofitGrantMinergiePRpPerM2: num(p, "minergieP") * CHF }),
    strength: (p) => (num(p, "standard") + num(p, "minergie") + num(p, "minergieP")) / 120,
    approval: () => ({ homeowners: 0.6, tenants: 0.2, climate: 0.5 }),
  },

  // --- Infrastructure -----------------------------------------------------------------------
  {
    id: "municipal-solar",
    category: "infrastructure",
    topic: "solar",
    title: "Solar on public buildings",
    tagline: "Solar on schools, halls and other public buildings, a few each year.",
    summary:
      "The municipality puts solar on its own schools, halls and other public buildings, a few each year — the roofs that pay back best first, if the roof solar advisor has ranked them; otherwise in no particular order. The panels cost the treasury their price (less the federal payment) and generate from then on. Where the grid is full at summer middays, a large roof waits until the area is reinforced.",
    params: [{ kind: "slider", key: "perYear", label: "Buildings per year", min: 0, max: 20, step: 1, unit: "per year", default: 3 }],
    leadTimeMonths: 6,
    effects: (p) => ({ municipalSolarBuildingsPerYear: num(p, "perYear") }),
    strength: (p) => num(p, "perYear") / 3,
    approval: () => ({ climate: 0.6, tenants: 0.1, homeowners: 0.1, business: -0.1 }),
  },
  {
    id: "car-park-solar",
    category: "infrastructure",
    topic: "solar",
    title: "Solar over the town's car parks",
    tagline: "Canopies over the town's own car parks, a few each year.",
    summary:
      "The municipality puts solar canopies over its own car parks — by its schools, halls and sports grounds, and the public ones — a few each year, those that pay back best first. The treasury pays the price less the federal payment; what the panels save the building next door and earn feeding in is credited to you. Where the grid is full at summer middays, a car park waits until the area is reinforced.",
    params: [{ kind: "slider", key: "perYear", label: "Car parks per year", min: 0, max: 6, step: 1, unit: "per year", default: 2 }],
    leadTimeMonths: 6,
    effects: (p) => ({ carParkSolarMunicipalPerYear: num(p, "perYear") }),
    strength: (p) => num(p, "perYear") / 2,
    approval: () => ({ climate: 0.5, drivers: 0.1, tenants: 0.05 }),
  },

  {
    id: "public-building-chargers",
    category: "infrastructure",
    topic: "cars",
    title: "Chargers at public buildings",
    tagline: "Public chargers at schools and halls, a few sites each year.",
    summary:
      "The municipality puts public chargers in the car parks of its schools, halls and other public buildings, a few sites each year — first where most households nearby want an electric car but have no charger, if the mobility advisor tells you where; otherwise wherever it comes up. Never right next to a site still being built. They're municipal chargers like any other: bought by the treasury, selling at your public charging price.",
    params: [
      { kind: "slider", key: "perYear", label: "Sites per year", min: 0, max: 10, step: 1, unit: "per year", default: 2 },
      { kind: "choice", key: "points", label: "Charge points per site", options: [{ value: "4", label: "4" }, { value: "8", label: "8" }, { value: "12", label: "12" }], default: "4" },
    ],
    leadTimeMonths: 6,
    effects: (p) => ({ publicBuildingChargerSitesPerYear: num(p, "perYear"), publicBuildingChargerPoints: Number(p.points ?? 4) }),
    strength: (p) => num(p, "perYear") / 2,
    approval: () => ({ climate: 0.4, drivers: 0.2, tenants: 0.15 }),
  },
  {
    id: "workplace-charging",
    category: "subsidy",
    topic: "cars",
    title: "Workplace charging programme",
    tagline: "Grants and advice for chargers in staff car parks.",
    summary:
      "Grants and advice for employers to put chargers in their staff car parks. More drivers can then charge at work — a good part of their week's charging, wherever they live — which helps most those without a charger at home or close by. With the sun, the employers' chargers also get load management that spreads their staff's charging over the sunny middle of the day, where the town's solar has power to spare; a little dearer. A running cost, in proportion to how many employers it reaches.",
    params: [
      { kind: "slider", key: "reach", label: "Employers it reaches", min: 0, max: 60, step: 10, unit: "% of those without chargers", default: 30 },
      {
        kind: "choice",
        key: "timing",
        label: "When staff cars charge",
        options: [
          { value: "sun", label: "With the sun (load management)" },
          { value: "arrival", label: "As soon as they arrive" },
        ],
        default: "sun",
      },
    ],
    leadTimeMonths: 12,
    effects: (p) => ({ workChargingBoost: num(p, "reach") / 100, workChargingWithSun: p.timing !== "arrival" }),
    annualCostRp: (p, ctx) => (num(p, "reach") / 100) * ctx.residents * (p.timing === "arrival" ? 6 : 8) * CHF,
    strength: (p) => Math.max(num(p, "reach") / 30, p.timing !== "arrival" ? 0.2 : 0),
    approval: () => ({ climate: 0.25, drivers: 0.15, business: 0.1 }),
  },

  {
    id: "heat-pump-load-control",
    category: "infrastructure",
    topic: "grid",
    title: "Heat pump load control",
    tagline: "Enrolled heat pumps pause in turns, cutting the winter evening peak.",
    summary:
      "The utility may switch enrolled heat pumps off for short spells when the grid peaks (ripple control, long practice in Switzerland) — in turns, so a house hardly cools down. It cuts the winter evening peak on every transformer station. A running cost for the control equipment; owners grumble a little.",
    params: [{ kind: "slider", key: "share", label: "Heat pumps enrolled", min: 0, max: 100, step: 10, unit: "%", default: 60 }],
    leadTimeMonths: 12,
    effects: (p) => ({ heatPumpLoadControlShare: num(p, "share") / 100 }),
    annualCostRp: (p, ctx) => (num(p, "share") / 100) * ctx.residents * 3 * CHF,
    strength: (p) => num(p, "share") / 60,
    approvalFollowsSettings: true,
    approval: (p) => ({ homeowners: -0.15 * (num(p, "share") / 100), climate: 0.1 }),
  },
  {
    id: "smart-charging",
    category: "infrastructure",
    topic: "grid",
    title: "Smart charging programme",
    tagline: "Moves evening car charging into the night.",
    summary:
      "Wallbox controls and a bonus for households that let the utility charge their electric car off-peak instead of as soon as they plug in. Moves evening charging into the night — the evening peak falls. A running cost for the programme.",
    params: [{ kind: "slider", key: "share", label: "Households signing up", min: 0, max: 100, step: 10, unit: "% of the rest", default: 50 }],
    leadTimeMonths: 6,
    effects: (p) => ({ smartChargingShare: num(p, "share") / 100 }),
    annualCostRp: (p, ctx) => (num(p, "share") / 100) * ctx.residents * 4 * CHF,
    strength: (p) => num(p, "share") / 50,
    approvalFollowsSettings: true,
    approval: (p) => ({ climate: 0.15, drivers: -0.05 * (num(p, "share") / 100) }),
  },

  // --- Information ----------------------------------------------------------------------------
  {
    id: "solar-outreach",
    category: "information",
    topic: "solar",
    title: "Solar information campaign",
    tagline: "Owners seriously consider solar more often.",
    summary: "Info events and campaigns that make owners seriously consider solar more often — up to about three times as often at full effort. A running cost, in proportion to the effort.",
    params: [{ kind: "slider", key: "level", label: "Effort", min: 0, max: 100, step: 5, unit: "%", default: 50 }],
    leadTimeMonths: 3,
    effects: (p) => ({ solarOutreachLevel: num(p, "level") }),
    annualCostRp: (p, ctx) => (num(p, "level") / 100) * ctx.residents * 6 * CHF,
    strength: (p) => num(p, "level") / 50,
    approval: () => ({ climate: 0.3, homeowners: 0.1 }),
  },
  {
    id: "solar-check",
    category: "information",
    topic: "solar",
    title: "Solar check",
    tagline: "A free visit and a quote in hand for owners looking into solar.",
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
    topic: "town",
    title: "Energy consulting",
    tagline: "Independent advice on boilers, insulation and vehicles.",
    summary:
      "Independent advice for owners and households. It narrows the uncertainty decisions on a boiler, insulation or a vehicle are made under, so people act on clear savings more readily and stop chasing marginal ones, and more owners look into switching early. For solar, see the solar check.",
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
    oneOffCostRp: (_p, ctx) => (10_000 + ctx.residents * 2) * CHF,
    annualCostRp: (p, ctx) => ctx.residents * (p.scope === "extensive" ? 14 : 4) * CHF,
    approval: () => ({ homeowners: 0.3, tenants: 0.2, business: 0.2, climate: 0.3 }),
  },

  // --- Laws ------------------------------------------------------------------------------------
  {
    id: "solar-mandate",
    category: "law",
    topic: "solar",
    title: "Solar mandate for new buildings",
    tagline: "New buildings must carry a share of their roof's usable capacity.",
    summary:
      "New buildings must carry a share of their roof's usable solar capacity, on top of the building code's own minimum. You can exempt small buildings. Applies to permits from the day it takes effect.",
    params: [
      { kind: "slider", key: "share", label: "Share of usable roof", min: 0, max: 100, step: 10, unit: "%", default: 60 },
      { kind: "slider", key: "minFootprint", label: "Only buildings over", min: 0, max: 1000, step: 50, unit: "m² footprint", default: 0 },
    ],
    leadTimeMonths: 12,
    effects: (p) => ({ newBuildSolarMandatePct: num(p, "share"), newBuildSolarMandateMinFootprintM2: num(p, "minFootprint") }),
    strength: (p) => num(p, "share") / 60,
    approvalFollowsSettings: true,
    approval: (p) => {
      const share = num(p, "share") / 100;
      return { homeowners: -0.1 - 0.4 * share, business: -0.05 - 0.25 * share, climate: 0.3 + 0.4 * share };
    },
    referendum: "optional",
  },
  {
    id: "insulation-standard",
    category: "law",
    topic: "heating",
    title: "Insulation standard for new buildings",
    tagline: "A stricter envelope for new buildings than the building code.",
    summary: "A stricter envelope standard for new buildings than the building code, up to passive-house grade. Heat demand falls; construction gets no cheaper, but the heating bill does.",
    params: [{ kind: "slider", key: "level", label: "Standard", min: 0, max: 100, step: 10, unit: "% toward passive house", default: 50 }],
    leadTimeMonths: 12,
    effects: (p) => ({ newBuildInsulationLevel: num(p, "level") }),
    strength: (p) => num(p, "level") / 50,
    approvalFollowsSettings: true,
    approval: (p) => {
      const level = num(p, "level") / 100;
      return { homeowners: -0.1 - 0.3 * level, tenants: -0.05 - 0.15 * level, business: -0.1 - 0.2 * level, climate: 0.3 + 0.4 * level };
    },
    referendum: "optional",
  },
  {
    id: "car-park-solar-duty",
    category: "law",
    topic: "solar",
    title: "Solar duty for large car parks",
    tagline: "Every large open-air car park gets a canopy within so many years.",
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
    topic: "heating",
    title: "Minergie for renovations",
    tagline: "Whoever renovates the envelope must reach Minergie. It can slow renovation too.",
    summary:
      "An owner who renovates the building envelope must bring it to Minergie — no half-measures. Owners can still leave the envelope alone, so it can slow renovation as well as deepen it.",
    params: [],
    leadTimeMonths: 12,
    effects: () => ({ retrofitMinClass: "minergie" }),
    approval: () => ({ homeowners: -0.7, tenants: -0.3, business: -0.1, climate: 0.4 }),
    referendum: "optional",
  },
  {
    id: "fossil-heating-ban",
    category: "law",
    topic: "heating",
    title: "Ban on new fossil heating",
    tagline: "No new gas or oil system when a building replaces its heating.",
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
    topic: "cars",
    title: "Ban on new petrol and diesel cars",
    tagline: "No new petrol or diesel cars or vans. What is on the road stays until it is replaced.",
    summary: "Households may no longer buy a new petrol or diesel car, nor businesses a new diesel van. Lorries stay exempt. What is on the road stays there until it is replaced.",
    params: [],
    leadTimeMonths: 36,
    effects: () => ({ iceCarPurchaseBanned: true }),
    approval: () => ({ drivers: -0.8, homeowners: -0.1, tenants: -0.1, business: -0.3, climate: 0.8 }),
    referendum: "mandatory",
  },

  // --- More measures ---------------------------------------------------------------------------
  {
    id: "bike-infrastructure",
    category: "infrastructure",
    topic: "cars",
    title: "Bicycle network",
    tagline: "Built up over years. Households choose the bicycle more often.",
    summary:
      "Safe, connected bike lanes, built stretch by stretch over about ten years. As it grows, more households choose the bicycle whenever they rethink how they get around — a slow, diffuse effect, not a switch. It serves the whole town, so the credit is shared: your department carries about a quarter, as an investment, and the town's general budget, the canton and federal programmes pay the rest. Then a little upkeep. A larger credit goes to a public vote. If you stop, what is built stays, in the care of the road budget.",
    params: [{ kind: "slider", key: "level", label: "Network", min: 0, max: 100, step: 10, unit: "% of full build-out", default: 50 }],
    leadTimeMonths: 12,
    effects: () => ({}),
    costCategory: "infrastructure",
    buildOut: {
      years: 10,
      target: (p) => num(p, "level") / 100,
      fullCreditRp: (ctx) => ctx.residents * 1200 * CHF,
      departmentShare: 0.25,
      upkeepRp: (ctx) => ctx.residents * 5 * CHF,
      effects: (built) => ({ modeShiftToBikePts: built * 9 }),
    },
    strength: (p) => num(p, "level") / 50,
    approval: () => ({ climate: 0.4, tenants: 0.2, homeowners: 0.1, drivers: -0.15 }),
    referendum: (p) => (num(p, "level") > 50 ? "mandatory" : undefined),
  },
  {
    id: "public-transport",
    category: "infrastructure",
    topic: "cars",
    title: "Public transport service",
    tagline: "More frequent, better-connected buses and trams.",
    summary:
      "More frequent, better-connected buses and trams: mostly a yearly contribution for the service, and a small one-off for stops and bus lanes. Households rethinking how they get around choose public transport more often; the car loses share. Your department carries about a third, for the energy it saves; the town's general budget and the canton pay the rest. If the payments stop, the service falls back. A large step up goes to a public vote.",
    params: [{ kind: "slider", key: "level", label: "Service level", min: 0, max: 100, step: 10, unit: "% of full build-out", default: 50 }],
    leadTimeMonths: 12,
    effects: (p) => ({ modeShiftToOtherPts: (num(p, "level") / 100) * 7 }),
    oneOffCostRp: (p, ctx) => (num(p, "level") / 100) * ctx.residents * 12 * CHF,
    annualCostRp: (p, ctx) => (num(p, "level") / 100) * ctx.residents * 27 * CHF,
    strength: (p) => num(p, "level") / 50,
    approval: () => ({ tenants: 0.4, climate: 0.4, drivers: 0.1, business: 0.1 }),
    referendum: (p) => (num(p, "level") > 50 ? "mandatory" : undefined),
  },
  {
    id: "town-zero-emission-vehicles",
    category: "infrastructure",
    topic: "fleet",
    title: "Zero-emission town vehicles",
    tagline: "The town's own vehicles, and the lorries on its contracts.",
    summary:
      "The town's own vans and lorries, and the lorries of the firms it contracts for waste collection and the like, go electric. For its own, you pay what an electric vehicle costs over a diesel one and the charger at the yard, at each replacement. For contracts, it is a condition in the tender, and you pay a premium every year. Either can go as vehicles wear out and contracts come up, or by a deadline, which means replacing working vehicles early, at a further cost. They charge overnight at their yards, which the grid has to carry.",
    params: [
      {
        kind: "choice",
        key: "own",
        label: "The town's own vehicles",
        options: [
          { value: "off", label: "Not part of it" },
          { value: "wear", label: "As they wear out" },
          { value: "deadline", label: "By the deadline" },
        ],
        default: "wear",
      },
      {
        kind: "choice",
        key: "contracts",
        label: "Contracted services",
        options: [
          { value: "off", label: "Not part of it" },
          { value: "wear", label: "As contracts come up" },
          { value: "deadline", label: "By the deadline" },
        ],
        default: "wear",
      },
      { kind: "slider", key: "deadline", label: "Deadline, where chosen", min: 2028, max: 2050, step: 1, unit: "", default: 2035, isYear: true },
    ],
    leadTimeMonths: 6,
    effects: (p) => ({
      townOwnFleetElectric: p.own !== "off",
      townOwnFleetDeadlineYear: p.own === "deadline" ? num(p, "deadline") : 0,
      townContractFleetElectric: p.contracts !== "off",
      townContractFleetDeadlineYear: p.contracts === "deadline" ? num(p, "deadline") : 0,
    }),
    annualCostRp: (p, ctx) => ctx.residents * (p.contracts === "off" ? 0 : p.contracts === "deadline" ? 7 : 5) * CHF,
    costCategory: "programs",
    strength: (p) => (p.own !== "off" ? 0.5 : 0) + (p.contracts !== "off" ? 0.5 : 0),
    approval: () => ({ climate: 0.25, tenants: 0.05, homeowners: 0.02, business: -0.05 }),
  },
  {
    id: "parking-management",
    category: "law",
    topic: "cars",
    title: "Parking management",
    tagline: "Paid and limited parking, fewer spaces.",
    summary: "Paid and limited parking, fewer spaces. Driving becomes less convenient, so households rethinking how they get around choose the bicycle or public transport more often. Drivers dislike it, and businesses worry about customers.",
    params: [{ kind: "slider", key: "strictness", label: "Strictness", min: 0, max: 100, step: 10, unit: "%", default: 50 }],
    leadTimeMonths: 12,
    effects: (p) => ({ modeShiftToBikePts: (num(p, "strictness") / 100) * 3.5, modeShiftToOtherPts: (num(p, "strictness") / 100) * 4.5 }),
    strength: (p) => num(p, "strictness") / 50,
    approvalFollowsSettings: true,
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
    tagline: "Cuts the midday solar peak, at a little yield to owners.",
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
    topic: "cars",
    title: "Right to charge at home",
    tagline: "Landlords may no longer refuse a wallbox.",
    summary:
      "Landlords and owners' associations may no longer refuse a wallbox in the building's car park. Many more flat-dwellers may then put one in when they buy an electric car — at their own cost, a little higher where the landlord drags their feet — which removes the biggest barrier to an electric car in town, though never for all: some buildings have no parking at all. Tenants and drivers like it; property owners bear the disruption.",
    params: [{ kind: "slider", key: "coverage", label: "Households it reaches", min: 0, max: 80, step: 10, unit: "% of those who can't charge at home", default: 50 }],
    leadTimeMonths: 12,
    effects: (p) => ({ homeChargingBoost: num(p, "coverage") / 100 }),
    strength: (p) => num(p, "coverage") / 50,
    approvalFollowsSettings: true,
    approval: (p) => {
      const c = num(p, "coverage") / 100;
      return { tenants: 0.1 + 0.3 * c, drivers: 0.1 + 0.2 * c, climate: 0.3, homeowners: -0.1 - 0.3 * c };
    },
    referendum: "optional",
  },
  {
    id: "green-power",
    category: "law",
    topic: "solar",
    title: "Green electricity as the default",
    tagline: "Certified renewable power by default, at a premium the utility pays.",
    summary:
      "The utility supplies certified renewable power by default. Emissions attributed to grid electricity fall with the share, by nine tenths at 100%; the certificates cost the utility a premium on every kWh it buys, which comes out of its result — and so your department's share of it — unless you pass it on in your prices.",
    params: [{ kind: "slider", key: "share", label: "Share of supply", min: 0, max: 100, step: 10, unit: "%", default: 50 }],
    leadTimeMonths: 6,
    effects: (p) => ({ greenPowerShare: num(p, "share") }),
    strength: (p) => num(p, "share") / 50,
    approval: () => ({ climate: 0.4, homeowners: 0.05, tenants: 0.05 }),
  },
  {
    id: "agri-pv-dialogue",
    category: "information",
    topic: "solar",
    title: "Agri-PV dialogue",
    tagline: "People come to accept solar over farmland, year by year.",
    summary:
      "Field visits, farmers who already harvest under panels, round tables with the farmers' association and the landscape groups. Year by year, people come to accept solar over farmland: more farmers agree to panels over their fields, and the opposition to Agri-PV zones softens — those put forward and those already in force. A running cost.",
    params: [],
    leadTimeMonths: 2,
    effects: () => ({ agriPvDialogue: 1 }),
    annualCostRp: (_p, ctx) => (20_000 + ctx.residents * 2) * CHF,
    approval: () => ({ climate: 0.1, homeowners: 0.02 }),
  },
  {
    id: "climate-awareness",
    category: "information",
    topic: "town",
    title: "Climate awareness campaign",
    tagline: "A lean toward the greener option in every decision, when the numbers are close.",
    summary: "Events, school programmes, local stories. Households and owners lean a little more toward the greener option in every decision — heating, insulation, cars, solar — when the numbers are close, by up to a few percent of what the decision costs them a year. A running cost, in proportion to the effort.",
    params: [{ kind: "slider", key: "level", label: "Effort", min: 0, max: 100, step: 10, unit: "%", default: 50 }],
    leadTimeMonths: 3,
    effects: (p) => ({ progressiveNudgeShare: (num(p, "level") / 100) * 0.04 }),
    annualCostRp: (p, ctx) => (num(p, "level") / 100) * ctx.residents * 5 * CHF,
    strength: (p) => num(p, "level") / 50,
    approval: () => ({ climate: 0.3, homeowners: 0.05, drivers: -0.05 }),
  },

  // --- Carbon removal ---------------------------------------------------------------------
  {
    id: "advisor-roof-solar",
    category: "information",
    topic: "advisors",
    title: "Roof solar advisor",
    tagline: "Writes each March with the ten large roofs that would return the most.",
    summary:
      "A consultant who goes through every large roof the utility could rent and writes each March with the ten that would return the most on an array — at your rent, today's panel prices and the market — and how many owners would likely accept. With one retained, ‘Solar on public buildings’ takes the roofs that pay back best first.",
    params: [],
    leadTimeMonths: 3,
    effects: () => ({ advisorRoofSolar: 1 }),
    annualCostRp: (_p, ctx) => (40_000 + ctx.residents * 3) * CHF,
    approval: () => ({}),
  },
  {
    id: "advisor-mobility",
    category: "information",
    topic: "advisors",
    title: "Mobility advisor",
    tagline: "Writes each February with where a public charging site would do most good.",
    summary:
      "A consultant who writes each February with where a new public charging site would do most good — where most households who wanted an electric car went without a charger over the past year — and whether vans and lorries need a hub. With one retained, ‘Chargers at public buildings’ goes where the need is greatest first.",
    params: [],
    leadTimeMonths: 3,
    effects: () => ({ advisorMobility: 1 }),
    annualCostRp: (_p, ctx) => (20_000 + ctx.residents * 1.5) * CHF,
    approval: () => ({}),
  },
  {
    id: "advisor-district-heat",
    category: "information",
    topic: "advisors",
    title: "District heating advisor",
    tagline: "Writes each April with waste heat for sale and the streets worth piping.",
    summary:
      "A consultant who writes each April with the firms ready to sell their waste heat — the only way to find them — and the streets next to your network that would likely bring the most heat per metre of pipe within five years: buildings on oil, gas or wood whose heating is due for replacement, and how many owners here choose district heat.",
    params: [],
    leadTimeMonths: 3,
    effects: () => ({ advisorDistrictHeat: 1 }),
    annualCostRp: (_p, ctx) => (30_000 + ctx.residents * 2.5) * CHF,
    approval: () => ({}),
  },
  {
    id: "advisor-finance",
    category: "information",
    topic: "advisors",
    title: "Finance advisor",
    tagline: "Writes each June with the price change that would keep the utility's result.",
    summary:
      "A consultant who writes each June, before you set next year's prices: what the utility made, what next year's power — mostly bought already — will cost, the price change that would keep its result, and where the Swiss average is heading.",
    params: [],
    leadTimeMonths: 3,
    effects: () => ({ advisorFinance: 1 }),
    annualCostRp: (_p, ctx) => (40_000 + ctx.residents * 1) * CHF,
    approval: () => ({}),
  },
  {
    id: "carbon-removal",
    category: "infrastructure",
    topic: "town",
    title: "Carbon removal contracts",
    tagline: "Buys removals for what is left, once emissions are down to a fifth of the start.",
    summary:
      "The municipality pays for CO2 to be taken out of the air — biochar, direct air capture, capture at a waste-to-energy plant — to balance the emissions it can't avoid. Removals count only for the hard-to-avoid rest: once the town's own emissions are down to a fifth of the first year's. From the year after it gets there, they are bought month by month for what is left, up to the share set here, at the price of the day — around CHF 450 a tonne today, getting cheaper — and paid each month. Until then the contract costs nothing.",
    params: [{ kind: "slider", key: "share", label: "Cover up to", min: 1, max: 20, step: 1, unit: "% of the first year's emissions", default: 10 }],
    leadTimeMonths: 6,
    effects: (p) => ({ removalShareOfBaseline: num(p, "share") }),
    costCategory: "removals",
    strength: (p) => num(p, "share") / 10,
    approval: () => ({ climate: 0.25, business: -0.05 }),
  },
];

export const MEASURE_BY_ID = new Map(MEASURE_CATALOG.map((m) => [m.id, m]));
