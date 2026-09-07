/**
 * The strategic road network, extracted from the archive by tools/network.mjs.
 *
 * Loaded as packed typed arrays and held in CSR form, so a march order can be
 * routed across a 600k-edge graph without the browser parsing megabytes of
 * JSON or walking object graphs.
 */

export interface RoadMeta { snap: number; nodes: number; edges: number; provinces: number }

export class RoadNetwork {
  readonly lon: Float32Array;
  readonly lat: Float32Array;
  /** CSR adjacency: neighbours of n are adj[off[n] .. off[n+1]] */
  private off: Uint32Array;
  private adj: Uint32Array;
  private cost: Float32Array;
  /** province id -> road node, or -1 where no road reaches */
  readonly provinceNode: Int32Array;

  private constructor(
    lon: Float32Array, lat: Float32Array,
    edges: Uint32Array, lens: Float32Array,
    provinceNode: Int32Array,
  ) {
    this.lon = lon;
    this.lat = lat;
    this.provinceNode = provinceNode;

    const n = lon.length, e = lens.length;
    const degree = new Uint32Array(n + 1);
    for (let i = 0; i < e; i++) { degree[edges[i * 2]]++; degree[edges[i * 2 + 1]]++; }
    this.off = new Uint32Array(n + 1);
    let total = 0;
    for (let i = 0; i < n; i++) { this.off[i] = total; total += degree[i]; }
    this.off[n] = total;
    this.adj = new Uint32Array(total);
    this.cost = new Float32Array(total);
    const cursor = this.off.slice();
    for (let i = 0; i < e; i++) {
      const a = edges[i * 2], b = edges[i * 2 + 1], w = lens[i];
      this.adj[cursor[a]] = b; this.cost[cursor[a]++] = w;
      this.adj[cursor[b]] = a; this.cost[cursor[b]++] = w;
    }
  }

  static async load(): Promise<RoadNetwork> {
    const base = import.meta.env.BASE_URL || '/';
    const fresh: RequestInit = { cache: 'no-store' };
    const [meta, buf] = await Promise.all([
      fetch(`${base}data/roads.json`, fresh).then((r) => r.json() as Promise<RoadMeta>),
      fetch(`${base}data/roads.bin`, fresh).then((r) => r.arrayBuffer()),
    ]);
    const { nodes: n, edges: e, provinces: p } = meta;
    let o = 0;
    const lon = new Float32Array(buf, o, n); o += n * 4;
    const lat = new Float32Array(buf, o, n); o += n * 4;
    const edgePairs = new Uint32Array(buf, o, e * 2); o += e * 8;
    const lens = new Float32Array(buf, o, e); o += e * 4;
    const provinceNode = new Int32Array(buf, o, p);
    return new RoadNetwork(lon, lat, edgePairs, lens, provinceNode);
  }

  private km(a: number, b: number): number {
    const lat = ((this.lat[a] + this.lat[b]) / 2) * (Math.PI / 180);
    return Math.hypot((this.lon[b] - this.lon[a]) * 111.32 * Math.cos(lat),
      (this.lat[b] - this.lat[a]) * 110.54);
  }

  /**
   * A* between two road nodes. Bounded: a march that cannot find a road route
   * within the budget falls back to moving cross-country.
   */
  route(from: number, to: number, maxVisited = 40000): number[] | null {
    if (from < 0 || to < 0) return null;
    if (from === to) return [from];
    const g = new Map<number, number>([[from, 0]]);
    const prev = new Map<number, number>();
    const open: [number, number][] = [[this.km(from, to), from]];
    const closed = new Set<number>();
    let visited = 0;

    while (open.length) {
      // small frontier in practice; a linear scan beats a heap here
      let bestI = 0;
      for (let i = 1; i < open.length; i++) if (open[i][0] < open[bestI][0]) bestI = i;
      const [, node] = open.splice(bestI, 1)[0];
      if (node === to) break;
      if (closed.has(node)) continue;
      closed.add(node);
      if (++visited > maxVisited) return null;

      const gn = g.get(node)!;
      for (let i = this.off[node]; i < this.off[node + 1]; i++) {
        const nb = this.adj[i];
        if (closed.has(nb)) continue;
        const cost = gn + this.cost[i];
        if (cost < (g.get(nb) ?? Infinity)) {
          g.set(nb, cost);
          prev.set(nb, node);
          open.push([cost + this.km(nb, to), nb]);
        }
      }
    }

    if (!prev.has(to)) return null;
    const path = [to];
    let cur = to;
    while (prev.has(cur)) { cur = prev.get(cur)!; path.unshift(cur); }
    return path;
  }

