/**
 * The words of the letters (letters.ts): per group and tone, a few variants each, picked by a seeded
 * draw. Plain functions returning a subject and paragraphs; nothing here decides anything.
 */

import type { Bloc } from "../config/approval";

export interface LetterText {
  subject: string;
  paragraphs: string[];
}

/** A seeded pick from a list of variants. */
export function pick<T>(variants: T[], u: number): T {
  return variants[Math.min(variants.length - 1, Math.floor(u * variants.length))];
}

// --- Reactions to a decision ---

const WELCOME: Record<Bloc, string[]> = {
  homeowners: [
    "Many of our members face a decision about their heating, their roof or their windows in the coming years, and this will make the right choice easier for them.",
    "It is good to see the municipality backing owners who want to invest in their buildings, rather than leaving them to carry it alone.",
  ],
  tenants: [
    "Tenants rarely get a say in how their homes are heated or what their bills look like. This is a step that will reach them too.",
    "It is encouraging to see a decision that keeps tenants' everyday costs in mind.",
  ],
  drivers: [
    "People who depend on their car to get to work will welcome this. It treats them as part of the solution rather than the problem.",
    "Commuters have long felt overlooked in the town's plans. This is a welcome change.",
  ],
  business: [
    "Local firms need predictability to invest, and this gives it. Our members will take it into account in their plans.",
    "This is the kind of practical support the town's businesses have been asking for.",
  ],
  climate: [
    "This is a real step towards net zero, and we want to say so clearly. We hope it is the first of many.",
    "We have been campaigning for exactly this. Thank you for having the courage to act.",
  ],
};

const OBJECTION: Record<Bloc, string[]> = {
  homeowners: [
    "It lands on owners who are already stretched by renovation costs and rising interest rates. Many of them will simply have to pay more, with no say in the matter.",
    "Owners are being asked to carry costs the municipality should share. We urge the council to reconsider.",
  ],
  tenants: [
    "In the end, it is tenants who will pay for this — through their rent or their bills. Nobody asked them.",
    "Our members already struggle with their housing costs. This will not make it easier.",
  ],
  drivers: [
    "It makes life harder for everyone who has no real alternative to the car — shift workers, tradespeople, families on the edge of town.",
    "Drivers are once again asked to pay for the town's ambitions. We do not think that is fair.",
  ],
  business: [
    "It adds costs and paperwork for local firms at a difficult time. Some of our members are already wondering whether they can stay.",
    "Businesses were not consulted, and it shows. We ask the council to think again.",
  ],
  climate: [
    "It is a step in the wrong direction at exactly the moment the town should be speeding up.",
    "We are disappointed. Every year of delay makes the work ahead harder and more expensive.",
  ],
};

const LOSS: Record<Bloc, string[]> = {
  homeowners: ["It was helping owners make sensible investments, and its loss will be felt.", "Owners planned around it. Now they are left to fend for themselves."],
  tenants: ["It was one of the few things that reached tenants directly. We will miss it.", "Tenants were starting to feel the benefit. Now that is gone."],
  drivers: ["It was making life easier for people who depend on their car. Why take it away?", "Commuters were counting on it."],
  business: ["Firms had made plans around it. Changing course like this makes it hard to invest.", "Local businesses need reliability, not back-and-forth."],
  climate: ["It was one of the town's best steps towards net zero. Taking it back is a setback.", "This undoes real progress, and the town will pay for it later."],
};

