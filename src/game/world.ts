import type { CountryData, ProvinceData, WorldData } from './types';

/** Cell size of the province lookup grid, in degrees. */
const GRID_DEG = 1.5;
const cellKey = (lon: number, lat: number) =>
  `${Math.floor(lon / GRID_DEG)},${Math.floor(lat / GRID_DEG)}`;

function inRing(px: number, py: number, ring: number[][]): boolean {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const a = ring[j], b = ring[i];
    if ((a[1] > py) !== (b[1] > py) && px < ((b[0] - a[0]) * (py - a[1])) / (b[1] - a[1]) + a[0]) {
      inside = !inside;
    }
  }
  return inside;
}

/**
 * The world graph: provinces, adjacency, and the shared-border index that the
 * frontline is drawn from. Province polygons are quantised onto a common
 * lattice at build time, so an edge shared by two provinces - including across
 * a country border - is byte-identical in both, and can be found by hashing.
 */
export class World {
  readonly provinces: ProvinceData[];
  readonly countries: CountryData[];
  readonly geojson: GeoJSON.FeatureCollection;
  /** edge key -> the (one or two) provinces that own it */
  readonly edges = new Map<string, [number, number] | [number]>();
  /** province pair key -> the border segments they share */
  readonly borders = new Map<string, [number, number][][]>();

  readonly data: WorldData;

  constructor(data: WorldData, geojson: GeoJSON.FeatureCollection) {
    this.data = data;
    this.provinces = data.provinces;
    this.countries = data.countries;
    this.geojson = geojson;
    this.#indexEdges();
  }

  static async load(): Promise<World> {
    // Province ids are array positions shared between these two files, so a
    // stale copy of either silently mismatches every province on the map.
    // Never let the HTTP cache serve them.
    const fresh: RequestInit = { cache: 'no-store' };
    const [data, geo] = await Promise.all([
      fetch('/data/world.json', fresh).then((r) => r.json() as Promise<WorldData>),
      fetch('/data/provinces.geojson', fresh).then((r) => r.json() as Promise<GeoJSON.FeatureCollection>),
    ]);
    return new World(data, geo);
  }

