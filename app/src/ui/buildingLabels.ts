// What a building is, in words, for the player: the federal register's building classes (GWR GKLAS,
// in German in the data) by the name a player would use. Anything not listed falls back to the
// register's own wording.

const CLASS_LABEL: Record<string, string> = {
  "Gebäude mit einer Wohnung": "House",
  "Gebäude mit zwei Wohnungen": "Two-family house",
  "Gebäude mit drei oder mehr Wohnungen": "Apartment building",
  "Wohngebäude für Gemeinschaften": "Residential home",
  Hotelgebäude: "Hotel",
  "Andere Gebäude für kurzfristige Beherbergung": "Short-stay accommodation",
  Bürogebäude: "Office building",
  "Gross-und Einzelhandelsgebäude": "Shop",
  "Gross- und Einzelhandelsgebäude": "Shop",
  "Restaurants und Bars in Gebäuden ohne Wohnnutzung": "Restaurant or bar",
  "Gebäude des Verkehrs- und Nachrichtenwesens ohne Garagen": "Transport or communications building",
  Garagengebäude: "Garage",
  Industriegebäude: "Industrial building",
  "Behälter, Silos und Lagergebäude": "Warehouse or storage",
  "Gebäude für Kultur- und Freizeitzwecke": "Culture or leisure building",
  "Museen und Bibliotheken": "Museum or library",
  "Schul- und Hochschulgebäude, Forschungseinrichtungen": "School or research building",
  "Krankenhäuser und Facheinrichtungen des Gesundheitswesens": "Hospital or care home",
  Sporthallen: "Sports hall",
  "Landwirtschaftliche Betriebsgebäude": "Farm building",
  "Kirchen und sonstige Kultgebäude": "Church",
  "Denkmäler oder unter Denkmalschutz stehende Bauwerke": "Listed monument",
  "Sonstige Hochbauten, anderweitig nicht genannt": "Other building",
};

/** What kind of building it is: "Apartment building", "Office building" — the register's wording if
 * it has none of ours. */
export function buildingKindLabel(buildingClass: string | null): string {
  if (!buildingClass) return "Building";
  const key = buildingClass.replace(/\s+/g, " ").trim();
  return CLASS_LABEL[key] ?? key;
}

/** Whether a building with homes also has other uses (shops, offices) by the register's category. */
export function isMixedUse(category: string | null): boolean {
  return category === "Andere Wohngebäude (Wohngebäude mit Nebennutzung)" || category === "Gebäude mit teilweiser Wohnnutzung";
}
