"""Orchestrates the GWR + power-plant + footprint sources into one per-municipality
dataset consumed by the game client (written to app/public/data/<slug>.json).
"""

from __future__ import annotations

import dataclasses
import json
import math
from pathlib import Path

from . import coords
from .schema import Building, Dwelling, MunicipalityDataset, PowerPlant
from .sources import footprints as footprints_source
from .sources import gwr, powerplants, statent

BFS_NUMBER = 247
MUNICIPALITY_NAME = "Schlieren"
OUTPUT_PATH = Path(__file__).resolve().parents[3] / "app" / "public" / "data" / "schlieren.json"


def _clean_int(value) -> int | None:
    if value is None or (isinstance(value, float) and math.isnan(value)):
        return None
    return int(value)


def _clean_float(value) -> float | None:
    if value is None or (isinstance(value, float) and math.isnan(value)):
        return None
    return float(value)


def _clean_str(value) -> str | None:
    if value is None or (isinstance(value, float) and math.isnan(value)):
        return None
    text = str(value).strip()
    return text or None


def _camel_case(key: str) -> str:
    parts = key.split("_")
    return parts[0] + "".join(p.title() for p in parts[1:])


def _to_camel(obj):
    if isinstance(obj, dict):
        return {_camel_case(k): _to_camel(v) for k, v in obj.items()}
    if isinstance(obj, list):
        return [_to_camel(v) for v in obj]
    return obj


def build() -> MunicipalityDataset:
    print(f"Fetching GWR buildings for BFS {BFS_NUMBER}...")
    buildings_df = gwr.fetch_buildings(BFS_NUMBER)
    egids = {int(v) for v in buildings_df[gwr.EGID_COL].dropna()}
    print(f"  {len(buildings_df)} buildings")

    print("Fetching GWR dwellings...")
    dwellings_df = gwr.fetch_dwellings(egids)
    print(f"  {len(dwellings_df)} dwellings")

    print("Fetching power plant registry...")
    plants_df = powerplants.fetch_power_plants(MUNICIPALITY_NAME)
    print(f"  {len(plants_df)} plants")

    min_e = buildings_df["E-Gebaeudekoordinate"].min()
    max_e = buildings_df["E-Gebaeudekoordinate"].max()
    min_n = buildings_df["N-Gebaeudekoordinate"].min()
    max_n = buildings_df["N-Gebaeudekoordinate"].max()

    print(f"Fetching building footprints over bbox ({min_e:.0f},{min_n:.0f})-({max_e:.0f},{max_n:.0f})...")
    footprint_by_egid = footprints_source.fetch_building_footprints(min_e, min_n, max_e, max_n)
    matched_count = sum(1 for egid in egids if egid in footprint_by_egid)
    print(f"  matched {matched_count} / {len(buildings_df)} Schlieren buildings to a footprint")

    dwellings_by_egid: dict[int, list[Dwelling]] = {}
    for _, row in dwellings_df.iterrows():
        egid = int(row[gwr.EGID_COL])
        dwelling = Dwelling(
            ewid=str(_clean_int(row[gwr.EWID_COL])),
            room_count=_clean_float(row.get("Anzahl_Zimmer")),
            area_m2=_clean_float(row.get("Wohnungsflaeche")),
        )
        dwellings_by_egid.setdefault(egid, []).append(dwelling)

    buildings: list[Building] = []
    for _, row in buildings_df.iterrows():
        egid = int(row[gwr.EGID_COL])
        lon, lat = coords.lv95_to_lonlat(row["E-Gebaeudekoordinate"], row["N-Gebaeudekoordinate"])

        footprint_lv95 = footprint_by_egid.get(egid)
        footprint_wgs84 = coords.lv95_ring_to_lonlat(footprint_lv95) if footprint_lv95 else None

        buildings.append(
            Building(
                egid=str(egid),
                lon=lon,
                lat=lat,
                footprint=footprint_wgs84,
                construction_year=_clean_int(row.get("Baujahr_des_Gebaeudes")),
                category=_clean_str(row.get("Gebaeudekategorie_Bezeichnung")),
                floor_count=_clean_int(row.get("Anzahl_Geschosse")),
                energy_reference_area_m2=_clean_float(row.get("Energiebezugsflaeche")),
                heating_generator=_clean_str(row.get("Waermeerzeuger_Heizung_primaer_Bezeichnung")),
                heating_energy_source=_clean_str(row.get("Energie-/Waermequelle_Heizung_primaer_Bezeichnung")),
                dwellings=dwellings_by_egid.get(egid, []),
            )
        )

    plants: list[PowerPlant] = []
    for _, row in plants_df.iterrows():
        lon, lat = coords.lv95_to_lonlat(row["_x"], row["_y"])
        plants.append(
            PowerPlant(
                plant_id=str(row["xtf_id"]),
                lon=lon,
                lat=lat,
                capacity_kw=_clean_float(row.get("TotalPower")),
                technology=_clean_str(row.get("TechnologyLabel")),
                commissioning_date=_clean_str(row.get("BeginningOfOperation")),
            )
        )

    return MunicipalityDataset(
        bfs_number=BFS_NUMBER,
        name=MUNICIPALITY_NAME,
        employment_by_sector=statent.fetch_employment_by_sector(BFS_NUMBER),
        buildings=buildings,
        power_plants=plants,
    )


def main() -> None:
    dataset = build()
    OUTPUT_PATH.parent.mkdir(parents=True, exist_ok=True)
    payload = _to_camel(dataclasses.asdict(dataset))
    OUTPUT_PATH.write_text(json.dumps(payload, ensure_ascii=False), encoding="utf-8")
    print(f"Wrote {OUTPUT_PATH} ({len(dataset.buildings)} buildings, {len(dataset.power_plants)} power plants)")


if __name__ == "__main__":
    main()
