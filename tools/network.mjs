// Extract the strategic layer the game needs from the world archive:
//   - a road graph armies can march along
//   - every airfield, port and military base, for air and naval basing
// Output: public/data/roads.json, public/data/installations.json
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { PbfReader } from 'pbf';
import { VectorTile } from '@mapbox/vector-tile';
import { PMTiles } from '../server/pmtiles.mjs';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const FILE = process.env.WORLD_PMTILES || '/Users/noah/GANtile/20260519.pmtiles';

const ROAD_Z = 7;            // strategic road network
const INSTALL_Z = 9;         // where aerodromes / bases / docks start to appear
const SNAP = 0.06;           // road node lattice, degrees (~6 km)
const EXTENT = 4096;

const pm = new PMTiles(FILE, { tileCacheBytes: 256 << 20 });
const world = JSON.parse(fs.readFileSync(path.join(root, 'public/data/world.json'), 'utf8'));

const tile2lon = (x, z) => (x / 2 ** z) * 360 - 180;
const tile2lat = (y, z) => {
  const n = Math.PI - (2 * Math.PI * y) / 2 ** z;
  return (180 / Math.PI) * Math.atan(0.5 * (Math.exp(n) - Math.exp(-n)));
};

/** Province lookup on a coarse grid, so extracted features can be attributed. */
const GRID = 2;
const grid = new Map();
for (const p of world.provinces) {
  const k = `${Math.floor(p.lon / GRID)},${Math.floor(p.lat / GRID)}`;
  const list = grid.get(k) ?? [];
  list.push(p);
  grid.set(k, list);
}
function nearestProvince(lon, lat) {
  let best = -1, bestD = Infinity;
  for (let dx = -1; dx <= 1; dx++) {
    for (let dy = -1; dy <= 1; dy++) {
      const list = grid.get(`${Math.floor(lon / GRID) + dx},${Math.floor(lat / GRID) + dy}`);
      if (!list) continue;
      for (const p of list) {
        const d = (p.lon - lon) ** 2 + (p.lat - lat) ** 2;
        if (d < bestD) { bestD = d; best = p.id; }
      }
    }
  }
  return best;
}

// --------------------------------------------------------------- road graph --

const nodeId = new Map();       // "x,y" lattice key -> index
const nodeLon = [];
const nodeLat = [];
const edges = new Map();        // "a,b" -> length in km

const snapKey = (lon, lat) => `${Math.round(lon / SNAP)},${Math.round(lat / SNAP)}`;
function node(lon, lat) {
  const k = snapKey(lon, lat);
  let id = nodeId.get(k);
  if (id === undefined) {
    id = nodeLon.length;
    nodeId.set(k, id);
    nodeLon.push(Math.round(lon * 1e4) / 1e4);
    nodeLat.push(Math.round(lat * 1e4) / 1e4);
  }
  return id;
}
const km = (aLon, aLat, bLon, bLat) => {
  const lat = ((aLat + bLat) / 2) * (Math.PI / 180);
  return Math.hypot((bLon - aLon) * 111.32 * Math.cos(lat), (bLat - aLat) * 110.54);
};

let roadTiles = 0, roadFeatures = 0;
const t0 = Date.now();
const nRoad = 2 ** ROAD_Z;
for (let x = 0; x < nRoad; x++) {
  for (let y = 0; y < nRoad; y++) {
    const buf = pm.getTile(ROAD_Z, x, y);
    if (!buf) continue;
    const vt = new VectorTile(new PbfReader(buf));
    const layer = vt.layers.roads;
    if (!layer) continue;
    roadTiles++;
    const lon0 = tile2lon(x, ROAD_Z), lon1 = tile2lon(x + 1, ROAD_Z);
    const lat0 = tile2lat(y, ROAD_Z), lat1 = tile2lat(y + 1, ROAD_Z);
    for (let i = 0; i < layer.length; i++) {
      const f = layer.feature(i);
      const kind = f.properties.kind;
      if (kind !== 'highway' && kind !== 'major_road') continue;
      if (f.type !== 2) continue;
      roadFeatures++;
      for (const line of f.loadGeometry()) {
        let prev = -1;
        for (const pt of line) {
          const lon = lon0 + (pt.x / EXTENT) * (lon1 - lon0);
          const lat = lat0 + (pt.y / EXTENT) * (lat1 - lat0);
          if (lon < -180 || lon > 180 || lat < -85 || lat > 85) { prev = -1; continue; }
          const id = node(lon, lat);
          if (prev >= 0 && prev !== id) {
            const key = prev < id ? `${prev},${id}` : `${id},${prev}`;
            if (!edges.has(key)) {
              edges.set(key, Math.round(km(nodeLon[prev], nodeLat[prev], nodeLon[id], nodeLat[id]) * 10) / 10);
            }
          }
          prev = id;
        }
      }
    }
  }
}
console.log(`roads: ${roadTiles} tiles, ${roadFeatures} ways -> ${nodeLon.length} nodes, ${edges.size} edges (${((Date.now() - t0) / 1000).toFixed(1)}s)`);

