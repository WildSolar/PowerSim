"""Surface car parks big enough for a solar canopy (about 20 spaces and up), from OpenStreetMap.

Neither the cadastral survey (a car park is "other paved surface") nor the zoning layer says where
the car parks are; OpenStreetMap maps them as areas (amenity=parking). Only open-air ones are kept:
multi-storey, underground and rooftop car parks, street-side bays and car parks already under a roof
are left out. A lot's number of spaces is its mapped capacity where that is plausible for its size,
otherwise its area at about 27 m² a space (aisles included). Each gets the building it most likely
belongs to — a big building close by — whose electricity a canopy would offset, and its mapped
access ("customers", "private", "yes"...), from which the game tells the municipality's own lots
from private ones.

OpenStreetMap data (c) OpenStreetMap contributors, ODbL.
"""

from __future__ import annotations

from shapely import make_valid
from shapely.geometry import LineString, Point, Polygon
from shapely.ops import polygonize, unary_union
from shapely.strtree import STRtree

from .. import coords
from .exclusions import TILE_DEG_LAT, TILE_DEG_LON, _lv95, _post

MIN_SPACES = 20
M2_PER_SPACE = 27
# A mapped capacity is believed if it gives between this many m² a space.
CAPACITY_M2_PER_SPACE = (10, 60)
# How far from the lot its building may stand, and how much nearer a smaller one must be to win.
HOST_MAX_M = 60
HOST_DISTANCE_SCALE_M = 15

# Open-air parking only: these are garages, roofs or kerbs.
EXCLUDED_PARKING = {"multi-storey", "underground", "rooftop", "street_side", "lane", "on_kerb", "half_on_kerb", "layby", "carports", "garage_boxes", "sheds"}


def _query(south: float, west: float, north: float, east: float) -> str:
    bbox = f"({south},{west},{north},{east})"
    return f"""[out:json][timeout:90];
(
  way["amenity"="parking"]{bbox};
  relation["amenity"="parking"]{bbox};
);
out tags geom;"""


def _open_air(tags: dict) -> bool:
    if tags.get("parking") in EXCLUDED_PARKING:
        return False
    if tags.get("covered") == "yes" or tags.get("building") or tags.get("location") in ("underground", "roof", "rooftop"):
        return False
    return True


def _polygon(element: dict) -> Polygon | None:
    if element["type"] == "way":
        points = element.get("geometry", [])
        if len(points) < 4 or points[0] != points[-1]:
            return None
        return make_valid(Polygon(_lv95(points)))
    outer = [LineString(_lv95(m["geometry"])) for m in element.get("members", []) if m.get("role") == "outer" and len(m.get("geometry", [])) >= 2]
    parts = list(polygonize(unary_union(outer))) if outer else []
    return make_valid(unary_union(parts)) if parts else None


def _spaces(tags: dict, area_m2: float) -> int:
    capacity = tags.get("capacity", "")
    if capacity.isdigit() and int(capacity) > 0:
        per_space = area_m2 / int(capacity)
        if CAPACITY_M2_PER_SPACE[0] <= per_space <= CAPACITY_M2_PER_SPACE[1]:
            return int(capacity)
    return round(area_m2 / M2_PER_SPACE)


def fetch_car_parks(boundary_lv95: list[Polygon], footprints_lv95: dict[str, Polygon]) -> list[dict]:
    """[{id, name, access, spaces, area_m2, host_egid, rings}] — open-air car parks of MIN_SPACES or
    more inside the municipality, rings as [lon, lat]."""
    town = unary_union(boundary_lv95)
    min_e, min_n, max_e, max_n = town.bounds
    min_lon, min_lat = coords.lv95_to_lonlat(min_e, min_n)
    max_lon, max_lat = coords.lv95_to_lonlat(max_e, max_n)
    tiles_x = max(1, round((max_lon - min_lon) / TILE_DEG_LON))
    tiles_y = max(1, round((max_lat - min_lat) / TILE_DEG_LAT))
    elements: dict[tuple[str, int], dict] = {}
    for i in range(tiles_x):
        for j in range(tiles_y):
            west = min_lon + (max_lon - min_lon) * i / tiles_x
            east = min_lon + (max_lon - min_lon) * (i + 1) / tiles_x
            south = min_lat + (max_lat - min_lat) * j / tiles_y
            north = min_lat + (max_lat - min_lat) * (j + 1) / tiles_y
            for element in _post(_query(south, west, north, east)):
                elements[(element["type"], element["id"])] = element

    egids = list(footprints_lv95)
    shapes = [footprints_lv95[e] for e in egids]
    tree = STRtree(shapes)
    lots = []
    for (kind, osm_id), element in sorted(elements.items()):
        tags = element.get("tags", {})
        if not _open_air(tags):
            continue
        polygon = _polygon(element)
        if polygon is None or polygon.is_empty or not town.contains(polygon.representative_point()):
            continue
        # Mapped round a building now and then: only the open ground counts.
        nearby = [shapes[i] for i in tree.query(polygon)]
        ground = polygon.difference(unary_union(nearby)) if nearby else polygon
        area = ground.area
        spaces = _spaces(tags, area)
        if spaces < MIN_SPACES:
            continue
        host = None
        best = 0.0
        for i in tree.query(polygon.buffer(HOST_MAX_M)):
            d = shapes[i].distance(polygon)
            if d > HOST_MAX_M:
                continue
            score = shapes[i].area / (d + HOST_DISTANCE_SCALE_M)
            if score > best:
                best, host = score, egids[i]
        outer = max(getattr(ground, "geoms", [ground]), key=lambda g: g.area)
        lots.append(
            {
                "id": f"osm-{kind[0]}{osm_id}",
                "name": tags.get("name"),
                "access": tags.get("access"),
                "spaces": spaces,
                "area_m2": round(area),
                "host_egid": host,
                "rings": [[[round(v, 6) for v in coords.lv95_to_lonlat(x, y)] for x, y in outer.exterior.coords]],
            }
        )
    return lots
