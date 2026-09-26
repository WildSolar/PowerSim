"""Public charging sites for electric cars, from the federal register the "ich-tanke-strom.ch"
map is built on (BFE, published on data.geo.admin.ch in the charging industry's OICP format).

The register lists charge points; points at the same spot (within SITE_MERGE_M) are grouped
into one site, with the number of points and the highest power offered. A site is "dc" (fast
charging) if it offers at least DC_MIN_KW, else "ac". Points marked "Restricted access"
(company car parks, hotel guests) are left out: the public can't rely on them — and so are
entries whose name says the charger is broken or gone.
"""

from __future__ import annotations

import requests
from shapely.geometry import Point, Polygon

from .. import coords

REGISTER_URL = "https://data.geo.admin.ch/ch.bfe.ladestellen-elektromobilitaet/data/oicp/ch.bfe.ladestellen-elektromobilitaet.json"
SITE_MERGE_M = 25.0
# Register entries whose name says the charger is gone or broken.
OUT_OF_SERVICE_WORDS = ("defekt", "demontiert", "ausser betrieb", "außer betrieb")
DC_MIN_KW = 50.0


def fetch_sites(boundary_lv95: list[Polygon]) -> list[dict]:
    data = requests.get(REGISTER_URL, timeout=180).json()
    points = []
    for operator in data.get("EVSEData", []):
        for record in operator.get("EVSEDataRecord", []):
            if record.get("Accessibility") == "Restricted access":
                continue
            try:
                lat, lon = (float(v) for v in record["GeoCoordinates"]["Google"].split())
            except (KeyError, ValueError):
                continue
            x, y = coords.lonlat_to_lv95(lon, lat)
            if not any(poly.contains(Point(x, y)) for poly in boundary_lv95):
                continue
            power = max((float(f.get("power") or 0) for f in record.get("ChargingFacilities") or []), default=0.0)
            names = record.get("ChargingStationNames") or []
            name = next((n["value"] for n in names if n.get("lang") == "de"), names[0]["value"] if names else None)
            if name and any(word in name.lower() for word in OUT_OF_SERVICE_WORDS):
                continue
            address = record.get("Address") or {}
            points.append({"x": x, "y": y, "power_kw": power, "name": name or address.get("Street") or "Charging station"})

    sites: list[dict] = []
    for p in points:
        site = next((s for s in sites if (s["x"] - p["x"]) ** 2 + (s["y"] - p["y"]) ** 2 <= SITE_MERGE_M**2), None)
        if site is None:
            site = {"x": p["x"], "y": p["y"], "name": p["name"], "points": 0, "power_kw": 0.0}
            sites.append(site)
        site["points"] += 1
        site["power_kw"] = max(site["power_kw"], p["power_kw"])

    result = []
    for i, s in enumerate(sites):
        lon, lat = coords.lv95_to_lonlat(s["x"], s["y"])
        result.append(
            {
                "id": f"real-{i}",
                "name": s["name"],
                "lon": round(lon, 6),
                "lat": round(lat, 6),
                "points": s["points"],
                "power_kw": s["power_kw"] or 11.0,
                "kind": "dc" if s["power_kw"] >= DC_MIN_KW else "ac",
            }
        )
    return result
