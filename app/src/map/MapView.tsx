import { useEffect, useRef } from "react";
import { Map as MlMap, type MapGeoJSONFeature, type MapMouseEvent } from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css";
import type { Building, MunicipalityDataset } from "../data/types";

const BASEMAP_STYLE_URL = "https://vectortiles.geo.admin.ch/styles/ch.swisstopo.basemap.vt/style.json";

const POLY_SOURCE_ID = "buildings-polygons";
const POLY_LAYER_ID = "buildings-polygons-fill";
const POLY_SELECTED_LAYER_ID = "buildings-polygons-selected";
const POINT_SOURCE_ID = "buildings-points";
const POINT_LAYER_ID = "buildings-points-circle";

function closedRing(ring: [number, number][]): [number, number][] {
  if (ring.length === 0) return ring;
  const [first] = ring;
  const last = ring[ring.length - 1];
  if (first[0] === last[0] && first[1] === last[1]) return ring;
  return [...ring, first];
}

function buildingsToGeoJSON(buildings: Building[]) {
  const polygonFeatures = buildings
    .filter((b) => b.footprint && b.footprint.length >= 3)
    .map((b) => ({
      type: "Feature" as const,
      properties: { egid: b.egid },
      geometry: {
        type: "Polygon" as const,
        coordinates: [closedRing(b.footprint as [number, number][])],
      },
    }));

  const pointFeatures = buildings
    .filter((b) => !b.footprint || b.footprint.length < 3)
    .map((b) => ({
      type: "Feature" as const,
      properties: { egid: b.egid },
      geometry: { type: "Point" as const, coordinates: [b.lon, b.lat] },
    }));

  return {
    polygons: { type: "FeatureCollection" as const, features: polygonFeatures },
    points: { type: "FeatureCollection" as const, features: pointFeatures },
  };
}

export interface MapViewProps {
  dataset: MunicipalityDataset;
  selectedEgid: string | null;
  onSelectBuilding: (egid: string) => void;
}

export function MapView({ dataset, selectedEgid, onSelectBuilding }: MapViewProps) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<MlMap | null>(null);
  const onSelectBuildingRef = useRef(onSelectBuilding);
  onSelectBuildingRef.current = onSelectBuilding;

  useEffect(() => {
    if (!containerRef.current) return;

    const buildings = dataset.buildings;
    const center: [number, number] =
      buildings.length > 0 ? [buildings[0].lon, buildings[0].lat] : [8.4479, 47.3967];

    const map = new MlMap({
      container: containerRef.current,
      style: BASEMAP_STYLE_URL,
      center,
      zoom: 15,
    });
    mapRef.current = map;

    const geojson = buildingsToGeoJSON(buildings);

    // "style.load" fires once the style is parsed and sources are registered — the
    // right point to add our own source/layers. The "load" event additionally waits
    // for every style source (including swisstopo's unrelated hillshade/relief
    // layers) to finish loading tiles, which can take much longer or stall.
    map.on("style.load", () => {
      map.addSource(POLY_SOURCE_ID, { type: "geojson", data: geojson.polygons });
      map.addLayer({
        id: POLY_LAYER_ID,
        type: "fill",
        source: POLY_SOURCE_ID,
        paint: { "fill-color": "#3b82f6", "fill-opacity": 0.55, "fill-outline-color": "#1d4ed8" },
      });
      map.addLayer({
        id: POLY_SELECTED_LAYER_ID,
        type: "line",
        source: POLY_SOURCE_ID,
        paint: { "line-color": "#f97316", "line-width": 3 },
        filter: ["==", ["get", "egid"], "__none__"],
      });

      map.addSource(POINT_SOURCE_ID, { type: "geojson", data: geojson.points });
      map.addLayer({
        id: POINT_LAYER_ID,
        type: "circle",
        source: POINT_SOURCE_ID,
        paint: {
          "circle-radius": 5,
          "circle-color": "#3b82f6",
          "circle-stroke-color": "#1d4ed8",
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

  useEffect(() => {
    const map = mapRef.current;
    if (!map || !map.getLayer(POLY_SELECTED_LAYER_ID)) return;
    map.setFilter(POLY_SELECTED_LAYER_ID, ["==", ["get", "egid"], selectedEgid ?? "__none__"]);
  }, [selectedEgid]);

  return <div ref={containerRef} style={{ position: "absolute", inset: 0 }} />;
}
