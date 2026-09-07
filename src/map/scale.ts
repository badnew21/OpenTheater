/** Zoom bands: one continuous world, four ways of looking at it. */
export type Band = 'strategic' | 'operational' | 'tactical' | 'street';

export interface ScaleInfo {
  band: Band;
  label: string;
  /** What a unit counter represents at this scale. */
  echelon: string;
  metersPerPixel: number;
}

const BANDS: [number, Band, string, string][] = [
  [0, 'strategic', 'STRATEGIC', 'army group'],
  [6.5, 'operational', 'OPERATIONAL', 'corps'],
  [11.5, 'tactical', 'TACTICAL', 'battalion'],
  [15, 'street', 'STREET', 'squad'],
];

/**
 * The command ladder: which echelon is resolved at which zoom. Between two
 * entries the map shows both, cross-faded, so formations decompose smoothly.
 */
export const LEVELS: { level: number; zoom: number; echelon: string; scale: number }[] = [
  { level: 0, zoom: 1.5, echelon: 'army group', scale: 1.1 },
  { level: 1, zoom: 3.0, echelon: 'army', scale: 1.0 },
  { level: 2, zoom: 4.5, echelon: 'corps', scale: 0.92 },
  { level: 3, zoom: 6.0, echelon: 'brigade', scale: 0.85 },
  { level: 4, zoom: 10.5, echelon: 'battalion', scale: 0.68 },
  { level: 5, zoom: 13.5, echelon: 'company', scale: 0.54 },
];

/** What the player is commanding at this zoom, including mid-transition. */
export function commandLabel(zoom: number): string {
  if (zoom <= LEVELS[0].zoom) return LEVELS[0].echelon;
  const last = LEVELS[LEVELS.length - 1];
  if (zoom >= last.zoom) return last.echelon;
  let i = 0;
  while (i < LEVELS.length - 1 && zoom >= LEVELS[i + 1].zoom) i++;
  const t = (zoom - LEVELS[i].zoom) / (LEVELS[i + 1].zoom - LEVELS[i].zoom);
  return t > 0.5 ? LEVELS[i + 1].echelon : LEVELS[i].echelon;
}

export function bandFor(zoom: number): [Band, string, string] {
  let cur = BANDS[0];
  for (const b of BANDS) if (zoom >= b[0]) cur = b;
  return [cur[1], cur[2], cur[3]];
}

/** Ground resolution at the given latitude, in metres per screen pixel. */
export function metersPerPixel(zoom: number, lat: number): number {
  return (156543.03392 * Math.cos((lat * Math.PI) / 180)) / 2 ** zoom;
}

export function scaleInfo(zoom: number, lat: number): ScaleInfo {
  const [band, label, echelon] = bandFor(zoom);
  return { band, label, echelon, metersPerPixel: metersPerPixel(zoom, lat) };
}

/** Camera pitch that eases the view from a flat map into a diorama. */
export function pitchFor(zoom: number): number {
  if (zoom < 11) return 0;
  if (zoom > 17) return 58;
  const t = (zoom - 11) / 6;
  return 58 * t * t;
}

export function formatDistance(m: number): string {
  if (m >= 1000) return `${(m / 1000).toFixed(m >= 10000 ? 0 : 1)} km`;
  return `${m.toFixed(m >= 100 ? 0 : 1)} m`;
}
