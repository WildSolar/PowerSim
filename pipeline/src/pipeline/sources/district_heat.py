"""The district heating network a municipality starts with, inferred — real pipe routes
aren't open data (OpenStreetMap maps none here). GWR does say which buildings are heated
by district heat, so every street segment such a building fronts on must have a pipe;
those segments are then joined to the heat source along the shortest street routes (a
greedy Steiner-tree approximation: repeatedly connect the connected-so-far network to
the nearest still-unconnected customer street), so the result is one plausible connected
network rather than islands. Customer streets the street graph can't reach from the
source stay in as islands.

Where the heat comes from isn't in GWR either. KNOWN_SOURCES names it for municipalities
where it's known — a plant inside the municipality, or a trunk line arriving from a
neighbouring one ("import": the network is fed at the junction nearest to that plant).
Anywhere else with district-heated buildings, the source is placed at the junction
nearest to the customers' centre and labelled as unknown.
"""

from __future__ import annotations

import heapq
from collections import defaultdict

from .. import coords
from .streets import Segment

# BFS number -> the plant that feeds the network, and whether it sits inside the
# municipality ("plant") or in a neighbouring one ("import").
KNOWN_SOURCES: dict[int, dict] = {
    247: {"name": "Limeco waste-to-energy plant, Dietikon", "kind": "import", "lon": 8.4028, "lat": 47.4162},
}


def _node_positions(segments: list[Segment]) -> dict[int, tuple[float, float]]:
    positions: dict[int, tuple[float, float]] = {}
    for s in segments:
        positions[s.a] = s.lv95[0]
        positions[s.b] = s.lv95[-1]
    return positions


def _nearest_node(positions: dict[int, tuple[float, float]], x: float, y: float) -> int:
    return min(positions, key=lambda n: (positions[n][0] - x) ** 2 + (positions[n][1] - y) ** 2)


def infer_network(
    bfs_number: int,
    segments: list[Segment],
    district_heated_segments: set[int],
    customer_positions: list[tuple[float, float]],
) -> dict | None:
    """The source and the initially piped segment ids, or None when the municipality has
    neither district-heated buildings nor a known source."""
    known = KNOWN_SOURCES.get(bfs_number)
    if not district_heated_segments and not known:
        return None
    positions = _node_positions(segments)
    if not positions:
        return None

    if known:
        sx, sy = coords.lonlat_to_lv95(known["lon"], known["lat"])
        source = {"name": known["name"], "kind": known["kind"], "lon": known["lon"], "lat": known["lat"]}
    else:
        sx = sum(p[0] for p in customer_positions) / len(customer_positions)
        sy = sum(p[1] for p in customer_positions) / len(customer_positions)
        lon, lat = coords.lv95_to_lonlat(sx, sy)
        source = {"name": "District heating plant (location unknown)", "kind": "unknown", "lon": lon, "lat": lat}
    feed_node = _nearest_node(positions, sx, sy)
    source["node"] = feed_node
    fx, fy = positions[feed_node]
    source["feed_lon"], source["feed_lat"] = coords.lv95_to_lonlat(fx, fy)

    adjacency: dict[int, list[tuple[int, int, float]]] = defaultdict(list)  # node -> (neighbour, segment, length)
    for s in segments:
        adjacency[s.a].append((s.b, s.id, s.length_m))
        adjacency[s.b].append((s.a, s.id, s.length_m))

    piped: set[int] = set()
    tree_nodes = {feed_node}
    remaining = set(district_heated_segments)
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
            piped |= remaining  # unreachable from the source: kept as islands
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
        tree_nodes.update((seg.a, seg.b))
        remaining.discard(target_segment)
        remaining -= piped

    return {"source": source, "initial_segments": sorted(piped)}
