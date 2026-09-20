"""A municipality's own construction and demolition history, from GWR's construction
year (GBAUJ) and demolition year (GABBJ) — calibrates the game's town-growth and
building-renewal rates (app/src/sim/stock.ts) to what this municipality actually
did recently rather than one national guess. Floor space is approximated as
footprint x floors (GWR's own GEBF energy reference area is mostly empty), with
municipality medians standing in for missing footprints/floor counts."""

from __future__ import annotations

import pandas as pd

EXISTING = 1004
DEMOLISHED = 1007
HISTORY_YEARS = 15
LAST_COMPLETE_YEAR = 2025  # the dataset is built during 2026; a partial year would understate the rates


def _gfa(df: pd.DataFrame) -> pd.Series:
    known = df[df["GAREA"].notna() & df["GASTW"].notna()]
    median_area = float(known["GAREA"].median()) if len(known) else 100.0
    median_floors = float(known["GASTW"].median()) if len(known) else 2.0
    return df["GAREA"].fillna(median_area) * df["GASTW"].fillna(median_floors)


def compute_stock_history(records: pd.DataFrame) -> dict:
    records = records.copy()
    records["_gfa"] = _gfa(records)
    first_year = LAST_COMPLETE_YEAR - HISTORY_YEARS + 1
    years = list(range(first_year, LAST_COMPLETE_YEAR + 1))

    built_rows = records[records["GSTAT"].isin([EXISTING, DEMOLISHED])]
    demolished_rows = records[records["GSTAT"] == DEMOLISHED]
    built = built_rows.groupby("GBAUJ")["_gfa"].sum()
    demolished = demolished_rows.groupby("GABBJ")["_gfa"].sum()

    return {
        "first_year": first_year,
        "built_gfa_m2": [round(float(built.get(y, 0.0))) for y in years],
        "demolished_gfa_m2": [round(float(demolished.get(y, 0.0))) for y in years],
        "total_gfa_m2": round(float(records[records["GSTAT"] == EXISTING]["_gfa"].sum())),
    }
