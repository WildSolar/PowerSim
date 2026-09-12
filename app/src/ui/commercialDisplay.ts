import type { CommercialCategory } from "../sim/commercial";

export const COMMERCIAL_CATEGORY_LABEL: Record<CommercialCategory, string> = {
  office: "Office",
  retail: "Retail",
  industrial: "Industrial",
  school: "School",
  church: "Church",
  sports: "Sports hall",
  hospital: "Hospital/healthcare",
  other: "Commercial (other)",
};

export const COMMERCIAL_CATEGORY_ICON: Record<CommercialCategory, string> = {
  office: "🏢",
  retail: "🛒",
  industrial: "🏭",
  school: "🏫",
  church: "⛪",
  sports: "🏟️",
  hospital: "🏥",
  other: "🏛️",
};
