import { defineConfig } from 'vite';
import { createWorld } from './server/tiles.mjs';

/** Serves the world archive's vector tiles alongside the app in dev. */
function worldTiles() {
  return {
    name: 'world-tiles',
    configureServer(server: any) {
      // The archive is a local file that not every checkout has. Without it
      // the map falls back to its remote source and everything else still
      // works, so a missing archive must not take the whole dev server down.
      let world: ReturnType<typeof createWorld>;
      try {
        world = createWorld();
      } catch (err) {
        console.warn(`[world] no local archive (${(err as Error).message}); `
          + 'serving the app without it - set WORLD_PMTILES to use one');
        return;
      }
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
  build: {
    target: 'es2022',
    sourcemap: true,
    // the ground mode also ships as a page of its own: it needs none of the
    // map data, so it can be opened and played straight from a static host
    rollupOptions: { input: { main: 'index.html', ground: 'ground.html' } },
  },
});
