"""Fetch building footprint polygons from canton Zürich's official cadastral survey
(Amtliche Vermessung) WFS, which publishes survey-grade building outlines already
linked to GWR by EGID (`gwr_egid`) — a direct attribute join, no spatial matching
needed. (An earlier version used swisstopo's VECTOR25 buildings layer via a
bbox-tiled identify API; VECTOR25 is a 1:25'000-generalized cartographic dataset
that merges closely-spaced structures like row houses into single blobs and isn't
survey-precise, which showed up as visibly wrong building shapes/positions.)

Still canton-Zürich-only, unlike gwr.py (now national — see that module). Every
canton runs its own Amtliche Vermessung under the same federal specification, so
the *concept* generalizes, but not the access mechanism — each canton publishes
through its own geoportal with its own WFS endpoint and layer name; there's no
single federal service that aggregates them at survey precision with a bbox query.
Two national alternatives were investigated (2026-09) and found impractical for
now, not just theoretically worse:
  - swissBUILDINGS3D 3.0 Beta (swisstopo, federal): survey-grade, EGID-linked in
    19 cantons + the city of Zürich so far (still expanding — it's Beta) — but
    only distributed as whole-Switzerland DWG or File Geodatabase (.gdb) bulk
    archives, no bbox-queryable API. Reading a .gdb needs GDAL (via fiona/
    geopandas), which the original project plan already flagged as troublesome
    to install on Windows and deliberately avoided; that trade-off hasn't changed.
  - swissTLM3D (swisstopo, federal, the successor to VECTOR25, higher detail):
    ships a plain Shapefile a GDAL-free `pyshp`-style reader could handle — but
    only as one ~3.6GB whole-Switzerland archive, no per-region download and no
    bbox-queryable API found either. Downloading 3.6GB to serve one municipality
    isn't practical as a per-pipeline-run step.
A real national fix likely means either a per-canton WFS lookup table (26 entries,
formats potentially differing canton to canton — real effort, not a data problem)
or accepting the swissBUILDINGS3D/GDAL dependency once its EGID coverage is
closer to complete. Building a municipality outside canton Zürich currently
fails fast in build_dataset.py with a clear error rather than silently guessing.
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