  /** Nearest road node to a point, using a lazily built lattice index. */
  nearestNode(lon: number, lat: number, maxDeg = 1.5): number {
    if (!this.index) this.buildIndex();
    const cell = this.cell;
    let best = -1, bestD = maxDeg * maxDeg;
    const reach = Math.ceil(maxDeg / cell);
    const cx = Math.floor(lon / cell), cy = Math.floor(lat / cell);
    for (let dx = -reach; dx <= reach; dx++) {
      for (let dy = -reach; dy <= reach; dy++) {
        const list = this.index!.get(`${cx + dx},${cy + dy}`);
        if (!list) continue;
        for (const n of list) {
          const d = (this.lon[n] - lon) ** 2 + (this.lat[n] - lat) ** 2;
          if (d < bestD) { bestD = d; best = n; }
        }
      }
    }
    return best;
  }

  private index: Map<string, number[]> | null = null;
  private cell = 0.5;
  private buildIndex() {
    const g = new Map<string, number[]>();
    for (let i = 0; i < this.lon.length; i++) {
      const k = `${Math.floor(this.lon[i] / this.cell)},${Math.floor(this.lat[i] / this.cell)}`;
      const list = g.get(k) ?? [];
      list.push(i);
      g.set(k, list);
    }
    this.index = g;
  }

  /** A road route between two points on the ground, as a polyline. */
  routeBetween(from: [number, number], to: [number, number]): [number, number][] | null {
    const a = this.nearestNode(from[0], from[1]);
    const b = this.nearestNode(to[0], to[1]);
    if (a < 0 || b < 0) return null;
    const nodes = this.route(a, b);
    if (!nodes || nodes.length < 2) return null;
    return nodes.map((n) => [this.lon[n], this.lat[n]] as [number, number]);
  }

  /** A march route between two provinces as a polyline, or null. */
  provinceRoute(a: number, b: number): [number, number][] | null {
    const na = this.provinceNode[a], nb = this.provinceNode[b];
    if (na < 0 || nb < 0) return null;
    const nodes = this.route(na, nb);
    if (!nodes || nodes.length < 2) return null;
    return nodes.map((n) => [this.lon[n], this.lat[n]] as [number, number]);
  }
}

/** Length of a polyline in kilometres. */
export function polylineKm(pts: [number, number][]): number {
  let total = 0;
  for (let i = 1; i < pts.length; i++) {
    const lat = ((pts[i][1] + pts[i - 1][1]) / 2) * (Math.PI / 180);
    total += Math.hypot((pts[i][0] - pts[i - 1][0]) * 111.32 * Math.cos(lat),
      (pts[i][1] - pts[i - 1][1]) * 110.54);
  }
  return total;
}

/** Point at `t` (0..1) along a polyline. */
export function pointAlong(pts: [number, number][], t: number): [number, number] {
  if (pts.length === 1) return pts[0];
  const total = polylineKm(pts);
  let want = Math.max(0, Math.min(1, t)) * total;
  for (let i = 1; i < pts.length; i++) {
    const lat = ((pts[i][1] + pts[i - 1][1]) / 2) * (Math.PI / 180);
    const seg = Math.hypot((pts[i][0] - pts[i - 1][0]) * 111.32 * Math.cos(lat),
      (pts[i][1] - pts[i - 1][1]) * 110.54);
    if (want <= seg || i === pts.length - 1) {
      const k = seg > 0 ? want / seg : 0;
      return [pts[i - 1][0] + (pts[i][0] - pts[i - 1][0]) * k,
        pts[i - 1][1] + (pts[i][1] - pts[i - 1][1]) * k];
    }
    want -= seg;
  }
  return pts[pts.length - 1];
}
