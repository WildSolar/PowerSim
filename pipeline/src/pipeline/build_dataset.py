"""Orchestrates the GWR + power-plant + footprint sources into one per-municipality
dataset consumed by the game client (written to app/public/data/<slug>.json).

Takes a BFS municipality number on the command line (`python -m pipeline.build_dataset
247`), defaulting to Schlieren if none is given. gwr.py's own data is national — any
Swiss municipality's BFS number works there — but footprints.py is still canton-
Zürich-only (see that module's own doc for why), so this fails fast with a clear
message for a municipality outside canton ZH rather than silently producing a
dataset with no building shapes.
"""

from __future__ import annotations

import argparse
import dataclasses
import json
import math
import re
import unicodedata
from pathlib import Path

import pandas as pd
from shapely.geometry import Polygon

from . import coords
from .schema import Building, Dwelling, MunicipalityDataset, PowerPlant, StreetSegment
from .sources import footprints as footprints_source
from .sources import boundary as boundary_source
from .sources import district_heat as district_heat_source
from .sources import streets as streets_source
from .sources import exclusions as exclusions_source
from .sources import gwr, powerplants, sites as sites_source, statent, stock_history

DEFAULT_BFS_NUMBER = 247  # Schlieren
OUTPUT_DIR = Path(__file__).resolve().parents[3] / "app" / "public" / "data"
INDEX_FILENAME = "index.json"

# footprints.py only has a real (non-VECTOR25-blob) source for canton Zürich —
# see that module's own doc for what was tried and why it isn't national yet.
SUPPORTED_FOOTPRINT_CANTONS = {"ZH"}


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


def _slug(name: str) -> str:
    """Municipality name -> filename-safe slug, e.g. 'Schlieren' -> 'schlieren',
    'La Chaux-de-Fonds' -> 'la-chaux-de-fonds'."""
    normalized = unicodedata.normalize("NFKD", name).encode("ascii", "ignore").decode("ascii")
    slug = re.sub(r"[^a-z0-9]+", "-", normalized.lower()).strip("-")
    return slug or "municipality"


