// Reader benchmark: cold directory walk, hot cache, and viewport-shaped bursts.
import { PMTiles } from '../server/pmtiles.mjs';

const FILE = process.env.WORLD_PMTILES || '/Users/noah/GANtile/20260519.pmtiles';
const lon2x = (lon, z) => Math.floor(((lon + 180) / 360) * 2 ** z);
const lat2y = (lat, z) => Math.floor(((1 - Math.log(Math.tan((lat * Math.PI) / 180) + 1 / Math.cos((lat * Math.PI) / 180)) / Math.PI) / 2) * 2 ** z);

function bench(label, fn, iters) {
  const t0 = process.hrtime.bigint();
  let bytes = 0, hits = 0;
  for (let i = 0; i < iters; i++) { const b = fn(i); if (b) { bytes += b.length; hits++; } }
  const ms = Number(process.hrtime.bigint() - t0) / 1e6;
  console.log(
    `${label.padEnd(34)} ${String(iters).padStart(6)} tiles  ${ms.toFixed(1).padStart(8)} ms  ` +
    `${(ms / iters * 1000).toFixed(1).padStart(7)} µs/tile  ${(iters / (ms / 1000)).toFixed(0).padStart(7)} tiles/s  ` +
    `${(bytes / 1e6 / (ms / 1000)).toFixed(0).padStart(5)} MB/s  hits ${hits}`);
  return ms;
}

const pm = new PMTiles(FILE);
console.log(`archive: z${pm.header.minZoom}-${pm.header.maxZoom}, ${(pm.header.tileEntries / 1e6).toFixed(1)}M entries\n`);

// a viewport-sized block of tiles over a dense city, repeated
const CITY = [13.377, 52.516];
for (const z of [15, 13, 10, 6]) {
  const x0 = lon2x(CITY[0], z), y0 = lat2y(CITY[1], z);
  const n = 16;
  bench(`cold z${z} ${n}x${n} block`, (i) => pm.getTileRaw(z, x0 + (i % n), y0 + ((i / n) | 0)), n * n);
  bench(`hot  z${z} ${n}x${n} block`, (i) => pm.getTileRaw(z, x0 + (i % n), y0 + ((i / n) | 0)), n * n);
}

// scattered reads: worst case for directory and page cache
const rnd = (s) => () => ((s = (s * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff);
const r = rnd(7);
const scatter = Array.from({ length: 400 }, () => {
  const z = 12, n = 2 ** z;
  return [z, Math.floor(r() * n), Math.floor(r() * n)];
});
bench('scattered z12 worldwide', (i) => pm.getTileRaw(...scatter[i]), scatter.length);
bench('scattered z12 worldwide (warm)', (i) => pm.getTileRaw(...scatter[i]), scatter.length);

console.log('\nstats', pm.stats);

// --- concurrent path -------------------------------------------------------
async function benchAsync(label, coords) {
  const t0 = process.hrtime.bigint();
  const out = await pm.getTilesRaw(coords);
  const ms = Number(process.hrtime.bigint() - t0) / 1e6;
  const bytes = out.reduce((s, b) => s + (b ? b.length : 0), 0);
  console.log(
    `${label.padEnd(34)} ${String(coords.length).padStart(6)} tiles  ${ms.toFixed(1).padStart(8)} ms  ` +
    `${(ms / coords.length * 1000).toFixed(1).padStart(7)} µs/tile  ${(coords.length / (ms / 1000)).toFixed(0).padStart(7)} tiles/s  ` +
    `${(bytes / 1e6 / (ms / 1000)).toFixed(0).padStart(5)} MB/s`);
}

const r2 = rnd(99);
const cold = Array.from({ length: 400 }, () => { const z = 12, n = 2 ** z; return [z, Math.floor(r2() * n), Math.floor(r2() * n)]; });
await benchAsync('CONCURRENT scattered z12 cold', cold);
await benchAsync('CONCURRENT scattered z12 warm', cold);

const z = 15, cx = lon2x(2.3522, z), cy = lat2y(48.8566, z);   // Paris viewport
const view = [];
for (let dx = 0; dx < 20; dx++) for (let dy = 0; dy < 20; dy++) view.push([z, cx + dx - 10, cy + dy - 10]);
await benchAsync('CONCURRENT z15 viewport cold', view);
await benchAsync('CONCURRENT z15 viewport warm', view);
console.log('\ncache', pm.cacheInfo, '\nstats', pm.stats);
await pm.close();
