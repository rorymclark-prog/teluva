import { geoDistance, geoNaturalEarth1, geoOrthographic, geoPath } from 'd3-geo';
import { feature } from 'topojson-client';
import world from 'world-atlas/countries-110m.json';
import type { Topology, GeometryCollection } from 'topojson-specification';
import type { FeatureCollection } from 'geojson';

// Natural Earth public-domain geography, shipped with the app. No map tiles,
// geocoding requests, API keys or coordinate transmission to a map provider.
const topology = world as unknown as Topology<{ countries: GeometryCollection }>;
export const atlasCountries: FeatureCollection = feature(topology, topology.objects.countries);
export const ATLAS_WIDTH = 960, ATLAS_HEIGHT = 560;
export interface AtlasCamera { longitude: number; latitude: number; zoom: number; x: number; y: number }
export const initialAtlasCamera: AtlasCamera = { longitude: 15, latitude: 12, zoom: 1, x: 0, y: 0 };
export function atlasProjection(mode: 'globe' | 'map', camera: AtlasCamera) {
  const zoom = Math.max(0.7, Math.min(5, camera.zoom));
  return mode === 'globe'
    ? geoOrthographic().rotate([-camera.longitude, -camera.latitude, 0]).scale(235 * zoom).translate([480, 280]).clipAngle(90)
    : geoNaturalEarth1().scale(170 * zoom).translate([480 + camera.x, 280 + camera.y]).clipExtent([[0, 0], [960, 560]]);
}
export function visibleAtlasPoint(lng: number, lat: number, mode: 'globe' | 'map', camera: AtlasCamera): [number, number] | null {
  if (!Number.isFinite(lng) || !Number.isFinite(lat) || Math.abs(lng) > 180 || Math.abs(lat) > 90) return null;
  if (mode === 'globe' && geoDistance([lng, lat], [camera.longitude, camera.latitude]) > Math.PI / 2 - 0.005) return null;
  const point = atlasProjection(mode, camera)([lng, lat]);
  return point && point[0] >= 0 && point[0] <= 960 && point[1] >= 0 && point[1] <= 560 ? point : null;
}
export const atlasPath = (mode: 'globe' | 'map', camera: AtlasCamera) => geoPath(atlasProjection(mode, camera));
