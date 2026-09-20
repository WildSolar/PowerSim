"""Development sites: where a new building could plausibly go. National zoning from
ARE's harmonised building-zone layer (Bauzonen Schweiz) says what may be built where;
canton land cover (footprints.py's WFS, so canton-ZH-only for now) says which parts
of a zone are actually still open ground; existing footprints (with a setback) are
cut out. What's left, filtered to pieces big and compact enough to hold a building,
becomes the site list the game places new construction into."""

from __future__ import annotations

import math

import requests
from shapely import make_valid
from shapely.geometry import Polygon, shape
from shapely.ops import unary_union

from .. import coords

ZONING_URL = "https://api3.geo.admin.ch/rest/services/api/MapServer/find"

# ARE's harmonised zone-type code (ch_code_hn) -> game zone. 16 (restricted building
# zones) and the rest are deliberately not buildable here.
ZONE_BY_CODE = {"11": "residential", "12": "work", "13": "mixed", "14": "centre", "15": "public"}

SETBACK_M = 4.0  # gap kept clear around every existing building
EDGE_MARGIN_M = 1.5  # pieces are eroded by this so a placed building never touches a zone edge
MIN_AREA_M2 = 300.0
MIN_SHORT_SIDE_M = 10.0
MAX_SITES = 600


def fetch_zones(bfs_number: int) -> dict[str, list]:
    response = requests.get(
        ZONING_URL,
        params={
            "layer": "ch.are.bauzonen",
            "searchText": str(bfs_number),
            "searchField": "bfs_no",
            "contains": "false",
            "returnGeometry": "true",
            "geometryFormat": "geojson",
            "sr": 2056,
        },
        timeout=90,
    )
    response.raise_for_status()
    zones: dict[str, list] = {}
    for feature in response.json()["results"]:
        zone = ZONE_BY_CODE.get(feature["properties"]["ch_code_hn"])
        if zone:
            zones.setdefault(zone, []).append(make_valid(shape(feature["geometry"])))
    return zones


def _polygons(geometry) -> list[Polygon]:
    if geometry.is_empty:
        return []
    if geometry.geom_type == "Polygon":
        return [geometry]
    if hasattr(geometry, "geoms"):
        return [p for g in geometry.geoms for p in _polygons(g)]
    return []


def _long_axis_angle_deg(polygon: Polygon) -> tuple[float, float]:
    """Orientation of the minimum rotated rectangle's long side (degrees counter-
    clockwise from east) and the length of its short side."""
    rect = polygon.minimum_rotated_rectangle
    pts = list(rect.exterior.coords)
    edges = [(pts[i + 1][0] - pts[i][0], pts[i + 1][1] - pts[i][1]) for i in range(2)]
    lengths = [math.hypot(*e) for e in edges]
    long_edge = edges[0] if lengths[0] >= lengths[1] else edges[1]
    angle = math.degrees(math.atan2(long_edge[1], long_edge[0])) % 180.0
    return angle, min(lengths)


def compute_sites(zones: dict[str, list], open_land: list, footprints: list[list[tuple[float, float]]]) -> list[dict]:
    if not open_land or not zones:
        return []
    open_union = unary_union([make_valid(p) for p in open_land])
    built = unary_union([Polygon(ring).buffer(SETBACK_M) for ring in footprints if len(ring) >= 4])

    sites: list[dict] = []
    for zone, polys in zones.items():
        free = unary_union(polys).intersection(open_union).difference(built).buffer(-EDGE_MARGIN_M)
        for piece in _polygons(free):
            piece = piece.simplify(1.0)
            if piece.is_empty or piece.area < MIN_AREA_M2:
                continue
            angle, short_side = _long_axis_angle_deg(piece)
            if short_side < MIN_SHORT_SIDE_M:
                continue
            rings = [list(piece.exterior.coords)] + [list(r.coords) for r in piece.interiors]
            sites.append(
                {
                    "zone": zone,
                    "area_m2": round(piece.area),
                    "angle_deg": round(angle, 1),
                    "rings": [coords.lv95_ring_to_lonlat(r) for r in rings],
                }
            )

    sites.sort(key=lambda s: -s["area_m2"])
    sites = sites[:MAX_SITES]
    for i, site in enumerate(sites):
        site["id"] = f"site-{i}"
    return sites
