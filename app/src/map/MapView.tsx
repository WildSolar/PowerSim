import { useEffect, useRef } from "react";
import { Map as MlMap, Marker, NavigationControl, Popup, setWorkerUrl, type GeoJSONSource, type ImageSource, type MapMouseEvent } from "maplibre-gl";
// MapLibre finds its worker next to its own file, which a production build bundles away: hand it
// the worker as Vite builds it.
import mapWorkerUrl from "maplibre-gl/dist/maplibre-gl-worker.mjs?worker&url";
import "maplibre-gl/dist/maplibre-gl.css";
import type { Building, MunicipalityDataset, PowerPlant } from "../data/types";
import { buildingHeightM } from "../sim/buildingGeometry";
import { buildingPowerW } from "../sim/buildingPower";
import { simClock } from "../sim/engine";
import { stock } from "../sim/stock";
import { energyClassAt } from "../sim/retrofit";
import { underConstructionAt, visibleAt } from "../sim/lifetime";
import { addBoundaryLine, addBoundaryMask } from "./boundaryLayers";
import { useMapKeyboard } from "./useMapKeyboard";
import { effectivePowerPlantsAt } from "../sim/solarAdoption";
import { snowDepthCm } from "../sim/snow";
import { districtHeat } from "../sim/districtHeat";
import { mapNetworkBucketAt } from "../sim/districtHeatStats";
import { streets } from "../sim/streets";
import { pointsAt, publicCharging, siteCapacityAt, type ChargingSite } from "../sim/publicCharging";
import { REACH_M, type ChargingKind } from "../config/charging";
import { zoning } from "../sim/zoning";
import { mapFocus } from "./mapFocus";
import { grid } from "../sim/grid";
import { heatPumpSiting } from "../sim/heatPumpSiting";
import { publicBuildingBucket } from "../sim/publicBuildings";
import {
  AGE_LEGEND,
  buildingAgeBucket,
  buildingCategoryBucket,
  CONSTRUCTION_COLOR,
  buildingHeatingBucketAt,
  INSULATION_LEGEND,
  CATEGORY_LEGEND,
  DISTRICT_HEAT_LEGEND,
  CHARGER_USE_RAMP,
  COVERAGE_COLOR,
  DH_PRIORITY_COLOR,
  HIGH_STANDARD_COLOR,
  ZONING_BUILDING_COLOR,
  ZONING_LEGEND,
  PUBLIC_BUILDINGS_LEGEND,
  GRID_LEGEND,
  ZONING_PENDING_COLOR,
  EV_CHARGING_LEGEND,
  evChargingBucket,
  HEATING_LEGEND,
  PIPE_COLOR,
  PIPE_PLANNED_COLOR,
  PIPE_UNCONNECTED_COLOR,
  PIPE_UNDER_CONSTRUCTION_COLOR,
  STREET_UNPIPED_COLOR,
  legendMatchExpression,
  powerColorExpression,
  solarColorExpression,
  type ColorMode,
  type MapExpr,
  GROUND_HEAT_LEGEND,
  HEAT_USE_LEGEND,
  TUNNEL_COLOR,
} from "./colorModes";

setWorkerUrl(mapWorkerUrl);
const BASEMAP_STYLE_URL = "https://vectortiles.geo.admin.ch/styles/ch.swisstopo.basemap.vt/style.json";

const POLY_SOURCE_ID = "buildings-polygons";
const POLY_LAYER_ID = "buildings-polygons-extrusion";
const POINT_SOURCE_ID = "buildings-points";
const POINT_LAYER_ID = "buildings-points-circle";

const DEFAULT_COLOR = "#9db4c9";
const SELECTED_COLOR = "#f97316";
const POWER_TICK_MS = 1500;
const HEATING_TICK_MS = 5000; // renewals are years apart in simulated time — no need for power's snappy cadence
const SOLAR_TICK_MS = 5000; // new adoptions are decided at most once/year per building — same cadence as heating
const DISTRICT_HEAT_TICK_MS = 3000; // extensions finishing, buildings connecting

const STREET_SOURCE_ID = "streets";
const STREET_UNPIPED_LAYER_ID = "streets-unpiped";
const STREET_LINE_LAYER_ID = "streets-line";
const STREET_CONSTRUCTION_LAYER_ID = "streets-construction";
const STREET_HIT_LAYER_ID = "streets-hit"; // wide and invisible: what a click on a street is tested against
const DH_SOURCE_SOURCE_ID = "district-heat-source";
const DH_TRUNK_LAYER_ID = "district-heat-trunk";
const DH_PLANT_LAYER_ID = "district-heat-plant";
const STREET_CLICK_TOLERANCE_PX = 6;
const EV_CHARGING_TICK_MS = 3000; // cars booked to chargers, sites opening and filling up

const CHARGER_SOURCE_ID = "charging-sites";
// Municipal sites are circles, private ones squares; a fast-charging hub or lorry charging park
// has an outer ring (or square frame) too.
const CHARGER_LAYER_ID = "charging-sites-circle";
const CHARGER_HUB_LAYER_ID = "charging-sites-hub";
const CHARGER_SQUARE_LAYER_ID = "charging-sites-square";
const CHARGER_SQUARE_HUB_LAYER_ID = "charging-sites-square-hub";
const CHARGER_HIT_LAYER_IDS = [CHARGER_LAYER_ID, CHARGER_SQUARE_LAYER_ID];
const SQUARE_ICON = "charger-square";
const SQUARE_FRAME_ICON = "charger-square-frame";
const HUB_RING_GAP_PX = 8; // between a site's marker and its hub ring
const HUB_RING_WIDTH_PX = 4;
const LORRY_RING_WIDTH_PX = 5;
const CHARGER_REACH_SOURCE_ID = "charging-reach";
const CHARGER_REACH_FILL_LAYER_ID = "charging-reach-fill";
const CHARGER_REACH_LINE_LAYER_ID = "charging-reach-line";
const CHARGER_LAYER_IDS = [CHARGER_REACH_FILL_LAYER_ID, CHARGER_REACH_LINE_LAYER_ID, CHARGER_HUB_LAYER_ID, CHARGER_LAYER_ID, CHARGER_SQUARE_HUB_LAYER_ID, CHARGER_SQUARE_LAYER_ID];
const MUNICIPAL_CHARGER_STROKE = "#1a1a1a";
const COVERAGE_KINDS: ChargingKind[] = ["ac", "dc", "fleet"];
const coverageId = (kind: ChargingKind) => `charging-coverage-${kind}`;
const COVERAGE_METRES_PER_PX = 4;
const COVERAGE_MAX_PX = 2048;
const COVERAGE_OUTLINE_PX = 2;
const COVERAGE_FILL_ALPHA = 0.16;
const COVERAGE_OUTLINE_ALPHA = 0.85;
const ZONE_SOURCE_ID = "zone-parcels";
const ZONE_FILL_LAYER_ID = "zone-parcels-fill";
const ZONE_DH_LAYER_ID = "zone-parcels-dh-priority";
const ZONE_STANDARD_LAYER_ID = "zone-parcels-high-standard";
const ZONE_LINE_LAYER_ID = "zone-parcels-line";
const ZONE_MARK_LAYER_ID = "zone-parcels-mark"; // picked or with a change on the way
// The same parcels in the district heating layer: only the district-heat priority zones, under the streets.
const DH_PRIORITY_FILL_LAYER_ID = "dh-priority-zones-fill";
const DH_PRIORITY_LINE_LAYER_ID = "dh-priority-zones-line";
const ZONE_LAYER_IDS = [ZONE_FILL_LAYER_ID, ZONE_DH_LAYER_ID, ZONE_STANDARD_LAYER_ID, ZONE_LINE_LAYER_ID, ZONE_MARK_LAYER_ID];
const ZONING_TICK_MS = 3000;
const STATION_SOURCE_ID = "grid-stations";
const STATION_LAYER_ID = "grid-stations-circle";
const GRID_ZONE_SOURCE_ID = "grid-zones";
const HEAT_USE_SOURCE_ID = "heat-use";
const HEAT_USE_FILL_LAYER_ID = "heat-use-fill";
const HEAT_USE_LINE_LAYER_ID = "heat-use-line";
const TUNNEL_LAYER_ID = "heat-use-tunnels";
const GRID_ZONE_FILL_LAYER_ID = "grid-zones-fill";
const GRID_ZONE_LINE_LAYER_ID = "grid-zones-line";
const GRID_ZONE_SELECTED_LAYER_ID = "grid-zones-selected";
const GRID_DIMMED_COLOR = "#e0ded8"; // buildings outside the selected area
const STRIPE_DH = "zone-stripe-dh";
const STRIPE_STANDARD = "zone-stripe-standard";

const EMPTY_PNG = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==";
const LORRY_PARK_RING = "#7a4fd1";
const HUB_RING_COLOR = "#1a1a1a";
const PRIVATE_CHARGER_STROKE = "#52514e";

// Metres per screen pixel at zoom 0 at Swiss latitudes (MapLibre's 512-px tiles, cos 47.4°), so a
// street can be drawn at its real width: covering the painted street, not a hairline on top of it.
const METRES_PER_PX_AT_Z0 = (40_075_017 * Math.cos((47.4 * Math.PI) / 180)) / 512;

/** A line width that is `metres` (an expression) wide on the ground at every zoom, but never
 * thinner than `minPx` on screen. */
function metresWide(metres: unknown, minPx: number): unknown {
  const at = (zoom: number) => ["max", minPx, ["*", metres, 2 ** zoom / METRES_PER_PX_AT_Z0]];
  return ["interpolate", ["exponential", 2], ["zoom"], 12, at(12), 22, at(22)];
}
// Piped, planned and building streets are drawn this wide on the ground whatever the street's own
// width: an even band along the network reads better than one tracing every carriageway.
const NETWORK_LINE_WIDTH_M = 7;

type BuildingProperties = {
  egid: string;
  category: string;
  age: string;
  energyClass: string;
  constructing: number;
  heating: string;
  network: string; // districtHeatStats.ts's NetworkStatus
  charging: string; // colorModes.ts's evChargingBucket
  publicStatus: string; // publicBuildings.ts's publicBuildingBucket
  groundStatus: string; // heatPumpSiting.ts's groundBucket
  gridStatus: string; // grid.ts's bucket for the building's transformer area
  powerW: number;
  solarCapacityKw: number;
  heightM?: number;
};
type BuildingFeature = {
  type: "Feature";
  properties: BuildingProperties;
  geometry:
    | { type: "Polygon"; coordinates: [number, number][][] }
    | { type: "Point"; coordinates: [number, number] };
};
type BuildingFeatureCollection = { type: "FeatureCollection"; features: BuildingFeature[] };

