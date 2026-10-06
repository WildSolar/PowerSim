"""Heat for district heating: the networks a municipality has today, and where new heat could come
from. All federal open data from the Swiss Federal Office of Energy (BFE), plus canton Zurich's land
cover:

- Thermal networks (ch.bfe.thermische-netze): every district heating network in Switzerland as its
  operator reports it — a point, its capacity (MW, not always given), and up to two energy sources
  (a main one, and often a fossil peak boiler).
- Waste incineration plants (ch.bfe.kehrichtverbrennungsanlagen): location, and the heat and
  electricity each delivers a year.
- Heat supply for thermal networks (ch.bfe.fernwaerme-angebot): waste water treatment plants and the
  heat that could be recovered from their effluent a year.
- Heat demand of industry (ch.bfe.fernwaerme-nachfrage_industrie): hectare cells with industrial heat
  demand and their main branch (NOGA). A plant that uses a lot of process heat also throws a lot of
  it away; a few such sites become waste heat offers (which ones is the game's guess).
- Land cover (canton ZH): forest area (the local wood supply) and rivers and lakes (heat pumps
  drawing on surface water).

The game decides what each is worth; this module only finds them.
"""

from __future__ import annotations

import csv
import io
import json
import random
import zipfile

import requests
from shapely.geometry import Point, Polygon, shape
from shapely.ops import unary_union

from .. import coords
from ..cache import cached_json

STAC = "https://data.geo.admin.ch"
NETWORKS_URL = f"{STAC}/ch.bfe.thermische-netze/thermische-netze/thermische-netze_2056.csv.zip"
INCINERATORS_URL = f"{STAC}/ch.bfe.kehrichtverbrennungsanlagen/kehrichtverbrennungsanlagen/kehrichtverbrennungsanlagen_2056.csv.zip"
WASTEWATER_URL = f"{STAC}/ch.bfe.fernwaerme-angebot/fernwaerme-angebot/fernwaerme-angebot_2056.csv.zip"
IDENTIFY_URL = "https://api3.geo.admin.ch/rest/services/api/MapServer/identify"
INDUSTRY_LAYER = "ch.bfe.fernwaerme-nachfrage_industrie"
LAND_COVER_WFS = "https://maps.zh.ch/wfs/AVZHWFS"
LAND_COVER_LAYER = "ms:bodenbedeckung_f"

# A network counts for the municipality if its plant lies within this far of the border.
NETWORK_REACH_M = 300
# Networks whose position the operator didn't give (accuracy 101) can't be placed.
MIN_POSITION_ACCURACY = 102
# The last year a network may have started to be there when the game starts.
NETWORKS_SINCE_UPTO = 2026
# How far a plant outside the municipality may be to be worth a trunk line, and how many of the
# nearest are offered.
INCINERATOR_REACH_M = 8_000
INCINERATORS_MAX = 2
WASTEWATER_REACH_M = 1_500
WASTEWATER_MAX = 3
# Industrial waste heat: a hectare cell's heat demand times its branch's share that ends up as
# usable waste heat (cooling, exhaust, process water). Of the cells inside the municipality with at
# least this much waste heat a year (MWh), this many become offers.
INDUSTRY_MIN_WASTE_HEAT_MWH = 300
INDUSTRY_OFFERS = 3
# NOGA division -> (English name, share of the heat demand recoverable as waste heat). Informed
# guesses: heavy process industry and anything that cools a lot gives off most.
NOGA_WASTE_HEAT: dict[int, tuple[str, float]] = {
    10: ("Food production", 0.35),
    11: ("Beverage production", 0.35),
    13: ("Textile mill", 0.2),
    16: ("Sawmill and wood products", 0.15),
    17: ("Paper mill", 0.4),
    18: ("Printing works", 0.2),
    19: ("Refinery", 0.4),
    20: ("Chemical plant", 0.4),
    21: ("Pharmaceutical plant", 0.35),
    22: ("Rubber and plastics works", 0.3),
    23: ("Glass, ceramics and stone works", 0.45),
    24: ("Metal works", 0.45),
    25: ("Metal products factory", 0.25),
    26: ("Electronics factory", 0.3),
    27: ("Electrical equipment factory", 0.25),
    28: ("Machine works", 0.2),
    29: ("Vehicle parts factory", 0.25),
    32: ("Factory", 0.2),
    33: ("Repair and installation works", 0.1),
    35: ("Power plant", 0.5),
    38: ("Waste treatment plant", 0.4),
    41: ("Building contractor", 0.05),
    43: ("Construction yard", 0.05),
    46: ("Wholesale warehouse", 0.15),  # cold stores
    47: ("Retail centre", 0.15),
    52: ("Logistics centre", 0.1),
    56: ("Commercial kitchen", 0.2),
    62: ("Data centre", 0.8),
    63: ("Data centre", 0.8),
    86: ("Hospital", 0.15),
}
DEFAULT_WASTE_HEAT = ("Industrial site", 0.15)
# BFE energy source catalogue -> the game's kind of source.
ENERGY_SOURCE_KIND = {
    1: "oil",
    2: "gas",
    3: "gas",  # natural gas cogeneration
    4: "wood",  # logs
    5: "wood",  # wood chips
    6: "wood",  # pellets
    7: "wood",  # biogas: burned like wood, as far as the game goes
    8: "wood",  # biogas cogeneration
    10: "surfaceWater",
    11: "groundwater",
    12: "groundwater",  # geothermal (+ heat pump): a heat pump on the ground
    13: "groundwater",  # air (+ heat pump): a heat pump all the same
    14: "industry",
    15: "wastewater",
    16: "incinerator",
    17: "incinerator",  # nuclear power plant waste heat: bought like an incinerator's
    18: "industry",  # tunnel waste heat
    20: "other",  # solar thermal
}
# Rivers (flowing water) and lakes (standing water) at least this big (ha, around the municipality)
# are a heat source; brooks and ponds aren't. Pieces left smaller than the last after clipping to
# the municipality are dropped.
MIN_RIVER_HA = 3.0
MIN_LAKE_HA = 20.0
MIN_PIECE_HA = 0.2
WATER_MARGIN_M = 150

