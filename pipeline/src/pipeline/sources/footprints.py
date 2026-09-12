"""Fetch building footprint polygons from canton Zürich's official cadastral survey
(Amtliche Vermessung) WFS, which publishes survey-grade building outlines already
linked to GWR by EGID (`gwr_egid`) — a direct attribute join, no spatial matching
needed. (An earlier version used swisstopo's VECTOR25 buildings layer via a
bbox-tiled identify API; VECTOR25 is a 1:25'000-generalized cartographic dataset
that merges closely-spaced structures like row houses into single blobs and isn't
survey-precise, which showed up as visibly wrong building shapes/positions.)
"""

from __future__ import annotations

from collections import defaultdict

import requests
from shapely.geometry import shape
from shapely.ops import unary_union

WFS_URL = "https://maps.zh.ch/wfs/AVZHWFS"
LAYER = "ms:bodenbedeckung_f"
BUILDING_ART = "Gebäude"


def fetch_building_footprints(
    min_e: float, min_n: float, max_e: float, max_n: float
) -> dict[int, list[tuple[float, float]]]:
    """Building footprint rings (LV95 coordinates) keyed by GWR EGID, for buildings
    whose cadastral polygon falls within the given bbox."""
    params = {
        "Service": "WFS",
        "Request": "GetFeature",
        "Version": "2.0.0",
        "TypeNames": LAYER,
        "bbox": f"{min_e},{min_n},{max_e},{max_n},EPSG:2056",
        "outputFormat": "application/json",
    }
    response = requests.get(WFS_URL, params=params, timeout=60)
    response.raise_for_status()
    features = response.json()["features"]

    parts_by_egid: dict[int, list] = defaultdict(list)
    for feature in features:
        props = feature["properties"]
        if props.get("art") != BUILDING_ART:
            continue
        egid_raw = props.get("gwr_egid")
        if not egid_raw:
            continue
        parts_by_egid[int(egid_raw)].append(shape(feature["geometry"]))

    footprints: dict[int, list[tuple[float, float]]] = {}
    for egid, parts in parts_by_egid.items():
        geometry = unary_union(parts) if len(parts) > 1 else parts[0]
        if geometry.geom_type == "MultiPolygon":
            geometry = max(geometry.geoms, key=lambda g: g.area)
        if geometry.is_empty or geometry.geom_type != "Polygon":
            continue
        footprints[egid] = list(geometry.exterior.coords)

    return footprints
