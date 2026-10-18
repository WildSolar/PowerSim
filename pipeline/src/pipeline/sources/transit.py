"""Public transport quality classes (ÖV-Güteklassen, ARE): how well a place is served, from A (very
good) to D (basic), by how far it is to the nearest stop and how often that stop is served — a
station on the S-Bahn reaches further than a bus stop served hourly. Places outside every class have
next to no public transport. The game weighs a household's chance of getting about by public
transport by its building's class.

The federal layer (ch.are.gueteklassen_oev on geo.admin.ch) is fetched tile by tile over the
municipality, clipped to it (with a margin, for buildings at its edge) and simplified.
"""

from __future__ import annotations

import requests
from shapely.geometry import shape
from shapely.geometry.base import BaseGeometry
from shapely.ops import unary_union

from .. import coords
from ..cache import cached_json

IDENTIFY_URL = "https://api3.geo.admin.ch/rest/services/api/MapServer/identify"
LAYER = "ch.are.gueteklassen_oev"
CLASSES = ("A", "B", "C", "D")
TILE_M = 2_000
MARGIN_M = 300
SIMPLIFY_M = 5.0


def _tile(min_e: float, min_n: float, max_e: float, max_n: float) -> list[dict]:
    envelope = f"{min_e},{min_n},{max_e},{max_n}"

    def fetch():
        for attempt in range(3):
            try:
                response = requests.get(
                    IDENTIFY_URL,
                    params={
                        "geometry": envelope,
                        "geometryType": "esriGeometryEnvelope",
                        "layers": f"all:{LAYER}",
                        "mapExtent": envelope,
                        "imageDisplay": "500,500,96",
                        "tolerance": 0,
                        "returnGeometry": "true",
                        "geometryFormat": "geojson",
                        "sr": 2056,
                        "limit": 200,
                    },
                    timeout=120,
                )
                response.raise_for_status()
                return [{"id": r["id"], "class": r["properties"]["klasse_de"][:1], "geometry": r["geometry"]} for r in response.json().get("results", [])]
            except requests.RequestException:
                if attempt == 2:
                    raise
        return []

    return cached_json("oev-gueteklassen", envelope, fetch)


def _rings(geometry: BaseGeometry) -> list[list[list[tuple[float, float]]]]:
    """A (multi)polygon's parts as [outer ring, holes...] in lon/lat."""
    parts = [geometry] if geometry.geom_type == "Polygon" else [g for g in getattr(geometry, "geoms", []) if g.geom_type == "Polygon"]
    out = []
    for poly in parts:
        if poly.is_empty or poly.area < 100:
            continue
        rings = [poly.exterior, *poly.interiors]
        out.append([[tuple(round(v, 6) for v in coords.lv95_to_lonlat(x, y)) for x, y in ring.coords] for ring in rings])
    return out


def fetch_transit_classes(boundary_lv95: list) -> list[dict]:
    """The class areas over the municipality: [{class: "A".."D", rings: [outer, holes...]}], one
    entry per polygon, best class first."""
    area = unary_union(boundary_lv95).buffer(MARGIN_M)
    min_e, min_n, max_e, max_n = area.bounds
    by_id: dict[int, dict] = {}
    e = min_e
    while e < max_e:
        n = min_n
        while n < max_n:
            for f in _tile(round(e), round(n), round(min(e + TILE_M, max_e)), round(min(n + TILE_M, max_n))):
                by_id[f["id"]] = f
            n += TILE_M
        e += TILE_M
    out = []
    for cls in CLASSES:
        geoms = [shape(f["geometry"]) for f in by_id.values() if f["class"] == cls]
        if not geoms:
            continue
        merged = unary_union([g.buffer(0) for g in geoms]).intersection(area).simplify(SIMPLIFY_M, preserve_topology=True)
        out.extend({"class": cls, "rings": rings} for rings in _rings(merged))
    return out
