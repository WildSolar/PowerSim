"""Where wind turbines could stand: the federal wind atlas (BFE, ch.bfe.windenergie-geschwindigkeit_h125:
mean wind speed and its Weibull distribution 125 m above ground, the hub height of a modern
low-wind turbine), on the municipality's land outside the building zones, away from homes and water.

A grid of points over the municipality is thinned to those far enough from every home (the noise
ordinance and the cantons' practice), outside every building zone and off the water; the atlas is
asked about each (cached). The windiest points are then taken greedily as turbine positions, a
turbine spacing apart, and grouped into sites — wind parks of a few turbines — of which the best few
are kept. A site is named after the field it stands in.

What the game makes of them — the study that finds them, the zoning, permits and appeals — is the
game's; this only finds the places.
"""

from __future__ import annotations

import math

import requests
from shapely.geometry import Point, shape
from shapely.ops import unary_union

from .. import coords
from ..cache import cached_json
from . import farm

IDENTIFY_URL = "https://api3.geo.admin.ch/rest/services/api/MapServer/identify"
LAYER = "ch.bfe.windenergie-geschwindigkeit_h125"
GRID_M = 250
MIN_HOME_DISTANCE_M = 400
MIN_MEAN_WIND_MS = 4.5
TURBINE_SPACING_M = 450
SITE_RADIUS_M = 1_200
MAX_SITES = 3
MAX_TURBINES_PER_SITE = 4
WATER_ARTS = ("fliessendes Gewässer", "stehendes Gewässer")


def _wind_at(x: float, y: float) -> dict | None:
    def fetch():
        params = {
            "layers": f"all:{LAYER}",
            "geometryType": "esriGeometryPoint",
            "geometry": f"{x:.0f},{y:.0f}",
            "sr": 2056,
            "tolerance": 30,
            "mapExtent": f"{x - 1000:.0f},{y - 1000:.0f},{x + 1000:.0f},{y + 1000:.0f}",
            "imageDisplay": "1000,1000,96",
            "returnGeometry": "false",
        }
        for attempt in range(3):
            try:
                response = requests.get(IDENTIFY_URL, params=params, timeout=60)
                response.raise_for_status()
                results = response.json().get("results", [])
                if not results:
                    return None
                p = results[0].get("properties") or results[0].get("attributes") or {}
                return {"v_mean": p.get("v_mean"), "a": p.get("wei_a"), "k": p.get("wei_k")}
            except requests.RequestException:
                if attempt == 2:
                    raise
        return None

    return cached_json("wind-h125", f"{x:.0f},{y:.0f}", fetch)


def fetch_sites(bfs_number: int, boundary, homes: list[tuple[float, float]]) -> list[dict]:
    """Up to MAX_SITES wind sites: {id, name, lon, lat, turbines: [{lon, lat, v_mean, a, k}]}.
    `homes`: every building with a home in it, LV95."""
    town = unary_union(boundary)
    min_e, min_n, max_e, max_n = town.bounds
    zones = farm._building_zones(bfs_number)
    zones_union = unary_union(zones) if zones else None
    water = farm._tiled(farm.AV_WFS, "ms:bodenbedeckung_f", town.bounds, lambda p: p.get("art") in WATER_ARTS)
    water_union = unary_union([shape(f["geometry"]).buffer(0) for f in water]) if water else None

    # Homes in cells, for a quick nearest-home test.
    cell = MIN_HOME_DISTANCE_M
    grid: dict[tuple[int, int], list[tuple[float, float]]] = {}
    for hx, hy in homes:
        grid.setdefault((int(hx // cell), int(hy // cell)), []).append((hx, hy))

    def far_from_homes(x: float, y: float) -> bool:
        cx, cy = int(x // cell), int(y // cell)
        for i in (cx - 1, cx, cx + 1):
            for j in (cy - 1, cy, cy + 1):
                for hx, hy in grid.get((i, j), ()):
                    if math.hypot(hx - x, hy - y) < MIN_HOME_DISTANCE_M:
                        return False
        return True

    points = []
    x = min_e + GRID_M / 2
    while x < max_e:
        y = min_n + GRID_M / 2
        while y < max_n:
            p = Point(x, y)
            if town.contains(p) and far_from_homes(x, y) and not (zones_union and zones_union.contains(p)) and not (water_union and water_union.contains(p)):
                points.append((x, y))
            y += GRID_M
        x += GRID_M
    print(f"  {len(points)} spots far enough from homes, outside the building zones")

    windy = []
    for x, y in points:
        w = _wind_at(x, y)
        if w and w["v_mean"] and w["v_mean"] >= MIN_MEAN_WIND_MS:
            windy.append({"x": x, "y": y, **w})
    windy.sort(key=lambda p: -p["v_mean"])

    # Turbines: the windiest spots, a spacing apart; sites: turbines near each other.
    turbines: list[dict] = []
    for p in windy:
        if all(math.hypot(p["x"] - t["x"], p["y"] - t["y"]) >= TURBINE_SPACING_M for t in turbines):
            turbines.append(p)
    sites: list[list[dict]] = []
    for t in turbines:
        home = next((s for s in sites if math.hypot(s[0]["x"] - t["x"], s[0]["y"] - t["y"]) <= SITE_RADIUS_M and len(s) < MAX_TURBINES_PER_SITE), None)
        if home is not None:
            home.append(t)
        elif len(sites) < MAX_SITES:
            sites.append([t])

    names = [(shape(f["geometry"]).buffer(0), f["properties"].get("name")) for f in farm._tiled(farm.AV_WFS, "ms:nomenklatur_f", town.bounds, lambda p: p.get("kategorie") == "Flurname")]
    out = []
    for i, site in enumerate(sites):
        cx = sum(t["x"] for t in site) / len(site)
        cy = sum(t["y"] for t in site) / len(site)
        name = next((n for g, n in names if n and g.contains(Point(cx, cy))), None)
        lon, lat = coords.lv95_to_lonlat(cx, cy)
        out.append(
            {
                "id": f"wind-{i + 1}",
                "name": name,
                "lon": round(lon, 6),
                "lat": round(lat, 6),
                "turbines": [
                    {
                        **dict(zip(("lon", "lat"), (round(v, 6) for v in coords.lv95_to_lonlat(t["x"], t["y"])))),
                        "v_mean": round(t["v_mean"], 2),
                        "a": round(t["a"], 2),
                        "k": round(t["k"], 2),
                    }
                    for t in site
                ],
            }
        )
    return out

