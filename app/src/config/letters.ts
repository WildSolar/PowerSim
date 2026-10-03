// Letters from residents and groups, and the local paper (sim/letters.ts, sim/newspaper.ts): who
// writes, how often, and what answering a request is worth. Placeholders to balance.

import type { Bloc } from "./approval";

// --- How often ---

// Each month, a group writes about its mood with this chance, rising the further its mood is from
// the middle (per approval point away from MOOD_NEUTRAL), up to the cap; at most this many a month.
export const MOOD_LETTER_BASE_CHANCE = 0.08;
export const MOOD_LETTER_CHANCE_PER_POINT = 0.015;
export const MOOD_LETTER_MAX_CHANCE = 0.55;
export const MOOD_LETTERS_PER_MONTH = 2;
// ...and a group writes about its mood at most once in this many months.
export const MOOD_LETTER_COOLDOWN_MONTHS = 3;
export const MOOD_NEUTRAL = 56;
// Letters read a mood with this much noise (approval points either way): a hint, not a survey.
export const MOOD_NOISE_POINTS = 6;
export const MOOD_ANGRY_BELOW = 40;
export const MOOD_UNHAPPY_BELOW = 50;
export const MOOD_PLEASED_FROM = 66;

// A decision a group feels this strongly about (stance) brings a letter.
export const REACTION_MIN_STANCE = 0.25;
export const REACTION_CHANCE = 0.85;
export const REACTION_DELAY_DAYS: [number, number] = [2, 9];

// Letters about what happened in town: at most this many a month, and the same complaint at most
// once in this many months.
export const REPORT_LETTERS_PER_MONTH = 2;
export const REPORT_COOLDOWN_MONTHS = { refused: 2, exceptions: 3, noCharger: 4 } as const;

// --- Requests ---

export const REQUEST_CHANCE_PER_MONTH = 0.35;
export const MAX_OPEN_REQUESTS = 3;
// Answered in time: this much goodwill with the group that asked (approval points, fading like any
// shock); left unanswered: this much lost.
export const REQUEST_GRANTED_POINTS = 4;
export const REQUEST_LAPSED_POINTS = -1.5;
export const REQUEST_DEADLINE_MONTHS = { charger: 18, districtHeat: 24, grid: 12, publicSolar: 24, measure: 12 } as const;
// A charger request needs this many households without a charger nearby in the last half year.
export const CHARGER_REQUEST_MIN_UNMET = 3;
// A district-heating request: a street next to the network with at least this many buildings
// heated by gas or oil.
export const DH_REQUEST_MIN_BUILDINGS = 3;

// --- Who writes ---

export const FIRST_NAMES = [
  "Anna", "Laura", "Sarah", "Lea", "Nina", "Elena", "Ruth", "Ursula", "Sandra", "Monika", "Fatima", "Ivana", "Ana", "Giulia", "Esther", "Claudia",
  "Marco", "Luca", "Daniel", "Thomas", "Martin", "Peter", "Beat", "Reto", "Urs", "Stefan", "Arben", "João", "Mehmet", "Simon", "Andreas", "Hans",
];
export const LAST_NAMES = [
  "Müller", "Meier", "Schmid", "Keller", "Weber", "Huber", "Schneider", "Steiner", "Fischer", "Gerber", "Brunner", "Baumann", "Frei", "Zimmermann",
  "Moser", "Widmer", "Wyss", "Graf", "Roth", "Bachmann", "Kälin", "Bianchi", "Rossi", "Fontana", "Kaya", "Berisha", "Hoxha", "Silva", "Ferreira",
  "Nguyen", "Lehmann", "Suter",
];

/** The group's own organisation (`{town}` is the municipality), and how an individual member signs. */
export const BLOC_SENDERS: Record<Bloc, { organisation: string; individual: string[] }> = {
  homeowners: { organisation: "Homeowners' Association {town}", individual: ["homeowner", "owner of a family house", "owner of a small apartment block"] },
  tenants: { organisation: "Tenants' Association {town}", individual: ["tenant", "tenant in a rented flat", "resident"] },
  drivers: { organisation: "Drivers' and Commuters' Club, {town} section", individual: ["commuter", "car owner", "taxi driver"] },
  business: {
    organisation: "Trade Association {town}",
    individual: ["owner of a bakery", "owner of a joinery", "manager of a logistics firm", "owner of a garage", "owner of a print shop"],
  },
  climate: { organisation: "Climate Group {town}", individual: ["resident", "parent", "member of Parents for the Climate"] },
};

// Organisations sign about this share of the letters.
export const ORGANISATION_SHARE = 0.4;
