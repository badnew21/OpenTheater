import { PMTiles } from '../../server/pmtiles.mjs';
import { PbfReader } from 'pbf';
import { VectorTile } from '@mapbox/vector-tile';
const pm = new PMTiles('/Users/noah/GANtile/20260519.pmtiles');
const ll2t = (lon, lat, z) => { const n = 2 ** z; return [Math.floor((lon + 180) / 360 * n), Math.floor((1 - Math.log(Math.tan(lat * Math.PI / 180) + 1 / Math.cos(lat * Math.PI / 180)) / Math.PI) / 2 * n)]; };
const SPOTS = [['Rotterdam',4.4,51.92],['Norfolk',-76.3,36.9],['Hamburg',10,53.55],['Singapore',103.85,1.29],['Frankfurt',8.57,50.05],['Ramstein',7.6,49.44],['Sevastopol',33.53,44.6],['SanDiego',-117.15,32.7],['Heathrow',-0.45,51.47]];
const want = /port|harbour|harbor|ferry|dock|marina|aero|airport|airfield|air_base|military|naval|barrack|runway|helipad|terminal|base/i;
for (const z of [11, 13, 15]) {
  const kinds = {};
  for (const [, lon, lat] of SPOTS) {
    const [x, y] = ll2t(lon, lat, z);
    const buf = pm.getTile(z, x, y); if (!buf) continue;
    const vt = new VectorTile(new PbfReader(buf));
    for (const [name, l] of Object.entries(vt.layers)) {
      for (let i = 0; i < Math.min(l.length, 4000); i++) {
        const p = l.feature(i).properties;
        for (const key of ['kind', 'kind_detail']) {
          const v = p[key];
          if (typeof v === 'string' && want.test(v)) {
            const k = `${name}.${key}=${v}`;
            kinds[k] = (kinds[k] || 0) + 1;
          }
        }
      }
    }
  }
  console.log(`--- z${z}`);
  for (const [k, v] of Object.entries(kinds).sort((a, b) => b[1] - a[1]).slice(0, 22)) console.log('   ', k, v);
}
await pm.close();
