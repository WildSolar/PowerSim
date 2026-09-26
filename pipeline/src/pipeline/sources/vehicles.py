"""The municipality's registered road vehicles (BFS, "Bestand der Strassenfahrzeuge nach Gemeinde,
Fahrzeuggruppe, Treibstoff und Jahr", px-x-1103020100_111), latest year: passenger cars and goods
vehicles (Sachentransportfahrzeuge — vans, lorries and articulated lorries together; the table
doesn't split them per municipality), each with how many are fully electric.

Vehicles count where their holder is registered, so a business registered here with its lorries
parked elsewhere counts here — the closest per-municipality figure there is.
"""

from __future__ import annotations

import requests

TABLE_URL = "https://www.pxweb.bfs.admin.ch/api/v1/de/px-x-1103020100_111/px-x-1103020100_111.px"
CARS = "1"
GOODS = "3"
ELECTRIC = "500"


def fetch_register(bfs_number: int) -> dict | None:
    try:
        meta = requests.get(TABLE_URL, timeout=60).json()
        years = next(v["values"] for v in meta["variables"] if v["code"] == "Jahr")
        year = max(years)
        query = {
            "query": [
                {"code": "Gemeinde", "selection": {"filter": "item", "values": [str(bfs_number)]}},
                {"code": "Fahrzeuggruppe", "selection": {"filter": "item", "values": [CARS, GOODS]}},
                {"code": "Treibstoff", "selection": {"filter": "all", "values": ["*"]}},
                {"code": "Jahr", "selection": {"filter": "item", "values": [year]}},
            ],
            "response": {"format": "json"},
        }
        rows = requests.post(TABLE_URL, json=query, timeout=60).json()["data"]
    except (requests.RequestException, KeyError, ValueError, StopIteration) as e:
        print(f"  vehicle register unavailable ({e})")
        return None

    def count(group: str, fuel: str | None = None) -> int:
        total = 0
        for row in rows:
            _, g, f, _ = row["key"]
            if g == group and (fuel is None or f == fuel):
                try:
                    total += int(row["values"][0])
                except ValueError:
                    pass
        return total

    return {
        "year": int(year),
        "cars": count(CARS),
        "cars_electric": count(CARS, ELECTRIC),
        "goods_vehicles": count(GOODS),
        "goods_vehicles_electric": count(GOODS, ELECTRIC),
    }
