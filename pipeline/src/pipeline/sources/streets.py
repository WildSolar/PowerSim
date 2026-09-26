"""The municipality's street network, as segments between junctions — the unit district
heating pipes are laid in (and, later, other street-bound infrastructure). From swisstopo's
swissTLM3D road network (via the geo.admin.ch identify API, queried tile by tile): the same
data the swisstopo basemap is drawn from, so segments sit exactly on the painted streets,
and it carries each road's class, which gives its width (a "6m Strasse" is 6 m wide).

TLM roads already meet at shared end points at every junction. What needs work is wide
streets drawn as two parallel carriageways (Badenerstrasse, Zürcherstrasse, ...): for the
network they are one street, so wherever two stretches of the same street run side by side
a few metres apart, both are pulled onto the line midway between them, the duplicate is
dropped, and side streets that met either carriageway are reattached to that centre line.
The merged street's width spans both carriageways.

Pieces meeting end to end at a plain bend (no third street) are then joined back up when
they carry the same name (even where the class changes), so a segment is "this street from
one junction to the next". Only segments whose midpoint lies inside the municipality are kept. Motorways, service
access roads, ferries and unnamed footpaths are left out; named paths stay (buildings are
addressed from them).

Buildings are linked to the segment(s) in front of them through GWR's entrance records:
for each entrance, the nearest segment carrying the entrance's own street name (so a
building is tied to the street it is addressed from, not to whatever road happens to
pass closest behind it), falling back to the nearest segment of any name.
"""

from __future__ import annotations

import math
import unicodedata
from collections import defaultdict
from dataclasses import dataclass, field

import requests
from shapely.geometry import LineString, Point, Polygon
from shapely.ops import substring, unary_union
from shapely.strtree import STRtree

IDENTIFY_URL = "https://api3.geo.admin.ch/rest/services/api/MapServer/identify"
TLM_LAYER = "ch.swisstopo.swisstlm3d-strassen"
TILE_M = 400
MAX_RESULTS = 200  # the identify API's own cap: a tile hitting it is split and asked again

# TLM "objektart" code -> carriageway width (m). Codes missing here are left out.
ROAD_WIDTH_M = {
    8: 10.0,  # 10m Strasse
    20: 8.0,  # 8m Strasse
    9: 6.0,  # 6m Strasse
    10: 4.0,  # 4m Strasse
    11: 3.0,  # 3m Strasse
    12: 6.0,  # Platz
    4: 5.0,  # Verbindung (link roads at larger junctions)
}
# Paths: only kept when they carry a street name (buildings addressed from them).
NAMED_PATH_WIDTH_M = {15: 2.0, 16: 1.5}  # 2m Weg, 1m Weg
MAIN_ROAD_CODES = {8, 20}

# Two stretches of one street count as side-by-side carriageways when this far apart...
DUAL_MIN_GAP_M = 3.0
DUAL_MAX_GAP_M = 30.0
# ...running parallel (cosine of the angle between them)...
DUAL_PARALLEL_COS = 0.9
# ...for at least this share of a stretch's length.
DUAL_MIN_SHARE = 0.5
SAMPLE_STEP_M = 4.0
DEDUPE_BUFFER_M = 2.5
MIN_FRAGMENT_M = 6.0
REATTACH_MAX_M = 25.0
# An unnamed road this close alongside a named street of at least this width, for this share of its
# length, is part of it (side lanes and access strips run along the big streets, not the small ones).
ABSORB_MIN_STREET_WIDTH_M = 6.0
ABSORB_MAX_GAP_M = 20.0
ABSORB_MIN_SHARE = 0.7
# Stretches shorter than this between two junctions (the knots of a big crossing) are contracted
# into a single junction: too small to click, and nothing to lay a pipe along.
MIN_SEGMENT_M = 8.0

NAMED_MATCH_RADIUS_M = 150  # an entrance's own street, if a segment of it is this close
ANY_MATCH_RADIUS_M = 60  # otherwise the nearest street of any name, if this close