function closedRing(ring: [number, number][]): [number, number][] {
  if (ring.length === 0) return ring;
  const [first] = ring;
  const last = ring[ring.length - 1];
  if (first[0] === last[0] && first[1] === last[1]) return ring;
  return [...ring, first];
}

function solarCapacityByEgid(plants: PowerPlant[]): Map<string, number> {
  const byEgid = new Map<string, number>();
  for (const plant of plants) {
    if (plant.technology !== "Photovoltaic" || !plant.egid || !plant.capacityKw) continue;
    byEgid.set(plant.egid, (byEgid.get(plant.egid) ?? 0) + plant.capacityKw);
  }
  return byEgid;
}

const CONSTRUCTION_SITE_HEIGHT_M = 4;

/** Every building visible at `simTimeMs`: standing ones, plus construction sites drawn
 * as low amber blocks (they draw no power and house nobody yet). Rebuilt from scratch
 * whenever the stock changes, so every layer's value is filled in as it stands at
 * `simTimeMs` (installed heating system, energy class) — not the register's original
 * snapshot — or the layers would flash back to it until their next periodic repaint,
 * which at high speed, with the stock changing every few seconds, reads as flicker.
 * Power draw isn't recomputed here (the power layer's own tick does that); each
 * building keeps its last reading from `previousPowerW` meanwhile. */
/** Each building's grid colour: its area's load, or dimmed when another area is selected. */
function gridStatusFn(simTimeMs: number): (b: Building) => string {
  const buckets = grid.getAreas().map((a) => grid.bucket(a, simTimeMs));
  const selected = grid.getSelectedId();
  return (b) => {
    const areaId = grid.areaIdOf(b);
    return selected !== null && areaId !== selected ? "dimmed" : (buckets[areaId] ?? "ok");
  };
}

/** What the grid layer shows right now, as a key — to redraw only when it changes. */
function gridLayerKey(simTimeMs: number): string {
  return `${grid.getSelectedId()}|${grid.getZonesVersion()}|${grid.getAreas().map((a) => `${grid.bucket(a, simTimeMs)}:${grid.capacityAt(a, simTimeMs)}`).join(",")}`;
}

function buildingsToGeoJSON(
  allBuildings: Building[],
  plants: PowerPlant[],
  simTimeMs: number,
  previousPowerW?: Map<string, number>,
): { polygons: BuildingFeatureCollection; points: BuildingFeatureCollection } {
  const solarByEgid = solarCapacityByEgid(plants);
  const buildings = allBuildings.filter((b) => visibleAt(b, simTimeMs));
  const chargingAccess = publicCharging.householdAccess(buildings, simTimeMs);
  // Set here too, not only by the grid layer's refresh: a rebuild (the stock changed) must not
  // flash every building back to "room to spare" until the next refresh.
  const gridStatusOf = gridStatusFn(simTimeMs);

  const properties = (b: Building): BuildingProperties => ({
    egid: b.egid,
    category: buildingCategoryBucket(b),
    age: buildingAgeBucket(b),
    energyClass: energyClassAt(b, simTimeMs),
    constructing: underConstructionAt(b, simTimeMs) ? 1 : 0,
    heating: buildingHeatingBucketAt(b, simTimeMs),
    network: mapNetworkBucketAt(b, simTimeMs),
    charging: evChargingBucket(chargingAccess.get(b.egid)),
    publicStatus: publicBuildingBucket(b, plants),
    groundStatus: heatPumpSiting.groundBucket(b, simTimeMs),
    gridStatus: gridStatusOf(b),
    powerW: previousPowerW?.get(b.egid) ?? 0,
    solarCapacityKw: solarByEgid.get(b.egid) ?? 0,
  });

  const polygonFeatures = buildings
    .filter((b) => b.footprint && b.footprint.length >= 3)
    .map((b) => ({
      type: "Feature" as const,
      properties: {
        ...properties(b),
        heightM: underConstructionAt(b, simTimeMs) ? CONSTRUCTION_SITE_HEIGHT_M : buildingHeightM(b),
      },
      geometry: {
        type: "Polygon" as const,
        coordinates: [closedRing(b.footprint as [number, number][])],
      },
    }));

  const pointFeatures = buildings
    .filter((b) => !b.footprint || b.footprint.length < 3)
    .map((b) => ({
      type: "Feature" as const,
      properties: properties(b),
      geometry: { type: "Point" as const, coordinates: [b.lon, b.lat] as [number, number] },
    }));

  return {
    polygons: { type: "FeatureCollection", features: polygonFeatures },
    points: { type: "FeatureCollection", features: pointFeatures },
  };
}

/** Every street segment, by where it stands in the district heating network — piped, being
 * built, picked for the next extension (and whether it connects), or without pipes. */
function streetsToGeoJSON(simTimeMs: number) {
  const selection = districtHeat.getSelection();
  const unconnected = new Set(districtHeat.quote(simTimeMs).unconnected);
  const stateOf = (id: number) =>
    selection.has(id) ? (unconnected.has(id) ? "plannedUnconnected" : "planned") : districtHeat.stateAt(id, simTimeMs);
  return {
    type: "FeatureCollection" as const,
    features: streets.all().map((s) => ({
      type: "Feature" as const,
      properties: { id: s.id, state: stateOf(s.id) },
      geometry: { type: "LineString" as const, coordinates: s.line },
    })),
  };
}

/** The heat source: where the plant is and, for heat arriving from a neighbouring municipality,
 * the trunk line from it to where the network is fed. */
function districtHeatSourceGeoJSON() {
  const source = districtHeat.getSource();
  const features: object[] = [];
  if (source) {
    features.push({ type: "Feature", properties: {}, geometry: { type: "Point", coordinates: [source.lon, source.lat] } });
    if (source.kind === "import") {
      features.push({
        type: "Feature",
        properties: {},
        geometry: {
          type: "LineString",
          coordinates: [
            [source.lon, source.lat],
            [source.feedLon, source.feedLat],
          ],
        },
      });
    }
  }
  return { type: "FeatureCollection" as const, features };
}

/** Every public charging site: open ones by how full they are, ones being built as such. */
function chargingSitesToGeoJSON(simTimeMs: number) {
  return {
    type: "FeatureCollection" as const,
    features: publicCharging.getSites().map((site) => {
      const capacity = siteCapacityAt(site, simTimeMs);
      return {
        type: "Feature" as const,
        properties: {
          id: site.id,
          kind: site.kind,
          municipal: site.owner === "municipal" ? 1 : 0,
          points: capacity > 0 ? pointsAt(site, simTimeMs) : site.points,
          utilization: capacity > 0 ? publicCharging.usersAt(site.id, simTimeMs) / capacity : 0,
          building: capacity > 0 ? 0 : 1,
          selected: site.id === publicCharging.getSelectedId() ? 1 : 0,
        },
        geometry: { type: "Point" as const, coordinates: [site.lon, site.lat] },
      };
    }),
  };
}

/** A circle `radiusM` around a point, as a polygon ring — close enough at a town's scale. */
function circleRing(lon: number, lat: number, radiusM: number): [number, number][] {
  const mPerDegLat = 111_320;
  const mPerDegLon = mPerDegLat * Math.cos((lat * Math.PI) / 180);
  const ring: [number, number][] = [];
  for (let i = 0; i <= 64; i++) {
    const a = (i / 64) * 2 * Math.PI;
    ring.push([lon + (Math.cos(a) * radiusM) / mPerDegLon, lat + (Math.sin(a) * radiusM) / mPerDegLat]);
  }
  return ring;
}

/** The reach of the selected site — or, while placing a new one, of the site at the cursor. */
function chargingReachGeoJSON(preview: { lon: number; lat: number } | null) {
  const placing = publicCharging.getPlacing();
  const selected = publicCharging.getSelectedId();
  const site: Pick<ChargingSite, "lon" | "lat" | "kind"> | undefined =
    placing && preview ? { ...preview, kind: placing.kind } : selected ? publicCharging.getSite(selected) : undefined;
  return {
    type: "FeatureCollection" as const,
    features: site
      ? [{ type: "Feature" as const, properties: {}, geometry: { type: "Polygon" as const, coordinates: [circleRing(site.lon, site.lat, REACH_M[site.kind])] } }]
      : [],
  };
}

// Square markers are signed-distance-field icons, so they can be coloured per site like the circles
// (icon-color) and carry an outline (icon-halo). The SDF convention MapLibre expects: 0.75 at the
// edge, falling by 1/8 per pixel outward (and rising inward).
const SDF_RADIUS_PX = 8;
const SQUARE_SIDE_PX = 24; // at icon-size 1: matches a circle of radius 12 (a 12-point site)

function sdfIcon(size: number, signedDistance: (x: number, y: number) => number): { width: number; height: number; data: Uint8Array } {
  const data = new Uint8Array(size * size * 4);
  for (let j = 0; j < size; j++) {
    for (let i = 0; i < size; i++) {
      const d = signedDistance(i + 0.5 - size / 2, j + 0.5 - size / 2);
      const o = (j * size + i) * 4;
      data[o] = data[o + 1] = data[o + 2] = 255;
      data[o + 3] = Math.max(0, Math.min(255, Math.round(255 * (0.75 - d / SDF_RADIUS_PX))));
    }
  }
  return { width: size, height: size, data };
}

/** Signed distance from a point to the outline of an axis-aligned square of side `side` centred
 * on the origin (negative inside). */
function squareDistance(x: number, y: number, side: number): number {
  const dx = Math.abs(x) - side / 2;
  const dy = Math.abs(y) - side / 2;
  return Math.hypot(Math.max(dx, 0), Math.max(dy, 0)) + Math.min(Math.max(dx, dy), 0);
}

