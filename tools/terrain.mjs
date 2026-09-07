// Assign each province a terrain type by sampling the archive's real landcover,
// instead of guessing from latitude. Rewrites terrain in provinces.geojson and
// world.json in place.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { PbfReader } from 'pbf';
import { VectorTile } from '@mapbox/vector-tile';
import { PMTiles } from '../server/pmtiles.mjs';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const FILE = process.env.WORLD_PMTILES || '/Users/noah/GANtile/20260519.pmtiles';
const Z = 7;                 // landcover's most detailed zoom
const SAMPLES = 18;          // interior points per province
const EXTENT = 4096;

const pm = new PMTiles(FILE, { tileCacheBytes: 512 << 20 });
const geo = JSON.parse(fs.readFileSync(path.join(root, 'public/data/provinces.geojson'), 'utf8'));
const world = JSON.parse(fs.readFileSync(path.join(root, 'public/data/world.json'), 'utf8'));

const lon2xf = (lon, z) => ((lon + 180) / 360) * 2 ** z;
const lat2yf = (lat, z) => ((1 - Math.log(Math.tan((lat * Math.PI) / 180) + 1 / Math.cos((lat * Math.PI) / 180)) / Math.PI) / 2) * 2 ** z;

function mulberry32(a) {
  return () => { a |= 0; a = (a + 0x6d2b79f5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}
const rng = mulberry32(12345);

const ringHit = (px, py, r) => {
  let inside = false;
  for (let i = 0, j = r.length - 1; i < r.length; j = i++) {
    const [xi, yi] = r[i], [xj, yj] = r[j];
    if ((yi > py) !== (yj > py) && px < ((xj - xi) * (py - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
};
const polyHit = (px, py, rings) => ringHit(px, py, rings[0]) && !rings.slice(1).some((h) => ringHit(px, py, h));

// --- interior sample points per province ------------------------------------
function samplePoints(feature) {
  const polys = feature.geometry.type === 'Polygon' ? [feature.geometry.coordinates] : feature.geometry.coordinates;
  let best = polys[0], bestA = -Infinity;
  for (const p of polys) {
    let a = 0;
    for (let i = 0, j = p[0].length - 1; i < p[0].length; j = i++)
      a += p[0][j][0] * p[0][i][1] - p[0][i][0] * p[0][j][1];
    if (Math.abs(a) > bestA) { bestA = Math.abs(a); best = p; }
  }
  let x0 = 180, y0 = 90, x1 = -180, y1 = -90;
  for (const [x, y] of best[0]) { if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y; }
  const pts = [];
  for (let t = 0; t < SAMPLES * 40 && pts.length < SAMPLES; t++) {
    const lon = x0 + rng() * (x1 - x0), lat = y0 + rng() * (y1 - y0);
    if (polyHit(lon, lat, best)) pts.push([lon, lat]);
  }
  if (!pts.length) pts.push([(x0 + x1) / 2, (y0 + y1) / 2]);
  return pts;
}

// --- group every sample by tile, decode each tile once -----------------------
const jobs = new Map();   // "z/x/y" -> [{province, lon, lat}]
const samples = geo.features.map((f) => {
  const pts = samplePoints(f);
  for (const [lon, lat] of pts) {
    const fx = lon2xf(lon, Z), fy = lat2yf(lat, Z);
    const key = `${Math.floor(fx)}/${Math.floor(fy)}`;
    (jobs.get(key) ?? jobs.set(key, []).get(key)).push({ id: f.id, fx, fy });
  }
  return pts.length;
});
console.log(`${geo.features.length} provinces, ${samples.reduce((a, b) => a + b, 0)} samples, ${jobs.size} tiles at z${Z}`);

const votes = geo.features.map(() => ({}));
let decoded = 0, missing = 0;
const t0 = Date.now();
for (const [key, pts] of jobs) {
  const [tx, ty] = key.split('/').map(Number);
  const buf = pm.getTile(Z, tx, ty);
  if (!buf) { missing += pts.length; continue; }
  decoded++;
  const vt = new VectorTile(new PbfReader(buf));
  const layer = vt.layers.landcover;
  if (!layer) { missing += pts.length; continue; }
  // decode once, then test every sample that falls in this tile
  const feats = [];
  for (let i = 0; i < layer.length; i++) {
    const f = layer.feature(i);
    if (f.type !== 3) continue;
    feats.push({ kind: f.properties.kind, rings: f.loadGeometry().map((r) => r.map((p) => [p.x, p.y])) });
  }
  for (const p of pts) {
    const px = (p.fx - tx) * EXTENT, py = (p.fy - ty) * EXTENT;
    for (let i = feats.length - 1; i >= 0; i--) {         // later features draw on top
      if (polyHit(px, py, feats[i].rings)) { const v = votes[p.id]; v[feats[i].kind] = (v[feats[i].kind] || 0) + 1; break; }
    }
  }
}
console.log(`decoded ${decoded} tiles in ${Date.now() - t0}ms (${missing} samples with no cover)`);

// --- landcover kind -> game terrain -----------------------------------------
const MOUNTAINS = [
  [-125, 30, -105, 60], [-80, -56, -62, 9], [4, 43, 17, 48], [-10, 27, 10, 36],
  [60, 25, 100, 42], [36, 36, 50, 45], [55, 50, 70, 68], [128, 32, 146, 46],
  [-152, 55, -125, 68], [95, -12, 145, 5], [20, -34, 32, -22], [166, -47, 176, -34],
  [8, 59, 18, 70], [24, 42, 30, 47],
];
const inRange = (lon, lat) => MOUNTAINS.some(([a, b, c, d]) => lon >= a && lon <= c && lat >= b && lat <= d);

function terrainFor(kind, lon, lat, share) {
  const alat = Math.abs(lat);
  if (kind === 'glacier' || alat > 70) return 'arctic';
  if (inRange(lon, lat)) return kind === 'barren' || kind === 'grassland' ? 'mountain' : 'hills';
  switch (kind) {
    case 'urban_area': return 'urban';
    case 'forest': return alat < 14 ? 'jungle' : alat > 58 ? 'taiga' : 'forest';
    case 'farmland': return 'plains';
    case 'grassland': return alat > 60 ? 'tundra' : 'plains';
    case 'scrub': return alat > 60 ? 'tundra' : share > 0.6 ? 'hills' : 'plains';
    case 'barren': return alat > 62 ? 'tundra' : 'desert';
    default: return alat > 62 ? 'tundra' : 'plains';
  }
}

const counts = {};
geo.features.forEach((f, i) => {
  const v = votes[i];
  const total = Object.values(v).reduce((a, b) => a + b, 0);
  const [kind, n] = Object.entries(v).sort((a, b) => b[1] - a[1])[0] ?? ['none', 0];
  const lon = world.provinces[i].lon, lat = world.provinces[i].lat;
  const t = terrainFor(total ? kind : 'none', lon, lat, total ? n / total : 0);
  f.properties.terrain = t;
  f.properties.cover = total ? kind : 'unknown';
  world.provinces[i].t = t;
  counts[t] = (counts[t] || 0) + 1;
});

fs.writeFileSync(path.join(root, 'public/data/provinces.geojson'), JSON.stringify(geo));
fs.writeFileSync(path.join(root, 'public/data/world.json'), JSON.stringify(world));
console.log('terrain:', Object.entries(counts).sort((a, b) => b[1] - a[1]).map(([k, v]) => `${k} ${v}`).join(', '));
const spot = (name) => {
  const f = geo.features.filter((x) => x.properties.countryName === name).slice(0, 6);
  console.log(`  ${name}: ${f.map((x) => `${x.properties.name}=${x.properties.terrain}`).join(', ')}`);
};
['Zimbabwe', 'Germany', 'Egypt', 'Switzerland', 'Brazil', 'Norway'].forEach(spot);
await pm.close();
