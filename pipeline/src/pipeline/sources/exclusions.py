"""Land that is open on paper but never a development site: sports fields, playgrounds,
parks, allotments, cemeteries and the like. Neither the cadastral land cover (a
sports pitch is just "meadow") nor the zoning layer (they often sit in an ordinary
or public zone) says so, so this asks OpenStreetMap through the Overpass API for
those areas inside the municipality's bounding box.

OpenStreetMap data (c) OpenStreetMap contributors, ODbL — only areas derived from it
are shipped in the dataset (as absent development sites), never the raw data.
"""

from __future__ import annotations

import time

import requests
from shapely import make_valid
from shapely.geometry import LineString, Polygon
from shapely.ops import polygonize, unary_union

from .. import coords

OVERPASS_URL = "https://overpass-api.de/api/interpreter"
# Overpass answers 406 to requests without an identifying User-Agent.
HEADERS = {"User-Agent": "grid-and-ground-pipeline/0.1 (offline data preparation)"}

LEISURE = "pitch|sports_centre|stadium|track|playground|park|garden|golf_course|recreation_ground|dog_park|nature_reserve|swimming_pool|fitness_station"
LANDUSE = "cemetery|recreation_ground|allotments|village_green"
AMENITY = "grave_yard"


def _query(south: float, west: float, north: float, east: float) -> str:
    bbox = f"({south},{west},{north},{east})"
    return f"""[out:json][timeout:90];
(
  way["leisure"~"^({LEISURE})$"]{bbox};
  way["landuse"~"^({LANDUSE})$"]{bbox};
  way["amenity"="{AMENITY}"]{bbox};
  relation["leisure"~"^({LEISURE})$"]{bbox};
  relation["landuse"~"^({LANDUSE})$"]{bbox};
  relation["amenity"="{AMENITY}"]{bbox};
);
out geom;"""


def _post(query: str) -> list[dict]:
    last_error: Exception | None = None
    for attempt in range(4):
        try:
            response = requests.post(OVERPASS_URL, data={"data": query}, headers=HEADERS, timeout=120)
            if response.status_code in (429, 502, 503, 504):
                raise requests.HTTPError(f"Overpass busy ({response.status_code})")
            response.raise_for_status()
            return response.json()["elements"]
        except (requests.RequestException, ValueError) as e:
            last_error = e
            time.sleep(5 * (attempt + 1))
    raise SystemExit(f"Overpass request failed after retries ({last_error}); without it, sports fields and parks would be offered as building sites")


def _lv95(points: list[dict]) -> list[tuple[float, float]]:
    return [coords.lonlat_to_lv95(p["lon"], p["lat"]) for p in points]


def _way_polygon(points: list[dict]) -> Polygon | None:
    if len(points) < 4 or points[0] != points[-1]:
        return None  # an open way (a running track drawn as a line) has no inside
    return Polygon(_lv95(points))


def fetch_excluded_areas(min_lon: float, min_lat: float, max_lon: float, max_lat: float) -> list:
    """Polygons (LV95) of every park/sports/cemetery/allotment area in the bbox."""
    polygons = []
    for element in _post(_query(min_lat, min_lon, max_lat, max_lon)):
        if element["type"] == "way":
            polygon = _way_polygon(element.get("geometry", []))
            if polygon is not None:
                polygons.append(polygon)
        elif element["type"] == "relation":
            outer = [LineString(_lv95(m["geometry"])) for m in element.get("members", []) if m.get("role") == "outer" and len(m.get("geometry", [])) >= 2]
            if outer:
                polygons.extend(polygonize(unary_union(outer)))
    return [make_valid(p) for p in polygons if not p.is_empty]