function addChargerIcons(map: MlMap): void {
  if (!map.hasImage(SQUARE_ICON)) {
    map.addImage(SQUARE_ICON, sdfIcon(SQUARE_SIDE_PX + 2 * SDF_RADIUS_PX, (x, y) => squareDistance(x, y, SQUARE_SIDE_PX)), { sdf: true });
  }
  if (!map.hasImage(SQUARE_FRAME_ICON)) {
    // A hollow frame around the square: its centre line the ring gap out, as thick as a hub ring.
    const frameSide = SQUARE_SIDE_PX + 2 * (HUB_RING_GAP_PX + HUB_RING_WIDTH_PX / 2);
    map.addImage(
      SQUARE_FRAME_ICON,
      sdfIcon(frameSide + HUB_RING_WIDTH_PX + 2 * SDF_RADIUS_PX, (x, y) => Math.abs(squareDistance(x, y, frameSide)) - HUB_RING_WIDTH_PX / 2),
      { sdf: true },
    );
  }
}

/** Every zone parcel as the plan stands at `simTimeMs`, with whether it's picked or has a change
 * on the way — for the zoning layer. */
function zoneParcelsGeoJSON(simTimeMs: number) {
  const selection = zoning.getSelection();
  return {
    type: "FeatureCollection" as const,
    features: zoning.getParcels().flatMap((parcel) => {
      const state = zoning.stateAt(parcel.id, simTimeMs);
      if (!state) return [];
      const properties = {
        id: parcel.id,
        zone: state.zone,
        extraFloors: state.extraFloors,
        dhPriority: state.dhPriority ? 1 : 0,
        highStandard: state.highStandard ? 1 : 0,
        mark: selection.has(parcel.id) ? "selected" : zoning.hasPendingChange(parcel.id, simTimeMs) ? "pending" : "none",
      };
      return parcel.rings.map((rings) => ({ type: "Feature" as const, properties, geometry: { type: "Polygon" as const, coordinates: rings } }));
    }),
  };
}

/** A small tile of diagonal stripes, for the energy-zone overlays (fill-pattern). */
function stripeImage(color: string, forward: boolean): { width: number; height: number; data: Uint8Array } {
  const size = 12;
  const data = new Uint8Array(size * size * 4);
  const [r, g, b] = [1, 3, 5].map((i) => parseInt(color.slice(i, i + 2), 16));
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const d = ((forward ? x + y : x - y + size) % size + size) % size;
      const on = d < 3;
      const o = (y * size + x) * 4;
      data[o] = r;
      data[o + 1] = g;
      data[o + 2] = b;
      data[o + 3] = on ? 170 : 0;
    }
  }
  return { width: size, height: size, data };
}

/** Every transformer station, by how loaded it was at the last reading — for the grid layer. */
function stationsGeoJSON(simTimeMs: number) {
  const selected = grid.getSelectedId();
  return {
    type: "FeatureCollection" as const,
    features: grid.getAreas().map((a) => ({
      type: "Feature" as const,
      properties: { id: a.id, bucket: grid.bucket(a, simTimeMs), capacityKw: grid.capacityAt(a, simTimeMs), selected: a.id === selected ? 1 : 0 },
      geometry: { type: "Point" as const, coordinates: [a.lon, a.lat] },
    })),
  };
}

/** Each station's zone, by how loaded it was at the last reading — for the grid layer. */
function gridZonesGeoJSON(simTimeMs: number) {
  const selected = grid.getSelectedId();
  const zones = grid.zonePolygons();
  return {
    type: "FeatureCollection" as const,
    features: grid.getAreas().flatMap((a) => {
      const zone = zones[a.id];
      if (!zone || zone.fill.length === 0) return [];
      const properties = { id: a.id, bucket: grid.bucket(a, simTimeMs), selected: a.id === selected ? 1 : 0 };
      return [
        { type: "Feature" as const, properties: { ...properties, part: "fill" }, geometry: { type: "MultiPolygon" as const, coordinates: zone.fill } },
        { type: "Feature" as const, properties: { ...properties, part: "edge" }, geometry: { type: "MultiLineString" as const, coordinates: zone.edges } },
      ];
    }),
  };
}

/** The heat-use atlas, by what it means for a heat pump — the zones where boreholes are allowed
 * without conditions are left clear. */
function heatUseGeoJSON() {
  const features: object[] = [];
  for (const z of heatPumpSiting.getZones()) {
    const bucket = z.zone === "A" ? "noGround" : z.zone === "B" || z.noBoreholes ? "noBoreholes" : z.zone === "D" || z.zone === "F" ? null : "conditions"; // C, E, G and any zone not known yet
    if (!bucket) continue;
    features.push({
      type: "Feature",
      properties: { bucket },
      geometry: { type: "MultiPolygon", coordinates: z.polygons.map((rings) => rings.map((ring) => ring.map((p) => heatPumpSiting.toLonLat(p)))) },
    });
  }
  for (const line of heatPumpSiting.getTunnels()) {
    features.push({ type: "Feature", properties: { bucket: "tunnel" }, geometry: { type: "LineString", coordinates: line.map((p) => heatPumpSiting.toLonLat(p)) } });
  }
  return { type: "FeatureCollection" as const, features };
}

type ImageCorners = [[number, number], [number, number], [number, number], [number, number]];

/** Where every charger of a kind reaches, as one image: the union of their reach circles, lightly
 * shaded with a firmer outline around the whole. Drawing the circles opaque onto a canvas unions
 * them for free (a map fill would darken wherever two overlap); the outline is what's left of a
 * ring drawn under a slightly smaller disc — only the outer edge of the union survives. Chargers
 * being built count too. Null when there's no charger of that kind. */
function coverageImage(kind: ChargingKind): { url: string; coordinates: ImageCorners } | null {
  const sites = publicCharging.getSites().filter((s) => s.kind === kind);
  if (sites.length === 0) return null;
  const reachM = REACH_M[kind];
  const lat0 = sites.reduce((sum, s) => sum + s.lat, 0) / sites.length;
  const mPerDegLat = 111_320;
  const mPerDegLon = mPerDegLat * Math.cos((lat0 * Math.PI) / 180);
  const padM = reachM + 20;
  const west = Math.min(...sites.map((s) => s.lon)) - padM / mPerDegLon;
  const east = Math.max(...sites.map((s) => s.lon)) + padM / mPerDegLon;
  const south = Math.min(...sites.map((s) => s.lat)) - padM / mPerDegLat;
  const north = Math.max(...sites.map((s) => s.lat)) + padM / mPerDegLat;
  const widthM = (east - west) * mPerDegLon;
  const heightM = (north - south) * mPerDegLat;
  const pxM = Math.max(COVERAGE_METRES_PER_PX, widthM / COVERAGE_MAX_PX, heightM / COVERAGE_MAX_PX);
  const canvas = document.createElement("canvas");
  canvas.width = Math.ceil(widthM / pxM);
  canvas.height = Math.ceil(heightM / pxM);
  const ctx = canvas.getContext("2d");
  if (!ctx) return null;

  const disc = (s: ChargingSite, radiusPx: number) => {
    ctx.beginPath();
    ctx.arc(((s.lon - west) * mPerDegLon) / pxM, ((north - s.lat) * mPerDegLat) / pxM, radiusPx, 0, 2 * Math.PI);
    ctx.fill();
  };
  ctx.fillStyle = "rgb(255, 0, 0)"; // red: the outline ring
  for (const s of sites) disc(s, reachM / pxM);
  ctx.fillStyle = "rgb(0, 255, 0)"; // green: the inside
  for (const s of sites) disc(s, reachM / pxM - COVERAGE_OUTLINE_PX);

  const image = ctx.getImageData(0, 0, canvas.width, canvas.height);
  const d = image.data;
  const hex = COVERAGE_COLOR[kind];
  const [cr, cg, cb] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16));
  for (let i = 0; i < d.length; i += 4) {
    const a = d[i + 3] / 255;
    if (a === 0) continue;
    const outline = (d[i] / 255) * a;
    const inside = (d[i + 1] / 255) * a;
    d[i] = cr;
    d[i + 1] = cg;
    d[i + 2] = cb;
    d[i + 3] = Math.round(255 * Math.min(1, outline * COVERAGE_OUTLINE_ALPHA + inside * COVERAGE_FILL_ALPHA));
  }
  ctx.putImageData(image, 0, 0);
  return {
    url: canvas.toDataURL(),
    coordinates: [
      [west, north],
      [east, north],
      [east, south],
      [west, south],
    ],
  };
}

/** Hides the basemap's own building layers so only our extruded volumes show —
 * avoids visibly doubled/misaligned outlines between the basemap and our own data,
 * which come from different survey vintages. */
function hideBasemapBuildingLayers(map: MlMap): void {
  const layers = map.getStyle().layers ?? [];
  for (const layer of layers) {
    const sourceLayer = "source-layer" in layer ? layer["source-layer"] : undefined;
    if (/build/i.test(layer.id) || (sourceLayer && /build/i.test(sourceLayer))) {
      map.setLayoutProperty(layer.id, "visibility", "none");
    }
  }
}

// The only basemap text layer we keep: street names, set along the road lines.
const STREET_NAME_LAYER_ID = "transportation_label";
// Icon layers hidden outright: their symbol is just a box around the (removed) text.
const HIDDEN_ICON_LAYER_IDS = new Set(["road_number"]);

/** Strips every piece of basemap writing except street names — place, station, POI,
 * park, water, peak/elevation, route-number and house-number labels — while keeping
 * the icons that share a layer with a label (station and POI symbols). Route-number
 * shields are dropped entirely — without their number they're empty boxes. */
function hideBasemapLabels(map: MlMap): void {
  for (const layer of map.getStyle().layers ?? []) {
    if (layer.type !== "symbol" || layer.id === STREET_NAME_LAYER_ID) continue;
    if (layer.layout?.["icon-image"] && !HIDDEN_ICON_LAYER_IDS.has(layer.id)) {
      map.setLayoutProperty(layer.id, "text-field", "");
    } else {
      map.setLayoutProperty(layer.id, "visibility", "none");
    }
  }
}

// How much colour the basemap keeps (0 grey, 1 as swisstopo draws it): enough to tell rail,
// road, water and green apart, quiet enough that the data layers carry the colour.
const BASEMAP_SATURATION = 0.35;

function muteColor(color: string): string {
  const m = /^rgba?\(\s*([\d.]+)\s*,\s*([\d.]+)\s*,\s*([\d.]+)\s*(?:,\s*([\d.]+)\s*)?\)$/.exec(color);
  if (!m) return color;
  const [r, g, b] = [Number(m[1]), Number(m[2]), Number(m[3])];
  const grey = 0.299 * r + 0.587 * g + 0.114 * b;
  const mix = (c: number) => Math.round(grey + BASEMAP_SATURATION * (c - grey));
  return m[4] === undefined ? `rgb(${mix(r)}, ${mix(g)}, ${mix(b)})` : `rgba(${mix(r)}, ${mix(g)}, ${mix(b)}, ${m[4]})`;
}