@dataclass
class Segment:
    id: int
    name: str | None
    highway: str  # "main" | "street" | "path": the road class the game prices by
    a: int  # end node ids (compact, 0-based)
    b: int
    lv95: list[tuple[float, float]]
    length_m: float = 0.0
    width_m: float = 0.0


@dataclass
class _Road:
    line: LineString
    name: str | None
    width_m: float
    code: int
    dual: bool = False
    original_ends: tuple[tuple[float, float], tuple[float, float]] | None = field(default=None)


def _identify(x0: float, y0: float, x1: float, y1: float, out: dict, depth: int = 0) -> None:
    extent = f"{x0},{y0},{x1},{y1}"
    params = {
        "geometryType": "esriGeometryEnvelope",
        "geometry": extent,
        "layers": f"all:{TLM_LAYER}",
        "tolerance": 0,
        "sr": 2056,
        "returnGeometry": "true",
        "geometryFormat": "geojson",
        "limit": MAX_RESULTS,
        "mapExtent": extent,
        "imageDisplay": "500,500,96",
    }
    results = requests.get(IDENTIFY_URL, params=params, timeout=90).json().get("results", [])
    if len(results) >= MAX_RESULTS and depth < 6:
        mx, my = (x0 + x1) / 2, (y0 + y1) / 2
        for quarter in ((x0, y0, mx, my), (mx, y0, x1, my), (x0, my, mx, y1), (mx, my, x1, y1)):
            _identify(*quarter, out, depth + 1)
        return
    for feature in results:
        out[feature["featureId"]] = feature


def _fetch_roads(min_e: float, min_n: float, max_e: float, max_n: float) -> list[_Road]:
    features: dict = {}
    e = math.floor(min_e / TILE_M) * TILE_M
    while e < max_e:
        n = math.floor(min_n / TILE_M) * TILE_M
        while n < max_n:
            _identify(e, n, e + TILE_M, n + TILE_M, features)
            n += TILE_M
        e += TILE_M

    roads = []
    for feature in features.values():
        props = feature["properties"]
        code = props.get("objektart")
        name = props.get("strassenname") or None
        width = ROAD_WIDTH_M.get(code) or (NAMED_PATH_WIDTH_M.get(code) if name else None)
        if width is None:
            continue
        geometry = feature["geometry"]
        parts = geometry["coordinates"] if geometry["type"] == "MultiLineString" else [geometry["coordinates"]]
        for part in parts:
            points = [(p[0], p[1]) for p in part]
            if len(points) >= 2:
                roads.append(_Road(LineString(points), name, width, code))
    return roads


def _tangent(line: LineString, distance: float) -> tuple[float, float]:
    p0 = line.interpolate(max(0.0, distance - 1.0))
    p1 = line.interpolate(min(line.length, distance + 1.0))
    dx, dy = p1.x - p0.x, p1.y - p0.y
    norm = math.hypot(dx, dy) or 1.0
    return dx / norm, dy / norm


