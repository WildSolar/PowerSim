"""Where the town's jobs are: BFS STATENT, full-time equivalents per hectare, from the federal map
service (layer ch.bfs.betriebszaehlungen-beschaeftigte_vollzeitaequivalente, its latest survey
year). Each hectare inside the municipality hands its jobs to the buildings standing in it, by floor
area — weighted towards buildings without homes, so an office block takes more than the flats next
door — and a hectare with jobs but no building of the town in it gives them to the nearest building
within 150 m. BFS shows a hectare with fewer than four jobs as four (privacy), so the smallest
figures are rounded up.

The game uses them for the cars charging at the town's workplaces (sim/workCharging.ts)."""

from __future__ import annotations

import math

from shapely.geometry import Point
from shapely.ops import unary_union

from .. import http
from ..cache import cached_json

IDENTIFY_URL = "https://api3.geo.admin.ch/rest/services/api/MapServer/identify"
LAYER = "ch.bfs.betriebszaehlungen-beschaeftigte_vollzeitaequivalente"
YEAR = 2022
TILE_M = 1000  # at most ~121 hectares a tile (edges included), under the API's limit of 200
NEAREST_M = 150.0

# How strongly a building draws its hectare's jobs, per m² of floor, by GWR category: buildings
# without homes most; homes only a little (a practice or an office in a flat).
CATEGORY_WEIGHT = {
    "Gebäude ohne Wohnnutzung": 1.0,
    "Sonderbau": 1.0,
    "Gebäude mit teilweiser Wohnnutzung": 0.5,
    "Andere Wohngebäude (Wohngebäude mit Nebennutzung)": 0.25,
    "Gebäude mit ausschliesslicher Wohnnutzung": 0.03,
}
OTHER_WEIGHT = 0.5


def _tile(e0: int, n0: int) -> list[dict]:
    def fetch() -> list[dict]:
        response = http.get(
            IDENTIFY_URL,
            params={
                "geometryType": "esriGeometryEnvelope",
                "geometry": f"{e0},{n0},{e0 + TILE_M},{n0 + TILE_M}",
                "layers": f"all:{LAYER}",
                "mapExtent": f"{e0},{n0},{e0 + TILE_M},{n0 + TILE_M}",
                "imageDisplay": "500,500,96",
                "tolerance": 0,
                "returnGeometry": "true",
                "geometryFormat": "geojson",
                "sr": 2056,
                "limit": 200,
                "timeInstant": YEAR,
            },
            timeout=90,
        )
        response.raise_for_status()
        out = []
        for f in response.json().get("results", []):
            ring = (f.get("geometry") or {}).get("coordinates", [[]])[0]
            props = f.get("properties") or f.get("attributes") or {}
            if not ring or props.get("number") is None:
                continue
            out.append({"e": min(p[0] for p in ring), "n": min(p[1] for p in ring), "fte": float(props["number"])})
        return out

    return cached_json("statent-jobs", f"{YEAR}:{e0},{n0}", fetch)


def _cells(boundary_lv95: list) -> dict[tuple[int, int], float]:
    """Full-time equivalents by hectare (south-west corner), for the hectares whose centre lies in
    the municipality."""
    area = unary_union(boundary_lv95)
    min_e, min_n, max_e, max_n = area.bounds
    cells: dict[tuple[int, int], float] = {}
    for e0 in range(int(math.floor(min_e / TILE_M) * TILE_M), int(max_e) + 1, TILE_M):
        for n0 in range(int(math.floor(min_n / TILE_M) * TILE_M), int(max_n) + 1, TILE_M):
            for c in _tile(e0, n0):
                key = (int(c["e"]), int(c["n"]))
                if key in cells or not area.contains(Point(key[0] + 50, key[1] + 50)):
                    continue
                cells[key] = c["fte"]
    return cells


def jobs_by_egid(boundary_lv95: list, buildings: list[dict]) -> dict[str, float]:
    """Each building's share of the town's jobs (full-time equivalents). `buildings`: dicts with egid,
    x, y (LV95), floor_m2 and category."""
    cells = _cells(boundary_lv95)
    by_cell: dict[tuple[int, int], list[dict]] = {}
    for b in buildings:
        by_cell.setdefault((int(b["x"] // 100 * 100), int(b["y"] // 100 * 100)), []).append(b)

    def weight(b: dict) -> float:
        return max(1.0, b["floor_m2"] or 0.0) * CATEGORY_WEIGHT.get(b["category"] or "", OTHER_WEIGHT)

    jobs: dict[str, float] = {}
    for (e, n), fte in cells.items():
        here = by_cell.get((e, n))
        if not here:
            centre = (e + 50, n + 50)
            nearest = min(buildings, key=lambda b: (b["x"] - centre[0]) ** 2 + (b["y"] - centre[1]) ** 2, default=None)
            if nearest is None or math.dist((nearest["x"], nearest["y"]), centre) > NEAREST_M:
                continue
            here = [nearest]
        total = sum(weight(b) for b in here)
        for b in here:
            jobs[b["egid"]] = jobs.get(b["egid"], 0.0) + fte * weight(b) / total
    return {egid: round(v, 1) for egid, v in jobs.items() if v >= 0.05}