function muteValue(value: unknown): unknown {
  if (typeof value === "string") return muteColor(value);
  if (Array.isArray(value)) return value.map(muteValue);
  if (value && typeof value === "object") return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, muteValue(v)]));
  return value;
}

/** Takes most of the colour out of the basemap's areas and lines, so it reads as a quiet
 * ground under the buildings and network layers. Labels and icons keep theirs. */
function muteBasemapColors(map: MlMap): void {
  for (const layer of map.getStyle().layers ?? []) {
    if (layer.type !== "fill" && layer.type !== "line" && layer.type !== "background") continue;
    const paint = (layer as { paint?: Record<string, unknown> }).paint ?? {};
    for (const [key, value] of Object.entries(paint)) {
      if (key.endsWith("color")) map.setPaintProperty(layer.id, key as "fill-color", muteValue(value) as string);
    }
  }
}

interface ColorScales {
  powerMinW: number;
  powerMaxW: number;
  maxSolarCapacityKw: number;
}

function colorExpression(mode: ColorMode, selectedEgid: string | null, scales: ColorScales): MapExpr {
  const byMode: Record<ColorMode, () => MapExpr | string> = {
    none: () => DEFAULT_COLOR,
    category: () => legendMatchExpression("category", CATEGORY_LEGEND),
    heating: () => legendMatchExpression("heating", HEATING_LEGEND),
    districtHeat: () => legendMatchExpression("network", DISTRICT_HEAT_LEGEND),
    evCharging: () => legendMatchExpression("charging", EV_CHARGING_LEGEND),
    zoning: () => ZONING_BUILDING_COLOR,
    publicBuildings: () => legendMatchExpression("publicStatus", PUBLIC_BUILDINGS_LEGEND),
    groundHeat: () => legendMatchExpression("groundStatus", GROUND_HEAT_LEGEND),
    // With an area selected, buildings elsewhere fade so its own stand out.
    grid: () => ["case", ["==", ["get", "gridStatus"], "dimmed"], GRID_DIMMED_COLOR, legendMatchExpression("gridStatus", GRID_LEGEND)],
    age: () => legendMatchExpression("age", AGE_LEGEND),
    insulation: () => legendMatchExpression("energyClass", INSULATION_LEGEND),
    power: () => powerColorExpression(scales.powerMinW, scales.powerMaxW),
    solar: () => solarColorExpression(scales.maxSolarCapacityKw),
  };
  const base = byMode[mode]();
  return [
    "case",
    ["==", ["get", "egid"], selectedEgid ?? "__none__"],
    SELECTED_COLOR,
    ["==", ["get", "constructing"], 1],
    CONSTRUCTION_COLOR,
    base,
  ];
}

/** maplibre-gl's own expression-spec types are a deep literal-tuple union that a
 * runtime-built JSON-DSL array can't structurally satisfy — cast at this one
 * boundary rather than fighting it, since the expressions themselves are already
 * verified against the real style. */
function ml(expr: MapExpr): any {
  return expr;
}

export interface MapViewProps {
  // Never construct a new object for this to reflect live state (e.g. a
  // merged solar-adoption plant list) — the mount effect below is keyed on
  // its reference and tears down/rebuilds the whole MapLibre map on change.
  // Live per-building state (power, heating, solar) is instead pushed into
  // the already-created map by the ticking effects further down.
  dataset: MunicipalityDataset;
  selectedEgid: string | null;
  onSelectBuilding: (egid: string) => void;
  colorMode: ColorMode;
  /** WASD/QE/RF camera keys; off while a modal is open. */
  keyboardEnabled: boolean;
}