def _collapse_dual_carriageways(roads: list[_Road]) -> list[_Road]:
    """Pulls side-by-side stretches of the same street onto their centre line and drops the
    duplicate — see module doc."""
    by_name: dict[str, list[int]] = defaultdict(list)
    for i, road in enumerate(roads):
        if road.name:
            by_name[road.name].append(i)

    collapsed: dict[int, tuple[LineString, float]] = {}
    for indices in by_name.values():
        if len(indices) < 2:
            continue
        for i in indices:
            road = roads[i]
            line = road.line
            steps = max(2, int(line.length / SAMPLE_STEP_M) + 1)
            points, paired, gaps = [], 0, []
            for k in range(steps):
                dist = line.length * k / (steps - 1)
                p = line.interpolate(dist)
                t = _tangent(line, dist)
                best = None
                for j in indices:
                    if j == i:
                        continue
                    other = roads[j].line
                    d = other.distance(p)
                    if not (DUAL_MIN_GAP_M <= d <= DUAL_MAX_GAP_M) or (best and d >= best[1]):
                        continue
                    q = other.interpolate(other.project(p))
                    tq = _tangent(other, other.project(p))
                    if abs(t[0] * tq[0] + t[1] * tq[1]) < DUAL_PARALLEL_COS:
                        continue
                    ux, uy = (q.x - p.x) / d, (q.y - p.y) / d
                    if abs(ux * t[0] + uy * t[1]) > 0.4:  # the other stretch has to be beside it, not ahead
                        continue
                    best = (q, d)
                if best:
                    paired += 1
                    gaps.append(best[1])
                    points.append(((p.x + best[0].x) / 2, (p.y + best[0].y) / 2))
                else:
                    points.append((p.x, p.y))
            if paired / steps >= DUAL_MIN_SHARE and line.length >= 20:
                gap = sorted(gaps)[len(gaps) // 2]
                collapsed[i] = (LineString(points), road.width_m + gap)

    result: list[_Road] = []
    kept_by_name: dict[str, list[LineString]] = defaultdict(list)
    for i, road in enumerate(roads):
        if i not in collapsed:
            result.append(road)
    # Longest first, so the duplicate dropped is the shorter piece of each pair.
    for i in sorted(collapsed, key=lambda i: -collapsed[i][0].length):
        road = roads[i]
        line, width = collapsed[i]
        kept = kept_by_name[road.name]
        remainder = line.difference(unary_union(kept).buffer(DEDUPE_BUFFER_M)) if kept else line
        parts = [remainder] if isinstance(remainder, LineString) else list(getattr(remainder, "geoms", []))
        for part in parts:
            if part.length < MIN_FRAGMENT_M:
                continue
            ends = (road.line.coords[0], road.line.coords[-1]) if part.equals(line) else None
            result.append(_Road(part, road.name, width, road.code, dual=True, original_ends=ends))
            kept.append(part)
    return result


def _parallel_share(line: LineString, others: list[LineString], max_gap: float) -> tuple[float, float]:
    """The share of `line` that runs beside one of `others` (parallel, DUAL_MIN_GAP_M..max_gap
    away), and the typical gap."""
    steps = max(2, int(line.length / SAMPLE_STEP_M) + 1)
    paired, gaps = 0, []
    for k in range(steps):
        dist = line.length * k / (steps - 1)
        p = line.interpolate(dist)
        t = _tangent(line, dist)
        for other in others:
            d = other.distance(p)
            if not (DUAL_MIN_GAP_M <= d <= max_gap):
                continue
            tq = _tangent(other, other.project(p))
            if abs(t[0] * tq[0] + t[1] * tq[1]) >= DUAL_PARALLEL_COS:
                paired += 1
                gaps.append(d)
                break
    return paired / steps, (sorted(gaps)[len(gaps) // 2] if gaps else 0.0)


def _absorb_unnamed_side_roads(roads: list[_Road]) -> list[_Road]:
    """An unnamed road running alongside a wide named street for most of its length — a side
    lane, an access strip — is part of that street for the network: it is dropped, and the street it
    runs beside is widened to cover it."""
    named = [i for i, r in enumerate(roads) if r.name and r.width_m >= ABSORB_MIN_STREET_WIDTH_M]
    tree = STRtree([roads[i].line for i in named])
    dropped: set[int] = set()
    widened: dict[int, float] = {}
    for i, road in enumerate(roads):
        if road.name or road.line.length < 10:
            continue
        near = [named[int(k)] for k in tree.query(road.line.buffer(ABSORB_MAX_GAP_M))]
        if not near:
            continue
        share, gap = _parallel_share(road.line, [roads[j].line for j in near], ABSORB_MAX_GAP_M)
        if share < ABSORB_MIN_SHARE:
            continue
        dropped.add(i)
        for j in near:
            if roads[j].line.distance(road.line) <= ABSORB_MAX_GAP_M:
                widened[j] = max(widened.get(j, roads[j].width_m), roads[j].width_m + gap + road.width_m / 2)
    result = []
    for i, road in enumerate(roads):
        if i in dropped:
            continue
        if i in widened:
            road = _Road(road.line, road.name, widened[i], road.code, dual=True, original_ends=(road.line.coords[0], road.line.coords[-1]))
        result.append(road)
    return result


def _key(p: tuple[float, float]) -> tuple[int, int]:
    return (round(p[0] * 10), round(p[1] * 10))


def _reattach(roads: list[_Road], original: list[_Road]) -> list[_Road]:
    """Side streets that met a carriageway which has since moved onto the centre line (or been
    dropped) end in mid-air: each such end — one that was a junction in the original network —
    is extended to the nearest point of the merged street, which is split there."""
    original_degree: dict[tuple[int, int], int] = defaultdict(int)
    for road in original:
        original_degree[_key(road.line.coords[0])] += 1
        original_degree[_key(road.line.coords[-1])] += 1

    def connected_ends() -> set[tuple[int, int]]:
        keys: dict[tuple[int, int], int] = defaultdict(int)
        for road in roads:
            keys[_key(road.line.coords[0])] += 1
            keys[_key(road.line.coords[-1])] += 1
        return {k for k, v in keys.items() if v >= 2}

    joined = connected_ends()
    lines = [r.line for r in roads]
    tree = STRtree(lines)
    splits: dict[int, list[float]] = defaultdict(list)
    new_coords: dict[int, list[tuple[float, float]]] = {}

    for i, road in enumerate(roads):
        coords = list(road.line.coords)
        for end in (0, -1):
            p = coords[end]
            if _key(p) in joined:
                continue
            if not road.dual:
                was_junction = original_degree.get(_key(p), 0) >= 2
            elif road.original_ends is None:
                was_junction = True  # a merged street's piece cut short by the duplicate check: it continues
            else:
                was_junction = original_degree.get(_key(road.original_ends[0 if end == 0 else 1]), 0) >= 2
            if not was_junction:
                continue
            point = Point(p)
            best = None
            for j in tree.query(point.buffer(REATTACH_MAX_M)):
                j = int(j)
                if j == i:
                    continue
                if not roads[j].dual and not road.dual:
                    continue  # only a merged street moved; ordinary junctions are intact
                d = lines[j].distance(point)
                if d <= REATTACH_MAX_M and (best is None or d < best[1]):
                    best = (j, d)
            if best is None or best[1] < 0.05:
                continue
            j = best[0]
            along = lines[j].project(point)
            target = lines[j].interpolate(along)
            splits[j].append(along)
            coords = new_coords.get(i, coords)
            coords = [(target.x, target.y)] + coords if end == 0 else coords + [(target.x, target.y)]
            new_coords[i] = coords

    result = []
    for i, road in enumerate(roads):
        line = LineString(new_coords[i]) if i in new_coords else road.line
        cuts = sorted(d for d in splits.get(i, []) if 0.5 < d < line.length - 0.5)
        if i in new_coords and cuts:
            # The road was both extended and cut: recompute cut positions on the extended line.
            cuts = sorted(line.project(roads[i].line.interpolate(d)) for d in cuts)
        bounds = [0.0, *cuts, line.length]
        for a, b in zip(bounds, bounds[1:]):
            if b - a > 0.05:
                result.append(_Road(substring(line, a, b), road.name, road.width_m, road.code, road.dual))
    return result


def _join_plain_bends(roads: list[_Road]) -> list[_Road]:
    """Joins roads meeting end to end at a point no third road touches, when both carry the
    same name — one street drawn as several pieces."""
    roads = list(roads)
    alive = [True] * len(roads)
    changed = True
    while changed:
        changed = False
        ends: dict[tuple[int, int], list[int]] = defaultdict(list)
        for i, r in enumerate(roads):
            if alive[i]:
                ends[_key(r.line.coords[0])].append(i)
                ends[_key(r.line.coords[-1])].append(i)
        for key, incident in ends.items():
            if len(incident) != 2 or incident[0] == incident[1]:
                continue
            i, j = incident
            ri, rj = roads[i], roads[j]
            if ri.name != rj.name:
                continue
            ci, cj = list(ri.line.coords), list(rj.line.coords)
            if _key(ci[-1]) != key:
                ci.reverse()
            if _key(cj[0]) != key:
                cj.reverse()
            if _key(ci[0]) == _key(cj[-1]):
                continue  # a closed loop — leave it as two pieces
            # A street changing class along the way (a path widening into a lane) is still one
            # stretch: it takes the wider width, and the class of its longer part.
            code = ri.code if ri.line.length >= rj.line.length else rj.code
            roads[i] = _Road(LineString(ci + cj[1:]), ri.name, max(ri.width_m, rj.width_m), code, ri.dual or rj.dual)
            alive[j] = False
            changed = True
            break
    return [r for r, a in zip(roads, alive) if a]


def fetch_segments(boundary_lv95: list[Polygon], min_e: float, min_n: float, max_e: float, max_n: float) -> list[Segment]:
    margin = 300
    original = _fetch_roads(min_e - margin, min_n - margin, max_e + margin, max_n + margin)
    roads = _collapse_dual_carriageways(original)
    roads = _absorb_unnamed_side_roads(roads)
    roads = _reattach(roads, original)
    roads = _join_plain_bends(roads)

    inside = [p.buffer(0) for p in boundary_lv95]
    node_ids: dict[tuple[int, int], int] = {}

    def node(p: tuple[float, float]) -> int:
        return node_ids.setdefault(_key(p), len(node_ids))

    segments: list[Segment] = []
    for road in roads:
        line = road.line
        if line.length < 1:
            continue
        mid = line.interpolate(0.5, normalized=True)
        if not any(poly.contains(mid) for poly in inside):
            continue
        coords = [(x, y) for x, y, *_ in line.coords]
        segments.append(
            Segment(
                id=len(segments),
                name=road.name,
                highway="main" if road.code in MAIN_ROAD_CODES or road.width_m >= 12 else ("path" if road.code in NAMED_PATH_WIDTH_M else "street"),
                a=node(coords[0]),
                b=node(coords[-1]),
                lv95=coords,
                length_m=line.length,
                width_m=road.width_m,
            )
        )
    return _contract_short_segments(segments)


def _contract_short_segments(segments: list[Segment]) -> list[Segment]:
    """Drops stretches shorter than MIN_SEGMENT_M: one between two junctions is shrunk to a
    point (its two end nodes become one junction), a short dead end simply goes. Ids and node
    ids are renumbered compactly."""
    degree: dict[int, int] = defaultdict(int)
    for s in segments:
        degree[s.a] += 1
        degree[s.b] += 1
    parent: dict[int, int] = {}

    def find(n: int) -> int:
        while parent.get(n, n) != n:
            n = parent[n]
        return n

    kept = []
    for s in segments:
        if s.length_m >= MIN_SEGMENT_M or s.a == s.b:
            kept.append(s)
            continue
        if degree[s.a] >= 2 and degree[s.b] >= 2:
            ra, rb = find(s.a), find(s.b)
            if ra != rb:
                parent[rb] = ra
        # else: a short dead end — dropped

    node_ids: dict[int, int] = {}
    result = []
    for s in kept:
        a = node_ids.setdefault(find(s.a), len(node_ids))
        b = node_ids.setdefault(find(s.b), len(node_ids))
        if a == b and s.length_m < MIN_SEGMENT_M * 3:
            continue  # a loop shrunk onto a single junction
        result.append(Segment(len(result), s.name, s.highway, a, b, s.lv95, s.length_m, s.width_m))
    return result


def _normalize(name: str | None) -> str:
    if not name:
        return ""
    return unicodedata.normalize("NFC", name).casefold().replace("str.", "strasse").strip()


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
        best, best_d = None, NAMED_MATCH_RADIUS_M
        for sid in by_name.get(_normalize(name), []):
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