// each province gets the road node nearest its centre: where a march starts
const provinceNode = world.provinces.map((p) => {
  let best = -1, bestD = Infinity;
  for (let i = 0; i < nodeLon.length; i++) {
    const d = (nodeLon[i] - p.lon) ** 2 + (nodeLat[i] - p.lat) ** 2;
    if (d < bestD) { bestD = d; best = i; }
  }
  return bestD < 4 ? best : -1;      // no road within ~2 degrees: none
});
const connected = provinceNode.filter((n) => n >= 0).length;
console.log(`provinces with a road head: ${connected}/${world.provinces.length}`);

// Binary, because a million-edge graph as JSON is 40 MB of parsing the browser
// does not need to do: two float arrays for the nodes, one pair array for the
// edges, and their lengths.
const nodeCount = nodeLon.length;
const edgeList = [...edges];
const lonArr = new Float32Array(nodeCount);
const latArr = new Float32Array(nodeCount);
for (let i = 0; i < nodeCount; i++) { lonArr[i] = nodeLon[i]; latArr[i] = nodeLat[i]; }
const edgeArr = new Uint32Array(edgeList.length * 2);
const lenArr = new Float32Array(edgeList.length);
edgeList.forEach(([k, len], i) => {
  const [a, b] = k.split(',').map(Number);
  edgeArr[i * 2] = a; edgeArr[i * 2 + 1] = b; lenArr[i] = len;
});
const provArr = new Int32Array(provinceNode);
fs.writeFileSync(path.join(root, 'public/data/roads.bin'), Buffer.concat([
  Buffer.from(lonArr.buffer), Buffer.from(latArr.buffer),
  Buffer.from(edgeArr.buffer), Buffer.from(lenArr.buffer), Buffer.from(provArr.buffer),
]));
fs.writeFileSync(path.join(root, 'public/data/roads.json'), JSON.stringify({
  snap: SNAP, nodes: nodeCount, edges: edgeList.length, provinces: provArr.length,
}));

// ------------------------------------------------------------ installations --

const AIR = new Set(['aerodrome', 'airfield']);
const BASE = new Set(['military', 'naval_base']);
const PORT = new Set(['marina', 'ferry_terminal', 'harbour', 'port']);

const installations = [];
const seen = new Set();
const t1 = Date.now();
let installTiles = 0;
const nInst = 2 ** INSTALL_Z;
for (let x = 0; x < nInst; x++) {
  for (let y = 0; y < nInst; y++) {
    const buf = pm.getTile(INSTALL_Z, x, y);
    if (!buf) continue;
    const vt = new VectorTile(new PbfReader(buf));
    installTiles++;
    const lon0 = tile2lon(x, INSTALL_Z), lon1 = tile2lon(x + 1, INSTALL_Z);
    const lat0 = tile2lat(y, INSTALL_Z), lat1 = tile2lat(y + 1, INSTALL_Z);
    // coastal cities double as ports: OSM harbour tagging is far too sparse to
    // base a navy on, but every coastal city of size has somewhere to tie up
    const places = vt.layers.places;
    if (places) {
      for (let i = 0; i < places.length; i++) {
        const f = places.feature(i);
        if (f.properties.kind !== 'locality') continue;
        const rank = Number(f.properties.population_rank ?? 0);
        if (rank < 9) continue;
        const g = f.loadGeometry()[0]?.[0];
        if (!g) continue;
        const lon = lon0 + (g.x / EXTENT) * (lon1 - lon0);
        const lat = lat0 + (g.y / EXTENT) * (lat1 - lat0);
        const prov = nearestProvince(lon, lat);
        if (prov < 0 || !world.provinces[prov].o) continue;      // coastal only
        const key = `city:${f.id ?? `${lon},${lat}`}`;
        if (seen.has(key)) continue;
        seen.add(key);
        installations.push({
          t: 'port', city: 1,
          n: f.properties['name:en'] ?? f.properties.name ?? '',
          lon: Math.round(lon * 1e4) / 1e4,
          lat: Math.round(lat * 1e4) / 1e4,
          p: prov,
        });
      }
    }

    for (const layerName of ['landuse', 'pois', 'water']) {
      const layer = vt.layers[layerName];
      if (!layer) continue;
      for (let i = 0; i < layer.length; i++) {
        const f = layer.feature(i);
        const kind = f.properties.kind;
        let type = null;
        if (AIR.has(kind)) type = 'air';
        else if (BASE.has(kind)) type = 'base';
        else if (PORT.has(kind) || (layerName === 'water' && kind === 'dock')) type = 'port';
        if (!type) continue;
        if (f.id != null && seen.has(f.id)) continue;
        if (f.id != null) seen.add(f.id);
        // centroid of the feature's first ring / line
        const geom = f.loadGeometry()[0];
        if (!geom?.length) continue;
        let sx = 0, sy = 0;
        for (const p of geom) { sx += p.x; sy += p.y; }
        const lon = lon0 + (sx / geom.length / EXTENT) * (lon1 - lon0);
        const lat = lat0 + (sy / geom.length / EXTENT) * (lat1 - lat0);
        if (!isFinite(lon) || !isFinite(lat)) continue;
        installations.push({
          t: type,
          n: f.properties['name:en'] ?? f.properties.name ?? '',
          lon: Math.round(lon * 1e4) / 1e4,
          lat: Math.round(lat * 1e4) / 1e4,
          p: nearestProvince(lon, lat),
        });
      }
    }
  }
}
console.log(`installations: scanned ${installTiles} tiles at z${INSTALL_Z} (${((Date.now() - t1) / 1000).toFixed(1)}s)`);

