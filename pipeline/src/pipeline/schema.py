"""Dataclasses describing the shape of the per-municipality dataset shipped to the game client.

Field names here are the ones the TypeScript client consumes (see app/src/data/types.ts) —
keep the two in sync when this shape changes.
"""

from __future__ import annotations

from dataclasses import dataclass, field


@dataclass
class Dwelling:
    ewid: str
    room_count: float | None = None
    area_m2: float | None = None


@dataclass
class Building:
    egid: str
    lon: float
    lat: float
    footprint: list[tuple[float, float]] | None  # WGS84 (lon, lat) polygon ring, or None
    address: str | None  # street + house number from GWR's building-entrance records
    construction_year: int | None
    category: str | None  # GKAT — coarse residential/non-residential category
    building_class: str | None  # GKLAS — finer EU-standard building-use class (office, retail, school, ...)
    floor_count: int | None
    energy_reference_area_m2: float | None
    footprint_area_m2: float | None  # Gebaeudeflaeche — footprint area, much better data coverage than energy_reference_area_m2
    heating_generator: str | None  # GWAERZH1 code
    heating_energy_source: str | None  # GENH1 code
    hot_water_generator: str | None
    hot_water_energy_source: str | None
    dwellings: list[Dwelling] = field(default_factory=list)
    street_segments: list[int] = field(default_factory=list)  # StreetSegment ids this building fronts on (see sources/streets.py)


@dataclass
class StreetSegment:
    """A street from one junction to the next — the unit district heating pipes are laid in."""

    id: int
    name: str | None
    highway: str  # "main" (8-10 m roads and merged dual carriageways) | "street" | "path"
    a: int  # end node ids, shared by segments meeting at a junction
    b: int
    length_m: float
    width_m: float  # the carriageway's width (both carriageways and the gap, for a merged street)
    line: list[tuple[float, float]]  # WGS84 (lon, lat)


@dataclass
class PowerPlant:
    plant_id: str
    lon: float
    lat: float
    capacity_kw: float | None
    technology: str | None
    commissioning_date: str | None
    egid: str | None  # links to Building.egid where the registry records one (most rooftop solar does)


@dataclass
class MunicipalityDataset:
    bfs_number: int
    name: str
    employment_by_sector: dict[str, int]
    boundary: list  # official municipal boundary: polygons -> rings (outer first, then holes) -> [lon, lat]
    stock_history: dict  # first_year, built_gfa_m2[], demolished_gfa_m2[], total_gfa_m2 — see sources/stock_history.py
    development_sites: list  # vacant buildable land — see sources/sites.py
    buildings: list[Building]
    power_plants: list[PowerPlant]
    streets: list[StreetSegment] = field(default_factory=list)
    # The inferred starting network: {source: {name, kind, lon, lat, node, feed_lon, feed_lat},
    # initial_segments: [ids]}, or None without district heat — see sources/district_heat.py.
    district_heat: dict | None = None