export function reactionText(bloc: Bloc, positive: boolean, title: string, kind: "enacted" | "repealed", u: number[]): LetterText {
  const verb = kind === "enacted" ? "enacted" : "repealed";
  if (positive) {
    return {
      subject: kind === "enacted" ? `Thank you: ${title}` : `${title}: good riddance`,
      paragraphs: [
        kind === "enacted"
          ? `We read with satisfaction that the municipality has ${verb} the measure "${title}".`
          : `We were relieved to hear that "${title}" has been ${verb}.`,
        pick(WELCOME[bloc], u[0]),
      ],
    };
  }
  return {
    subject: kind === "enacted" ? `Concerns about ${title}` : `Why repeal ${title}?`,
    paragraphs: [
      kind === "enacted" ? `We are writing about the municipality's decision to enact "${title}".` : `We learned with dismay that "${title}" has been repealed.`,
      kind === "enacted" ? pick(OBJECTION[bloc], u[0]) : pick(LOSS[bloc], u[0]),
    ],
  };
}

// --- Votes ---

export function campaignText(bloc: Bloc, supports: boolean, title: string, when: string): LetterText {
  return supports
    ? {
        subject: `Vote yes on ${title}`,
        paragraphs: [
          `The public vote on "${title}" is coming up in ${when}. We will be campaigning for a yes, and we wanted the council to know it can count on us.`,
          pick(WELCOME[bloc], 0.2),
        ],
      }
    : {
        subject: `We will fight ${title} at the ballot box`,
        paragraphs: [
          `"${title}" goes to a public vote in ${when}. We will be campaigning against it.`,
          pick(OBJECTION[bloc], 0.7),
        ],
      };
}

// --- Moods ---

export type Mood = "angry" | "unhappy" | "pleased";
export type MoodCause = { kind: "measure"; title: string; likes: boolean } | { kind: "spending" } | null;

const MOOD_OPENING: Record<Mood, string[]> = {
  angry: [
    "We have to tell you plainly: patience among our members is running out.",
    "Frankly, we feel ignored by the town hall.",
    "Our members are angry, and we would not be doing our job if we did not pass that on.",
  ],
  unhappy: [
    "Our members are not happy with the direction the town is taking.",
    "We wanted to let you know about growing unease among our members.",
    "There is a lot of grumbling among our members at the moment.",
  ],
  pleased: [
    "We do not only write when something is wrong. Our members are, on the whole, satisfied with the council's work.",
    "Credit where it is due: our members feel the town is moving in the right direction.",
  ],
};

export function moodText(bloc: Bloc, mood: Mood, cause: MoodCause, u: number): LetterText {
  const paragraphs = [pick(MOOD_OPENING[mood], u)];
  if (cause?.kind === "measure") {
    paragraphs.push(
      cause.likes
        ? `"${cause.title}" in particular has been well received${mood === "pleased" ? "" : " — but it is not enough on its own"}.`
        : `"${cause.title}" in particular keeps coming up. It weighs on people${mood === "pleased" ? ", even if they accept the rest" : ""}.`,
    );
  } else if (cause?.kind === "spending") {
    paragraphs.push("Above all, people are worried about the spending. The energy department is spending well beyond what it has been given, and taxpayers notice.");
  } else if (mood !== "pleased") {
    paragraphs.push(bloc === "climate" ? "Too little is happening, and too slowly." : "People feel that decisions are made over their heads.");
  }
  const subject = mood === "pleased" ? "A word of thanks" : mood === "angry" ? "Our patience is running out" : "Growing unease";
  return { subject, paragraphs };
}

// --- What happened in town ---

export function refusedHeatPumpText(kind: "ground" | "air" | "grid", detail: string, got: string, address: string): LetterText {
  const what = kind === "ground" ? "a ground-source heat pump" : kind === "air" ? "an air heat pump" : "a heat pump";
  return {
    subject: kind === "grid" ? "No heat pump because the grid is full?" : "Our heat pump was refused",
    paragraphs: [
      `Our heating at ${address} gave up this month. We wanted to replace it with ${what}, but ${detail}.`,
      `So we have had to put in ${got} instead, which will be with us for the next twenty years. We do not understand how the town can talk about net zero when people who want to do the right thing are turned away.`,
    ],
  };
}

