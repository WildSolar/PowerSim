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


def fetch_power_plants(municipality_name: str) -> pd.DataFrame:
    """Power plants in the given municipality, with technology labels resolved to English text."""
    response = requests.get(REGISTRY_URL, timeout=120)
    response.raise_for_status()
    zf = zipfile.ZipFile(io.BytesIO(response.content))

    plants = _read_csv_from_zip(zf, "ElectricityProductionPlant.csv")
    subcat = _read_csv_from_zip(zf, "SubCategoryCatalogue.csv")

    subcat_labels = dict(zip(subcat["Catalogue_id"], subcat["en"]))

    sub = plants[plants["Municipality"] == municipality_name].copy()
    sub["TechnologyLabel"] = sub["SubCategory"].map(subcat_labels)
    return sub
