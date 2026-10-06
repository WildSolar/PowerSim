"""A small disk cache for slow, rarely changing web requests (OpenStreetMap's Overpass API, the
canton's land cover), so rebuilding a dataset after a pipeline change doesn't fetch them all again.
Kept in pipeline/.cache (not in git); delete it to fetch fresh data.
"""

from __future__ import annotations

import hashlib
import json
from pathlib import Path
from typing import Any, Callable

CACHE_DIR = Path(__file__).resolve().parents[2] / ".cache"


def cached_json(namespace: str, key: str, fetch: Callable[[], Any]) -> Any:
    """`fetch()`'s JSON-serialisable result, from the cache if this key was fetched before."""
    path = CACHE_DIR / namespace / f"{hashlib.sha1(key.encode('utf-8')).hexdigest()}.json"
    if path.exists():
        return json.loads(path.read_text(encoding="utf-8"))
    result = fetch()
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(result), encoding="utf-8")
    return result
