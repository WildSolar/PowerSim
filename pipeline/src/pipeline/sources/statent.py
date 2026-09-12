"""BFS STATENT (employment by sector) — NOT wired up yet.

Research confirmed the only directly-downloadable machine-readable STATENT file is a
Switzerland-wide 100m hectare grid with a single classed total-FTE value per cell (no
municipality field, no NOGA sector breakdown). Getting real per-municipality,
per-sector figures needs either a spatial join against municipality boundaries plus
BFS's STAT-TAB/px-web API for the sector split, neither of which any current milestone
actually consumes yet (the commercial/industrial background load is a later
milestone). Returning an empty mapping here rather than guessing is intentional —
revisit when that milestone starts.
"""

from __future__ import annotations


def fetch_employment_by_sector(bfs_number: int) -> dict[str, int]:
    del bfs_number  # not yet used — see module docstring
    return {}
