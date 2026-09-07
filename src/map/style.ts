import type { StyleSpecification, ExpressionSpecification, FilterSpecification } from 'maplibre-gl';

/**
 * The base map: a 2D wargame board built from the OSM archive.
 *
 * Two sources point at the same tiles. `world` runs to the archive's z15 for
 * detail; `cover` is capped at z7 so MapLibre keeps overzooming the global
 * landcover instead of dropping it - without that the terrain tint vanishes
 * the moment you cross into corps-level zoom and the map appears to fall apart.
 */

export const C = {
  ocean: '#101c26',
  oceanShelf: '#162835',
  water: '#1b2f3d',
  earth: '#b9ad8c',
  forest: '#8f9e75',
  taiga: '#7f9276',
  scrub: '#b3ac86',
  farmland: '#c4b98f',
  grass: '#b5b88d',
  barren: '#c7bb99',
  desert: '#cfc09a',
  glacier: '#dfe4e6',
  urban: '#a2957c',
  jungle: '#7f9963',
  road: '#7d6c56',
  roadMinor: '#8f8069',
  rail: '#544c40',
  border: '#3d2f28',
  ink: '#26221c',
  halo: 'rgba(238,230,210,0.9)',
} as const;

const zoomStops = (stops: [number, number | string][]): ExpressionSpecification =>
  ['interpolate', ['linear'], ['zoom'], ...stops.flat()] as unknown as ExpressionSpecification;

const roadWidth = (base: number): ExpressionSpecification =>
  ['interpolate', ['exponential', 1.5], ['zoom'],
    5, base * 0.3, 9, base * 0.7, 13, base * 1.8, 16, base * 5, 19, base * 18] as unknown as ExpressionSpecification;

/** landcover / landuse kind -> terrain colour. Kinds come from a census of the archive. */
const COVER_COLOR: ExpressionSpecification = ['match', ['get', 'kind'],
  'forest', C.forest, 'wood', C.forest, 'nature_reserve', C.forest, 'national_park', C.forest,
  'farmland', '#c4b98f', 'orchard', '#bcb283', 'allotments', '#c4b98f', 'vineyard', '#bcb283',
  'grassland', C.grass, 'grass', C.grass, 'meadow', C.grass, 'village_green', C.grass,
  'scrub', C.scrub, 'heath', C.scrub, 'shrubbery', C.scrub,
  'barren', C.barren, 'bare_rock', '#b8ad91', 'scree', '#b8ad91', 'sand', C.desert, 'beach', C.desert,
  'glacier', C.glacier, 'urban_area', C.urban,
  'residential', '#ada08a', 'neighbourhood', '#ada08a', 'commercial', '#a89a83',
  'industrial', '#9c8f7b', 'military', '#94836d', 'naval_base', '#94836d', 'aerodrome', '#a99c86',
  'wetland', '#9aa88d', 'marsh', '#9aa88d',
  'park', '#9fb083', 'garden', '#9fb083', 'cemetery', '#a3ad8b', 'zoo', '#9fb083', 'golf_course', '#a5b586',
  'pedestrian', '#b0a48d', 'school', '#aa9d87', 'university', '#aa9d87', 'hospital', '#ab9b8b',
  'platform', '#a89b85', 'pier', '#a89b85',
  'transparent'] as unknown as ExpressionSpecification;

