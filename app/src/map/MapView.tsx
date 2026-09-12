import { useEffect, useRef } from "react";
import {
  Map as MlMap,
  NavigationControl,
  type GeoJSONSource,
  type MapGeoJSONFeature,
  type MapMouseEvent,
} from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css";
import type { Building, MunicipalityDataset, PowerPlant } from "../data/types";
import { buildingHeightM } from "../sim/buildingGeometry";
import { buildingPowerW } from "../sim/buildingPower";
import { simClock } from "../sim/engine";
import { snowDepthCm } from "../sim/snow";
import {
  buildingCategoryBucket,
  buildingHeatingBucket,
  CATEGORY_LEGEND,
  HEATING_LEGEND,
  legendMatchExpression,
  powerColorExpression,
  solarColorExpression,
  type ColorMode,
  type MapExpr,
} from "./colorModes";

const BASEMAP_STYLE_URL = "https://vectortiles.geo.admin.ch/styles/ch.swisstopo.basemap.vt/style.json";

const POLY_SOURCE_ID = "buildings-polygons";
const POLY_LAYER_ID = "buildings-polygons-extrusion";
const POINT_SOURCE_ID = "buildings-points";
const POINT_LAYER_ID = "buildings-points-circle";

const DEFAULT_COLOR = "#9db4c9";
const SELECTED_COLOR = "#f97316";
const POWER_TICK_MS = 1500;

type BuildingProperties = {
  egid: string;
  category: string;
  heating: string;
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

function buildingsToGeoJSON(
  buildings: Building[],
  plants: PowerPlant[],
): { polygons: BuildingFeatureCollection; points: BuildingFeatureCollection } {
  const solarByEgid = solarCapacityByEgid(plants);

  const polygonFeatures = buildings
    .filter((b) => b.footprint && b.footprint.length >= 3)
    .map((b) => ({
      type: "Feature" as const,
      properties: {
        egid: b.egid,
        category: buildingCategoryBucket(b),
        heating: buildingHeatingBucket(b),
        powerW: 0,
        solarCapacityKw: solarByEgid.get(b.egid) ?? 0,
        heightM: buildingHeightM(b),
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
      properties: {
        egid: b.egid,
        category: buildingCategoryBucket(b),
        heating: buildingHeatingBucket(b),
        powerW: 0,
        solarCapacityKw: solarByEgid.get(b.egid) ?? 0,
      },
      geometry: { type: "Point" as const, coordinates: [b.lon, b.lat] as [number, number] },
    }));

  return {
    polygons: { type: "FeatureCollection", features: polygonFeatures },
    points: { type: "FeatureCollection", features: pointFeatures },
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

interface ColorScales {
  powerMinW: number;
  powerMaxW: number;
  maxSolarCapacityKw: number;
}

function colorExpression(mode: ColorMode, selectedEgid: string | null, scales: ColorScales): MapExpr {
  const base =
    mode === "category"
      ? legendMatchExpression("category", CATEGORY_LEGEND)
      : mode === "heating"
        ? legendMatchExpression("heating", HEATING_LEGEND)
        : mode === "power"
          ? powerColorExpression(scales.powerMinW, scales.powerMaxW)
          : mode === "solar"
            ? solarColorExpression(scales.maxSolarCapacityKw)
            : DEFAULT_COLOR;
  return ["case", ["==", ["get", "egid"], selectedEgid ?? "__none__"], SELECTED_COLOR, base];
}

/** maplibre-gl's own expression-spec types are a deep literal-tuple union that a
 * runtime-built JSON-DSL array can't structurally satisfy — cast at this one
 * boundary rather than fighting it, since the expressions themselves are already
 * verified against the real style. */
function ml(expr: MapExpr): any {
  return expr;
}

export interface MapViewProps {
  dataset: MunicipalityDataset;
  selectedEgid: string | null;
  onSelectBuilding: (egid: string) => void;
  colorMode: ColorMode;
}

export function MapView({ dataset, selectedEgid, onSelectBuilding, colorMode }: MapViewProps) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<MlMap | null>(null);
  const onSelectBuildingRef = useRef(onSelectBuilding);
  onSelectBuildingRef.current = onSelectBuilding;
  const selectedEgidRef = useRef(selectedEgid);
  selectedEgidRef.current = selectedEgid;
  const polygonsRef = useRef<BuildingFeatureCollection | null>(null);
  const pointsRef = useRef<BuildingFeatureCollection | null>(null);
  const lastPowerMinWRef = useRef(0);
  const lastPowerMaxWRef = useRef(0);
  const maxSolarCapacityKwRef = useRef(0);

  useEffect(() => {
    if (!containerRef.current) return;

    const buildings = dataset.buildings;
    const center: [number, number] =
      buildings.length > 0 ? [buildings[0].lon, buildings[0].lat] : [8.4479, 47.3967];

    const map = new MlMap({
      container: containerRef.current,
      style: BASEMAP_STYLE_URL,
      center,
      zoom: 16,
      pitch: 50,
      bearing: -15,
    });
    mapRef.current = map;
    map.addControl(new NavigationControl({ visualizePitch: true }), "top-right");

    const geojson = buildingsToGeoJSON(buildings, dataset.powerPlants);
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

      const handleClick = (e: MapMouseEvent & { features?: MapGeoJSONFeature[] }) => {
        const feature = e.features?.[0];
        const egid = feature?.properties?.egid as string | undefined;
        if (egid) onSelectBuildingRef.current(egid);
      };

      map.on("click", POLY_LAYER_ID, handleClick);
      map.on("click", POINT_LAYER_ID, handleClick);
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

  // Live power-draw mode: periodically recompute every building's current device
  // draw and push it into the source data + a fresh color scale. Devices are pure
  // functions of (seed, simTime), so this is a cheap recomputation, not a simulation
  // that needs to run continuously in the background.
  useEffect(() => {
    const map = mapRef.current;
    if (!map || colorMode !== "power") return;

    const buildingsByEgid = new Map(dataset.buildings.map((b) => [b.egid, b]));

    const tick = () => {
      const polySource = map.getSource(POLY_SOURCE_ID) as GeoJSONSource | undefined;
      const pointSource = map.getSource(POINT_SOURCE_ID) as GeoJSONSource | undefined;
      const polyData = polygonsRef.current;
      const pointData = pointsRef.current;
      if (!polySource || !pointSource || !polyData || !pointData) return;

      const simTimeMs = simClock.getSimTimeMs();
      const snowCoverCm = snowDepthCm(simTimeMs);
      let minW = 0;
      let maxW = 0;
      for (const feature of [...polyData.features, ...pointData.features]) {
        const building = buildingsByEgid.get(feature.properties.egid);
        const power = building ? buildingPowerW(building, simTimeMs, dataset.powerPlants, snowCoverCm) : 0;
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
