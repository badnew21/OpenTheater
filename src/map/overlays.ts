import type { FilterSpecification, Map as MapLibreMap } from 'maplibre-gl';

/**
 * Strategic overlays drawn from the real map data: military installations,
 * airfields and ports. These are OSM features, so they only exist in the tiles
 * from about z10 - above that the archive simply has nothing to show.
 */

export type OverlayId = 'bases' | 'airfields' | 'ports';

const ICON_SIZE = 26;

/**
 * Installation markers are meant to be found at a glance over busy terrain:
 * a dark disc for contrast, a bright ring, and a glow so they read against
 * both pale desert and dark water.
 */
function icon(draw: (ctx: CanvasRenderingContext2D, s: number) => void, color: string): ImageData {
  const r = 2, s = ICON_SIZE;
  const cv = document.createElement('canvas');
  cv.width = s * r; cv.height = s * r;
  const ctx = cv.getContext('2d')!;
  ctx.scale(r, r);
  const m = s / 2;

  ctx.save();
  ctx.shadowColor = color;
  ctx.shadowBlur = 6;
  ctx.fillStyle = 'rgba(10,13,16,0.92)';
  ctx.beginPath();
  ctx.arc(m, m, m - 3.2, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();

  ctx.strokeStyle = color;
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.arc(m, m, m - 3.2, 0, Math.PI * 2);
  ctx.stroke();

  ctx.strokeStyle = color;
  ctx.fillStyle = color;
  ctx.lineWidth = 1.7;
  ctx.lineCap = 'round';
  draw(ctx, s);
  return ctx.getImageData(0, 0, s * r, s * r);
}

const anchorIcon = (c: string) => icon((ctx, s) => {
  const m = s / 2;
  ctx.beginPath();
  ctx.arc(m, m - 5, 1.8, 0, Math.PI * 2);
  ctx.stroke();
  ctx.beginPath();
  ctx.moveTo(m, m - 3.2); ctx.lineTo(m, m + 5.5);
  ctx.moveTo(m - 3.4, m - 1.6); ctx.lineTo(m + 3.4, m - 1.6);
  ctx.stroke();
  ctx.beginPath();
  ctx.moveTo(m - 4.4, m + 1.8);
  ctx.quadraticCurveTo(m, m + 7.6, m + 4.4, m + 1.8);
  ctx.stroke();
}, c);

const planeIcon = (c: string) => icon((ctx, s) => {
  const m = s / 2;
  ctx.beginPath();
  ctx.moveTo(m, m - 6);
  ctx.lineTo(m + 1.5, m - 1.5);
  ctx.lineTo(m + 6, m + 1.4);
  ctx.lineTo(m + 6, m + 2.8);
  ctx.lineTo(m + 1.4, m + 2);
  ctx.lineTo(m + 1.1, m + 4.6);
  ctx.lineTo(m + 2.8, m + 6);
  ctx.lineTo(m, m + 5.2);
  ctx.lineTo(m - 2.8, m + 6);
  ctx.lineTo(m - 1.1, m + 4.6);
  ctx.lineTo(m - 1.4, m + 2);
  ctx.lineTo(m - 6, m + 2.8);
  ctx.lineTo(m - 6, m + 1.4);
  ctx.lineTo(m - 1.5, m - 1.5);
  ctx.closePath();
  ctx.fill();
}, c);

const baseIcon = (c: string) => icon((ctx, s) => {
  const m = s / 2;
  ctx.beginPath();
  ctx.moveTo(m - 5, m - 4.5);
  ctx.lineTo(m + 5, m - 4.5);
  ctx.lineTo(m + 5, m + 1);
  ctx.quadraticCurveTo(m, m + 6.5, m - 5, m + 1);
  ctx.closePath();
  ctx.stroke();
  ctx.beginPath();
  ctx.moveTo(m - 2.4, m - 1.6); ctx.lineTo(m + 2.4, m + 1.6);
  ctx.moveTo(m + 2.4, m - 1.6); ctx.lineTo(m - 2.4, m + 1.6);
  ctx.stroke();
}, c);

// deliberately saturated: these have to win against terrain
const COLORS = { bases: '#ff9a4d', airfields: '#61c8ff', ports: '#4fe0b0' };

export class Overlays {
  private visible = new Set<OverlayId>();

  constructor(private map: MapLibreMap) {}

  add() {
    const { map } = this;
    map.addImage('ov-port', anchorIcon(COLORS.ports), { pixelRatio: 2 });
    map.addImage('ov-air', planeIcon(COLORS.airfields), { pixelRatio: 2 });
    map.addImage('ov-base', baseIcon(COLORS.bases), { pixelRatio: 2 });

    const hidden = { visibility: 'none' as const };

    // --- military installations ---------------------------------------
    map.addLayer({
      id: 'ov/bases-area', source: 'world', 'source-layer': 'landuse', type: 'fill', minzoom: 8,
      filter: ['match', ['get', 'kind'], ['military', 'naval_base'], true, false] as FilterSpecification,
      layout: hidden,
      paint: { 'fill-color': COLORS.bases, 'fill-opacity': 0.3, 'fill-outline-color': COLORS.bases },
    });
    map.addLayer({
      id: 'ov/bases-edge', source: 'world', 'source-layer': 'landuse', type: 'line', minzoom: 8,
      filter: ['match', ['get', 'kind'], ['military', 'naval_base'], true, false] as FilterSpecification,
      layout: hidden,
      paint: { 'line-color': COLORS.bases, 'line-width': 1.6, 'line-opacity': 0.95, 'line-blur': 0.4 },
    });
    map.addLayer({
      id: 'ov/bases', source: 'world', 'source-layer': 'landuse', type: 'symbol', minzoom: 9,
      filter: ['match', ['get', 'kind'], ['military', 'naval_base'], true, false] as FilterSpecification,
      layout: {
        ...hidden, 'icon-image': 'ov-base', 'icon-size': 0.6, 'icon-allow-overlap': true,
        'text-field': ['coalesce', ['get', 'name:en'], ['get', 'name'], ''],
        'text-font': ['Noto Sans Medium'],
        'text-size': ['interpolate', ['linear'], ['zoom'], 9.5, 0, 11, 10] as never,
        'text-anchor': 'top',
        'text-offset': [0, 0.9], 'text-optional': true, 'text-max-width': 9,
      },
      paint: {
        'text-color': COLORS.bases, 'text-halo-color': 'rgba(8,10,13,0.9)', 'text-halo-width': 1.5,
      },
    });

    // --- airfields -----------------------------------------------------
    map.addLayer({
      id: 'ov/airfields-area', source: 'world', 'source-layer': 'landuse', type: 'fill', minzoom: 8,
      filter: ['match', ['get', 'kind'], ['aerodrome', 'airfield'], true, false] as FilterSpecification,
      layout: hidden,
      paint: { 'fill-color': COLORS.airfields, 'fill-opacity': 0.26 },
    });
    map.addLayer({
      id: 'ov/airfields-edge', source: 'world', 'source-layer': 'landuse', type: 'line', minzoom: 8,
      filter: ['match', ['get', 'kind'], ['aerodrome', 'airfield'], true, false] as FilterSpecification,
      layout: hidden,
      paint: { 'line-color': COLORS.airfields, 'line-width': 1.6, 'line-opacity': 0.95 },
    });
    map.addLayer({
      id: 'ov/runways', source: 'world', 'source-layer': 'roads', type: 'line', minzoom: 10,
      filter: ['==', ['get', 'kind'], 'aeroway'] as FilterSpecification,
      layout: hidden,
      paint: {
        'line-color': COLORS.airfields,
        'line-width': ['interpolate', ['linear'], ['zoom'], 10, 1.4, 15, 5] as never,
        'line-opacity': 0.95,
      },
    });
    map.addLayer({
      id: 'ov/airfields', source: 'world', 'source-layer': 'landuse', type: 'symbol', minzoom: 9,
      filter: ['match', ['get', 'kind'], ['aerodrome', 'airfield'], true, false] as FilterSpecification,
      layout: {
        ...hidden, 'icon-image': 'ov-air', 'icon-size': 0.6, 'icon-allow-overlap': true,
        'text-field': ['coalesce', ['get', 'name:en'], ['get', 'name'], ''],
        'text-font': ['Noto Sans Medium'],
        'text-size': ['interpolate', ['linear'], ['zoom'], 9.5, 0, 11, 10] as never,
        'text-anchor': 'top',
        'text-offset': [0, 0.9], 'text-optional': true, 'text-max-width': 9,
      },
      paint: {
        'text-color': COLORS.airfields, 'text-halo-color': 'rgba(8,10,13,0.9)', 'text-halo-width': 1.5,
      },
    });

    // --- ports ---------------------------------------------------------
    map.addLayer({
      id: 'ov/docks', source: 'world', 'source-layer': 'water', type: 'fill', minzoom: 9,
      filter: ['match', ['get', 'kind'], ['dock', 'harbour'], true, false] as FilterSpecification,
      layout: hidden,
      paint: { 'fill-color': COLORS.ports, 'fill-opacity': 0.45, 'fill-outline-color': COLORS.ports },
    });
    map.addLayer({
      id: 'ov/ferries', source: 'world', 'source-layer': 'roads', type: 'line', minzoom: 6,
      filter: ['==', ['get', 'kind'], 'ferry'] as FilterSpecification,
      layout: hidden,
      paint: { 'line-color': COLORS.ports, 'line-width': 1.2, 'line-dasharray': [3, 3], 'line-opacity': 0.65 },
    });
    map.addLayer({
      id: 'ov/ports', source: 'world', 'source-layer': 'pois', type: 'symbol', minzoom: 9,
      filter: ['match', ['get', 'kind'],
        ['marina', 'ferry_terminal', 'terminal', 'harbourmaster', 'port'], true, false] as FilterSpecification,
      layout: {
        ...hidden, 'icon-image': 'ov-port', 'icon-size': 0.6, 'icon-allow-overlap': true,
        'text-field': ['coalesce', ['get', 'name:en'], ['get', 'name'], ''],
        'text-font': ['Noto Sans Medium'],
        'text-size': ['interpolate', ['linear'], ['zoom'], 9.5, 0, 11, 10] as never,
        'text-anchor': 'top',
        'text-offset': [0, 0.9], 'text-optional': true, 'text-max-width': 9,
      },
      paint: {
        'text-color': COLORS.ports, 'text-halo-color': 'rgba(8,10,13,0.9)', 'text-halo-width': 1.5,
      },
    });
  }

  private layersOf(id: OverlayId): string[] {
    switch (id) {
      case 'bases': return ['ov/bases-area', 'ov/bases-edge', 'ov/bases'];
      case 'airfields': return ['ov/airfields-area', 'ov/airfields-edge', 'ov/runways', 'ov/airfields'];
      case 'ports': return ['ov/docks', 'ov/ferries', 'ov/ports'];
    }
  }

  toggle(id: OverlayId, on: boolean) {
    if (on) this.visible.add(id); else this.visible.delete(id);
    for (const layer of this.layersOf(id)) {
      if (this.map.getLayer(layer)) {
        this.map.setLayoutProperty(layer, 'visibility', on ? 'visible' : 'none');
      }
    }
  }

  isOn(id: OverlayId) { return this.visible.has(id); }
}