export function buildStyle(tilesUrl: string): StyleSpecification {
  const base = import.meta.env.BASE_URL || '/';
  const v = (layer: string, id: string, extra: Record<string, unknown>) =>
    ({ id, source: 'world', 'source-layer': layer, ...extra });

  return {
    version: 8,
    name: 'Theatre',
    glyphs: `${base}fonts/{fontstack}/{range}.pbf`,
    projection: { type: 'mercator' },
    light: { anchor: 'viewport', position: [1.3, 210, 32], intensity: 0.3, color: '#fff4dc' },
    sources: {
      world: { type: 'vector', url: tilesUrl, attribution: '© <a href="https://protomaps.com">Protomaps</a> © OpenStreetMap contributors' },
      // same archive, clamped to the last zoom that carries landcover
      cover: { type: 'vector', url: tilesUrl, maxzoom: 7 },
    },
    layers: [
      { id: 'bg', type: 'background', paint: { 'background-color': C.ocean } },

      v('earth', 'earth', { type: 'fill', paint: { 'fill-color': C.earth } }),

      {
        id: 'landcover', source: 'cover', 'source-layer': 'landcover', type: 'fill',
        paint: { 'fill-color': COVER_COLOR, 'fill-opacity': zoomStops([[1, 0.85], [8, 0.8], [12, 0.55], [15, 0.4]]) },
      },

      v('landuse', 'landuse', {
        type: 'fill', minzoom: 6,
        paint: { 'fill-color': COVER_COLOR, 'fill-opacity': zoomStops([[6, 0.25], [10, 0.55], [14, 0.7]]) },
      }),

      // Rivers are drawn from their centre lines, not their polygons.
      // protomaps/basemaps#373: river polygons from an extracted archive render
      // many times too wide in MapLibre, so the fill is restricted to bodies of
      // water that are genuinely area features.
      v('water', 'water', {
        type: 'fill',
        filter: ['all',
          ['==', ['geometry-type'], 'Polygon'],
          ['match', ['get', 'kind'], ['river', 'canal', 'stream'], false, true],
        ] as FilterSpecification,
        paint: {
          'fill-color': ['match', ['get', 'kind'], 'ocean', C.ocean, 'sea', C.oceanShelf, C.water],
        },
      }),
      v('water', 'water/river', {
        type: 'line', minzoom: 5,
        filter: ['==', ['geometry-type'], 'LineString'] as FilterSpecification,
        layout: { 'line-cap': 'round', 'line-join': 'round' },
        paint: {
          'line-color': C.water,
          'line-width': ['interpolate', ['exponential', 1.6], ['zoom'],
            5, ['match', ['get', 'kind'], 'river', 0.6, 0.3],
            10, ['match', ['get', 'kind'], 'river', 1.8, 0.8],
            14, ['match', ['get', 'kind'], 'river', 6, 2.5],
            18, ['match', ['get', 'kind'], 'river', 26, 10]] as never,
        },
      }),

      v('roads', 'roads/minor', {
        type: 'line', minzoom: 12,
        filter: ['match', ['get', 'kind'], ['minor_road', 'path', 'other'], true, false] as FilterSpecification,
        layout: { 'line-cap': 'round', 'line-join': 'round' },
        paint: { 'line-color': C.roadMinor, 'line-width': roadWidth(0.5), 'line-opacity': zoomStops([[12, 0], [14, 0.65]]) },
      }),
      v('roads', 'roads/rail', {
        type: 'line', minzoom: 7,
        filter: ['==', ['get', 'kind'], 'rail'] as FilterSpecification,
        paint: { 'line-color': C.rail, 'line-width': roadWidth(0.5), 'line-dasharray': [4, 2], 'line-opacity': 0.65 },
      }),
      v('roads', 'roads/road', {
        type: 'line', minzoom: 6,
        filter: ['match', ['get', 'kind'], ['major_road', 'medium_road'], true, false] as FilterSpecification,
        layout: { 'line-cap': 'round', 'line-join': 'round' },
        paint: { 'line-color': C.road, 'line-width': roadWidth(0.8), 'line-opacity': 0.8 },
      }),
      v('roads', 'roads/highway', {
        type: 'line', minzoom: 4,
        filter: ['==', ['get', 'kind'], 'highway'] as FilterSpecification,
        layout: { 'line-cap': 'round', 'line-join': 'round' },
        paint: { 'line-color': '#8a6a45', 'line-width': roadWidth(1.2) },
      }),

      // Buildings only matter once you are down among them.
      v('buildings', 'buildings/flat', {
        type: 'fill', minzoom: 13,
        paint: { 'fill-color': '#9b8d78', 'fill-opacity': zoomStops([[13, 0.4], [15.5, 0.85]]) },
      }),
      v('buildings', 'buildings/3d', {
        type: 'fill-extrusion', minzoom: 15.5,
        filter: ['!=', ['get', 'kind'], 'building_part'] as FilterSpecification,
        paint: {
          'fill-extrusion-color': ['interpolate', ['linear'], ['coalesce', ['get', 'height'], 9],
            0, '#a89a84', 20, '#9e917c', 60, '#928776', 200, '#877e70'] as never,
          'fill-extrusion-height': ['coalesce', ['get', 'height'], 9] as never,
          'fill-extrusion-base': ['coalesce', ['get', 'min_height'], 0] as never,
          'fill-extrusion-opacity': 0.95,
          'fill-extrusion-vertical-gradient': true,
        },
      }),

      v('boundaries', 'boundaries/region', {
        type: 'line', minzoom: 4,
        filter: ['>=', ['get', 'kind_detail'], 3] as FilterSpecification,
        paint: { 'line-color': C.border, 'line-width': zoomStops([[4, 0.3], [10, 1]]), 'line-opacity': 0.25 },
      }),
      v('boundaries', 'boundaries/country', {
        type: 'line',
        filter: ['<=', ['get', 'kind_detail'], 2] as FilterSpecification,
        paint: {
          'line-color': C.border,
          'line-width': zoomStops([[1, 0.5], [5, 1.2], [10, 2.2]]),
          'line-opacity': 0.5,
        },
      }),
    ],
  } as StyleSpecification;
}