// Ports live at higher zoom than the rest, so look only where they can be:
// a block of z11 tiles around every coastal province.
const PORT_Z = 11;
const lon2t = (lon, z) => Math.floor(((lon + 180) / 360) * 2 ** z);
const lat2t = (lat, z) => Math.floor(((1 - Math.log(Math.tan((lat * Math.PI) / 180) + 1 / Math.cos((lat * Math.PI) / 180)) / Math.PI) / 2) * 2 ** z);
const t2 = Date.now();
let portTiles = 0, portsFound = 0;
const portSeen = new Set();
for (const p of world.provinces) {
  if (!p.o) continue;                            // coastal provinces only
  const cx = lon2t(p.lon, PORT_Z), cy = lat2t(p.lat, PORT_Z);
  for (let dx = -2; dx <= 2; dx++) {
    for (let dy = -2; dy <= 2; dy++) {
      const buf = pm.getTile(PORT_Z, cx + dx, cy + dy);
      if (!buf) continue;
      portTiles++;
      const vt = new VectorTile(new PbfReader(buf));
      const lon0 = tile2lon(cx + dx, PORT_Z), lon1 = tile2lon(cx + dx + 1, PORT_Z);
      const lat0 = tile2lat(cy + dy, PORT_Z), lat1 = tile2lat(cy + dy + 1, PORT_Z);
      for (const layerName of ['water', 'pois', 'landuse']) {
        const layer = vt.layers[layerName];
        if (!layer) continue;
        for (let i = 0; i < layer.length; i++) {
          const f = layer.feature(i);
          const kind = f.properties.kind;
          const isPort = PORT.has(kind) || kind === 'dock' || kind === 'harbour';
          if (!isPort) continue;
          if (f.id != null && portSeen.has(f.id)) continue;
          if (f.id != null) portSeen.add(f.id);
          const geom = f.loadGeometry()[0];
          if (!geom?.length) continue;
          let sx = 0, sy = 0;
          for (const q of geom) { sx += q.x; sy += q.y; }
          const lon = lon0 + (sx / geom.length / EXTENT) * (lon1 - lon0);
          const lat = lat0 + (sy / geom.length / EXTENT) * (lat1 - lat0);
          if (!isFinite(lon) || !isFinite(lat)) continue;
          installations.push({
            t: 'port',
            n: f.properties['name:en'] ?? f.properties.name ?? '',
            lon: Math.round(lon * 1e4) / 1e4,
            lat: Math.round(lat * 1e4) / 1e4,
            p: p.id,
          });
          portsFound++;
        }
      }
    }
  }
}
console.log(`ports: scanned ${portTiles} tiles at z${PORT_Z}, found ${portsFound} (${((Date.now() - t2) / 1000).toFixed(1)}s)`);

const byType = {};
for (const i of installations) byType[i.t] = (byType[i.t] || 0) + 1;
console.log('  ', JSON.stringify(byType));
fs.writeFileSync(path.join(root, 'public/data/installations.json'), JSON.stringify({ installations }));

for (const f of ['roads.bin', 'roads.json', 'installations.json']) {
  console.log(`${f}: ${(fs.statSync(path.join(root, 'public/data', f)).size / 1e6).toFixed(2)} MB`);
}
await pm.close();
