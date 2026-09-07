// Align the political layer with the map it sits on.
//
// Province polygons come from Natural Earth; the coastline you actually see is
// OpenStreetMap, out of the tile archive. Wherever those two disagree the
// political fill spills into the sea or leaves a rim of unclaimed beach. This
// clips every coastal province against the archive's own land polygons, so the
// political border follows the rendered shore exactly.
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import { fileURLToPath } from 'node:url';
import { PbfReader } from 'pbf';
import { VectorTile } from '@mapbox/vector-tile';
import polyclip from 'polygon-clipping';
import { PMTiles } from '../server/pmtiles.mjs';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const FILE = process.env.WORLD_PMTILES || '/Users/noah/GANtile/20260519.pmtiles';
const LAND_Z = 7;          // detail of the coastline we clip against
/**
 * Lattice for the clipped outline, in degrees. The raw OSM shore carries a
 * vertex every ~150 m, which is far more than a political overlay needs and
 * nine times the file size. Coastal edges are not shared with a neighbouring
 * province, so thinning them cannot disturb the frontline geometry.
 */
const COAST_QUANT = 0.004;
const EXTENT = 4096;
const GRID = 2;            // degrees, for the land index

const pm = new PMTiles(FILE, { tileCacheBytes: 256 << 20 });
const geoPath = path.join(root, 'public/data/provinces.geojson');
const geo = JSON.parse(fs.readFileSync(geoPath, 'utf8'));
const world = JSON.parse(fs.readFileSync(path.join(root, 'public/data/world.json'), 'utf8'));

/** Signed area in tile units; sign tells an outer ring from a hole. */
function ringArea(ring) {
  let a = 0;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    a += ring[j].x * ring[i].y - ring[i].x * ring[j].y;
  }
  return a / 2;
}

/**
 * Split a tile polygon's rings into proper polygons: each outer ring starts a
 * new one, and the rings that follow it with the opposite winding are its holes.
 */
function splitRings(geometry, lon0, lon1, lat0, lat1) {
  const toLngLat = (ring) => {
    const pts = ring.map((p) => [
      lon0 + (p.x / EXTENT) * (lon1 - lon0),
      lat0 + (p.y / EXTENT) * (lat1 - lat0),
    ]);
    const first = pts[0], last = pts[pts.length - 1];
    if (first[0] !== last[0] || first[1] !== last[1]) pts.push([first[0], first[1]]);
    return pts;
  };

  const polys = [];
  let current = null;
  for (const ring of geometry) {
    if (ring.length < 4) continue;
    const area = ringArea(ring);
    if (area === 0) continue;
    const pts = toLngLat(ring);
    if (pts.length < 4) continue;
    if (area > 0 || !current) {           // outer ring: begin a new polygon
      current = [pts];
      polys.push(current);
    } else {
      current.push(pts);                  // hole in the polygon being built
    }
  }
  return polys;
}

const tile2lon = (x, z) => (x / 2 ** z) * 360 - 180;
const tile2lat = (y, z) => {
  const n = Math.PI - (2 * Math.PI * y) / 2 ** z;
  return (180 / Math.PI) * Math.atan(0.5 * (Math.exp(n) - Math.exp(-n)));
};

// ------------------------------------------------------------- land index --

const land = new Map();      // "gx,gy" -> [{rings, bbox}]
let landPolys = 0;
const t0 = Date.now();
const n = 2 ** LAND_Z;
for (let x = 0; x < n; x++) {
  for (let y = 0; y < n; y++) {
    const buf = pm.getTile(LAND_Z, x, y);
    if (!buf) continue;
    const layer = new VectorTile(new PbfReader(buf)).layers.earth;
    if (!layer) continue;
    const lon0 = tile2lon(x, LAND_Z), lon1 = tile2lon(x + 1, LAND_Z);
    const lat0 = tile2lat(y, LAND_Z), lat1 = tile2lat(y + 1, LAND_Z);
    for (let i = 0; i < layer.length; i++) {
      const f = layer.feature(i);
      if (f.type !== 3) continue;

      // A vector-tile polygon feature can hold several outer rings, not just
      // one outer plus holes: ring winding says which is which. Treating every
      // ring after the first as a hole punches the land full of gaps, which is
      // exactly how coastal provinces went missing.
      for (const poly of splitRings(f.loadGeometry(), lon0, lon1, lat0, lat1)) {
        let x0 = 180, y0 = 90, x1 = -180, y1 = -90;
        for (const [px, py] of poly[0]) {
          if (px < x0) x0 = px; if (px > x1) x1 = px;
          if (py < y0) y0 = py; if (py > y1) y1 = py;
        }
        const entry = { rings: poly, bbox: [x0, y0, x1, y1] };
        landPolys++;
        for (let gx = Math.floor(x0 / GRID); gx <= Math.floor(x1 / GRID); gx++) {
          for (let gy = Math.floor(y0 / GRID); gy <= Math.floor(y1 / GRID); gy++) {
            const key = `${gx},${gy}`;
            const list = land.get(key) ?? [];
            list.push(entry);
            land.set(key, list);
          }
        }
      }
    }
  }
}
console.log(`land: ${landPolys} polygons at z${LAND_Z} in ${((Date.now() - t0) / 1000).toFixed(1)}s`);

