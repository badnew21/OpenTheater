import { defineConfig } from 'vite';
import { createWorld } from './server/tiles.mjs';

/** Serves the world archive's vector tiles alongside the app in dev. */
function worldTiles() {
  return {
    name: 'world-tiles',
    configureServer(server: any) {
      const world = createWorld();
      console.log(`[world] ${world.pm.header.minZoom}-${world.pm.header.maxZoom} ${world.pm.metadata.name}`);
      server.middlewares.use((req: any, res: any, next: any) => {
        Promise.resolve(world.handle(req, res)).then((handled) => { if (!handled) next(); }, next);
      });
    },
  };
}

export default defineConfig({
  base: '/OpenTheater/',
  plugins: [worldTiles()],
  // MapLibre 6 loads its tile worker as a sibling module next to its entry
  // point. Pre-bundling moves the entry into .vite/deps and the worker is then
  // never found - the map renders but silently requests no tiles.
  optimizeDeps: { exclude: ['maplibre-gl'] },
  // the harness assigns a port; fall back to 5180 when run by hand
  server: { port: Number(process.env.PORT) || 5180, host: '127.0.0.1' },
  build: { target: 'es2022', sourcemap: true },
});
