// Roof contracts (sim/roofContracts.ts): the utility rents large roofs and puts its own solar on
// them. Informed placeholders.

// Roofs worth asking about: a building footprint at least this big (m²), not a public building (the
// municipality's own roofs need no contract).
export const ROOF_CONTRACT_MIN_FOOTPRINT_M2 = 300;
// The rent the utility offers, per m² of roof the panels cover, a year (CHF): its default, and the
// range the player can set. Swiss roof rents run at roughly CHF 1-3 per m² a year.
export const ROOF_RENT_DEFAULT_CHF_PER_M2 = 2;
export const ROOF_RENT_RANGE_CHF_PER_M2: [number, number] = [0.5, 8];
export const ROOF_RENT_STEP_CHF_PER_M2 = 0.25;
// What an owner wants for their roof (CHF per m² a year) is drawn per building, log-normal: this
// median and this spread (of the log) — some would let it for little, some hardly at all. Each offer
// adds a little of the day's mood on top.
export const OWNER_ASK_MEDIAN_CHF_PER_M2 = 2;
export const OWNER_ASK_LOG_SPREAD = 0.7;
export const OWNER_ASK_OFFER_NOISE = 0.15;
// An offer makes some owners look into solar of their own (most never get round to it, whatever
// the numbers say — the cash, the hassle, a roof due for repair): this share do, and build their own
// if it pencils out (sim/solarAdoption.ts's decision).
export const OWNER_PROMPTED_SHARE = 0.2;
// The owner answers within this many days.
export const ROOF_ANSWER_DAYS: [number, number] = [20, 70];
// An accepted contract gives the utility this long to build; then it lapses.
export const ROOF_BUILD_WITHIN_MONTHS = 12;
// After a no (or a lapsed contract), the owner won't hear of it again for this long.
export const ROOF_DECLINE_COOLDOWN_YEARS = 3;
// From ordering to panels in service.
export const ROOF_INSTALL_MONTHS = 4;
// Running the arrays: insurance, cleaning, a reserve for the inverters, per kWp a year (CHF).
export const ROOF_UPKEEP_CHF_PER_KWP_YEAR = 20;
// A contract's term (years) — the arrays' life.
export const ROOF_CONTRACT_YEARS = 25;
