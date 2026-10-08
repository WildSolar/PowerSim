/**
 * The tutorial's script: a newly elected mayor's first weeks, as the chief of staff walks them
 * through the job. Each step is something Nadia says, and either a Next button (a briefing) or a
 * task the player does in the game itself — the step moves on when it's done. `target` names the
 * element to spotlight (its data-tour attribute).
 */

import { measures } from "../sim/measures";

export interface TutorialState {
  town: string;
  colorMode: string;
  selectedEgid: string | null;
  townHall: string | null;
  inboxOpen: boolean;
  reportCardYear: number | null;
  speed: number;
  nextElection: string | null;
}

export interface TutorialStep {
  id: string;
  chapter: string;
  /** What Nadia says: paragraphs, with {town} and {election} filled in. */
  say: string[];
  /** What the player is asked to do, if anything (the step waits for `done`). */
  task?: string;
  done?: (s: TutorialState) => boolean;
  /** The element to spotlight. */
  target?: string;
  /** A helping hand for the task: a button that does it for them (the Tutorial component knows how). */
  help?: "pickBuilding";
  /** Leave the map clear of the dimming (steps about the map itself). */
  noDim?: boolean;
  /** On entering the step, close what's open (windows, the building, the tool) — a clear stage. */
  clearStage?: boolean;
}

const enacted = (id: string) => {
  const s = measures.getState(id);
  return !!(s?.active || s?.pending);
};

export const HEAT_PUMP_MEASURE = "heat-pump-grant";