const nearbyLand = (bbox) => {
  const out = new Set();
  for (let gx = Math.floor(bbox[0] / GRID); gx <= Math.floor(bbox[2] / GRID); gx++) {
    for (let gy = Math.floor(bbox[1] / GRID); gy <= Math.floor(bbox[3] / GRID); gy++) {
      for (const e of land.get(`${gx},${gy}`) ?? []) {
        if (e.bbox[0] > bbox[2] || e.bbox[2] < bbox[0] || e.bbox[1] > bbox[3] || e.bbox[3] < bbox[1]) continue;
        out.add(e);
      }
    }
  }
  return [...out];
};

/** Snap a ring onto the lattice and drop the points that collapse together. */
function quantize(ring) {
  const snap = (v) => Math.round(v / COAST_QUANT) * COAST_QUANT;
  const out = [];
  for (const [lon, lat] of ring) {
    const p = [Math.round(snap(lon) * 1e4) / 1e4, Math.round(snap(lat) * 1e4) / 1e4];
    const last = out[out.length - 1];
    if (!last || last[0] !== p[0] || last[1] !== p[1]) out.push(p);
  }
  if (out.length >= 2) {
    const [a, b] = [out[0], out[out.length - 1]];
    if (a[0] !== b[0] || a[1] !== b[1]) out.push([a[0], a[1]]);
  }
  return out.length >= 4 ? out : ring.map(([lon, lat]) => [Math.round(lon * 1e4) / 1e4, Math.round(lat * 1e4) / 1e4]);
}

const areaOf = (polys) => {
  let a = 0;
  for (const poly of polys) {
    for (const ring of poly) {
      let s = 0;
      for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
        s += ring[j][0] * ring[i][1] - ring[i][0] * ring[j][1];
      }
      a += Math.abs(s / 2) * (ring === poly[0] ? 1 : -1);
    }
  }
  return a;
};

// ------------------------------------------------------------------ clip ---

const t1 = Date.now();
let clipped = 0, unchanged = 0, failed = 0, emptied = 0;
let areaBefore = 0, areaAfter = 0;

for (const f of geo.features) {
  // Only coastal provinces need it. Inland borders are untouched, which keeps
  // the shared-edge lattice - and so the frontline geometry - exact.
  if (!f.properties.coastal) { unchanged++; continue; }
  const polys = f.geometry.type === 'Polygon' ? [f.geometry.coordinates] : f.geometry.coordinates;
  let x0 = 180, y0 = 90, x1 = -180, y1 = -90;
  for (const poly of polys) {
    for (const [px, py] of poly[0]) {
      if (px < x0) x0 = px; if (px > x1) x1 = px;
      if (py < y0) y0 = py; if (py > y1) y1 = py;
    }
  }
  const pieces = nearbyLand([x0, y0, x1, y1]);
  if (!pieces.length) { unchanged++; continue; }

  const before = areaOf(polys);
  // Intersect against each land polygon separately and union the results: the
  // tiles cut the coastline into pieces that do not overlap each other, so
  // intersecting against all of them at once yields nothing.
  let result;
  try {
    const parts = [];
    for (const piece of pieces) {
      const hit = polyclip.intersection(polys, [piece.rings]);
      if (hit && hit.length) parts.push(...hit);
    }
    result = parts.length > 1 ? polyclip.union(...parts.map((p) => [p])) : parts;
  } catch {
    failed++;
    continue;
  }
  if (!result || !result.length) { emptied++; continue; }   // keep the original
  const after = areaOf(result);
  // a clip that removes almost everything means the two datasets disagree
  // wildly here; trust the original rather than deleting a province
  if (after < before * 0.35) { emptied++; continue; }

  areaBefore += before;
  areaAfter += after;
  const thinned = result.map((poly) => poly.map(quantize)).filter((poly) => poly[0]?.length >= 4);
  if (!thinned.length) { emptied++; continue; }
  f.geometry = thinned.length === 1
    ? { type: 'Polygon', coordinates: thinned[0] }
    : { type: 'MultiPolygon', coordinates: thinned };
  clipped++;
}

console.log(`clipped ${clipped} coastal provinces in ${((Date.now() - t1) / 1000).toFixed(1)}s`);
console.log(`  untouched inland ${unchanged}, kept as-is ${emptied}, failed ${failed}`);
console.log(`  coastal area trimmed by ${(100 * (1 - areaAfter / areaBefore)).toFixed(1)}%`);

// province centres move when their shape does
for (const f of geo.features) {
  const id = f.id;
  const polys = f.geometry.type === 'Polygon' ? [f.geometry.coordinates] : f.geometry.coordinates;
  let best = polys[0], bestA = -1;
  for (const poly of polys) {
    const a = areaOf([poly]);
    if (a > bestA) { bestA = a; best = poly; }
  }
  let cx = 0, cy = 0;
  for (const [px, py] of best[0]) { cx += px; cy += py; }
  cx /= best[0].length; cy /= best[0].length;
  if (isFinite(cx) && isFinite(cy)) {
    world.provinces[id].lon = Math.round(cx * 1e4) / 1e4;
    world.provinces[id].lat = Math.round(cy * 1e4) / 1e4;
  }
}

const out = JSON.stringify(geo);
fs.writeFileSync(geoPath, out);
fs.writeFileSync(`${geoPath}.gz`, zlib.gzipSync(out, { level: 9 }));
fs.writeFileSync(path.join(root, 'public/data/world.json'), JSON.stringify(world));
console.log(`size ${(out.length / 1e6).toFixed(2)} MB (${(fs.statSync(`${geoPath}.gz`).size / 1e6).toFixed(2)} MB gzipped)`);
await pm.close();
