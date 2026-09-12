"""Fetch and parse the GWR (building/dwelling register) extract from canton Zürich's
open data portal, filtered to one municipality by BFS number.

The federal GWR itself has no direct bulk-CSV download; canton Zürich republishes the
same register as a straightforward CSV covering the whole canton, which we filter
client-side. Confirmed columns (as of this writing) are used directly below.
"""

from __future__ import annotations

import io

import pandas as pd
import requests

BUILDINGS_URL = "https://daten.statistik.zh.ch/ogd/daten/ressourcen/KTZH_00002022_00004064.csv"
DWELLINGS_URL = "https://daten.statistik.zh.ch/ogd/daten/ressourcen/KTZH_00002022_00004065.csv"

EGID_COL = "Eidgenoessischer_Gebaeudeidentifikator"
EWID_COL = "Eidgenoessischer_Wohnungsidentifikator"


def _download_csv(url: str) -> pd.DataFrame:
    response = requests.get(url, timeout=120)
    response.raise_for_status()
    return pd.read_csv(io.BytesIO(response.content), sep=None, engine="python", encoding="utf-8-sig")


def fetch_buildings(bfs_number: int) -> pd.DataFrame:
    """Buildings in the given municipality, one row per EGID."""
    df = _download_csv(BUILDINGS_URL)
    return df[df["BFS_NR"] == bfs_number].copy()


def fetch_dwellings(egids: set[int]) -> pd.DataFrame:
    """Dwellings whose building EGID is in the given set."""
    df = _download_csv(DWELLINGS_URL)
    return df[df[EGID_COL].isin(egids)].copy()
