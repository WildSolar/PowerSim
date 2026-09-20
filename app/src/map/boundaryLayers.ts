import type { FeatureCollection, Polygon } from "geojson";
import type { LayerSpecification, Map as MlMap } from "maplibre-gl";
import type { MunicipalityBoundary } from "../data/types";

const MASK_SOURCE_ID = "municipality-mask";
const BORDER_SOURCE_ID = "municipality-border";
const MASK_LAYER_ID = "municipality-mask-fill";
const BORDER_LAYER_ID = "municipality-border-line";

const WORLD_RING: number[][] = [
  [-180, -85],
  [180, -85],
  [180, 85],
  [-180, 85],
  [-180, -85],
];

/** Everything outside the municipality: the whole world with each outer ring cut out,
 * plus each interior ring (an enclave belonging to another municipality) added back. */
function outsideMask(boundary: MunicipalityBoundary): FeatureCollection<Polygon> {
  const enclaves = boundary.flatMap((rings) => rings.slice(1));
  return {
    type: "FeatureCollection",
    features: [
      { type: "Feature", properties: {}, geometry: { type: "Polygon", coordinates: [WORLD_RING, ...boundary.map((rings) => rings[0])] } },
      ...enclaves.map((ring) => ({
        type: "Feature" as const,
        properties: {},
        geometry: { type: "Polygon" as const, coordinates: [ring] },
      })),
    ],
  };
}

/** Fades the basemap outside the municipality (a light grey wash lowers both saturation
 * and contrast; vector layers have no true saturation control). Added below the building
 * layers so buildings stay unaffected. Added before our own layers, so call it first. */
export function addBoundaryMask(map: MlMap, boundary: MunicipalityBoundary): void {
  map.addSource(MASK_SOURCE_ID, { type: "geojson", data: outsideMask(boundary) });
  const layer: LayerSpecification = {
    id: MASK_LAYER_ID,
    type: "fill",
    source: MASK_SOURCE_ID,
    paint: { "fill-color": "#e6e8eb", "fill-opacity": 0.7 },
  };
  map.addLayer(layer);
}

/** The red municipal border line, drawn on top of everything else. */
export function addBoundaryLine(map: MlMap, boundary: MunicipalityBoundary): void {
  map.addSource(BORDER_SOURCE_ID, {
    type: "geojson",
    data: {
      type: "Feature",
      properties: {},
      geometry: { type: "MultiLineString", coordinates: boundary.flatMap((rings) => rings) },
    },
  });
  map.addLayer({
    id: BORDER_LAYER_ID,
    type: "line",
    source: BORDER_SOURCE_ID,
    layout: { "line-join": "round" },
    paint: { "line-color": "#d62828", "line-width": 3 },
  });
}
