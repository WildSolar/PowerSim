"""Where heat may be taken from the ground: canton Zurich's Wärmenutzungsatlas (AWEL), open
data (CC0) over the canton's WFS. Every location falls in a zone that says which systems are
allowed — the game uses it to decide whether a building can have a ground-source heat pump, and
whether that means boreholes or groundwater wells:

  A  groundwater protection zones around drinking-water wells (no ground heat use at all)
  B  gravel aquifer suitable for drinking water (no boreholes; groundwater heat only for large
     systems, by concession)
  C  productive gravel aquifer unsuitable for drinking water (boreholes with conditions)
  D  low-productivity gravel aquifer (boreholes allowed)
  E  spring-water areas (boreholes with conditions)
  F  outside usable groundwater (boreholes allowed)

plus areas with special conditions for boreholes (depth limits, casing) and the tunnels and
galleries boreholes must keep clear of. Zones B-F come with a "zonen" attribute in the OGD layer
(a "_Sperr" variant bans boreholes outright); zone A has its own layer. Canton Zurich only: for a
municipality elsewhere this returns None and the game applies no restriction."""

from __future__ import annotations

import requests
from shapely import make_valid
from shapely.geometry import shape
from shapely.ops import unary_union

from .. import coords

OGD_WFS = "https://maps.zh.ch/wfs/OGDZHWFS"
ATLAS_WFS = "https://maps.zh.ch/wfs/AwelGSWaermewwwZHWFS"
ZONES_LAYER = "ms:ogd-0316_giszhpub_gs_waermenutzungsatlas_f"
SIMPLIFY_M = 2.0
MARGIN_M = 100.0


def _get_features(url: str, layer: str, bbox: tuple[float, float, float, float]) -> list[dict]:
    response = requests.get(
        url,
        params={
            "SERVICE": "WFS",
            "VERSION": "2.0.0",
            "REQUEST": "GetFeature",
            "TYPENAMES": layer,
            "BBOX": f"{bbox[0]},{bbox[1]},{bbox[2]},{bbox[3]},urn:ogc:def:crs:EPSG::2056",
            "OUTPUTFORMAT": "geojson",
        },
        timeout=120,
    )
    response.raise_for_status()
    return response.json().get("features", [])


def _rings(geometry) -> list[list[list[list[float]]]]:
    """Polygons -> rings (outer first) -> [lon, lat]."""
    polygons = [geometry] if geometry.geom_type == "Polygon" else [g for g in getattr(geometry, "geoms", []) if g.geom_type == "Polygon"]
    out = []
    for polygon in polygons:
        if polygon.is_empty:
            continue
        rings = [polygon.exterior, *polygon.interiors]
        out.append([[[round(v, 7) for v in coords.lv95_to_lonlat(x, y)] for x, y in ring.coords] for ring in rings])
    return out


def fetch_heat_use(boundary_lv95: list) -> dict | None:
    """{zones: [{zone, noBoreholes, rings}], conditions: [{rings}], tunnels: [[[lon, lat], ...]]}
    for the municipality (clipped to it, plus a margin), or None if the atlas can't be reached."""
    area = unary_union(boundary_lv95)
    clip = area.buffer(MARGIN_M)
    bbox = clip.bounds
    try:
        zone_features = _get_features(OGD_WFS, ZONES_LAYER, bbox)
        a_features = _get_features(ATLAS_WFS, "ms:waermenutzung-zone-a", bbox)
        condition_features = _get_features(ATLAS_WFS, "ms:erdwaermesonden-auflagen", bbox)
        tunnel_features = _get_features(ATLAS_WFS, "ms:tunnels-und-stollen", bbox)
    except (requests.RequestException, ValueError) as error:
        print(f"  heat-use atlas unavailable: {error}")
        return None

    by_zone: dict[str, list] = {}
    for f in zone_features:
        code = str((f.get("properties") or {}).get("zonen") or "").strip()
        if code:
            by_zone.setdefault(code, []).append(make_valid(shape(f["geometry"])))
    if a_features:
        by_zone["A"] = [make_valid(shape(f["geometry"])) for f in a_features]

    zones = []
    for code, geometries in sorted(by_zone.items()):
        geometry = unary_union(geometries).intersection(clip).simplify(SIMPLIFY_M, preserve_topology=True)
        rings = _rings(geometry)
        if rings:
            letter = code[0].upper()
            zones.append({"zone": letter, "no_boreholes": "sperr" in code.lower(), "rings": rings})

    conditions = []
    if condition_features:
        geometry = unary_union([make_valid(shape(f["geometry"])) for f in condition_features]).intersection(clip).simplify(SIMPLIFY_M, preserve_topology=True)
        conditions = [{"rings": rings} for rings in [_rings(geometry)] if rings]

    tunnels = []
    for f in tunnel_features:
        geometry = shape(f["geometry"]).intersection(clip)
        lines = [geometry] if geometry.geom_type == "LineString" else [g for g in getattr(geometry, "geoms", []) if g.geom_type == "LineString"]
        for line in lines:
            simplified = line.simplify(SIMPLIFY_M)
            tunnels.append([[round(v, 7) for v in coords.lv95_to_lonlat(x, y)] for x, y in simplified.coords])

    return {"zones": zones, "conditions": conditions, "tunnels": tunnels}
