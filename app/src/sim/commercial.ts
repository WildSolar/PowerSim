/**
 * Non-residential ("commercial") building load. Schlieren's GWR extract carries a
 * field never ingested before now — Gebaeudeklasse_Bezeichnung, the EU-standard
 * building-*use* class (office, retail, school, ...) — distinct from and much
 * finer than the Gebaeudekategorie field already used elsewhere (which only says
 * "has dwellings or not"). Which category a building falls into is real data
 * again, same as heating/hot-water/solar — no stochastic draw needed for *that*.
 * What's genuinely unknown, and openly approximated here, is each category's load
 * *shape and intensity*: a smooth business-hours occupancy curve (schedule.ts) per
 * category, scaled by a plausible-order-of-magnitude W/m2 intensity, the
 * building's own floor area (Gebaeudeflaeche x floor count — much better data
 * coverage than Energiebezugsflaeche, which is why this uses that instead), and a
 * per-building random multiplier so same-category buildings don't look like twins.
 *
 * Deliberately left unmodeled (commercialCategory returns null): garages,
 * storage/silos, agriculture, and transport buildings plausibly draw close to
 * nothing; and "Sonstige Hochbauten" — Schlieren's largest non-residential bucket
 * at ~470 buildings, a catch-all too heterogeneous to assign a number to without
 * just making one up. Zero is a more honest default there than padding the
 * municipality total with the same guess 470 times over.
 *
 * A building with both dwellings and a recognized commercial class (teilweise
 * Wohnnutzung) gets both loads added — reasonable for a real mixed-use building,
 * though this uses the *whole* floor area for the commercial side rather than
 * trying to guess which floors are which.
 */

import type { Building } from "../data/types";
import { dayOfWeek, toDateMs } from "./calendar";
import { hashSeed, mulberry32 } from "./rng";
import { businessHoursShape, isWeekday } from "./schedule";
import { noiseChannelSeed, valueNoiseFrom } from "./valueNoise";

export type CommercialCategory = "office" | "retail" | "industrial" | "school" | "church" | "sports" | "hospital" | "other";

const CATEGORY_BY_BUILDING_CLASS: Record<string, CommercialCategory> = {
  "Bürogebäude": "office",
  "Gross-und Einzelhandelsgebäude": "retail",
  "Industriegebäude": "industrial",
  "Schul- und Hochschulgebäude, Forschungseinrichtungen": "school",
  "Kirchen und sonstige Kultgebäude": "church",
  Sporthallen: "sports",
  "Krankenhäuser und Facheinrichtungen des Gesundheitswesens": "hospital",
  Hotelgebäude: "other",
  "Museen und Bibliotheken": "other",
  "Gebäude für Kultur- und Freizeitzwecke": "other",
};

export function commercialCategory(building: Building): CommercialCategory | null {
  if (!building.buildingClass) return null;
  return CATEGORY_BY_BUILDING_CLASS[building.buildingClass] ?? null;
}

/** Total floor area across all levels — Gebaeudeflaeche (footprint) x floor
 * count, falling back to a single floor's worth when floor count isn't on record. */
export function totalFloorAreaM2(building: Building): number | null {
  if (building.footprintAreaM2 == null) return null;
  return building.footprintAreaM2 * Math.max(1, building.floorCount ?? 1);
}

interface CategoryProfile {
  peakWPerM2: number; // plausible order-of-magnitude intensity at full occupancy
  baselineFraction: number; // always-on floor (standby/security/refrigeration) as a fraction of peak
  shape: (hourOfDay: number, dow: number) => number; // 0-1 occupancy curve
}

const HOUR_MS = 3_600_000;
const DAY_MS = 24 * HOUR_MS;

