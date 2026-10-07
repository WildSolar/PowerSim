"""Farmland plots: where Agri-PV could go. Canton Zurich's cadastral survey and open data:

- Land cover (ms:bodenbedeckung_f): fields, meadows and pastures ("Acker, Wiese, Weide").
- Building zones (ARE's harmonised layer, every type): farmland inside them is building land, not
  farmland — left out.
- Parcels (ms:liegenschaften_f): the farmland is cut along them, so a plot is one owner's field.
- Field names (ms:nomenklatur_f, "Flurname"): what a plot is called locally.
- Prime farmland (OGD Fruchtfolgeflächen): the share of each plot that is protected cropland.

Only plots of at least MIN_PLOT_HA are kept — smaller ones aren't worth an Agri-PV installation.
"""

from __future__ import annotations

import json

import requests
from shapely.geometry import shape
from shapely.ops import unary_union

from .. import coords
from ..cache import cached_json

AV_WFS = "https://maps.zh.ch/wfs/AVZHWFS"
OGD_WFS = "https://maps.zh.ch/wfs/OGDZHWFS"
ZONES_URL = "https://api3.geo.admin.ch/rest/services/api/MapServer/find"
FARMLAND_ART = "Acker, Wiese, Weide"
MIN_PLOT_HA = 1.0
SIMPLIFY_M = 2.0
TILE_M = 1_500


def _tiled(url: str, layer: str, bounds: tuple[float, float, float, float], keep) -> list[dict]:
    """Every feature of a WFS layer over `bounds`, tile by tile (cached), filtered by `keep`."""
    min_e, min_n, max_e, max_n = bounds
    features: dict[str, dict] = {}
    e = min_e
    while e < max_e:
        n = min_n
        while n < max_n:
            params = {
                "Service": "WFS",
                "Request": "GetFeature",
                "Version": "2.0.0",
                "TypeNames": layer,
                "bbox": f"{e},{n},{min(e + TILE_M, max_e)},{min(n + TILE_M, max_n)},EPSG:2056",
                "outputFormat": "application/json",
            }

            def fetch(params=params):
                for attempt in range(3):
                    try:
                        response = requests.get(url, params=params, timeout=120)
                        response.raise_for_status()
                        return [f for f in response.json()["features"] if keep(f["properties"])]
                    except requests.RequestException:
                        if attempt == 2:
                            raise
                return []

            for f in cached_json("wfs-" + layer.replace(":", "-"), json.dumps(params, sort_keys=True), fetch):
                key = str(f["properties"].get("geodb_oid") or f["properties"].get("objid") or len(features))
                features[key] = f
            n += TILE_M
        e += TILE_M
    return list(features.values())


def _building_zones(bfs_number: int):
    def fetch():
        response = requests.get(
            ZONES_URL,
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
        return [r["geometry"] for r in response.json()["results"]]

    return [shape(g).buffer(0) for g in cached_json("building-zones", str(bfs_number), fetch)]


def fetch_plots(bfs_number: int, boundary) -> list[dict]:
    """The farmland plots: {id, name, area_m2, prime_share, rings (polygons -> rings -> [lon, lat])}."""
    town = unary_union(boundary)
    bounds = town.bounds
    farmland = [shape(f["geometry"]).buffer(0) for f in _tiled(AV_WFS, "ms:bodenbedeckung_f", bounds, lambda p: p.get("art") == FARMLAND_ART)]
    if not farmland:
        return []
    zones = _building_zones(bfs_number)
    open_land = unary_union(farmland).intersection(town)
    if zones:
        open_land = open_land.difference(unary_union(zones))
    parcels = _tiled(AV_WFS, "ms:liegenschaften_f", bounds, lambda p: True)
    prime_features = _tiled(OGD_WFS, "ms:ogd-0002_giszhpub_fff_f", bounds, lambda p: p.get("fff_cod") == 1)
    prime = unary_union([shape(f["geometry"]).buffer(0) for f in prime_features]) if prime_features else None
    names = [(shape(f["geometry"]).buffer(0), f["properties"].get("name")) for f in _tiled(AV_WFS, "ms:nomenklatur_f", bounds, lambda p: p.get("kategorie") == "Flurname")]

    plots = []
    seen: set[str] = set()
    for f in parcels:
        props = f["properties"]
        plot_id = str(props.get("egris_egrid") or props.get("objid"))
        if plot_id in seen:
            continue
        seen.add(plot_id)
        geometry = shape(f["geometry"]).buffer(0)
        if not geometry.intersects(open_land):
            continue
        piece = geometry.intersection(open_land)
        if piece.is_empty or piece.area < MIN_PLOT_HA * 10_000:
            continue
        # A parcel cut in two by a road: keep its biggest piece.
        if piece.geom_type != "Polygon":
            parts = [p for p in getattr(piece, "geoms", []) if p.geom_type == "Polygon"]
            if not parts:
                continue
            piece = max(parts, key=lambda p: p.area)
            if piece.area < MIN_PLOT_HA * 10_000:
                continue
        simplified = piece.simplify(SIMPLIFY_M, preserve_topology=True)
        centre = piece.representative_point()
        name = next((n for g, n in names if n and g.contains(centre)), None)
        prime_share = (piece.intersection(prime).area / piece.area) if prime is not None else 0.0
        rings = [simplified.exterior, *simplified.interiors]
        plots.append(
            {
                "id": plot_id,
                "number": props.get("nummer"),
                "name": name,
                "area_m2": round(piece.area),
                "prime_share": round(prime_share, 2),
                "rings": [[[round(v, 6) for v in coords.lv95_to_lonlat(x, y)] for x, y in ring.coords] for ring in rings],
            }
        )
    plots.sort(key=lambda p: p["id"])
    return plots

