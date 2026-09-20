"""Fetch and parse the BFE/Pronovo electricity production plant registry
(includes rooftop solar), filtered to one municipality by name.
"""

from __future__ import annotations

import io
import zipfile

import pandas as pd
import requests

REGISTRY_URL = (
    "https://data.geo.admin.ch/ch.bfe.elektrizitaetsproduktionsanlagen/csv/2056/"
    "ch.bfe.elektrizitaetsproduktionsanlagen.zip"
)


def _read_csv_from_zip(zf: zipfile.ZipFile, name: str) -> pd.DataFrame:
    with zf.open(name) as f:
        return pd.read_csv(f, sep=None, engine="python", encoding="utf-8-sig")


_registry_cache: tuple[pd.DataFrame, dict] | None = None


def _normalize(name: str) -> str:
    """'Aesch (ZH)' (GWR) and 'Aesch ZH' (this registry) must compare equal."""
    return "".join(ch for ch in str(name).lower() if ch.isalnum())


def _load_registry() -> tuple[pd.DataFrame, dict]:
    """Downloaded once per process — building many municipalities in one run would
    otherwise re-fetch the whole national registry for each."""
    global _registry_cache
    if _registry_cache is None:
        response = requests.get(REGISTRY_URL, timeout=120)
        response.raise_for_status()
        zf = zipfile.ZipFile(io.BytesIO(response.content))
        plants = _read_csv_from_zip(zf, "ElectricityProductionPlant.csv")
        subcat = _read_csv_from_zip(zf, "SubCategoryCatalogue.csv")
        plants["_municipality_key"] = plants["Municipality"].map(_normalize)
        _registry_cache = (plants, dict(zip(subcat["Catalogue_id"], subcat["en"])))
    return _registry_cache


def fetch_power_plants(
    municipality_name: str, canton: str | None = None, egids: set[int] | None = None
) -> pd.DataFrame:
    """Power plants in the given municipality, with technology labels resolved to English text.
    Pass the canton to keep same-named municipalities in other cantons out. Pass the
    municipality's building EGIDs to also catch plants whose registry municipality
    spelling differs from GWR's (e.g. 'Pfäffikon ZH' vs 'Pfäffikon'), which a name
    match alone misses."""
    plants, subcat_labels = _load_registry()
    mask = plants["_municipality_key"] == _normalize(municipality_name)
    if egids is not None:
        mask |= plants["EGID"].isin(egids)
    if canton is not None:
        mask &= plants["Canton"] == canton
    sub = plants[mask].copy()
    sub["TechnologyLabel"] = sub["SubCategory"].map(subcat_labels)
    return sub