def build(bfs_number: int) -> MunicipalityDataset:
    print(f"Fetching GWR buildings for BFS {bfs_number}...")
    buildings_df = gwr.fetch_buildings(bfs_number)
    if buildings_df.empty:
        raise SystemExit(f"No buildings found for BFS number {bfs_number} — check the number against {gwr.AUTHORITIES_URL}")
    municipality_name = str(buildings_df["Gemeindename"].iloc[0])
    egids = {int(v) for v in buildings_df[gwr.EGID_COL].dropna()}
    print(f"  {len(buildings_df)} buildings in {municipality_name}")

    canton = gwr.municipality_canton(bfs_number)
    if canton not in SUPPORTED_FOOTPRINT_CANTONS:
        raise SystemExit(
            f"{municipality_name} is in canton {canton}, but footprints.py only has a real building-shape "
            f"source for {', '.join(sorted(SUPPORTED_FOOTPRINT_CANTONS))} today — see that module's own doc "
            "for what was investigated and why. GWR itself (buildings/dwellings/addresses) is national and "
            "would work fine; only the map footprint shapes are the blocker."
        )

    print("Fetching GWR dwellings...")
    dwellings_df = gwr.fetch_dwellings(bfs_number, egids)
    print(f"  {len(dwellings_df)} dwellings")

    print("Fetching GWR addresses...")
    address_by_egid = gwr.fetch_addresses(bfs_number, egids)
    print(f"  {len(address_by_egid)} / {len(buildings_df)} buildings matched an address")

    print("Fetching power plant registry...")
    plants_df = powerplants.fetch_power_plants(municipality_name, canton, egids)
    print(f"  {len(plants_df)} plants")

    min_e = buildings_df["E-Gebaeudekoordinate"].min()
    max_e = buildings_df["E-Gebaeudekoordinate"].max()
    min_n = buildings_df["N-Gebaeudekoordinate"].min()
    max_n = buildings_df["N-Gebaeudekoordinate"].max()

    print(f"Fetching building footprints over bbox ({min_e:.0f},{min_n:.0f})-({max_e:.0f},{max_n:.0f})...")
    footprint_by_egid, land = footprints_source.fetch_land_cover(min_e, min_n, max_e, max_n)
    matched_count = sum(1 for egid in egids if egid in footprint_by_egid)
    print(f"  matched {matched_count} / {len(buildings_df)} {municipality_name} buildings to a footprint")

    # Buildings with no cadastral footprint match render as a bare point marker,
    # which reads badly on the map (often sitting inside a neighboring building's
    # volume). Manual spot-checking found these are overwhelmingly transit-stop
    # shelters and other inconsequential structures, so we drop them for a clean
    # map rather than keep a point-marker fallback.
    dropped_count = len(buildings_df) - matched_count
    buildings_df = buildings_df[buildings_df[gwr.EGID_COL].astype(int).isin(footprint_by_egid)].copy()
    print(f"  dropped {dropped_count} building(s) with no footprint match")

    print("Fetching parks / sports fields / cemeteries (OpenStreetMap)...")
    margin = 300  # meters, so an area straddling the border is still seen
    min_lon, min_lat = coords.lv95_to_lonlat(min_e - margin, min_n - margin)
    max_lon, max_lat = coords.lv95_to_lonlat(max_e + margin, max_n + margin)
    excluded = exclusions_source.fetch_excluded_areas(min_lon, min_lat, max_lon, max_lat)
    print(f"  {len(excluded)} areas kept out of development")
    development_sites = sites_source.compute_sites(
        sites_source.fetch_zones(bfs_number), land, list(footprint_by_egid.values()), excluded
    )
    print(f"  {len(development_sites)} development sites")

    print("Fetching the street network (OpenStreetMap)...")
    boundary = boundary_source.fetch_boundary(bfs_number)
    boundary_lv95 = [Polygon([coords.lonlat_to_lv95(lon, lat) for lon, lat in polygon[0]]) for polygon in boundary]
    segments = streets_source.fetch_segments(boundary_lv95, min_lon, min_lat, max_lon, max_lat)
    print(f"  {len(segments)} street segments, {sum(s.length_m for s in segments) / 1000:.1f} km")
    entrances = gwr.fetch_entrances(bfs_number, egids)
    positions = {
        int(row[gwr.EGID_COL]): (float(row["E-Gebaeudekoordinate"]), float(row["N-Gebaeudekoordinate"])) for _, row in buildings_df.iterrows()
    }
    segments_by_egid = streets_source.link_buildings(segments, entrances, positions)
    print(f"  {sum(1 for v in segments_by_egid.values() if v)} / {len(positions)} buildings linked to a street")

    district_heated = buildings_df[
        buildings_df["Energie-/Waermequelle_Heizung_primaer_Bezeichnung"].fillna("").str.startswith("Fernwärme")
    ]
    dh_egids = [int(e) for e in district_heated[gwr.EGID_COL]]
    network = district_heat_source.infer_network(
        bfs_number,
        segments,
        {sid for egid in dh_egids for sid in segments_by_egid.get(egid, [])},
        [positions[e] for e in dh_egids],
    )
    if network:
        piped_km = sum(segments[s].length_m for s in network["initial_segments"]) / 1000
        print(f"  district heating: {len(dh_egids)} customers, {len(network['initial_segments'])} segments ({piped_km:.1f} km) piped, source: {network['source']['name']}")

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
                address=address_by_egid.get(egid),
                construction_year=_clean_int(row.get("Baujahr_des_Gebaeudes")),
                category=_clean_str(row.get("Gebaeudekategorie_Bezeichnung")),
                building_class=_clean_str(row.get("Gebaeudeklasse_Bezeichnung")),
                floor_count=_clean_int(row.get("Anzahl_Geschosse")),
                energy_reference_area_m2=_clean_float(row.get("Energiebezugsflaeche")),
                footprint_area_m2=_clean_float(row.get("Gebaeudeflaeche")),
                heating_generator=_clean_str(row.get("Waermeerzeuger_Heizung_primaer_Bezeichnung")),
                heating_energy_source=_clean_str(row.get("Energie-/Waermequelle_Heizung_primaer_Bezeichnung")),
                hot_water_generator=_clean_str(row.get("Waermeerzeuger_Warmwasser_primaer_Bezeichnung")),
                hot_water_energy_source=_clean_str(row.get("Energie-/Waermequelle_Warmwasser_primaer_Bezeichnung")),
                dwellings=dwellings_by_egid.get(egid, []),
                street_segments=segments_by_egid.get(egid, []),
            )
        )

    plants: list[PowerPlant] = []
    for _, row in plants_df.iterrows():
        if pd.isna(row["_x"]) or pd.isna(row["_y"]):
            continue  # registry rows without coordinates can't be placed (and NaN isn't valid JSON)
        lon, lat = coords.lv95_to_lonlat(row["_x"], row["_y"])
        plant_egid = _clean_int(row.get("EGID"))
        plants.append(
            PowerPlant(
                plant_id=str(row["xtf_id"]),
                lon=lon,
                lat=lat,
                capacity_kw=_clean_float(row.get("TotalPower")),
                technology=_clean_str(row.get("TechnologyLabel")),
                commissioning_date=_clean_str(row.get("BeginningOfOperation")),
                egid=str(plant_egid) if plant_egid is not None else None,
            )
        )

    return MunicipalityDataset(
        bfs_number=bfs_number,
        name=municipality_name,
        employment_by_sector=statent.fetch_employment_by_sector(bfs_number),
        boundary=boundary,
        stock_history=stock_history.compute_stock_history(gwr.fetch_building_records(bfs_number)),
        development_sites=development_sites,
        buildings=buildings,
        power_plants=plants,
        streets=[
            StreetSegment(
                id=s.id,
                name=s.name,
                highway=s.highway,
                a=s.a,
                b=s.b,
                length_m=round(s.length_m, 1),
                line=[tuple(round(v, 6) for v in coords.lv95_to_lonlat(x, y)) for x, y in s.lv95],
            )
            for s in segments
        ],
        district_heat=network,
    )


