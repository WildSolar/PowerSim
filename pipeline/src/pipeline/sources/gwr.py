"""Fetch and parse the GWR (building/dwelling register) extract from the federal
statistics office's own public bulk-download service (MADD — Mass Data Download),
filtered to one municipality by BFS number.

Works for any Swiss municipality, not just canton Zürich — an earlier version of
this module pulled from canton Zürich's own open-data portal
(daten.statistik.zh.ch), which only republishes GWR for municipalities within that
canton. `https://public.madd.bfs.admin.ch/{bfs_number}.zip` is confirmed (fetched
live against several municipalities while building this) to serve every Swiss
municipality, keyed by the exact same BFS number this pipeline already uses
everywhere else. The municipality list itself — BFS number, name, canton — is at
https://public.madd.bfs.admin.ch/authorities.json, useful for validating a target
BFS number or looking up a municipality's canton (footprints.py needs the canton
to pick its own source).

The ZIP contains three CSVs (buildings, dwellings, entrances — the same three
concepts the old canton-ZH extract split across separate URLs) plus a codes CSV
decoding every numeric field (GSTAT, GKAT, GKLAS, GWAERZH1, GENH1, ...) to German/
French/Italian text. Canton ZH's own republish had already joined these codes to
German text at the source; this module does the same join itself so every
downstream consumer (build_dataset.py, and everything past it) sees the identical
column names and text values as before — nothing downstream needed to change.
"""

from __future__ import annotations

import io
import zipfile

import pandas as pd
import requests

ZIP_URL_TEMPLATE = "https://public.madd.bfs.admin.ch/{bfs_number}.zip"
AUTHORITIES_URL = "https://public.madd.bfs.admin.ch/authorities.json"

BUILDINGS_CSV = "gebaeude_batiment_edificio.csv"
DWELLINGS_CSV = "wohnung_logement_abitazione.csv"
ENTRANCES_CSV = "eingang_entree_entrata.csv"
CODES_CSV = "kodes_codes_codici.csv"

EGID_COL = "Eidgenoessischer_Gebaeudeidentifikator"
EWID_COL = "Eidgenoessischer_Wohnungsidentifikator"

# GWR's federal GSTAT codelist for Gebaeudestatus_Code — 1004 is the only status
# meaning the building is actually standing today. The others (1001 projected,
# 1002 approved, 1003 under construction, 1007 demolished) are real GWR rows for
# buildings that don't physically exist right now, either not yet or not anymore.
# Left unfiltered, a demolished building keeps its old coordinate (often now
# inside whatever replaced it) with no current footprint to match, so it rendered
# as a stray point marker sitting inside another building's volume.
EXISTING_BUILDING_STATUS_CODE = 1004

# Federal field name (CMERKM in the codes CSV) -> the column name this module's
# own output uses, matching exactly what canton ZH's old CSV called the same
# concept so build_dataset.py needed zero changes.
_CODED_BUILDING_FIELDS = {
    "GKAT": "Gebaeudekategorie_Bezeichnung",
    "GKLAS": "Gebaeudeklasse_Bezeichnung",
    "GWAERZH1": "Waermeerzeuger_Heizung_primaer_Bezeichnung",
    "GENH1": "Energie-/Waermequelle_Heizung_primaer_Bezeichnung",
    "GWAERZW1": "Waermeerzeuger_Warmwasser_primaer_Bezeichnung",
    "GENW1": "Energie-/Waermequelle_Warmwasser_primaer_Bezeichnung",
}

_RAW_BUILDING_FIELDS = {
    "EGID": EGID_COL,
    "GGDENR": "BFS_NR",
    "GGDENAME": "Gemeindename",
    "GSTAT": "Gebaeudestatus_Code",
    "GKODE": "E-Gebaeudekoordinate",
    "GKODN": "N-Gebaeudekoordinate",
    "GBAUJ": "Baujahr_des_Gebaeudes",
    "GASTW": "Anzahl_Geschosse",
    "GEBF": "Energiebezugsflaeche",
    "GAREA": "Gebaeudeflaeche",
}


_zip_cache: dict[int, bytes] = {}


def _download_zip(bfs_number: int) -> zipfile.ZipFile:
    """Cached per BFS number within one pipeline run — fetch_buildings,
    fetch_dwellings, and fetch_addresses are each called once per municipality
    and would otherwise re-download the same ~2MB archive three times."""
    content = _zip_cache.get(bfs_number)
    if content is None:
        response = requests.get(ZIP_URL_TEMPLATE.format(bfs_number=bfs_number), timeout=120)
        response.raise_for_status()
        content = response.content
        _zip_cache[bfs_number] = content
    return zipfile.ZipFile(io.BytesIO(content))