export function fossilExceptionsText(count: number): LetterText {
  return {
    subject: "New boilers despite the ban",
    paragraphs: [
      `We have learned that ${count} building${count === 1 ? "" : "s"} were allowed to install a new gas or oil boiler last month, as exceptions to the fossil heating ban — because no heat pump could go in and no district heating reaches them.`,
      "Every one of those boilers will run for twenty years. We ask the council to remove what stands in the way: reinforce the grid, extend district heating.",
    ],
  };
}

export function noChargerText(street: string | null, count: number): LetterText {
  return {
    subject: "Nowhere to charge",
    paragraphs: [
      `I would like to switch to an electric car, but there is no public charger with room anywhere near ${street ?? "where I live"}.${count > 1 ? ` I am not the only one: ${count} households around here found the same last month.` : ""}`,
      "Without a garage, we have no way to charge at home. Please do something about it.",
    ],
  };
}

// --- Requests ---

export function requestText(kind: "charger" | "districtHeat" | "grid" | "publicSolar" | "measure", target: string, deadline: string): LetterText {
  switch (kind) {
    case "charger":
      return {
        subject: `A charger near ${target}, please`,
        paragraphs: [
          `Several of us around ${target} want to switch to an electric car, but none of us can charge at home and the nearest public chargers are full or too far.`,
          `Would the municipality build public chargers here? If something is under way by ${deadline}, many of us would make the switch.`,
        ],
      };
    case "districtHeat":
      return {
        subject: `District heating for ${target}?`,
        paragraphs: [
          `The district heating network runs just round the corner, but not along ${target}. Several of us still heat with oil or gas and would rather connect than buy another boiler.`,
          `Could the network be extended to our street? Our boilers will not last forever — ideally the pipes would be ordered by ${deadline}.`,
        ],
      };
    case "grid":
      return {
        subject: `The grid in the ${target} area`,
        paragraphs: [
          `Residents in the ${target} area are being told that no new heat pumps or wallboxes can be connected because the transformer station is full.`,
          `We ask the municipality to reinforce the station or add a battery. If it is ordered by ${deadline}, we can plan our renovations around it.`,
        ],
      };
    case "publicSolar":
      return {
        subject: `Solar panels on ${target}`,
        paragraphs: [
          `${target} has a large roof and no solar panels. Our children learn about climate change in school; it would mean a lot if their own building set an example.`,
          `Could the municipality put panels on it? An order by ${deadline} would make a lot of people happy.`,
        ],
      };
    case "measure":
      return {
        subject: `We ask for ${target}`,
        paragraphs: [
          `Our members have discussed it at length, and we have one clear request: please enact "${target}".`,
          `We would like to see it decided by ${deadline}.`,
        ],
      };
  }
}

export function grantedText(ask: string): LetterText {
  return { subject: "Thank you", paragraphs: [`We asked for ${ask}, and the municipality delivered. Thank you — it has not gone unnoticed.`] };
}

export function lapsedText(ask: string): LetterText {
  return { subject: "Still waiting", paragraphs: [`Some time ago we asked for ${ask}. Nothing has happened. We are disappointed, and we will remember it.`] };
}

export function resolvedByOthersText(ask: string): LetterText {
  return { subject: "Sorted — but not by you", paragraphs: [`We asked for ${ask}. Someone else has since seen to it, so the problem is solved — no thanks to the municipality.`] };
}

export function welcomeText(town: string): LetterText {
  return {
    subject: `Welcome to the energy department of ${town}`,
    paragraphs: [
      "Welcome to your new office. Residents, local groups and businesses will write to you here: when you decide something they care about, when something goes wrong in town, and when they want something done. Their letters are a fair hint of how people feel — though for a precise picture, you would commission a survey.",
      "Some letters ask for something concrete — a charger, a pipe, a reinforced grid. Answer them in time and the people who asked will remember it.",
      `And every month, the local paper reports on the town. Good luck.`,
    ],
  };
}
