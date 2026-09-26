"""The municipality's street network, as segments between junctions — the unit district
heating pipes are laid in (and, later, other street-bound infrastructure). From
OpenStreetMap via the Overpass API: OSM carries the junction topology (ways share node
ids where streets meet) and a road class, which the official street directory doesn't.

Each OSM way is split wherever it meets another street, and pieces meeting end to end
at a plain bend (no third street) are joined back up when they carry the same name and
class, so a segment is "this street from one junction to the next". Only segments whose
midpoint lies inside the municipality are kept. Driveways, parking aisles, footpaths,
tracks and motorways are left out: pipes run under streets that buildings front on.

Buildings are linked to the segment(s) in front of them through GWR's entrance records:
for each entrance, the nearest segment carrying the entrance's own street name (so a
building is tied to the street it is addressed from, not to whatever road happens to
pass closest behind it), falling back to the nearest segment of any name.

OpenStreetMap data (c) OpenStreetMap contributors, ODbL.
"""

from __future__ import annotations

import unicodedata
from collections import defaultdict
from dataclasses import dataclass, field

from shapely.geometry import LineString, Point, Polygon
from shapely.strtree import STRtree

from .. import coords
from .exclusions import _post

HIGHWAY_CLASSES = (
    "trunk|trunk_link|primary|primary_link|secondary|secondary_link|tertiary|tertiary_link|"
    "unclassified|residential|living_street|pedestrian|service"
)
EXCLUDED_SERVICE = {"driveway", "parking_aisle", "drive-through", "emergency_access"}

NAMED_MATCH_RADIUS_M = 150  # an entrance's own street, if a segment of it is this close
ANY_MATCH_RADIUS_M = 60  # otherwise the nearest street of any name, if this close


@dataclass
class Segment:
    id: int
    name: str | None
    highway: str
    a: int  # end node ids (compact, 0-based)
    b: int
    lv95: list[tuple[float, float]]
    length_m: float = 0.0
    osm_nodes: list[int] = field(default_factory=list)


def _query(south: float, west: float, north: float, east: float) -> str:
    return f"""[out:json][timeout:120];
way["highway"~"^({HIGHWAY_CLASSES})$"]({south},{west},{north},{east});
out geom;"""


def _normalize(name: str | None) -> str:
    if not name:
        return ""
    return unicodedata.normalize("NFC", name).casefold().replace("str.", "strasse").strip()


def fetch_segments(boundary_lv95: list[Polygon], min_lon: float, min_lat: float, max_lon: float, max_lat: float) -> list[Segment]:
    ways = []
    for element in _post(_query(min_lat, min_lon, max_lat, max_lon)):
        if element["type"] != "way" or len(element.get("nodes", [])) < 2:
            continue
        tags = element.get("tags", {})
        if tags.get("highway") == "service" and tags.get("service") in EXCLUDED_SERVICE:
            continue
        if tags.get("area") == "yes":
            continue
        points = [coords.lonlat_to_lv95(p["lon"], p["lat"]) for p in element["geometry"]]
        ways.append((element["nodes"], points, tags.get("name"), tags["highway"]))

    # How many way-ends / way-passes meet at each node: 3 or more is a junction.
    degree: dict[int, int] = defaultdict(int)
    for nodes, _, _, _ in ways:
        for i, n in enumerate(nodes):
            degree[n] += 1 if i in (0, len(nodes) - 1) else 2

    pieces: list[tuple[list[int], list[tuple[float, float]], str | None, str]] = []
    for nodes, points, name, highway in ways:
        start = 0
        for i in range(1, len(nodes)):
            if i == len(nodes) - 1 or degree[nodes[i]] >= 3:
                pieces.append((nodes[start : i + 1], points[start : i + 1], name, highway))
                start = i

    pieces = _join_plain_bends(pieces)

    inside = [p.buffer(0) for p in boundary_lv95]
    node_ids: dict[int, int] = {}

    def compact(osm_node: int) -> int:
        if osm_node not in node_ids:
            node_ids[osm_node] = len(node_ids)
        return node_ids[osm_node]

    segments: list[Segment] = []
    for nodes, points, name, highway in pieces:
        line = LineString(points)
        if line.length < 1:
            continue
        mid = line.interpolate(0.5, normalized=True)
        if not any(poly.contains(mid) for poly in inside):
            continue
        segments.append(
            Segment(
                id=len(segments),
                name=name,
                highway=highway,
                a=compact(nodes[0]),
                b=compact(nodes[-1]),
                lv95=points,
                length_m=line.length,
                osm_nodes=nodes,
            )
        )
    return segments


def _join_plain_bends(pieces):
    """Joins pieces meeting end to end at a node no third piece touches, when both carry
    the same name and class — e.g. one street drawn as several OSM ways."""
    pieces = [list(p) for p in pieces]
    alive = [True] * len(pieces)
    changed = True
    while changed:
        changed = False
        ends: dict[int, list[int]] = defaultdict(list)
        for i, p in enumerate(pieces):
            if alive[i]:
                ends[p[0][0]].append(i)
                ends[p[0][-1]].append(i)
        for node, incident in ends.items():
            if len(incident) != 2 or incident[0] == incident[1]:
                continue
            i, j = incident
            if not (alive[i] and alive[j]):
                continue
            pi, pj = pieces[i], pieces[j]
            if pi[2] != pj[2] or pi[3] != pj[3]:
                continue
            # Orient so pi ends at `node` and pj starts there.
            if pi[0][-1] != node:
                pi[0].reverse(), pi[1].reverse()
            if pj[0][0] != node:
                pj[0].reverse(), pj[1].reverse()
            if pi[0][0] == pj[0][-1]:
                continue  # a closed loop — leave it as two pieces
            pieces[i] = [pi[0] + pj[0][1:], pi[1] + pj[1][1:], pi[2], pi[3]]
            alive[j] = False
            changed = True
            break
    return [tuple(p) for p, a in zip(pieces, alive) if a]


def link_buildings(
    segments: list[Segment],
    entrances_by_egid: dict[int, list[tuple[str, float, float]]],
    position_by_egid: dict[int, tuple[float, float]],
) -> dict[int, list[int]]:
    """The segment ids each building fronts on (see module doc)."""
    lines = [LineString(s.lv95) for s in segments]
    tree = STRtree(lines)
    by_name: dict[str, list[int]] = defaultdict(list)
    for s in segments:
        by_name[_normalize(s.name)].append(s.id)

    def nearest_any(x: float, y: float) -> int | None:
        idx = tree.nearest(Point(x, y))
        if idx is None:
            return None
        return int(idx) if lines[int(idx)].distance(Point(x, y)) <= ANY_MATCH_RADIUS_M else None

    def nearest_named(name: str, x: float, y: float) -> int | None:
        candidates = by_name.get(_normalize(name), [])
        best, best_d = None, NAMED_MATCH_RADIUS_M
        for sid in candidates:
            d = lines[sid].distance(Point(x, y))
            if d <= best_d:
                best, best_d = sid, d
        return best

    links: dict[int, list[int]] = {}
    for egid, (x, y) in position_by_egid.items():
        found: list[int] = []
        for street, ex, ey in entrances_by_egid.get(egid, []):
            sid = nearest_named(street, ex, ey)
            if sid is None:
                sid = nearest_any(ex, ey)
            if sid is not None and sid not in found:
                found.append(sid)
        if not found:
            sid = nearest_any(x, y)
            if sid is not None:
                found.append(sid)
        links[egid] = found
    return links
