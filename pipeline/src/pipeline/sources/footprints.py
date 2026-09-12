"""Fetch building footprint polygons from swisstopo's VECTOR25 buildings layer via the
geo.admin.ch identify API, tiled over a bounding box (the API caps results per call and
has no bulk per-municipality download).
"""

from __future__ import annotations

import requests

IDENTIFY_URL = "https://api3.geo.admin.ch/rest/services/api/MapServer/identify"
LAYER = "ch.swisstopo.vec25-gebaeude"
MAX_RESULTS_PER_TILE = 200
TILE_SIZE_M = 200
PADDING_M = 50


def _identify_tile(e1: float, n1: float, e2: float, n2: float) -> list[dict]:
    params = {
        "geometryType": "esriGeometryEnvelope",
        "geometry": f"{e1},{n1},{e2},{n2}",
        "mapExtent": f"{e1},{n1},{e2},{n2}",
        "imageDisplay": "1000,1000,96",
        "tolerance": 0,
        "layers": f"all:{LAYER}",
        "sr": 2056,
        "returnGeometry": "true",
    }
    response = requests.get(IDENTIFY_URL, params=params, timeout=30)
    response.raise_for_status()
    return response.json().get("results", [])


def _tile_bbox(e1: float, n1: float, e2: float, n2: float) -> list[dict]:
    """Query one bbox; if the result count suggests truncation, split into quadrants and recurse."""
    results = _identify_tile(e1, n1, e2, n2)
    if len(results) < MAX_RESULTS_PER_TILE:
        return results
    mid_e, mid_n = (e1 + e2) / 2, (n1 + n2) / 2
    quadrants = [
        (e1, n1, mid_e, mid_n),
        (mid_e, n1, e2, mid_n),
        (e1, mid_n, mid_e, n2),
        (mid_e, mid_n, e2, n2),
    ]
    combined: list[dict] = []
    for q in quadrants:
        combined.extend(_tile_bbox(*q))
    return combined


def fetch_building_footprints(
    min_e: float, min_n: float, max_e: float, max_n: float
) -> list[list[tuple[float, float]]]:
    """Building footprint rings (LV95 coordinates) covering the given bbox, padded slightly."""
    min_e, min_n = min_e - PADDING_M, min_n - PADDING_M
    max_e, max_n = max_e + PADDING_M, max_n + PADDING_M

    footprints: list[list[tuple[float, float]]] = []
    e = min_e
    while e < max_e:
        n = min_n
        while n < max_n:
            tile_results = _tile_bbox(e, n, min(e + TILE_SIZE_M, max_e), min(n + TILE_SIZE_M, max_n))
            for feature in tile_results:
                geometry = feature.get("geometry")
                rings = geometry.get("rings") if geometry else None
                if not rings:
                    continue
                footprints.append([(pt[0], pt[1]) for pt in rings[0]])
            n += TILE_SIZE_M
        e += TILE_SIZE_M
    return footprints
