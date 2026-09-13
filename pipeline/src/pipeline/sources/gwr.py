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
ADDRESSES_URL = "https://daten.statistik.zh.ch/ogd/daten/ressourcen/KTZH_00002022_00004066.csv"

EGID_COL = "Eidgenoessischer_Gebaeudeidentifikator"
EWID_COL = "Eidgenoessischer_Wohnungsidentifikator"

# GWR's federal GSTAT codelist for Gebaeudestatus_Code — 1004 is the only status
# meaning the building is actually standing today. The others (1001 projected,
# 1002 approved, 1003 under construction, 1007 demolished) are real GWR rows for
# buildings that don't physically exist right now, either not yet or not anymore —
# in Schlieren's own extract, 204 demolished + 30 planned/approved/under-construction
# out of 2456 rows. Left unfiltered, a demolished building keeps its old coordinate
# (often now inside whatever replaced it) with no current footprint to match, so it
# rendered as a stray point marker sitting inside another building's volume.
EXISTING_BUILDING_STATUS_CODE = 1004


def _download_csv(url: str) -> pd.DataFrame:
    response = requests.get(url, timeout=120)
    response.raise_for_status()
    return pd.read_csv(io.BytesIO(response.content), sep=None, engine="python", encoding="utf-8-sig")


def fetch_buildings(bfs_number: int) -> pd.DataFrame:
    """Currently-existing buildings in the given municipality, one row per EGID —
    excludes demolished/planned/approved/under-construction GWR records."""
    df = _download_csv(BUILDINGS_URL)
    municipality = df[df["BFS_NR"] == bfs_number]
    return municipality[municipality["Gebaeudestatus_Code"] == EXISTING_BUILDING_STATUS_CODE].copy()


def fetch_dwellings(egids: set[int]) -> pd.DataFrame:
    """Dwellings whose building EGID is in the given set."""
    df = _download_csv(DWELLINGS_URL)
    return df[df[EGID_COL].isin(egids)].copy()


def fetch_addresses(egids: set[int]) -> dict[int, str]:
    """One street-and-house-number address per EGID in the given set, built from
    GWR's building-entrance records (a building can have more than one entrance,
    e.g. a corner building addressed from two streets). Prefers the entrance
    flagged as the official address (`Offizielle_Adresse_Bezeichnung` == "Ja");
    among ties (or if none is flagged) picks the lowest entrance ID so the choice
    is deterministic rather than depending on row order. Buildings with no house
    number recorded (rare — 2 out of ~2500 in Schlieren) are simply omitted, not
    guessed at."""
    df = _download_csv(ADDRESSES_URL)
    df = df[df[EGID_COL].isin(egids)].copy()
    df["_is_official"] = df["Offizielle_Adresse_Bezeichnung"] == "Ja"
    df = df.sort_values(["_is_official", "Eidgenoessischer_Eingangsidentifikator"], ascending=[False, True])
    df = df.drop_duplicates(subset=EGID_COL, keep="first")

    addresses: dict[int, str] = {}
    for _, row in df.iterrows():
        street = row["Strassenbezeichnung"]
        house_number = row["Eingangsnummer_Gebaeude"]
        if pd.isna(street) or pd.isna(house_number):
            continue
        addresses[int(row[EGID_COL])] = f"{street} {house_number}"
    return addresses