def write_index() -> None:
    """Rebuilds app/public/data/index.json — the list of available municipalities
    the game's start menu reads — by scanning every dataset file in OUTPUT_DIR."""
    entries = []
    for path in sorted(OUTPUT_DIR.glob("*.json")):
        if path.name == INDEX_FILENAME:
            continue
        data = json.loads(path.read_text(encoding="utf-8"))
        entries.append(
            {
                "slug": path.stem,
                "name": data["name"],
                "bfsNumber": data["bfsNumber"],
                "buildingCount": len(data["buildings"]),
            }
        )
    entries.sort(key=lambda e: e["name"])
    (OUTPUT_DIR / INDEX_FILENAME).write_text(json.dumps(entries, ensure_ascii=False, indent=2), encoding="utf-8")


def build_and_write(bfs_number: int) -> tuple[Path, MunicipalityDataset]:
    dataset = build(bfs_number)
    output_path = OUTPUT_DIR / f"{_slug(dataset.name)}.json"
    output_path.parent.mkdir(parents=True, exist_ok=True)
    payload = _to_camel(dataclasses.asdict(dataset))
    output_path.write_text(json.dumps(payload, ensure_ascii=False, allow_nan=False), encoding="utf-8")
    return output_path, dataset


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "bfs_number",
        type=int,
        nargs="?",
        default=None,
        help=f"BFS municipality number (default: {DEFAULT_BFS_NUMBER}, Schlieren). Look one up at {gwr.AUTHORITIES_URL}",
    )
    parser.add_argument(
        "--canton",
        help="build every municipality in this canton (e.g. ZH) instead of a single one; "
        "a municipality that fails is reported at the end and doesn't stop the rest",
    )
    args = parser.parse_args()

    if args.canton:
        bfs_numbers = gwr.canton_municipalities(args.canton)
        failures: list[tuple[int, str, str]] = []
        for i, (bfs_number, name) in enumerate(bfs_numbers, 1):
            print(f"\n=== [{i}/{len(bfs_numbers)}] {name} (BFS {bfs_number}) ===")
            try:
                output_path, dataset = build_and_write(bfs_number)
                print(f"Wrote {output_path} ({len(dataset.buildings)} buildings, {len(dataset.power_plants)} power plants)")
            except (Exception, SystemExit) as e:
                print(f"FAILED: {e}")
                failures.append((bfs_number, name, str(e)))
        write_index()
        print(f"\nDone:{len(bfs_numbers) - len(failures)} built, {len(failures)} failed")
        for bfs_number, name, reason in failures:
            print(f"  {name} (BFS {bfs_number}): {reason}")
        return

    output_path, dataset = build_and_write(args.bfs_number or DEFAULT_BFS_NUMBER)
    write_index()
    print(f"Wrote {output_path} ({len(dataset.buildings)} buildings, {len(dataset.power_plants)} power plants)")


if __name__ == "__main__":
    main()