_csv_cache: dict[str, dict[str, list[dict]]] = {}


def _zip_csvs(url: str) -> dict[str, list[dict]]:
    if url not in _csv_cache:
        response = requests.get(url, timeout=120)
        response.raise_for_status()
        tables: dict[str, list[dict]] = {}
        with zipfile.ZipFile(io.BytesIO(response.content)) as z:
            for name in z.namelist():
                if name.lower().endswith(".csv"):
                    text = z.read(name).decode("utf-8-sig")
                    tables[name.rsplit("/", 1)[-1]] = list(csv.DictReader(io.StringIO(text)))
        _csv_cache[url] = tables
    return _csv_cache[url]


def _float(value: str | None) -> float | None:
    try:
        return float(value) if value not in (None, "") else None
    except ValueError:
        return None


def _distance(boundary: list[Polygon], x: float, y: float) -> float:
    p = Point(x, y)
    return min(poly.distance(p) for poly in boundary)


def fetch_networks(boundary: list[Polygon]) -> list[dict]:
    """The district heating networks with a plant in or just outside the municipality: name,
    operator, position (LV95 x/y), capacity in MW (or None) and their energy sources in the
    operator's order, as (kind, label)."""
    tables = _zip_csvs(NETWORKS_URL)
    labels = {int(r["Catalogue_id"]): r["EnergySource__en"] for r in tables["EnergySourceCatalogue.csv"]}
    networks = []
    for r in tables["ch.bfe.thermische-netze.csv"]:
        accuracy = int(r.get("PositionAccuracy") or 101)
        since = int(r["BeginningOfOperation"]) if (r.get("BeginningOfOperation") or "").isdigit() else None
        x, y = _float(r.get("x")), _float(r.get("y"))
        if x is None or y is None or accuracy < MIN_POSITION_ACCURACY or (since is not None and since > NETWORKS_SINCE_UPTO):
            continue
        if _distance(boundary, x, y) > NETWORK_REACH_M:
            continue
        sources = []
        for key in ("EnergySource1", "EnergySource2"):
            code = int(r[key]) if (r.get(key) or "").isdigit() else None
            if code in ENERGY_SOURCE_KIND:
                sources.append({"kind": ENERGY_SOURCE_KIND[code], "label": labels.get(code, "")})
        networks.append(
            {
                "name": r["Name"].strip(),
                "operator": (r.get("Operator") or "").strip() or None,
                "since": since,
                "x": x,
                "y": y,
                "power_mw": _float(r.get("Power")),
                "sources": sources,
            }
        )
    return networks


