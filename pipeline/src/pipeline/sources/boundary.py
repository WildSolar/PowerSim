"""Fetch a municipality's official boundary polygon from swisstopo's swissBOUNDARIES3D
municipality layer via the federal geo.admin.ch REST API — national, keyed by the same
BFS number used everywhere else, and returned directly in WGS84 (no LV95 transform)."""

from __future__ import annotations

import requests

URL_TEMPLATE = (
    "https://api3.geo.admin.ch/rest/services/api/MapServer/"
    "ch.swisstopo.swissboundaries3d-gemeinde-flaeche.fill/{bfs_number}"
)

# polygons -> rings (outer ring first, then holes) -> [lon, lat] points
Boundary = list[list[list[list[float]]]]


def fetch_boundary(bfs_number: int) -> Boundary:
    response = requests.get(
        URL_TEMPLATE.format(bfs_number=bfs_number),
        params={"geometryFormat": "geojson", "sr": 4326},
        timeout=60,
    )
    response.raise_for_status()
    geometry = response.json()["feature"]["geometry"]
    if geometry["type"] == "Polygon":
        return [geometry["coordinates"]]
    return geometry["coordinates"]