export const TUTORIAL_STEPS: TutorialStep[] = [
  // --- 1. Your first day ---
  {
    id: "welcome",
    chapter: "Your first day",
    say: [
      "Congratulations, Mayor — and welcome to the Gemeindehaus. I'm Nadia Frei, your chief of staff.",
      "{town} elected you on one promise: net zero by 2050. It's December, and the new year is three weeks away. Before it turns, let me show you how this place works. It won't take long.",
    ],
  },
  {
    id: "town",
    chapter: "Your first day",
    noDim: true,
    say: [
      "That's {town} out there — as it really is. Every building comes from the federal register: when it was built, how many homes it holds, how it's heated. The streets, the zoning plan, the solar panels on the roofs: all real.",
      "Drag the map to look around, scroll to zoom, and hold the right mouse button to tilt it.",
    ],
  },
  // --- 2. The numbers that matter ---
  {
    id: "clock",
    chapter: "The numbers that matter",
    target: "clock",
    say: [
      "The calendar. Time stands still while we talk. You run it with the buttons here — slow, medium, fast — or with the keys 1, 2 and 3; the space bar pauses.",
      "A year passes in a few minutes at full speed. Twenty-four of them until 2050.",
    ],
  },
  {
    id: "treasury",
    chapter: "The numbers that matter",
    target: "treasury",
    say: [
      "Your department's money. It comes in as the canton's allocation and a share of what the municipal utility earns selling electricity and heat. It goes out on subsidies, programmes and anything you build.",
      "You can borrow for building things. Spend far more than you take in on running costs, though, and the taxpayers will notice.",
    ],
  },
  {
    id: "approval",
    chapter: "The numbers that matter",
    target: "approval",
    say: [
      "And this is how {town} feels about you. Homeowners, tenants, drivers, business and the climate-minded each have their own view of what you do.",
      "Below 50% on election day, or below a quarter for six months, and you're out. The next election: {election}.",
    ],
  },
  {
    id: "co2",
    chapter: "The numbers that matter",
    target: "co2",
    say: [
      "The town's CO₂ — heating oil and gas, petrol and diesel, and the electricity it draws. It's counted once a year, at New Year. This year's count is the baseline everything after is measured against.",
    ],
  },
  {
    id: "score",
    chapter: "The numbers that matter",
    target: "score",
    say: [
      "From next year on, every year scores its cut in emissions per resident against this one, in percent. Early cuts count every year after them. Par is what doing nothing would score — the cleaner grid, old boilers wearing out anyway.",
      "Reach net zero by 2050 and you've won. Reach it early, with the books in order, and you can finish there.",
    ],
  },
  // --- 3. One building ---
  {
    id: "pickBuilding",
    chapter: "One building",
    noDim: true,
    task: "Click a building on the map.",
    help: "pickBuilding",
    done: (s) => s.selectedEgid !== null,
    say: ["Let's start small. Pick any building — a block of flats is a good place to start."],
  },
  {
    id: "buildingPanel",
    chapter: "One building",
    target: "building-panel",
    say: [
      "Every building tells its story: its age and insulation, how it's heated and when that system is due for replacement, what it uses, its homes and the people in them.",
      "Owners decide for themselves — mostly when something wears out. A boiler lasts twenty years; whatever replaces it will be there in 2045. Your job is to make the clean choice the obvious one when that moment comes.",
    ],
  },
  // --- 4. The whole town ---
  {
    id: "heatingLayer",
    chapter: "The whole town",
    target: "layer-heating",
    task: "Open the Heating view.",
    done: (s) => s.colorMode === "heating",
    say: ["One building at a time won't get us to 2050. The views on the left colour the whole town by what matters."],
  },
  {
    id: "heatingExplained",
    chapter: "The whole town",
    target: "legend",
    say: [
      "Orange is oil and gas — the biggest share of what we emit. Purple is district heating, green heat pumps.",
      "Every orange building is a decision someone will make in the next twenty years. How many of them choose green is largely up to you.",
    ],
  },
  {
    id: "groundLayer",
    chapter: "The whole town",
    target: "layer-groundHeat",
    task: "Open the Ground heat view.",
    done: (s) => s.colorMode === "groundHeat",
    say: ["Heat pumps are the usual way out of oil and gas — but not every building can have one."],
  },
  {
    id: "groundExplained",
    chapter: "The whole town",
    target: "legend",
    say: [
      "Over drinking water, the canton bans boreholes; elsewhere they come with conditions. And an air heat pump can be too loud for the neighbours in a dense street.",
      "Where neither works, district heating is often the answer. Keep that in mind.",
    ],
  },
  {
    id: "solarLayer",
    chapter: "The whole town",
    target: "layer-solar",
    task: "Open the Solar view.",
    done: (s) => s.colorMode === "solar",
    say: ["One more. Every roof could make electricity."],
  },
  {
    id: "solarExplained",
    chapter: "The whole town",
    target: "legend",
    say: [
      "The brighter, the more solar on the roof. Most roofs are still bare. Owners put panels up when it pays — your subsidies, your feed-in price and your campaigns all tip that balance.",
    ],
  },
  // --- 5. Time ---
  {
    id: "play",
    chapter: "Time",
    target: "speed",
    task: "Start the clock at medium speed (▶▶, or the key 2).",
    done: (s) => s.speed > 0,
    say: ["Let's watch the town for a moment."],
  },
  {
    id: "watch",
    chapter: "Time",
    target: "clock",
    noDim: true,
    say: [
      "Every household lives its day: lights in the evening, heating at dawn, cars charging overnight. Open the Power draw view some time and watch the town breathe.",
      "Nothing you decide happens at once. Measures take months, owners take years.",
    ],
  },
  {
    id: "pause",
    chapter: "Time",
    target: "speed",
    task: "Pause again (the pause button, or the space bar).",
    done: (s) => s.speed === 0,
    say: ["Now — to work."],
  },
  // --- 6. The Town hall ---
  {
    id: "openTownHall",
    chapter: "The Town hall",
    target: "townhall",
    task: "Open the Town hall.",
    done: (s) => s.townHall !== null,
    say: ["Your decisions are made in the Town hall. The clock stops while you're in there."],
  },
  {
    id: "measuresTab",
    chapter: "The Town hall",
    target: "th-measures",
    task: "Go to Measures.",
    done: (s) => s.townHall === "measures",
    say: ["The overview sums up where things stand. But the real work is here."],
  },
  {
    id: "measuresExplained",
    chapter: "The Town hall",
    noDim: true,
    say: [
      "Four kinds of measures. Subsidies pay people who act. Infrastructure is what the municipality builds itself. Information helps people decide well. Laws ban, require and set standards — cheap, but they can be voted down.",
      "Each has a cost, a lead time and a public reaction. Bigger ones go to a public vote.",
    ],
  },
  {
    id: "pickMeasure",
    chapter: "The Town hall",
    target: `measure-${HEAT_PUMP_MEASURE}`,
    task: "Open the Heat pump grant.",
    done: () => !!document.querySelector('[data-tour="measure-enact"]'),
    say: ["Let's begin where most of our emissions are: heating."],
  },
  {
    id: "enactMeasure",
    chapter: "The Town hall",
    target: "measure-enact",
    task: "Enact it.",
    done: () => enacted(HEAT_PUMP_MEASURE),
    say: [
      "A grant for every owner who installs a heat pump. You can set how much; it costs nothing until someone takes it up — but then it costs for everyone who does, including those who would have switched anyway.",
    ],
  },
  {
    id: "pricesTab",
    chapter: "The Town hall",
    target: "th-prices",
    task: "Go to Prices.",
    done: (s) => s.townHall === "prices",
    say: ["Done — it takes effect in a few months. One more thing in here."],
  },
  {
    id: "pricesExplained",
    chapter: "The Town hall",
    noDim: true,
    say: [
      "You run the municipal utility, so you set the prices: electricity, what solar owners get for what they feed in, district heat, public charging. Once a year — next year's sheet is due by the end of August.",
      "Prices steer people. Cheap electricity makes heat pumps pay; a good feed-in price puts panels on roofs. But the utility's profit is part of your budget.",
    ],
  },
  {
    id: "closeTownHall",
    chapter: "The Town hall",
    target: "th-close",
    task: "Close the Town hall.",
    done: (s) => s.townHall === null,
    say: ["That's enough paperwork for one day."],
  },
  // --- 7. Building things ---
  {
    id: "tools",
    chapter: "Building things",
    target: "tools",
    say: [
      "Below the views are your planning tools. Here you don't just colour the map — you build: district heating pipes and heat plants, public chargers, a stronger grid, zoning changes, solar on public and rented roofs, Agri-PV over fields, wind turbines.",
    ],
  },
  {
    id: "dhTool",
    chapter: "Building things",
    target: "layer-districtHeat",
    task: "Open the District heating tool.",
    done: (s) => s.colorMode === "districtHeat",
    say: ["Remember the buildings where no heat pump can go?"],
  },
  {
    id: "dhExplained",
    chapter: "Building things",
    target: "tool-drawer",
    say: [
      "{town}'s district heating network: what feeds it, how much of the winter peak its clean sources carry. Click streets on the map to plan an extension; buildings along it can connect when their heating is next replaced.",
      "Further down: new heat sources — heat pumps on groundwater or a river, waste heat, wood. It's slow and costly work, but every connected building is a boiler gone for good.",
    ],
  },
  // --- 8. The town talks back ---
  {
    id: "inbox",
    chapter: "The town talks back",
    target: "inbox",
    task: "Open your inbox.",
    done: (s) => s.inboxOpen,
    say: ["People will tell you what they think. Often."],
  },
  {
    id: "inboxExplained",
    chapter: "The town talks back",
    noDim: true,
    say: [
      "Letters from residents and groups react to what you do. Some ask for something concrete by a deadline — a charger in their street, district heating — marked with a pin. Answer in time and they'll remember it — and they'll remember if you don't.",
      "And once a month, the local paper.",
    ],
  },
  {
    id: "wiki",
    chapter: "The town talks back",
    target: "wiki",
    clearStage: true,
    say: ["When you want to know exactly how something works — why an owner chose a boiler, what a measure really does — the wiki has it all. No shame in looking things up. I do."],
  },
  // --- 9. The year turns ---
  {
    id: "runToYearEnd",
    chapter: "The year turns",
    target: "speed",
    clearStage: true,
    task: "Run time at full speed (▶▶▶, or the key 3) until the new year.",
    done: (s) => s.reportCardYear !== null,
    say: ["The year ends in a few weeks. Let's see where we stand."],
  },
  {
    id: "review",
    chapter: "The year turns",
    noDim: true,
    say: [
      "Every New Year, the Year in Review: the town's CO₂ and where it came from, the money, how people feel, what changed in the buildings. This first one is the baseline — every year after is scored against it.",
      "Read it, then close it with ‘Back to the map’. The clock waits for you.",
    ],
  },
  {
    id: "finale",
    chapter: "Your term",
    noDim: true,
    say: [
      "That's the job, Mayor. Twenty-four years, one town, every building in it.",
      "A word of advice: start early — what's built this decade is still standing in 2050. Watch your approval as closely as your CO₂. And read your mail.",
      "Whenever you're ready, a term of your own awaits — in {town} or one of the other towns. I'll be in my office.",
    ],
  },
];