export function MapView({ dataset, selectedEgid, onSelectBuilding, colorMode, keyboardEnabled }: MapViewProps) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<MlMap | null>(null);
  useMapKeyboard(mapRef, keyboardEnabled);
  const onSelectBuildingRef = useRef(onSelectBuilding);
  onSelectBuildingRef.current = onSelectBuilding;
  const selectedEgidRef = useRef(selectedEgid);
  selectedEgidRef.current = selectedEgid;
  const colorModeRef = useRef(colorMode);
  colorModeRef.current = colorMode;
  const polygonsRef = useRef<BuildingFeatureCollection | null>(null);
  const pointsRef = useRef<BuildingFeatureCollection | null>(null);
  const lastPowerMinWRef = useRef(0);
  const lastPowerMaxWRef = useRef(0);
  const maxSolarCapacityKwRef = useRef(0);
  const coverageKeysRef = useRef(new Map<ChargingKind, string>());

  useEffect(() => {
    if (!containerRef.current) return;

    // Start over the middle of town: the median position of its homes (a mean or the first
    // building could land on an outlying farm or an empty field).
    const homes = dataset.buildings.filter((b) => b.dwellings.length > 0);
    const median = (values: number[]) => values.sort((a, b) => a - b)[Math.floor(values.length / 2)];
    const center: [number, number] = homes.length > 0 ? [median(homes.map((b) => b.lon)), median(homes.map((b) => b.lat))] : [8.4479, 47.3967];

    const map = new MlMap({
      container: containerRef.current,
      style: BASEMAP_STYLE_URL,
      center,
      zoom: 16,
      pitch: 50,
      bearing: -15,
    });
    mapRef.current = map;
    if (import.meta.env.DEV) Object.assign(window, { __map: map });
    map.addControl(new NavigationControl({ visualizePitch: true }), "bottom-left");

    const geojson = buildingsToGeoJSON(stock.getAll(), effectivePowerPlantsAt(stock.getAll(), dataset.powerPlants, simClock.getSimTimeMs()), simClock.getSimTimeMs());
    polygonsRef.current = geojson.polygons;
    pointsRef.current = geojson.points;
    maxSolarCapacityKwRef.current = Math.max(
      0,
      ...geojson.polygons.features.map((f) => f.properties.solarCapacityKw),
      ...geojson.points.features.map((f) => f.properties.solarCapacityKw),
    );

    // "style.load" fires once the style is parsed and sources are registered — the
    // right point to add our own source/layers. The "load" event additionally waits
    // for every style source (including swisstopo's unrelated hillshade/relief
    // layers) to finish loading tiles, which can take much longer or stall.
    map.on("style.load", () => {
      hideBasemapBuildingLayers(map);
      hideBasemapLabels(map);
      muteBasemapColors(map);

      if (dataset.boundary) addBoundaryMask(map, dataset.boundary);

      // District heating: streets and the heat source, under the buildings, shown only in that layer.
      const dhVisibility = colorModeRef.current === "districtHeat" ? "visible" : "none";
      map.addSource(STREET_SOURCE_ID, {
        type: "geojson",
        data: streetsToGeoJSON(simClock.getSimTimeMs()),
      });
      map.addLayer({
        id: STREET_UNPIPED_LAYER_ID,
        type: "line",
        source: STREET_SOURCE_ID,
        filter: ["==", ["get", "state"], "none"],
        layout: { visibility: dhVisibility, "line-cap": "round", "line-join": "round" },
        // A clear band along every street the network could be extended along, lighter than the
        // network itself so the two don't compete.
        paint: { "line-color": STREET_UNPIPED_COLOR, "line-width": metresWide(NETWORK_LINE_WIDTH_M * 0.6, 3) as never, "line-opacity": 0.45 },
      });
      map.addLayer({
        id: STREET_LINE_LAYER_ID,
        type: "line",
        source: STREET_SOURCE_ID,
        filter: ["in", ["get", "state"], ["literal", ["piped", "planned", "plannedUnconnected"]]],
        layout: { visibility: dhVisibility, "line-cap": "round", "line-join": "round" },
        paint: {
          "line-color": ["match", ["get", "state"], "planned", PIPE_PLANNED_COLOR, "plannedUnconnected", PIPE_UNCONNECTED_COLOR, PIPE_COLOR],
          "line-width": metresWide(NETWORK_LINE_WIDTH_M, 4) as never,
        },
      });
      map.addLayer({
        id: STREET_CONSTRUCTION_LAYER_ID,
        type: "line",
        source: STREET_SOURCE_ID,
        filter: ["==", ["get", "state"], "construction"],
        layout: { visibility: dhVisibility, "line-join": "round" },
        paint: {
          "line-color": PIPE_UNDER_CONSTRUCTION_COLOR,
          "line-width": metresWide(NETWORK_LINE_WIDTH_M, 4) as never,
          "line-dasharray": [1.5, 1],
        },
      });
      map.addLayer({
        id: STREET_HIT_LAYER_ID,
        type: "line",
        source: STREET_SOURCE_ID,
        layout: { visibility: dhVisibility },
        paint: { "line-color": "#000", "line-width": metresWide(NETWORK_LINE_WIDTH_M, 16) as never, "line-opacity": 0 },
      });
      map.addSource(DH_SOURCE_SOURCE_ID, { type: "geojson", data: districtHeatSourceGeoJSON() as never });
      map.addLayer({
        id: DH_TRUNK_LAYER_ID,
        type: "line",
        source: DH_SOURCE_SOURCE_ID,
        filter: ["==", ["geometry-type"], "LineString"],
        layout: { visibility: dhVisibility },
        paint: { "line-color": PIPE_COLOR, "line-width": 4, "line-dasharray": [2, 1.5], "line-opacity": 0.8 },
      });
      map.addLayer({
        id: DH_PLANT_LAYER_ID,
        type: "circle",
        source: DH_SOURCE_SOURCE_ID,
        filter: ["==", ["geometry-type"], "Point"],
        layout: { visibility: dhVisibility },
        paint: { "circle-radius": 9, "circle-color": PIPE_COLOR, "circle-stroke-color": "#fff", "circle-stroke-width": 2 },
      });

      // Zoning: the parcels on the ground, under the buildings, shown only in that layer.
      const zoneVisibility = colorModeRef.current === "zoning" ? "visible" : "none";
      if (!map.hasImage(STRIPE_DH)) map.addImage(STRIPE_DH, stripeImage(DH_PRIORITY_COLOR, true));
      if (!map.hasImage(STRIPE_STANDARD)) map.addImage(STRIPE_STANDARD, stripeImage(HIGH_STANDARD_COLOR, false));
      map.addSource(ZONE_SOURCE_ID, { type: "geojson", data: zoneParcelsGeoJSON(simClock.getSimTimeMs()) });
      map.addLayer({
        id: ZONE_FILL_LAYER_ID,
        type: "fill",
        source: ZONE_SOURCE_ID,
        layout: { visibility: zoneVisibility },
        paint: {
          "fill-color": ml(legendMatchExpression("zone", ZONING_LEGEND)),
          // Denser where more floors are allowed.
          "fill-opacity": ["+", 0.3, ["*", 0.18, ["get", "extraFloors"]]],
        },
      });
      map.addLayer({
        id: ZONE_DH_LAYER_ID,
        type: "fill",
        source: ZONE_SOURCE_ID,
        filter: ["==", ["get", "dhPriority"], 1],
        layout: { visibility: zoneVisibility },
        paint: { "fill-pattern": STRIPE_DH },
      });
      map.addLayer({
        id: ZONE_STANDARD_LAYER_ID,
        type: "fill",
        source: ZONE_SOURCE_ID,
        filter: ["==", ["get", "highStandard"], 1],
        layout: { visibility: zoneVisibility },
        paint: { "fill-pattern": STRIPE_STANDARD },
      });
      map.addLayer({
        id: ZONE_LINE_LAYER_ID,
        type: "line",
        source: ZONE_SOURCE_ID,
        layout: { visibility: zoneVisibility, "line-join": "round" },
        paint: { "line-color": ml(legendMatchExpression("zone", ZONING_LEGEND)), "line-width": 1.5 },
      });
      map.addLayer({
        id: ZONE_MARK_LAYER_ID,
        type: "line",
        source: ZONE_SOURCE_ID,
        filter: ["!=", ["get", "mark"], "none"],
        layout: { visibility: zoneVisibility, "line-join": "round" },
        paint: { "line-color": ["match", ["get", "mark"], "selected", SELECTED_COLOR, ZONING_PENDING_COLOR], "line-width": 3.5 },
      });

      // District-heat priority zones, for the district heating layer: under its streets.
      map.addLayer(
        {
          id: DH_PRIORITY_FILL_LAYER_ID,
          type: "fill",
          source: ZONE_SOURCE_ID,
          filter: ["==", ["get", "dhPriority"], 1],
          layout: { visibility: dhVisibility },
          paint: { "fill-pattern": STRIPE_DH, "fill-opacity": 0.7 },
        },
        STREET_UNPIPED_LAYER_ID,
      );
      map.addLayer(
        {
          id: DH_PRIORITY_LINE_LAYER_ID,
          type: "line",
          source: ZONE_SOURCE_ID,
          filter: ["==", ["get", "dhPriority"], 1],
          layout: { visibility: dhVisibility, "line-join": "round" },
          paint: { "line-color": DH_PRIORITY_COLOR, "line-width": 2 },
        },
        STREET_UNPIPED_LAYER_ID,
      );

      // Grid: each station's zone, on the ground under the buildings, shown only in that layer.
      const gridVisibility = colorModeRef.current === "grid" ? "visible" : "none";
      map.addSource(GRID_ZONE_SOURCE_ID, { type: "geojson", data: { type: "FeatureCollection", features: [] } });
      map.addLayer({
        id: GRID_ZONE_FILL_LAYER_ID,
        type: "fill",
        source: GRID_ZONE_SOURCE_ID,
        filter: ["==", ["get", "part"], "fill"],
        layout: { visibility: gridVisibility },
        // Without antialiasing: a zone is many small cells side by side, which would show hairline seams.
        paint: {
          "fill-color": ml(legendMatchExpression("bucket", GRID_LEGEND)),
          "fill-opacity": ["case", ["==", ["get", "selected"], 1], 0.3, 0.14],
          "fill-antialias": false,
        },
      });
      map.addLayer({
        id: GRID_ZONE_LINE_LAYER_ID,
        type: "line",
        source: GRID_ZONE_SOURCE_ID,
        filter: ["==", ["get", "part"], "edge"],
        layout: { visibility: gridVisibility, "line-join": "round", "line-cap": "round" },
        paint: { "line-color": "#52514e", "line-width": 1.2, "line-opacity": 0.7 },
      });
      map.addLayer({
        id: GRID_ZONE_SELECTED_LAYER_ID,
        type: "line",
        source: GRID_ZONE_SOURCE_ID,
        filter: ["all", ["==", ["get", "part"], "edge"], ["==", ["get", "selected"], 1]],
        layout: { visibility: gridVisibility, "line-join": "round", "line-cap": "round" },
        paint: { "line-color": SELECTED_COLOR, "line-width": 3.5 },
      });

      // The heat-use atlas (the Ground heat layer): on the ground, under the buildings.
      const heatUseVisibility = colorModeRef.current === "groundHeat" ? "visible" : "none";
      map.addSource(HEAT_USE_SOURCE_ID, { type: "geojson", data: heatUseGeoJSON() as never });
      map.addLayer({
        id: HEAT_USE_FILL_LAYER_ID,
        type: "fill",
        source: HEAT_USE_SOURCE_ID,
        filter: ["!=", ["get", "bucket"], "tunnel"],
        layout: { visibility: heatUseVisibility },
        paint: { "fill-color": ml(legendMatchExpression("bucket", HEAT_USE_LEGEND)), "fill-opacity": 0.22 },
      });
      map.addLayer({
        id: HEAT_USE_LINE_LAYER_ID,
        type: "line",
        source: HEAT_USE_SOURCE_ID,
        filter: ["!=", ["get", "bucket"], "tunnel"],
        layout: { visibility: heatUseVisibility, "line-join": "round" },
        paint: { "line-color": ml(legendMatchExpression("bucket", HEAT_USE_LEGEND)), "line-width": 1.5, "line-opacity": 0.8 },
      });
      map.addLayer({
        id: TUNNEL_LAYER_ID,
        type: "line",
        source: HEAT_USE_SOURCE_ID,
        filter: ["==", ["get", "bucket"], "tunnel"],
        layout: { visibility: heatUseVisibility, "line-cap": "round" },
        paint: { "line-color": TUNNEL_COLOR, "line-width": 3, "line-opacity": 0.8 },
      });

      // Charger coverage (the EV charging layer's toggles): on the ground, under the buildings.
      for (const kind of COVERAGE_KINDS) {
        map.addSource(coverageId(kind), {
          type: "image",
          url: EMPTY_PNG,
          coordinates: [
            [center[0] - 0.001, center[1] + 0.001],
            [center[0] + 0.001, center[1] + 0.001],
            [center[0] + 0.001, center[1] - 0.001],
            [center[0] - 0.001, center[1] - 0.001],
          ],
        });
        map.addLayer({
          id: coverageId(kind),
          type: "raster",
          source: coverageId(kind),
          layout: { visibility: "none" },
          paint: { "raster-opacity": 1, "raster-fade-duration": 0, "raster-resampling": "linear" },
        });
      }

      map.addSource(POLY_SOURCE_ID, { type: "geojson", data: geojson.polygons });
      map.addLayer({
        id: POLY_LAYER_ID,
        type: "fill-extrusion",
        source: POLY_SOURCE_ID,
        paint: {
          "fill-extrusion-color": ml(
            colorExpression("none", selectedEgidRef.current, { powerMinW: 0, powerMaxW: 0, maxSolarCapacityKw: 0 }),
          ),
          "fill-extrusion-height": ["get", "heightM"],
          "fill-extrusion-base": 0,
          "fill-extrusion-opacity": 0.9,
        },
      });

      map.addSource(POINT_SOURCE_ID, { type: "geojson", data: geojson.points });
      map.addLayer({
        id: POINT_LAYER_ID,
        type: "circle",
        source: POINT_SOURCE_ID,
        paint: {
          "circle-radius": 5,
          "circle-color": ml(
            colorExpression("none", selectedEgidRef.current, { powerMinW: 0, powerMaxW: 0, maxSolarCapacityKw: 0 }),
          ),
          "circle-stroke-color": "#5b7185",
          "circle-stroke-width": 1,
        },
      });

      // Public charging: every site, and the reach of the selected one — drawn over the buildings
      // (they sit at street level, easily hidden behind a block), shown only in that layer.
      const evVisibility = colorModeRef.current === "evCharging" ? "visible" : "none";
      map.addSource(CHARGER_REACH_SOURCE_ID, { type: "geojson", data: chargingReachGeoJSON(null) });
      map.addLayer({
        id: CHARGER_REACH_FILL_LAYER_ID,
        type: "fill",
        source: CHARGER_REACH_SOURCE_ID,
        layout: { visibility: evVisibility },
        paint: { "fill-color": "#2a78d6", "fill-opacity": 0.1 },
      });
      map.addLayer({
        id: CHARGER_REACH_LINE_LAYER_ID,
        type: "line",
        source: CHARGER_REACH_SOURCE_ID,
        layout: { visibility: evVisibility },
        paint: { "line-color": "#2a78d6", "line-width": 2.5, "line-opacity": 0.85 },
      });
      map.addSource(CHARGER_SOURCE_ID, { type: "geojson", data: chargingSitesToGeoJSON(simClock.getSimTimeMs()) });
      addChargerIcons(map);
      const chargerRadius: unknown = ["interpolate", ["linear"], ["get", "points"], 1, 6, 12, 12];
      const chargerFill: unknown = [
        "case",
        ["==", ["get", "building"], 1],
        CONSTRUCTION_COLOR,
        ["interpolate", ["linear"], ["get", "utilization"], 0, CHARGER_USE_RAMP[0], 0.7, CHARGER_USE_RAMP[1], 1, CHARGER_USE_RAMP[2]],
      ];
      const chargerOpacity: unknown = ["case", ["==", ["get", "building"], 1], 0.65, 1];
      // The ring says what kind of site it is (the shape already says who runs it).
      const ringColor: unknown = ["case", ["==", ["get", "kind"], "fleet"], LORRY_PARK_RING, HUB_RING_COLOR];
      const isHub: unknown = ["in", ["get", "kind"], ["literal", ["dc", "fleet"]]];
      // Municipal: circles.
      map.addLayer({
        id: CHARGER_HUB_LAYER_ID,
        type: "circle",
        source: CHARGER_SOURCE_ID,
        filter: ["all", ["==", ["get", "municipal"], 1], isHub] as never,
        layout: { visibility: evVisibility },
        paint: {
          "circle-radius": ["+", chargerRadius, HUB_RING_GAP_PX + HUB_RING_WIDTH_PX / 2] as never,
          "circle-color": "rgba(0,0,0,0)",
          "circle-stroke-color": ringColor as never,
          "circle-stroke-width": ["case", ["==", ["get", "kind"], "fleet"], LORRY_RING_WIDTH_PX, HUB_RING_WIDTH_PX],
        },
      });
      map.addLayer({
        id: CHARGER_LAYER_ID,
        type: "circle",
        source: CHARGER_SOURCE_ID,
        filter: ["==", ["get", "municipal"], 1],
        layout: { visibility: evVisibility },
        paint: {
          "circle-radius": chargerRadius as never,
          "circle-color": chargerFill as never,
          "circle-opacity": chargerOpacity as never,
          "circle-stroke-color": ["case", ["==", ["get", "selected"], 1], SELECTED_COLOR, MUNICIPAL_CHARGER_STROKE],
          "circle-stroke-width": ["case", ["==", ["get", "selected"], 1], 4, 2.5],
        },
      });
      // Private: squares, the same size as a circle for the same number of points.
      const squareSize: unknown = ["interpolate", ["linear"], ["get", "points"], 1, 0.5, 12, 1];
      map.addLayer({
        id: CHARGER_SQUARE_HUB_LAYER_ID,
        type: "symbol",
        source: CHARGER_SOURCE_ID,
        filter: ["all", ["==", ["get", "municipal"], 0], isHub] as never,
        layout: {
          visibility: evVisibility,
          "icon-image": SQUARE_FRAME_ICON,
          "icon-size": squareSize as never,
          "icon-allow-overlap": true,
          "icon-ignore-placement": true,
        },
        paint: { "icon-color": ringColor as never },
      });
      map.addLayer({
        id: CHARGER_SQUARE_LAYER_ID,
        type: "symbol",
        source: CHARGER_SOURCE_ID,
        filter: ["==", ["get", "municipal"], 0],
        layout: {
          visibility: evVisibility,
          "icon-image": SQUARE_ICON,
          "icon-size": squareSize as never,
          "icon-allow-overlap": true,
          "icon-ignore-placement": true,
        },
        paint: {
          "icon-color": chargerFill as never,
          "icon-opacity": chargerOpacity as never,
          "icon-halo-color": ["case", ["==", ["get", "selected"], 1], SELECTED_COLOR, PRIVATE_CHARGER_STROKE],
          "icon-halo-width": ["case", ["==", ["get", "selected"], 1], 4, 1.5],
        },
      });

      // Grid: a marker per transformer station, over the buildings, shown only in that layer.
      map.addSource(STATION_SOURCE_ID, { type: "geojson", data: stationsGeoJSON(simClock.getSimTimeMs()) });
      map.addLayer({
        id: STATION_LAYER_ID,
        type: "circle",
        source: STATION_SOURCE_ID,
        layout: { visibility: colorModeRef.current === "grid" ? "visible" : "none" },
        paint: {
          "circle-radius": ["interpolate", ["linear"], ["get", "capacityKw"], 250, 6, 4000, 14],
          "circle-color": ml(legendMatchExpression("bucket", GRID_LEGEND)),
          "circle-stroke-color": ["case", ["==", ["get", "selected"], 1], SELECTED_COLOR, "#1a1a1a"],
          "circle-stroke-width": ["case", ["==", ["get", "selected"], 1], 4, 2],
        },
      });

      if (dataset.boundary) addBoundaryLine(map, dataset.boundary);

      // One handler for every click: in the district heating layer a street takes precedence (that
      // layer is where extensions are planned), otherwise whichever building is under the cursor.
      map.on("click", (e: MapMouseEvent) => {
        if (colorModeRef.current === "grid") {
          // A station selects its area; a building selects itself and its area.
          const { x, y } = e.point;
          const r = STREET_CLICK_TOLERANCE_PX;
          const station = map.queryRenderedFeatures(
            [
              [x - r, y - r],
              [x + r, y + r],
            ],
            { layers: [STATION_LAYER_ID] },
          )[0];
          if (station) {
            grid.select(Number(station.properties?.id));
            return;
          }
          const hit = map.queryRenderedFeatures(e.point, { layers: [POLY_LAYER_ID, POINT_LAYER_ID] })[0];
          const b = hit ? stock.lookup(String(hit.properties?.egid)) : undefined;
          if (b) grid.select(grid.areaIdOf(b));
        }
        if (colorModeRef.current === "zoning") {
          const parcel = map.queryRenderedFeatures(e.point, { layers: [ZONE_FILL_LAYER_ID] })[0];
          if (parcel) zoning.toggle(String(parcel.properties?.id));
          return;
        }
        if (colorModeRef.current === "evCharging") {
          const placing = publicCharging.getPlacing();
          if (placing) {
            publicCharging.build(placing.kind, e.lngLat.lng, e.lngLat.lat, simClock.getSimTimeMs(), placing.points);
            return;
          }
          const { x, y } = e.point;
          const r = STREET_CLICK_TOLERANCE_PX;
          const hit = map.queryRenderedFeatures(
            [
              [x - r, y - r],
              [x + r, y + r],
            ],
            { layers: CHARGER_HIT_LAYER_IDS },
          )[0];
          if (hit) {
            publicCharging.select(String(hit.properties?.id));
            return;
          }
        }
        if (colorModeRef.current === "districtHeat") {
          const { x, y } = e.point;
          const r = STREET_CLICK_TOLERANCE_PX;
          const hit = map.queryRenderedFeatures(
            [
              [x - r, y - r],
              [x + r, y + r],
            ],
            { layers: [STREET_HIT_LAYER_ID] },
          )[0];
          if (hit) {
            districtHeat.toggle(Number(hit.properties?.id));
            return;
          }
        }
        const building = map.queryRenderedFeatures(e.point, { layers: [POLY_LAYER_ID, POINT_LAYER_ID] })[0];
        const egid = building?.properties?.egid as string | undefined;
        if (egid) onSelectBuildingRef.current(egid);
      });
      for (const layer of CHARGER_HIT_LAYER_IDS) {
        map.on("mouseenter", layer, () => (map.getCanvas().style.cursor = "pointer"));
        map.on("mouseleave", layer, () => (map.getCanvas().style.cursor = publicCharging.getPlacing() ? "crosshair" : ""));
      }
      map.on("mouseenter", STREET_HIT_LAYER_ID, () => (map.getCanvas().style.cursor = "pointer"));
      map.on("mouseleave", STREET_HIT_LAYER_ID, () => (map.getCanvas().style.cursor = ""));
      map.on("mouseenter", POLY_LAYER_ID, () => (map.getCanvas().style.cursor = "pointer"));
      map.on("mouseleave", POLY_LAYER_ID, () => (map.getCanvas().style.cursor = ""));
      map.on("mouseenter", POINT_LAYER_ID, () => (map.getCanvas().style.cursor = "pointer"));
      map.on("mouseleave", POINT_LAYER_ID, () => (map.getCanvas().style.cursor = ""));
    });

    return () => {
      map.remove();
      mapRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dataset]);

  // The stock changed (something was permitted, started, finished or demolished): redraw the
  // building set from scratch. Cheap next to how rarely it happens.
  useEffect(() => {
    return stock.subscribe(() => {
      const map = mapRef.current;
      const polySource = map?.getSource(POLY_SOURCE_ID) as GeoJSONSource | undefined;
      const pointSource = map?.getSource(POINT_SOURCE_ID) as GeoJSONSource | undefined;
      if (!polySource || !pointSource) return;
      const simTimeMs = simClock.getSimTimeMs();
      const plants = effectivePowerPlantsAt(stock.getAll(), dataset.powerPlants, simTimeMs);
      const previousPowerW = new Map<string, number>();
      for (const f of [...(polygonsRef.current?.features ?? []), ...(pointsRef.current?.features ?? [])]) previousPowerW.set(f.properties.egid, f.properties.powerW);
      const fresh = buildingsToGeoJSON(stock.getAll(), plants, simTimeMs, previousPowerW);
      polygonsRef.current = fresh.polygons;
      pointsRef.current = fresh.points;
      maxSolarCapacityKwRef.current = Math.max(
        0,
        ...fresh.polygons.features.map((f) => f.properties.solarCapacityKw),
        ...fresh.points.features.map((f) => f.properties.solarCapacityKw),
      );
      polySource.setData(fresh.polygons);
      pointSource.setData(fresh.points);
    });
  }, [dataset]);

  // Live power-draw mode: periodically recompute every building's current device
  // draw and push it into the source data + a fresh color scale. Devices are pure
  // functions of (seed, simTime), so this is a cheap recomputation, not a simulation
  // that needs to run continuously in the background.
  useEffect(() => {
    const map = mapRef.current;
    if (!map || colorMode !== "power") return;

    const tick = () => {
      const polySource = map.getSource(POLY_SOURCE_ID) as GeoJSONSource | undefined;
      const pointSource = map.getSource(POINT_SOURCE_ID) as GeoJSONSource | undefined;
      const polyData = polygonsRef.current;
      const pointData = pointsRef.current;
      if (!polySource || !pointSource || !polyData || !pointData) return;

      const simTimeMs = simClock.getSimTimeMs();
      const snowCoverCm = snowDepthCm(simTimeMs);
      const plants = effectivePowerPlantsAt(stock.getAll(), dataset.powerPlants, simTimeMs);
      let minW = 0;
      let maxW = 0;
      for (const feature of [...polyData.features, ...pointData.features]) {
        const building = stock.lookup(feature.properties.egid);
        const power = building ? buildingPowerW(building, simTimeMs, plants, snowCoverCm) : 0;
        feature.properties.powerW = power;
        if (power > maxW) maxW = power;
        if (power < minW) minW = power;
      }
      lastPowerMinWRef.current = minW;
      lastPowerMaxWRef.current = maxW;

      polySource.setData(polyData);
      pointSource.setData(pointData);
      const expr = ml(
        colorExpression("power", selectedEgidRef.current, {
          powerMinW: minW,
          powerMaxW: maxW,
          maxSolarCapacityKw: maxSolarCapacityKwRef.current,
        }),
      );
      map.setPaintProperty(POLY_LAYER_ID, "fill-extrusion-color", expr);
      map.setPaintProperty(POINT_LAYER_ID, "circle-color", expr);
    };

    tick();
    const interval = setInterval(tick, POWER_TICK_MS);
    return () => clearInterval(interval);
  }, [colorMode, dataset]);

  // Live heating mode: like the power-draw tick above, but far less frequent —
  // stock renewal (heatingRenewal.ts) only ever changes a building's heating
  // system years apart in simulated time, so there's nothing to gain from
  // checking every 1.5s. Without this, the "Heating" layer would freeze at
  // whatever GWR recorded at load time and never show a renewal.
  useEffect(() => {
    const map = mapRef.current;
    if (!map || colorMode !== "heating") return;

    const tick = () => {
      const polySource = map.getSource(POLY_SOURCE_ID) as GeoJSONSource | undefined;
      const pointSource = map.getSource(POINT_SOURCE_ID) as GeoJSONSource | undefined;
      const polyData = polygonsRef.current;
      const pointData = pointsRef.current;
      if (!polySource || !pointSource || !polyData || !pointData) return;

      const simTimeMs = simClock.getSimTimeMs();
      for (const feature of [...polyData.features, ...pointData.features]) {
        const building = stock.lookup(feature.properties.egid);
        if (building) feature.properties.heating = buildingHeatingBucketAt(building, simTimeMs);
      }

      polySource.setData(polyData);
      pointSource.setData(pointData);
    };

    tick();
    const interval = setInterval(tick, HEATING_TICK_MS);
    return () => clearInterval(interval);
  }, [colorMode, dataset]);

  // Live insulation mode: like heating's tick — retrofits are years apart, so a slow repaint suffices.
  useEffect(() => {
    const map = mapRef.current;
    if (!map || colorMode !== "insulation") return;

    const tick = () => {
      const polySource = map.getSource(POLY_SOURCE_ID) as GeoJSONSource | undefined;
      const pointSource = map.getSource(POINT_SOURCE_ID) as GeoJSONSource | undefined;
      const polyData = polygonsRef.current;
      const pointData = pointsRef.current;
      if (!polySource || !pointSource || !polyData || !pointData) return;

      const simTimeMs = simClock.getSimTimeMs();
      for (const feature of [...polyData.features, ...pointData.features]) {
        const building = stock.lookup(feature.properties.egid);
        if (building) feature.properties.energyClass = energyClassAt(building, simTimeMs);
      }
      polySource.setData(polyData);
      pointSource.setData(pointData);
    };

    tick();
    const interval = setInterval(tick, HEATING_TICK_MS);
    return () => clearInterval(interval);
  }, [colorMode, dataset]);

  // Live solar mode: like heating's tick above, but for solarAdoption.ts's
  // simulated installations — GWR's real Pronovo plants are baked into the
  // initial geojson at mount (see the [dataset]-keyed effect), but a new
  // adoption only ever shows up here, live, once decided. The color scale's
  // own ceiling can grow over time as bigger installs get adopted, so it's
  // recomputed every tick rather than fixed at the initial mount-time max.
  useEffect(() => {
    const map = mapRef.current;
    if (!map || colorMode !== "solar") return;

    const tick = () => {
      const polySource = map.getSource(POLY_SOURCE_ID) as GeoJSONSource | undefined;
      const pointSource = map.getSource(POINT_SOURCE_ID) as GeoJSONSource | undefined;
      const polyData = polygonsRef.current;
      const pointData = pointsRef.current;
      if (!polySource || !pointSource || !polyData || !pointData) return;

      const simTimeMs = simClock.getSimTimeMs();
      const plants = effectivePowerPlantsAt(stock.getAll(), dataset.powerPlants, simTimeMs);
      const solarByEgid = solarCapacityByEgid(plants);
      let maxKw = 0;
      for (const feature of [...polyData.features, ...pointData.features]) {
        const building = stock.lookup(feature.properties.egid);
        const kw = building ? (solarByEgid.get(building.egid) ?? 0) : 0;
        feature.properties.solarCapacityKw = kw;
        if (kw > maxKw) maxKw = kw;
      }
      maxSolarCapacityKwRef.current = maxKw;

      polySource.setData(polyData);
      pointSource.setData(pointData);
      const expr = ml(colorExpression("solar", selectedEgidRef.current, { powerMinW: 0, powerMaxW: 0, maxSolarCapacityKw: maxKw }));
      map.setPaintProperty(POLY_LAYER_ID, "fill-extrusion-color", expr);
      map.setPaintProperty(POINT_LAYER_ID, "circle-color", expr);
    };

    tick();
    const interval = setInterval(tick, SOLAR_TICK_MS);
    return () => clearInterval(interval);
  }, [colorMode, dataset]);

  // District heating layer: show the streets and the source, keep the network state and every
  // building's standing towards it current (extensions finish, buildings connect over time), and
  // redraw right away when an extension is picked or ordered.
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !map.getLayer(STREET_UNPIPED_LAYER_ID)) return;
    const layers = [
      STREET_UNPIPED_LAYER_ID,
      STREET_LINE_LAYER_ID,
      STREET_CONSTRUCTION_LAYER_ID,
      STREET_HIT_LAYER_ID,
      DH_TRUNK_LAYER_ID,
      DH_PLANT_LAYER_ID,
      DH_PRIORITY_FILL_LAYER_ID,
      DH_PRIORITY_LINE_LAYER_ID,
    ];
    const visible = colorMode === "districtHeat";
    for (const id of layers) map.setLayoutProperty(id, "visibility", visible ? "visible" : "none");
    if (!visible) return;

    const source = districtHeat.getSource();
    let label: Marker | null = null;
    if (source) {
      const el = document.createElement("div");
      el.className = "district-heat-source-label";
      el.textContent = `🏭 ${source.name}`;
      label = new Marker({ element: el, anchor: "left", offset: [14, 0] }).setLngLat([source.lon, source.lat]).addTo(map);
    }

    const tick = () => {
      (map.getSource(STREET_SOURCE_ID) as GeoJSONSource | undefined)?.setData(streetsToGeoJSON(simClock.getSimTimeMs()));
      (map.getSource(ZONE_SOURCE_ID) as GeoJSONSource | undefined)?.setData(zoneParcelsGeoJSON(simClock.getSimTimeMs())); // priority zones come into force over time
      const polySource = map.getSource(POLY_SOURCE_ID) as GeoJSONSource | undefined;
      const pointSource = map.getSource(POINT_SOURCE_ID) as GeoJSONSource | undefined;
      const polyData = polygonsRef.current;
      const pointData = pointsRef.current;
      if (!polySource || !pointSource || !polyData || !pointData) return;
      const simTimeMs = simClock.getSimTimeMs();
      for (const feature of [...polyData.features, ...pointData.features]) {
        const building = stock.lookup(feature.properties.egid);
        if (building) feature.properties.network = mapNetworkBucketAt(building, simTimeMs);
      }
      polySource.setData(polyData);
      pointSource.setData(pointData);
    };

    tick();
    const interval = setInterval(tick, DISTRICT_HEAT_TICK_MS);
    const unsubscribe = districtHeat.subscribe(tick);
    return () => {
      clearInterval(interval);
      unsubscribe();
      label?.remove();
    };
  }, [colorMode, dataset]);

  // A panel asked the map to look somewhere (a charger or a building picked from a list).
  useEffect(
    () =>
      mapFocus.subscribe(({ lon, lat, minZoom = 16 }) => {
        const map = mapRef.current;
        if (!map) return;
        // Land in the middle of the part of the map not covered by panels (the layer dock and a tool
        // drawer on the left, a building or dwelling panel on the right).
        const box = map.getContainer().getBoundingClientRect();
        const middle = box.left + box.width / 2;
        let left = 0;
        let right = 0;
        for (const el of document.querySelectorAll(".layer-dock, .tool-drawer, .panel")) {
          const r = el.getBoundingClientRect();
          if (r.width === 0) continue;
          if (r.left < middle && r.right < box.right - 40) left = Math.max(left, r.right - box.left);
          else if (r.left > middle) right = Math.max(right, box.right - r.left);
        }
        map.easeTo({ center: [lon, lat], zoom: Math.max(map.getZoom(), minZoom), offset: [(left - right) / 2, 0], duration: 700 });
      }),
    [],
  );

  // Public buildings layer: what the municipality has put on its own buildings, kept current as
  // solar and chargers are ordered and built.
  useEffect(() => {
    const map = mapRef.current;
    if (!map || colorMode !== "publicBuildings") return;
    const tick = () => {
      const polySource = map.getSource(POLY_SOURCE_ID) as GeoJSONSource | undefined;
      const pointSource = map.getSource(POINT_SOURCE_ID) as GeoJSONSource | undefined;
      const polyData = polygonsRef.current;
      const pointData = pointsRef.current;
      if (!polySource || !pointSource || !polyData || !pointData) return;
      for (const f of [...polyData.features, ...pointData.features]) {
        const b = stock.lookup(f.properties.egid);
        if (b) f.properties.publicStatus = publicBuildingBucket(b, dataset.powerPlants);
      }
      polySource.setData(polyData);
      pointSource.setData(pointData);
    };
    tick();
    const interval = setInterval(tick, SOLAR_TICK_MS);
    const unsubscribe = publicCharging.subscribe(tick);
    return () => {
      clearInterval(interval);
      unsubscribe();
    };
  }, [colorMode, dataset]);

  // Grid layer: every building by its area's load, and the stations; refreshed after each reading
  // and as reinforcements and batteries come into service.
  // Ground heat layer: the heat-use atlas under the buildings.
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !map.getLayer(HEAT_USE_FILL_LAYER_ID)) return;
    const visible = colorMode === "groundHeat" ? "visible" : "none";
    for (const id of [HEAT_USE_FILL_LAYER_ID, HEAT_USE_LINE_LAYER_ID, TUNNEL_LAYER_ID]) map.setLayoutProperty(id, "visibility", visible);
  }, [colorMode]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map || !map.getLayer(STATION_LAYER_ID)) return;
    const visible = colorMode === "grid";
    for (const id of [STATION_LAYER_ID, GRID_ZONE_FILL_LAYER_ID, GRID_ZONE_LINE_LAYER_ID, GRID_ZONE_SELECTED_LAYER_ID]) {
      map.setLayoutProperty(id, "visibility", visible ? "visible" : "none");
    }
    if (!visible) return;
    // Redrawn only when something shows differently: re-sending the same data makes the map
    // re-tile, which flickers.
    let shown = "";
    const tick = () => {
      const simTimeMs = simClock.getSimTimeMs();
      const key = gridLayerKey(simTimeMs);
      if (key === shown) return;
      shown = key;
      (map.getSource(STATION_SOURCE_ID) as GeoJSONSource | undefined)?.setData(stationsGeoJSON(simTimeMs));
      (map.getSource(GRID_ZONE_SOURCE_ID) as GeoJSONSource | undefined)?.setData(gridZonesGeoJSON(simTimeMs));
      const polySource = map.getSource(POLY_SOURCE_ID) as GeoJSONSource | undefined;
      const pointSource = map.getSource(POINT_SOURCE_ID) as GeoJSONSource | undefined;
      const polyData = polygonsRef.current;
      const pointData = pointsRef.current;
      if (!polySource || !pointSource || !polyData || !pointData) return;
      const gridStatusOf = gridStatusFn(simTimeMs);
      for (const f of [...polyData.features, ...pointData.features]) {
        const b = stock.lookup(f.properties.egid);
        if (b) f.properties.gridStatus = gridStatusOf(b);
      }
      polySource.setData(polyData);
      pointSource.setData(pointData);
    };
    tick();
    const interval = setInterval(tick, SOLAR_TICK_MS);
    const unsubscribe = grid.subscribe(tick);
    const onEnter = () => (map.getCanvas().style.cursor = "pointer");
    const onExit = () => (map.getCanvas().style.cursor = "");
    map.on("mouseenter", STATION_LAYER_ID, onEnter);
    map.on("mouseleave", STATION_LAYER_ID, onExit);
    return () => {
      clearInterval(interval);
      unsubscribe();
      map.off("mouseenter", STATION_LAYER_ID, onEnter);
      map.off("mouseleave", STATION_LAYER_ID, onExit);
    };
  }, [colorMode, dataset]);

  // Zoning layer: the parcels as the plan stands (changes come into force over time), which are
  // picked, and a hover card per parcel.
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !map.getLayer(ZONE_FILL_LAYER_ID)) return;
    const visible = colorMode === "zoning";
    for (const id of ZONE_LAYER_IDS) map.setLayoutProperty(id, "visibility", visible ? "visible" : "none");
    if (!visible) return;

    const tick = () => (map.getSource(ZONE_SOURCE_ID) as GeoJSONSource | undefined)?.setData(zoneParcelsGeoJSON(simClock.getSimTimeMs()));
    const popup = new Popup({ closeButton: false, closeOnClick: false, offset: 10, className: "charger-popup" });
    const onHover = (e: MapMouseEvent & { features?: { properties: Record<string, unknown> }[] }) => {
      const id = String(e.features?.[0]?.properties.id);
      const state = zoning.stateAt(id, simClock.getSimTimeMs());
      const parcel = zoning.getParcel(id);
      if (!state || !parcel) return;
      const label = ZONING_LEGEND.find((l) => l.bucket === state.zone)?.label ?? state.zone;
      const extras = [
        state.extraFloors > 0 ? `+${state.extraFloors} floor${state.extraFloors === 1 ? "" : "s"}` : null,
        state.dhPriority ? "district-heat priority" : null,
        state.highStandard ? "high standard" : null,
      ].filter(Boolean);
      popup
        .setLngLat(e.lngLat)
        .setText(`${label} · ${(parcel.areaM2 / 10_000).toFixed(1)} ha${extras.length > 0 ? ` · ${extras.join(", ")}` : ""}`)
        .addTo(map);
    };
    const onLeave = () => popup.remove();
    const onEnter = () => (map.getCanvas().style.cursor = "pointer");
    const onExit = () => (map.getCanvas().style.cursor = "");

    tick();
    const interval = setInterval(tick, ZONING_TICK_MS);
    const unsubscribe = zoning.subscribe(tick);
    map.on("mousemove", ZONE_FILL_LAYER_ID, onHover as never);
    map.on("mouseleave", ZONE_FILL_LAYER_ID, onLeave);
    map.on("mouseenter", ZONE_FILL_LAYER_ID, onEnter);
    map.on("mouseleave", ZONE_FILL_LAYER_ID, onExit);
    return () => {
      clearInterval(interval);
      unsubscribe();
      map.off("mousemove", ZONE_FILL_LAYER_ID, onHover as never);
      map.off("mouseleave", ZONE_FILL_LAYER_ID, onLeave);
      map.off("mouseenter", ZONE_FILL_LAYER_ID, onEnter);
      map.off("mouseleave", ZONE_FILL_LAYER_ID, onExit);
      popup.remove();
      map.getCanvas().style.cursor = "";
    };
  }, [colorMode, dataset]);

  // EV charging layer: the sites (filling up, opening, being ordered), each building's charging
  // options, the selected site's reach, a hover card per site, and placing a new municipal site.
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !map.getLayer(CHARGER_LAYER_ID)) return;
    const visible = colorMode === "evCharging";
    for (const id of CHARGER_LAYER_IDS) map.setLayoutProperty(id, "visibility", visible ? "visible" : "none");
    if (!visible) {
      for (const kind of COVERAGE_KINDS) if (map.getLayer(coverageId(kind))) map.setLayoutProperty(coverageId(kind), "visibility", "none");
      return;
    }

    // Each kind's coverage, redrawn only when its chargers change.
    const drawCoverage = () => {
      const shown = publicCharging.getCoverage();
      for (const kind of COVERAGE_KINDS) {
        const layer = coverageId(kind);
        if (!map.getLayer(layer)) continue;
        const sites = publicCharging.getSites().filter((s) => s.kind === kind);
        const on = shown.has(kind) && sites.length > 0;
        if (on) {
          const key = sites.map((s) => `${s.id}@${s.lon},${s.lat}`).join("|");
          if (coverageKeysRef.current.get(kind) !== key) {
            const image = coverageImage(kind);
            if (image) (map.getSource(layer) as ImageSource | undefined)?.updateImage(image);
            coverageKeysRef.current.set(kind, key);
          }
        }
        map.setLayoutProperty(layer, "visibility", on ? "visible" : "none");
      }
    };

    let preview: { lon: number; lat: number } | null = null;
    const drawReach = () => (map.getSource(CHARGER_REACH_SOURCE_ID) as GeoJSONSource | undefined)?.setData(chargingReachGeoJSON(preview));

    const tick = () => {
      const simTimeMs = simClock.getSimTimeMs();
      (map.getSource(CHARGER_SOURCE_ID) as GeoJSONSource | undefined)?.setData(chargingSitesToGeoJSON(simTimeMs));
      drawReach();
      drawCoverage();
      map.getCanvas().style.cursor = publicCharging.getPlacing() ? "crosshair" : "";
      const polySource = map.getSource(POLY_SOURCE_ID) as GeoJSONSource | undefined;
      const pointSource = map.getSource(POINT_SOURCE_ID) as GeoJSONSource | undefined;
      const polyData = polygonsRef.current;
      const pointData = pointsRef.current;
      if (!polySource || !pointSource || !polyData || !pointData) return;
      const features = [...polyData.features, ...pointData.features];
      const shown: Building[] = [];
      for (const f of features) {
        const b = stock.lookup(f.properties.egid);
        if (b) shown.push(b);
      }
      const access = publicCharging.householdAccess(shown, simTimeMs);
      for (const f of features) f.properties.charging = evChargingBucket(access.get(f.properties.egid));
      polySource.setData(polyData);
      pointSource.setData(pointData);
    };

    // While placing: the reach of a site at the street nearest the cursor.
    const onMove = (e: MapMouseEvent) => {
      if (!publicCharging.getPlacing()) return;
      const snapped = streets.snapToStreet(e.lngLat.lng, e.lngLat.lat);
      preview = snapped ?? { lon: e.lngLat.lng, lat: e.lngLat.lat };
      drawReach();
    };

    // A hover card per site: who runs it, and how full it is.
    const popup = new Popup({ closeButton: false, closeOnClick: false, offset: 14, className: "charger-popup" });
    const onHover = (e: MapMouseEvent & { features?: { properties: Record<string, unknown> }[] }) => {
      const site = publicCharging.getSite(String(e.features?.[0]?.properties.id));
      if (!site) return;
      const stats = publicCharging.stats(site, simClock.getSimTimeMs());
      const text =
        stats.capacity === 0
          ? `${site.name} — being built`
          : `${site.name} — ${Math.round(stats.utilization * 100)}% full (${[
              stats.vehicles.car && `${stats.vehicles.car} car${stats.vehicles.car === 1 ? "" : "s"}`,
              stats.vehicles.van && `${stats.vehicles.van} van${stats.vehicles.van === 1 ? "" : "s"}`,
              stats.vehicles.truck && `${stats.vehicles.truck} ${stats.vehicles.truck === 1 ? "lorry" : "lorries"}`,
            ]
              .filter(Boolean)
              .join(", ") || "no vehicles yet"})`;
      popup.setLngLat([site.lon, site.lat]).setText(text).addTo(map);
    };
    const onLeave = () => popup.remove();

    tick();
    const interval = setInterval(tick, EV_CHARGING_TICK_MS);
    const unsubscribe = publicCharging.subscribe(tick);
    map.on("mousemove", onMove);
    for (const layer of CHARGER_HIT_LAYER_IDS) {
      map.on("mousemove", layer, onHover as never);
      map.on("mouseleave", layer, onLeave);
    }
    return () => {
      clearInterval(interval);
      unsubscribe();
      map.off("mousemove", onMove);
      for (const layer of CHARGER_HIT_LAYER_IDS) {
        map.off("mousemove", layer, onHover as never);
        map.off("mouseleave", layer, onLeave);
      }
      popup.remove();
      map.getCanvas().style.cursor = "";
      publicCharging.startPlacing(null);
      publicCharging.select(null);
    };
  }, [colorMode, dataset]);

  // Selection and non-power color modes update immediately; power mode is kept in
  // sync by the ticking effect above but still gets an immediate repaint here using
  // the last known scale, so clicking a building doesn't wait for the next tick.
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !map.getLayer(POLY_LAYER_ID)) return;
    const expr = ml(
      colorExpression(colorMode, selectedEgid, {
        powerMinW: lastPowerMinWRef.current,
        powerMaxW: lastPowerMaxWRef.current,
        maxSolarCapacityKw: maxSolarCapacityKwRef.current,
      }),
    );
    map.setPaintProperty(POLY_LAYER_ID, "fill-extrusion-color", expr);
    map.setPaintProperty(POINT_LAYER_ID, "circle-color", expr);
  }, [colorMode, selectedEgid]);

  return <div ref={containerRef} style={{ position: "absolute", inset: 0 }} />;
}