def _latest(row: dict) -> float | None:
    for year in range(2030, 2009, -1):
        value = _float(row.get(str(year)))
        if value is not None:
            return value
    return None


def fetch_incinerators(boundary: list[Polygon]) -> list[dict]:
    """Waste incineration plants within reach, with the heat and electricity they delivered in the
    latest year reported (MWh)."""
    tables = _zip_csvs(INCINERATORS_URL)
    heat = {r["id"]: _latest(r) for r in tables["Heat.csv"]}
    electricity = {r["id"]: _latest(r) for r in tables["Electricity.csv"]}
    plants = []
    for r in tables["WasteIncinerationPlant.csv"]:
        x, y = _float(r.get("x")), _float(r.get("y"))
        if x is None or y is None:
            continue
        distance = _distance(boundary, x, y)
        if distance > INCINERATOR_REACH_M:
            continue
        if not (heat.get(r["xtf_id"]) or electricity.get(r["xtf_id"])):
            continue  # closed
        plants.append(
            {
                "distance": distance,
                "id": f"kva-{r['xtf_id']}",
                "name": f"{r['Name'].strip()} waste incineration plant",
                "x": x,
                "y": y,
                "heat_mwh": heat.get(r["xtf_id"]) or 0.0,
                "electricity_mwh": electricity.get(r["xtf_id"]) or 0.0,
            }
        )
    return sorted(plants, key=lambda p: p["distance"])[:INCINERATORS_MAX]


def fetch_wastewater(boundary: list[Polygon]) -> list[dict]:
    """Waste water treatment plants within reach, with the heat recoverable from their effluent a
    year (MWh)."""
    tables = _zip_csvs(WASTEWATER_URL)
    plants = []
    for r in tables["HeatSupplier.csv"]:
        x, y, potential = _float(r.get("_x")), _float(r.get("_y")), _float(r.get("HeatPotential_MWha"))
        if x is None or y is None or not potential:
            continue
        distance = _distance(boundary, x, y)
        if distance > WASTEWATER_REACH_M:
            continue
        plants.append({"distance": distance, "id": f"ara-{r['xtf_id']}", "name": f"{r['Name'].strip()} waste water treatment plant", "x": x, "y": y, "potential_mwh": potential})
    return sorted(plants, key=lambda p: p["distance"])[:WASTEWATER_MAX]


def _identify_cells(bbox: tuple[float, float, float, float]) -> list[dict]:
    """Industry heat demand cells in a bbox, tiling the request if it comes back full."""
    min_e, min_n, max_e, max_n = bbox
    params = {
        "layers": f"all:{INDUSTRY_LAYER}",
        "geometryType": "esriGeometryEnvelope",
        "geometry": f"{min_e},{min_n},{max_e},{max_n}",
        "sr": 2056,
        "tolerance": 0,
        "returnGeometry": "true",
        "geometryFormat": "geojson",
        "limit": 200,
    }
    response = requests.get(IDENTIFY_URL, params=params, timeout=60)
    response.raise_for_status()
    results = response.json().get("results", [])
    if len(results) < 200 or max_e - min_e < 500:
        return results
    mid_e, mid_n = (min_e + max_e) / 2, (min_n + max_n) / 2
    cells: dict[int, dict] = {}
    for sub in ((min_e, min_n, mid_e, mid_n), (mid_e, min_n, max_e, mid_n), (min_e, mid_n, mid_e, max_n), (mid_e, mid_n, max_e, max_n)):
        for c in _identify_cells(sub):
            cells[c["id"]] = c
    return list(cells.values())