  #indexEdges() {
    const key = (a: number[], b: number[]) => {
      const ka = `${a[0]},${a[1]}`, kb = `${b[0]},${b[1]}`;
      return ka < kb ? `${ka}|${kb}` : `${kb}|${ka}`;
    };
    for (const f of this.geojson.features) {
      const id = f.id as number;
      const polys = f.geometry.type === 'Polygon'
        ? [(f.geometry as GeoJSON.Polygon).coordinates]
        : (f.geometry as GeoJSON.MultiPolygon).coordinates;
      for (const poly of polys) {
        for (const ring of poly) {
          for (let i = 1; i < ring.length; i++) {
            const k = key(ring[i - 1], ring[i]);
            const cur = this.edges.get(k);
            if (!cur) this.edges.set(k, [id]);
            else if (cur.length === 1 && cur[0] !== id) {
              const pair: [number, number] = [cur[0], id];
              this.edges.set(k, pair);
              const bk = pair[0] < pair[1] ? `${pair[0]}:${pair[1]}` : `${pair[1]}:${pair[0]}`;
              const segs = this.borders.get(bk) ?? [];
              segs.push([ring[i - 1] as [number, number], ring[i] as [number, number]]);
              this.borders.set(bk, segs);
            }
          }
        }
      }
    }
  }

  province(id: number) { return this.provinces[id]; }

  /**
   * Which province a point on the ground belongs to.
   *
   * Exact: a lattice of polygon bounding boxes narrows the field to a handful
   * of candidates, then a real point-in-polygon test decides. Nearest-centre
   * was tried and disagreed with the drawn map about a third of the time -
   * provinces are Voronoi cells in projected space, not in lon/lat, and
   * clipping to coastlines moves their centres.
   */
  provinceAt(lon: number, lat: number): number {
    if (!this.#grid) this.#buildGrid();
    const candidates = this.#grid!.get(cellKey(lon, lat));
    if (candidates) {
      for (const id of candidates) {
        if (this.#contains(id, lon, lat)) return id;
      }
    }
    return this.#nearestCentre(lon, lat);
  }

  #contains(id: number, lon: number, lat: number): boolean {
    const polys = this.#shapes![id];
    for (const poly of polys) {
      if (lon < poly.bbox[0] || lon > poly.bbox[2] || lat < poly.bbox[1] || lat > poly.bbox[3]) continue;
      if (!inRing(lon, lat, poly.rings[0])) continue;
      let inHole = false;
      for (let h = 1; h < poly.rings.length; h++) {
        if (inRing(lon, lat, poly.rings[h])) { inHole = true; break; }
      }
      if (!inHole) return true;
    }
    return false;
  }

  /** Offshore or in a gap: fall back to the nearest province centre. */
  #nearestCentre(lon: number, lat: number): number {
    let best = 0, bestD = Infinity;
    for (const p of this.provinces) {
      const d = (p.lon - lon) ** 2 + (p.lat - lat) ** 2;
      if (d < bestD) { bestD = d; best = p.id; }
    }
    return best;
  }

  #shapes: { rings: number[][][]; bbox: [number, number, number, number] }[][] | null = null;

  #grid: Map<string, number[]> | null = null;

  /** Index every province polygon by the lattice cells its bounding box spans. */
  #buildGrid() {
    const grid = new Map<string, number[]>();
    const shapes: { rings: number[][][]; bbox: [number, number, number, number] }[][] = [];

    for (const f of this.geojson.features) {
      const id = f.id as number;
      const polys = f.geometry.type === 'Polygon'
        ? [(f.geometry as GeoJSON.Polygon).coordinates]
        : (f.geometry as GeoJSON.MultiPolygon).coordinates;
      const entry: { rings: number[][][]; bbox: [number, number, number, number] }[] = [];
      for (const poly of polys) {
        let x0 = 180, y0 = 90, x1 = -180, y1 = -90;
        for (const [x, y] of poly[0]) {
          if (x < x0) x0 = x; if (x > x1) x1 = x;
          if (y < y0) y0 = y; if (y > y1) y1 = y;
        }
        entry.push({ rings: poly, bbox: [x0, y0, x1, y1] });
        for (let gx = Math.floor(x0 / GRID_DEG); gx <= Math.floor(x1 / GRID_DEG); gx++) {
          for (let gy = Math.floor(y0 / GRID_DEG); gy <= Math.floor(y1 / GRID_DEG); gy++) {
            const key = `${gx},${gy}`;
            const list = grid.get(key) ?? [];
            if (list[list.length - 1] !== id) list.push(id);
            grid.set(key, list);
          }
        }
      }
      shapes[id] = entry;
    }
    this.#grid = grid;
    this.#shapes = shapes;
  }
  borderKey(a: number, b: number) { return a < b ? `${a}:${b}` : `${b}:${a}`; }

  /** Great-circle distance between two province centres, in km. */
  distance(a: number, b: number): number {
    const p = this.provinces[a], q = this.provinces[b];
    const R = 6371, rad = Math.PI / 180;
    const dLat = (q.lat - p.lat) * rad, dLon = (q.lon - p.lon) * rad;
    const s = Math.sin(dLat / 2) ** 2 +
      Math.cos(p.lat * rad) * Math.cos(q.lat * rad) * Math.sin(dLon / 2) ** 2;
    return 2 * R * Math.asin(Math.sqrt(s));
  }

  /** Dijkstra over the province graph, cost weighted by terrain and distance. */
  path(from: number, to: number, passable: (p: number) => boolean): number[] {
    if (from === to) return [];
    const dist = new Map<number, number>([[from, 0]]);
    const prev = new Map<number, number>();
    const queue: [number, number][] = [[0, from]];
    const seen = new Set<number>();
    while (queue.length) {
      queue.sort((a, b) => a[0] - b[0]);
      const [d, cur] = queue.shift()!;
      if (cur === to) break;
      if (seen.has(cur)) continue;
      seen.add(cur);
      for (const nb of this.provinces[cur].nb) {
        if (!passable(nb) && nb !== to) continue;
        const cost = d + this.distance(cur, nb);
        if (cost < (dist.get(nb) ?? Infinity)) {
          dist.set(nb, cost);
          prev.set(nb, cur);
          queue.push([cost, nb]);
        }
      }
    }
    if (!prev.has(to)) return [];
    const out = [to];
    let cur = to;
    while (prev.has(cur)) { cur = prev.get(cur)!; if (cur !== from) out.unshift(cur); }
    return out;
  }
}
