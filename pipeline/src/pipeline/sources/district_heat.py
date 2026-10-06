"""District heating: the networks a municipality starts with, and the places new heat could come from.

Real pipe routes aren't open data (OpenStreetMap maps none here). The networks themselves are
(heat_sources.py: the BFE's register of thermal networks, with each plant's position, capacity and
energy sources), and GWR says which buildings are heated by district heat. Each such building is
taken to hang off the nearest network's plant — nearest weighted by the plant's size, and only as
far as a plant of that size reaches, so a small school heating network takes only the buildings
right next to it, a big one those further out; every street segment it is addressed from must have
a pipe, and those segments are joined to that plant along the shortest streets (a greedy
Steiner-tree approximation: repeatedly connect the connected-so-far network to the nearest
still-unconnected customer street), one plausible connected network per plant. Customer streets the
street graph can't reach stay in as islands. District-heated buildings no registered network
reaches are grouped into local networks of unknown origin (buildings within a few hundred metres of
each other), each with its plant placed at its centre.

New heat (heat_sources.py) is tied into the street graph at the junction nearest to it: a plant
outside the municipality (an incinerator, a waste water plant) by a trunk line to that junction.
"""

from __future__ import annotations

import heapq
import math
from collections import defaultdict

from shapely.geometry import Point, Polygon

from .. import coords
from . import heat_sources
from .streets import Segment

# How far a registered plant's network reaches: this many metres times the square root of its
# capacity in MW (a 0.3 MW school network ~440 m, a 5 MW one ~1.8 km), at most CUSTOMER_REACH_M.
REACH_M_PER_SQRT_MW = 800
CUSTOMER_REACH_M = 3_000
# A network whose capacity isn't reported counts as this big (MW).
DEFAULT_POWER_MW = 1.0
# District-heated buildings no registered network reaches: those within this distance of each other
# (chained) form one local network.
LOCAL_NETWORK_LINK_M = 400

# Trunk lines don't run straight: this much longer than the straight line.
TRUNK_DETOUR = 1.2


def _node_positions(segments: list[Segment]) -> dict[int, tuple[float, float]]:
    positions: dict[int, tuple[float, float]] = {}
    for s in segments:
        positions[s.a] = s.lv95[0]
        positions[s.b] = s.lv95[-1]
    return positions


def _nearest_node(positions: dict[int, tuple[float, float]], x: float, y: float) -> int:
    return min(positions, key=lambda n: (positions[n][0] - x) ** 2 + (positions[n][1] - y) ** 2)


def _adjacency(segments: list[Segment]) -> dict[int, list[tuple[int, int, float]]]:
    adjacency: dict[int, list[tuple[int, int, float]]] = defaultdict(list)  # node -> (neighbour, segment, length)
    for s in segments:
        # A segment passes every junction in `nodes`; each hop along it costs its share of the length.
        nodes = s.nodes or [s.a, s.b]
        hop = s.length_m / max(1, len(nodes) - 1)
        for n0, n1 in zip(nodes, nodes[1:]):
            adjacency[n0].append((n1, s.id, hop))
            adjacency[n1].append((n0, s.id, hop))
    return adjacency


def _steiner(segments: list[Segment], adjacency, feed_node: int, customer_segments: set[int]) -> set[int]:
    """The customer segments, joined to the feed node along the shortest streets."""
    piped: set[int] = set()
    tree_nodes = {feed_node}
    remaining = set(customer_segments)
    while remaining:
        # Shortest paths from the whole network built so far.
        dist = {n: 0.0 for n in tree_nodes}
        via: dict[int, tuple[int, int]] = {}  # node -> (previous node, segment)
        heap = [(0.0, n) for n in tree_nodes]
        heapq.heapify(heap)
        target_segment, target_node = None, None
        while heap:
            d, n = heapq.heappop(heap)
            if d > dist.get(n, float("inf")):
                continue
            hit = next((sid for _, sid, _ in adjacency[n] if sid in remaining), None)
            if hit is not None:
                target_segment, target_node = hit, n
                break
            for m, sid, length in adjacency[n]:
                nd = d + length
                if nd < dist.get(m, float("inf")):
                    dist[m] = nd
                    via[m] = (n, sid)
                    heapq.heappush(heap, (nd, m))
        if target_segment is None:
            piped |= remaining  # unreachable from the plant: kept as islands
            break
        n = target_node
        while n in via:
            prev, sid = via[n]
            piped.add(sid)
            tree_nodes.add(n)
            n = prev
        tree_nodes.add(target_node)
        seg = segments[target_segment]
        piped.add(target_segment)
        tree_nodes.update(seg.nodes or (seg.a, seg.b))
        remaining.discard(target_segment)
        remaining -= piped
    return piped


def _clusters(points: list[tuple[float, float, set[int]]], link_m: float) -> list[list[tuple[float, float, set[int]]]]:
    """Points chained together by gaps of at most `link_m` (single linkage)."""
    groups: list[list[tuple[float, float, set[int]]]] = []
    left = list(points)
    while left:
        group = [left.pop()]
        i = 0
        while i < len(group):
            x, y, _ = group[i]
            near = [p for p in left if math.hypot(p[0] - x, p[1] - y) <= link_m]
            for p in near:
                left.remove(p)
            group.extend(near)
            i += 1
        groups.append(group)
    return groups