def fetch_industry(boundary: list[Polygon], bfs_number: int, buildings: list[dict]) -> list[dict]:
    """A few industrial sites that could sell waste heat: hectare cells inside the municipality with
    a lot of waste heat for their branch, picked at random (weighted by it, the same every build), each
    tied to the biggest non-residential building in its cell. `buildings`: {egid, x, y, area_m2,
    residential} for every building."""
    union = unary_union(boundary)
    min_e, min_n, max_e, max_n = union.bounds
    candidates = []
    for cell in _identify_cells((min_e, min_n, max_e, max_n)):
        props = cell.get("properties") or cell.get("attributes") or {}
        demand = props.get("needindustry") or 0
        code = str(props.get("noga") or "").partition(":")[0].strip()
        noga = int(code) if code.isdigit() else None
        branch, share = NOGA_WASTE_HEAT.get(noga, DEFAULT_WASTE_HEAT) if noga is not None else DEFAULT_WASTE_HEAT
        waste_heat = demand * share
        if waste_heat < INDUSTRY_MIN_WASTE_HEAT_MWH:
            continue
        geometry = shape(cell["geometry"])
        if not union.contains(geometry.centroid):
            continue
        inside = [b for b in buildings if not b["residential"] and geometry.contains(Point(b["x"], b["y"]))]
        if not inside:
            continue
        site = max(inside, key=lambda b: b["area_m2"] or 0)
        candidates.append({"egid": site["egid"], "x": site["x"], "y": site["y"], "waste_heat_mwh": round(waste_heat), "noga": noga, "branch": branch})
    rng = random.Random(f"industry-heat:{bfs_number}")
    picked = []
    pool = sorted(candidates, key=lambda c: c["egid"])
    while pool and len(picked) < INDUSTRY_OFFERS:
        weights = [c["waste_heat_mwh"] for c in pool]
        choice = rng.choices(range(len(pool)), weights=weights)[0]
        picked.append(pool.pop(choice))
    return picked


def fetch_land(boundary: list[Polygon]) -> tuple[float, list]:
    """Forest inside the municipality (ha), and the rivers and lakes in and just around it (shapely
    polygons, LV95) — big enough to draw heat from, clipped to the border plus a margin."""
    union = unary_union(boundary)
    min_e, min_n, max_e, max_n = union.buffer(WATER_MARGIN_M).bounds
    forest: list = []
    water: dict[str, list] = {"fliessendes Gewässer": [], "stehendes Gewässer": []}
    # Tiled: the WFS caps how many features one request returns.
    step = 2_000
    e = min_e
    while e < max_e:
        n = min_n
        while n < max_n:
            params = {
                "Service": "WFS",
                "Request": "GetFeature",
                "Version": "2.0.0",
                "TypeNames": LAND_COVER_LAYER,
                "bbox": f"{e},{n},{min(e + step, max_e)},{min(n + step, max_n)},EPSG:2056",
                "outputFormat": "application/json",
            }
            for f in cached_json("land-cover", json.dumps(params, sort_keys=True), lambda: _get_features(params)):
                art = f["properties"].get("art")
                if art == "geschlossener Wald":
                    forest.append(shape(f["geometry"]))
                elif art in water:
                    water[art].append(shape(f["geometry"]))
            n += step
        e += step
    forest_ha = unary_union(forest).intersection(union).area / 10_000 if forest else 0.0
    bodies = []
    clip = union.buffer(WATER_MARGIN_M)
    for art, min_ha in (("fliessendes Gewässer", MIN_RIVER_HA), ("stehendes Gewässer", MIN_LAKE_HA)):
        if not water[art]:
            continue
        merged = unary_union(water[art])
        for part in list(merged.geoms) if hasattr(merged, "geoms") else [merged]:
            if part.area / 10_000 < min_ha:
                continue
            clipped = part.intersection(clip).simplify(3)
            for piece in list(clipped.geoms) if hasattr(clipped, "geoms") else [clipped]:
                if piece.geom_type == "Polygon" and piece.area / 10_000 >= MIN_PIECE_HA:
                    bodies.append(piece)
    return forest_ha, bodies


def _get_features(params: dict) -> list[dict]:
    for attempt in range(3):
        try:
            response = requests.get(LAND_COVER_WFS, params=params, timeout=120)
            response.raise_for_status()
            # Only what fetch_land reads: forest and water.
            return [f for f in response.json()["features"] if f["properties"].get("art") in ("geschlossener Wald", "fliessendes Gewässer", "stehendes Gewässer")]
        except requests.RequestException:
            if attempt == 2:
                raise
    return []


def polygon_rings_lonlat(geometry) -> list[list[list[tuple[float, float]]]]:
    """A (multi)polygon as polygons of rings in lon/lat (outer ring first)."""
    polys = list(geometry.geoms) if hasattr(geometry, "geoms") else [geometry]
    out = []
    for poly in polys:
        if poly.geom_type != "Polygon" or poly.is_empty:
            continue
        rings = [poly.exterior, *poly.interiors]
        out.append([[tuple(round(v, 6) for v in coords.lv95_to_lonlat(x, y)) for x, y in ring.coords] for ring in rings])
    return out