def _read_csv(zf: zipfile.ZipFile, name: str) -> pd.DataFrame:
    with zf.open(name) as f:
        return pd.read_csv(f, sep=None, engine="python", encoding="utf-8-sig")


def _build_decoder(codes_df: pd.DataFrame) -> dict[tuple[str, int], str]:
    """(CMERKM field name, CECODID code) -> German long text (CODTXTLD)."""
    decoder: dict[tuple[str, int], str] = {}
    for _, row in codes_df.iterrows():
        decoder[(row["CMERKM"], int(row["CECODID"]))] = row["CODTXTLD"]
    return decoder


def _decode_column(series: pd.Series, field: str, decoder: dict[tuple[str, int], str]) -> pd.Series:
    def decode_one(code):
        if pd.isna(code):
            return None
        return decoder.get((field, int(code)))

    return series.map(decode_one)


def municipality_canton(bfs_number: int) -> str | None:
    """This municipality's 2-letter canton abbreviation (e.g. 'ZH') — footprints.py
    uses this to pick its own per-canton source. Looked up from the same
    authorities.json the municipality-search box on gwr.admin.ch itself uses."""
    response = requests.get(AUTHORITIES_URL, timeout=60)
    response.raise_for_status()
    for entry in response.json():
        if entry.get("type") == "municipality" and entry.get("id") == str(bfs_number):
            return entry.get("canton")
    return None


def fetch_buildings(bfs_number: int) -> pd.DataFrame:
    """Currently-existing buildings in the given municipality, one row per EGID —
    excludes demolished/planned/approved/under-construction GWR records. Column
    names match the old canton-ZH extract exactly (see module doc)."""
    zf = _download_zip(bfs_number)
    raw = _read_csv(zf, BUILDINGS_CSV)
    codes_df = _read_csv(zf, CODES_CSV)
    decoder = _build_decoder(codes_df)

    df = pd.DataFrame()
    for raw_col, out_col in _RAW_BUILDING_FIELDS.items():
        df[out_col] = raw[raw_col]
    for raw_col, out_col in _CODED_BUILDING_FIELDS.items():
        df[out_col] = _decode_column(raw[raw_col], raw_col, decoder)

    df = df[df["BFS_NR"] == bfs_number]
    return df[df["Gebaeudestatus_Code"] == EXISTING_BUILDING_STATUS_CODE].copy()


def fetch_dwellings(bfs_number: int, egids: set[int]) -> pd.DataFrame:
    """Dwellings whose building EGID is in the given set."""
    zf = _download_zip(bfs_number)
    raw = _read_csv(zf, DWELLINGS_CSV)
    df = pd.DataFrame(
        {
            EGID_COL: raw["EGID"],
            EWID_COL: raw["EWID"],
            "Anzahl_Zimmer": raw["WAZIM"],
            "Wohnungsflaeche": raw["WAREA"],
        }
    )
    return df[df[EGID_COL].isin(egids)].copy()


def fetch_addresses(bfs_number: int, egids: set[int]) -> dict[int, str]:
    """One street-and-house-number address per EGID in the given set, built from
    GWR's building-entrance records (a building can have more than one entrance,
    e.g. a corner building addressed from two streets). Prefers the entrance
    flagged as the official address (DOFFADR == 1); among ties (or if none is
    flagged) picks the lowest entrance ID (EDID) so the choice is deterministic
    rather than depending on row order. Buildings with no house number recorded
    are simply omitted, not guessed at."""
    zf = _download_zip(bfs_number)
    raw = _read_csv(zf, ENTRANCES_CSV)
    df = raw[raw["EGID"].isin(egids)].copy()
    df["_is_official"] = df["DOFFADR"] == 1
    df = df.sort_values(["_is_official", "EDID"], ascending=[False, True])
    df = df.drop_duplicates(subset="EGID", keep="first")

    addresses: dict[int, str] = {}
    for _, row in df.iterrows():
        street = row["STRNAME"]
        house_number = row["DEINR"]
        if pd.isna(street) or pd.isna(house_number):
            continue
        addresses[int(row["EGID"])] = f"{street} {house_number}"
    return addresses