def _feed(positions, boundary: list[Polygon], x: float, y: float) -> dict:
    """Where a plant at (x, y) joins the street graph, and the trunk line to get there (m; 0 when it
    stands at the street)."""
    node = _nearest_node(positions, x, y)
    fx, fy = positions[node]
    lon, lat = coords.lv95_to_lonlat(x, y)
    feed_lon, feed_lat = coords.lv95_to_lonlat(fx, fy)
    straight = math.hypot(fx - x, fy - y)
    inside = any(poly.contains(Point(x, y)) for poly in boundary)
    return {
        "lon": lon,
        "lat": lat,
        "node": node,
        "feed_lon": feed_lon,
        "feed_lat": feed_lat,
        "trunk_m": round(straight * TRUNK_DETOUR) if straight > 30 else 0,
        "outside": not inside,
    }


def build(
    bfs_number: int,
    segments: list[Segment],
    boundary: list[Polygon],
    customers: list[tuple[float, float, set[int]]],
    buildings: list[dict],
) -> dict | None:
    """The starting networks and the candidate heat sources. `customers`: each district-heated
    building's position (LV95) and the segments it is addressed from. `buildings`: {egid, x, y,
    area_m2, residential} for every building (industrial waste heat sites)."""
    positions = _node_positions(segments)
    if not positions:
        return None
    adjacency = _adjacency(segments)

    registered = heat_sources.fetch_networks(boundary)
    print(f"  {len(registered)} registered district heating network(s): {', '.join(n['name'] for n in registered) or 'none'}")

    # Each district-heated building to the network nearest it — distance over the square root of the
    # plant's capacity, a power-weighted split — among those near enough.
    assigned: dict[int, set[int]] = defaultdict(set)
    unassigned: list[tuple[float, float, set[int]]] = []
    for x, y, segs in customers:
        near = []
        for i, n in enumerate(registered):
            power = n["power_mw"] or DEFAULT_POWER_MW
            d = math.hypot(n["x"] - x, n["y"] - y)
            if d <= min(CUSTOMER_REACH_M, REACH_M_PER_SQRT_MW * math.sqrt(power)):
                near.append((i, d / math.sqrt(power)))
        if near:
            assigned[min(near, key=lambda t: t[1])[0]] |= segs
        else:
            unassigned.append((x, y, segs))

    networks = []
    for i, n in enumerate(registered):
        feed = _feed(positions, boundary, n["x"], n["y"])
        networks.append(
            {
                "name": n["name"],
                "operator": n["operator"],
                "since": n["since"],
                "known": True,
                **feed,
                "power_mw": n["power_mw"],
                "sources": n["sources"],
                "segments": sorted(_steiner(segments, adjacency, feed["node"], assigned[i])),
            }
        )
    for group in _clusters(unassigned, LOCAL_NETWORK_LINK_M):
        x = sum(c[0] for c in group) / len(group)
        y = sum(c[1] for c in group) / len(group)
        feed = _feed(positions, boundary, x, y)
        feed["trunk_m"] = 0
        customer_segments = set().union(*(c[2] for c in group))
        if not customer_segments:
            continue
        networks.append(
            {
                "name": "Local heating network (plant unknown)",
                "operator": None,
                "since": None,
                "known": False,
                **feed,
                "power_mw": None,
                "sources": [],
                "segments": sorted(_steiner(segments, adjacency, feed["node"], customer_segments)),
            }
        )

    candidates = []
    for p in heat_sources.fetch_incinerators(boundary):
        candidates.append({"id": p["id"], "kind": "incinerator", "name": p["name"], **_feed(positions, boundary, p["x"], p["y"]), "heat_mwh": p["heat_mwh"], "electricity_mwh": p["electricity_mwh"]})
    for p in heat_sources.fetch_wastewater(boundary):
        candidates.append({"id": p["id"], "kind": "wastewater", "name": p["name"], **_feed(positions, boundary, p["x"], p["y"]), "potential_mwh": p["potential_mwh"]})
    for p in heat_sources.fetch_industry(boundary, bfs_number, buildings):
        candidates.append(
            {
                "id": f"ind-{p['egid']}",
                "kind": "industry",
                "name": p["branch"],
                **_feed(positions, boundary, p["x"], p["y"]),
                "potential_mwh": p["waste_heat_mwh"],
                "noga": p["noga"],
                "egid": str(p["egid"]),
            }
        )
    print(f"  {len(candidates)} candidate heat source(s): " + ", ".join(f"{c['kind']} {c['name']}" for c in candidates))

    forest_ha, water = heat_sources.fetch_land(boundary)
    print(f"  {forest_ha:.0f} ha of forest, {len(water)} river or lake area(s)")

    if not networks and not candidates and not water and forest_ha == 0:
        return None
    return {
        "networks": networks,
        "candidates": candidates,
        "water": [ring for body in water for ring in heat_sources.polygon_rings_lonlat(body)],
        "forest_ha": round(forest_ha, 1),
    }
