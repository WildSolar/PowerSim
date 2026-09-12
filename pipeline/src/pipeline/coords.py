"""Coordinate transforms between the Swiss LV95 grid (EPSG:2056) and WGS84."""

from pyproj import Transformer

_LV95_TO_WGS84 = Transformer.from_crs("EPSG:2056", "EPSG:4326", always_xy=True)


def lv95_to_lonlat(easting: float, northing: float) -> tuple[float, float]:
    """Convert a single LV95 (E, N) point to (lon, lat)."""
    lon, lat = _LV95_TO_WGS84.transform(easting, northing)
    return lon, lat


def lv95_ring_to_lonlat(ring: list[tuple[float, float]]) -> list[tuple[float, float]]:
    """Convert a list of LV95 (E, N) polygon-ring vertices to (lon, lat)."""
    return [lv95_to_lonlat(e, n) for e, n in ring]
