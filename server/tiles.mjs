// HTTP surface for the world archive: vector tiles + archive metadata.
// Used by the Vite dev server (middleware) and by the standalone host server,
// so peers in a P2P game can pull the world from whoever is hosting.
import fs from 'node:fs';
import path from 'node:path';
import { PMTiles } from './pmtiles.mjs';

export const WORLD_FILE = process.env.WORLD_PMTILES || '/Users/noah/GANtile/20260519.pmtiles';

const TILE_RE = /^\/world\/tiles\/(\d+)\/(\d+)\/(\d+)\.mvt$/;

export function createWorld(file = WORLD_FILE) {
  const pm = new PMTiles(file);
  const served = new Map();   // "z" -> count, for diagnosing what the client asks for
  const { minZoom, maxZoom, bounds, center, centerZoom } = pm.header;

  const tilejson = (origin) => ({
    tilejson: '3.0.0',
    name: pm.metadata.name ?? 'world',
    attribution: pm.metadata.attribution ?? '',
    tiles: [`${origin}/world/tiles/{z}/{x}/{y}.mvt`],
    minzoom: minZoom, maxzoom: maxZoom,
    bounds, center: [...center, centerZoom],
    vector_layers: pm.metadata.vector_layers ?? [],
  });

  async function handle(req, res) {
    const url = new URL(req.url, 'http://localhost');

    // Generated data is big and highly compressible. Serve the pre-gzipped
    // copy when one exists rather than shipping megabytes of raw JSON.
    if (url.pathname.startsWith('/data/') && !url.pathname.includes('..')) {
      const file = path.join(process.cwd(), 'public', url.pathname);
      const gz = `${file}.gz`;
      const accepts = (req.headers['accept-encoding'] ?? '').includes('gzip');
      if (accepts && fs.existsSync(gz)) {
        // Generated data is regenerated often and its ids must match world.json
        // exactly, so the browser has to revalidate rather than serve a stale
        // copy against a newer index.
        const stat = fs.statSync(gz);
        const etag = `W/"${stat.size}-${Math.round(stat.mtimeMs)}"`;
        if (req.headers['if-none-match'] === etag) {
          res.writeHead(304, { ETag: etag, 'Cache-Control': 'no-cache' });
          res.end();
          return true;
        }
        const body = fs.readFileSync(gz);
        res.writeHead(200, {
          'Content-Type': 'application/json',
          'Content-Encoding': 'gzip',
          'Content-Length': body.length,
          'Cache-Control': 'no-store',
          ETag: etag,
        });
        res.end(body);
        return true;
      }
    }
    const m = TILE_RE.exec(url.pathname);
    if (m) {
      const [z, x, y] = m.slice(1).map(Number);
      served.set(z, (served.get(z) ?? 0) + 1);
      if (process.env.TILE_LOG) console.log(`tile ${z}/${x}/${y}`);
      let raw = null;
      try { raw = await pm.getTileRawAsync(z, x, y); } catch (err) { console.error('tile error', z, x, y, err.message); }
      if (!raw) { res.writeHead(204, { 'Access-Control-Allow-Origin': '*' }).end(); return true; }
      res.writeHead(200, {
        'Content-Type': 'application/vnd.mapbox-vector-tile',
        'Content-Encoding': pm.tileEncoding,      // pass the archive's gzip straight through
        'Content-Length': raw.length,
        'Cache-Control': 'public, max-age=604800',
        'Access-Control-Allow-Origin': '*',
      });
      res.end(raw);
      return true;
    }
    if (url.pathname === '/world/meta.json') {
      const body = JSON.stringify({
        file, header: pm.header, metadata: pm.metadata, stats: pm.stats, cache: pm.cacheInfo,
        served: Object.fromEntries([...served].sort((a, b) => a[0] - b[0])),
        tilejson: tilejson(url.searchParams.get('origin') ?? ''),
      });
      res.writeHead(200, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' });
      res.end(body);
      return true;
    }
    if (url.pathname === '/world/tiles.json') {
      const origin = `http://${req.headers.host}`;
      res.writeHead(200, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' });
      res.end(JSON.stringify(tilejson(origin)));
      return true;
    }
    return false;
  }

  return { pm, handle, tilejson };
}
