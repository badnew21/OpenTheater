// Standalone host: serves the built game and the world archive to peers.
// One player hosts; everyone else joins them for tiles and, later, game state.
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createWorld } from './tiles.mjs';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const DIST = path.join(root, 'dist');
const PORT = Number(process.env.PORT ?? 5190);

const TYPES = {
  '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css',
  '.json': 'application/json', '.geojson': 'application/json',
  '.pbf': 'application/x-protobuf', '.png': 'image/png', '.svg': 'image/svg+xml',
  '.map': 'application/json',
};

const world = createWorld();

const server = http.createServer(async (req, res) => {
  if (await world.handle(req, res)) return;
  const url = new URL(req.url, 'http://localhost');
  let file = path.join(DIST, decodeURIComponent(url.pathname));
  if (!file.startsWith(DIST)) { res.writeHead(403).end(); return; }
  if (!fs.existsSync(file) || fs.statSync(file).isDirectory()) file = path.join(DIST, 'index.html');
  if (!fs.existsSync(file)) { res.writeHead(404).end('build the app first: npm run build'); return; }
  res.writeHead(200, {
    'Content-Type': TYPES[path.extname(file)] ?? 'application/octet-stream',
    'Access-Control-Allow-Origin': '*',
  });
  fs.createReadStream(file).pipe(res);
});

server.listen(PORT, () => {
  console.log(`host: http://localhost:${PORT}  (world: ${world.pm.header.maxZoom} zooms, ${(world.pm.header.tileEntries / 1e6).toFixed(0)}M tiles)`);
});
