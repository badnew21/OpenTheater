import { PMTiles } from '/Users/noah/hoi/server/pmtiles.mjs';
import { PbfReader } from 'pbf';
import { VectorTile } from '@mapbox/vector-tile';
const p = new PMTiles('/Users/noah/GANtile/20260519.pmtiles');
const ll2t = (lon, lat, z) => { const n = 2 ** z; return [Math.floor((lon + 180) / 360 * n), Math.floor((1 - Math.log(Math.tan(lat * Math.PI / 180) + 1 / Math.cos(lat * Math.PI / 180)) / Math.PI) / 2 * n)]; };
for (const [name, lon, lat, z] of [['Manhattan', -73.9857, 40.7484, 15], ['Berlin', 13.377, 52.516, 15], ['Ardennes', 5.7, 50.0, 14], ['world', 0, 0, 0], ['Europe', 10, 50, 6], ['ocean', -140, 0, 15]]) {
  const [x, y] = ll2t(lon, lat, z); const t1 = Date.now();
  const buf = p.getTile(z, x, y); const ms = Date.now() - t1;
  if (!buf) { console.log(name.padEnd(10), `${z}/${x}/${y}`, 'MISS', ms + 'ms'); continue; }
  const vt = new VectorTile(new PbfReader(buf));
  console.log(name.padEnd(10), `${z}/${x}/${y}`.padEnd(20), (buf.length / 1024).toFixed(0) + 'KB', (ms + 'ms').padEnd(6),
    Object.keys(vt.layers).map(k => k + ':' + vt.layers[k].length).join(' '));
}
const [x, y] = ll2t(-73.9857, 40.7484, 15);
const vt = new VectorTile(new PbfReader(p.getTile(15, x, y)));
const B = vt.layers.buildings;
console.log('--- buildings:', B.length, 'extent', B.extent);
let withH = 0, hs = [];
for (let i = 0; i < B.length; i++) { const h = B.feature(i).properties.height; if (h != null) { withH++; hs.push(h); } }
console.log('with height:', withH, 'max', Math.max(...hs), 'median', hs.sort((a, b) => a - b)[hs.length >> 1]);
for (let i = 0; i < 4; i++) { const f = B.feature(i); console.log('  id=' + f.id, 'type=' + f.type, JSON.stringify(f.properties)); }
for (const L of ['roads', 'pois', 'landuse', 'places']) {
  const l = vt.layers[L]; if (!l) continue;
  console.log(`--- ${L}: ${l.length}`);
  for (let i = 0; i < 2; i++) { const f = l.feature(i); console.log('   id=' + f.id, JSON.stringify(f.properties).slice(0, 200)); }
}
// throughput: a 16x16 block of z15 tiles
const t2 = Date.now(); let bytes = 0, n = 0;
for (let dx = 0; dx < 16; dx++) for (let dy = 0; dy < 16; dy++) { const b = p.getTileRaw(15, x + dx, y + dy); if (b) { bytes += b.length; n++; } }
console.log(`256 z15 tiles: ${n} hits, ${(bytes / 1e6).toFixed(1)}MB, ${Date.now() - t2}ms`);
console.log('stats', p.stats);
