// What is actually in the tiles: layer -> kind -> count, per zoom band.
import { PMTiles } from '../../server/pmtiles.mjs';
import { PbfReader } from 'pbf';
import { VectorTile } from '@mapbox/vector-tile';
const pm = new PMTiles('/Users/noah/GANtile/20260519.pmtiles');
const ll2t = (lon, lat, z) => { const n = 2 ** z; return [Math.floor((lon + 180) / 360 * n), Math.floor((1 - Math.log(Math.tan(lat * Math.PI / 180) + 1 / Math.cos(lat * Math.PI / 180)) / Math.PI) / 2 * n)]; };
const SPOTS = [['Berlin', 13.377, 52.516], ['Paris', 2.35, 48.86], ['Kansas', -98.5, 39.0], ['Sahara', 10, 24], ['Alps', 10.5, 46.5]];
for (const z of [4, 8, 12, 15]) {
  const layers = {};
  for (const [, lon, lat] of SPOTS) {
    const [x, y] = ll2t(lon, lat, z);
    const buf = pm.getTile(z, x, y); if (!buf) continue;
    const vt = new VectorTile(new PbfReader(buf));
    for (const [name, l] of Object.entries(vt.layers)) {
      const bag = layers[name] ??= { n: 0, kinds: {}, detail: {}, props: new Set() };
      bag.n += l.length;
      for (let i = 0; i < Math.min(l.length, 900); i++) {
        const p = l.feature(i).properties;
        if (p.kind != null) bag.kinds[p.kind] = (bag.kinds[p.kind] || 0) + 1;
        if (p.kind_detail != null) bag.detail[p.kind_detail] = (bag.detail[p.kind_detail] || 0) + 1;
        for (const k of Object.keys(p)) if (!k.startsWith('name')) bag.props.add(k);
      }
    }
  }
  console.log(`\n===== z${z} =====`);
  for (const [name, b] of Object.entries(layers)) {
    const top = (o) => Object.entries(o).sort((a, c) => c[1] - a[1]).slice(0, 9).map(([k, v]) => `${k}(${v})`).join(' ');
    console.log(`${name.padEnd(11)} n=${String(b.n).padEnd(6)} kinds: ${top(b.kinds) || '-'}`);
    if (Object.keys(b.detail).length) console.log(`${''.padEnd(11)} detail: ${top(b.detail)}`);
    console.log(`${''.padEnd(11)} props: ${[...b.props].join(',')}`);
  }
}
await pm.close();