const PROFILES: Record<CommercialCategory, CategoryProfile> = {
  office: {
    peakWPerM2: 12,
    baselineFraction: 0.1,
    shape: (h, dow) => (isWeekday(dow) ? businessHoursShape(h, 7.5, 18) : 0),
  },
  retail: {
    peakWPerM2: 25, // higher than office — display lighting plus refrigeration
    baselineFraction: 0.3, // refrigeration never fully switches off
    shape: (h, dow) => (dow >= 1 && dow <= 6 ? businessHoursShape(h, 8, 20) : 0), // closed Sundays
  },
  industrial: {
    // The one category explicitly called out as close to unmodelable — real
    // industrial demand is batch/shift-driven, not a smooth daily curve. This is
    // deliberately the roughest profile here: long "open" hours standing in for
    // shift coverage, a high baseline since machinery/refrigeration/ventilation
    // often doesn't fully stop, plus a slow day-to-day wobble (below) rather than
    // pretending to know which days a batch actually runs.
    peakWPerM2: 20,
    baselineFraction: 0.6,
    shape: (h) => businessHoursShape(h, 6, 22),
  },
  school: {
    peakWPerM2: 10,
    baselineFraction: 0.05,
    shape: (h, dow) => (isWeekday(dow) ? businessHoursShape(h, 7.5, 17) : 0),
  },
  church: {
    peakWPerM2: 3, // mostly unoccupied — lighting/aux heating only
    baselineFraction: 0.1,
    shape: (h, dow) => {
      if (dow === 0) return businessHoursShape(h, 9, 12); // Sunday service
      if (dow === 3) return businessHoursShape(h, 18, 20); // a weekday evening event
      return 0;
    },
  },
  sports: {
    peakWPerM2: 15,
    baselineFraction: 0.1,
    shape: (h, dow) => (isWeekday(dow) ? businessHoursShape(h, 16, 22) : businessHoursShape(h, 10, 20)),
  },
  hospital: {
    peakWPerM2: 30, // 24/7 equipment load, well above office intensity
    baselineFraction: 0.8,
    shape: (h) => businessHoursShape(h, 8, 18), // staff/visitors add a daytime bump on top
  },
  other: {
    // Hotels, museums, culture/leisure venues — too few of any one kind in
    // Schlieren to model separately, so one generic occupied-building shape.
    peakWPerM2: 8,
    baselineFraction: 0.15,
    shape: (h, dow) => (isWeekday(dow) ? businessHoursShape(h, 9, 18) : 0),
  },
};

export interface CommercialProfile {
  egid: string;
  category: CommercialCategory;
  areaM2: number;
  intensityMultiplier: number;
  shiftNoiseSeed: number; // valueNoise.ts's hashed channel for an industrial building's shift pattern
}

/** +/-30% per-building variation within a category, seeded — two same-category
 * buildings shouldn't read as identical twins. */
function intensityMultiplier(egid: string): number {
  return 0.7 + mulberry32(hashSeed(egid, "commercial-intensity"))() * 0.6;
}

/** Null when the building isn't a recognized, modeled commercial category, or has
 * no footprint-area data to scale from. */
export function makeCommercialProfile(building: Building): CommercialProfile | null {
  const category = commercialCategory(building);
  if (!category) return null;
  const areaM2 = totalFloorAreaM2(building);
  if (areaM2 === null) return null;
  return {
    egid: building.egid,
    category,
    areaM2,
    intensityMultiplier: intensityMultiplier(building.egid),
    shiftNoiseSeed: noiseChannelSeed(`commercial-shift-${building.egid}`),
  };
}

export function commercialPowerWFromProfile(profile: CommercialProfile, simTimeMs: number): number {
  const p = PROFILES[profile.category];
  const dateMs = toDateMs(simTimeMs);
  const hourOfDay = (dateMs % DAY_MS) / HOUR_MS;
  const dow = dayOfWeek(dateMs);
  const occupancy = p.shape(hourOfDay, dow);
  const intensity = p.baselineFraction + (1 - p.baselineFraction) * occupancy;

  const dayNoise =
    profile.category === "industrial" ? 1 + 0.25 * valueNoiseFrom(profile.shiftNoiseSeed, dateMs, 3 * DAY_MS) : 1;

  return p.peakWPerM2 * profile.areaM2 * intensity * profile.intensityMultiplier * dayNoise;
}

export function commercialPowerW(building: Building, simTimeMs: number): number {
  const profile = makeCommercialProfile(building);
  if (!profile) return 0;
  return commercialPowerWFromProfile(profile, simTimeMs);
}
