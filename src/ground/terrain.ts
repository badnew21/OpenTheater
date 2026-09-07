import { MeshBuilder } from './mesh';
import type { Vec3 } from './glx';
import type { Biome } from './palette';

/** Integer hash - the same lattice point always gives the same value. */
function hash2(ix: number, iy: number, seed: number): number {
  let h = Math.imul(ix, 0x27d4eb2d) ^ Math.imul(iy, 0x165667b1) ^ Math.imul(seed, 0x9e3779b1);
  h = Math.imul(h ^ (h >>> 15), 0x85ebca6b);
  h = Math.imul(h ^ (h >>> 13), 0xc2b2ae35);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

const smooth = (t: number) => t * t * (3 - 2 * t);

/** Value noise: lattice of hashed values, smoothly interpolated. */
function noise2(x: number, y: number, seed: number): number {
  const ix = Math.floor(x), iy = Math.floor(y);
  const fx = smooth(x - ix), fy = smooth(y - iy);
  const a = hash2(ix, iy, seed), b = hash2(ix + 1, iy, seed);
  const c = hash2(ix, iy + 1, seed), d = hash2(ix + 1, iy + 1, seed);
  return (a + (b - a) * fx) + ((c + (d - c) * fx) - (a + (b - a) * fx)) * fy;
}

/** Stacked octaves, each half the amplitude and twice the frequency. */
function fbm(x: number, y: number, seed: number, octaves: number): number {
  let sum = 0, amp = 1, freq = 1, norm = 0;
  for (let o = 0; o < octaves; o++) {
    sum += noise2(x * freq, y * freq, seed + o * 977) * amp;
    norm += amp;
    amp *= 0.5;
    freq *= 2.03;    // slightly off 2 so octaves do not line up into a grid
  }
  return sum / norm;
}

/** A deterministic pseudo-random stream, so a province always rebuilds the same. */
export class Rng {
  private s: number;
  constructor(seed: number) { this.s = (seed | 0) || 1; }
  next(): number {
    this.s ^= this.s << 13; this.s |= 0;
    this.s ^= this.s >>> 17;
    this.s ^= this.s << 5; this.s |= 0;
    return ((this.s >>> 0) % 100000) / 100000;
  }
  range(lo: number, hi: number) { return lo + this.next() * (hi - lo); }
  int(n: number) { return Math.floor(this.next() * n) % n; }
  pick<T>(items: readonly T[]): T { return items[this.int(items.length)]; }
}

export const ARENA = 280;        // metres across the playable ground
const CELLS = 112;               // 2.5 m facets, big enough to read as facets
const CELL = ARENA / CELLS;

/**
 * The ground itself: a heightfield generated from the province's id, so the
 * same province is always the same piece of country, and sampled by the
 * character controller through the very same triangles that get drawn - the
 * feet cannot end up under the visible surface.
 */
export class Terrain {
  readonly size = ARENA;
  readonly cells = CELLS;
  readonly cell = CELL;
  readonly heights: Float32Array;
  readonly waterLevel: number;
  readonly hasWater: boolean;
  private maxHeight = 0;

  constructor(readonly seed: number, private biome: Biome, coastal: boolean) {
    const n = CELLS + 1;
    this.heights = new Float32Array(n * n);
    // which way the sea lies, if there is one
    const coastAngle = hash2(seed, 7, 31) * Math.PI * 2;
    const cdx = Math.cos(coastAngle), cdz = Math.sin(coastAngle);

    // the shape of the country, before the clearing and the coast are cut into it
    const raw = (x: number, z: number): number => {
      let v = fbm(x / 90, z / 90, seed, 5);
      if (biome.ridged) {
        // ridged noise turns rolling lumps into something with aretes
        const r = 1 - Math.abs(v * 2 - 1);
        v = r * r * 0.75 + v * 0.25;
      }
      return (v - 0.5) * biome.relief;
    };
    // The deployment ground is levelled to the height the middle of the map
    // already sits at, not to zero. Levelling to zero digs a crater wherever
    // the surrounding country happens to be high, which on mountains put the
    // player at the bottom of a pit with a wall of rock on every side.
    const centre = raw(0, 0);

    let lowest = Infinity, highest = -Infinity;
    for (let j = 0; j < n; j++) {
      for (let i = 0; i < n; i++) {
        const x = -ARENA / 2 + i * CELL;
        const z = -ARENA / 2 + j * CELL;
        let h = raw(x, z);

        // a level clearing to deploy into, feathered out so it is not a disc
        const d = Math.hypot(x, z);
        const flat = 1 - Math.min(1, Math.max(0, (d - 16) / 30));
        h += (centre - h) * flat * 0.9;

        if (coastal) {
          // the seaward corner runs out below the waterline
          const along = (x * cdx + z * cdz) / (ARENA / 2);
          const sea = Math.min(1, Math.max(0, (along - 0.15) / 0.85));
          h = h * (1 - sea) + (-7 * sea * sea);
        }

        if (biome.step > 0) {
          // terracing, mixed rather than applied outright: full quantisation
          // gives vertical cliffs at every cell edge and nothing can walk it
          const terraced = Math.round(h / biome.step) * biome.step;
          h = h * 0.35 + terraced * 0.65;
        }

        this.heights[j * n + i] = h;
        if (h < lowest) lowest = h;
        if (h > highest) highest = h;
      }
    }
    this.maxHeight = highest;
    // A coast is a shoreline near the datum, not a puddle in the deepest
    // trench: the seaward run-out reaches about -7, so the sea has to sit near
    // zero for the water's edge to land somewhere you can walk to. Inland,
    // water only appears where the ground genuinely dishes, and then it fills
    // enough of the hollow to read as a pond rather than as a blue splinter.
    this.hasWater = coastal || lowest < -5;
    this.waterLevel = coastal ? -1 : lowest + 1.5;
  }

  private h(i: number, j: number): number {
    const n = CELLS + 1;
    const ci = i < 0 ? 0 : i > CELLS ? CELLS : i;
    const cj = j < 0 ? 0 : j > CELLS ? CELLS : j;
    return this.heights[cj * n + ci];
  }

  /**
   * Ground height under a point, read off the same two triangles the mesh is
   * built from rather than a bilinear approximation of them.
   */
  heightAt(x: number, z: number): number {
    const gx = (x + ARENA / 2) / CELL;
    const gz = (z + ARENA / 2) / CELL;
    const i = Math.floor(gx), j = Math.floor(gz);
    const fx = gx - i, fz = gz - j;
    const h00 = this.h(i, j), h10 = this.h(i + 1, j);
    const h01 = this.h(i, j + 1), h11 = this.h(i + 1, j + 1);
    // the cell is split along its (0,0)-(1,1) diagonal
    return fz < fx
      ? h00 + (h10 - h00) * fx + (h11 - h10) * fz
      : h00 + (h11 - h01) * fx + (h01 - h00) * fz;
  }

  /** Rise over run at a point, 0 flat and 1 at forty-five degrees. */
  slopeAt(x: number, z: number): number {
    const d = CELL;
    const dx = this.heightAt(x + d, z) - this.heightAt(x - d, z);
    const dz = this.heightAt(x, z + d) - this.heightAt(x, z - d);
    return Math.hypot(dx, dz) / (2 * d);
  }

  /** True where the point is under water and not walkable. */
  submerged(x: number, z: number): boolean {
    return this.hasWater && this.heightAt(x, z) < this.waterLevel - 0.35;
  }

  /**
   * The colour of a facet: mostly the biome's two ground tones mottled
   * together, with rock showing through where it is steep and a cap of snow
   * or ice on whatever stands highest.
   */
  private facetColour(x: number, z: number, slope: number, height: number, jitter: number): Vec3 {
    const b = this.biome;
    const m = noise2(x / 26, z / 26, this.seed + 4001);
    let c: Vec3 = [
      b.ground[0] + (b.ground2[0] - b.ground[0]) * m,
      b.ground[1] + (b.ground2[1] - b.ground[1]) * m,
      b.ground[2] + (b.ground2[2] - b.ground[2]) * m,
    ];
    const rocky = Math.min(1, Math.max(0, (slope - 0.42) / 0.5));
    if (rocky > 0) c = [
      c[0] + (b.rock[0] - c[0]) * rocky,
      c[1] + (b.rock[1] - c[1]) * rocky,
      c[2] + (b.rock[2] - c[2]) * rocky,
    ];
    if (b.cap && this.maxHeight > 4) {
      const line = b.capHeight * this.maxHeight;
      const t = Math.min(1, Math.max(0, (height - line) / Math.max(2, this.maxHeight * 0.2)));
      if (t > 0) c = [
        c[0] + (b.cap[0] - c[0]) * t,
        c[1] + (b.cap[1] - c[1]) * t,
        c[2] + (b.cap[2] - c[2]) * t,
      ];
    }
    // a touch of per-facet variation stops large flats reading as one surface
    const f = 0.94 + jitter * 0.12;
    return [c[0] * f, c[1] * f, c[2] * f];
  }

  /** The ground as one static mesh, coloured per facet. */
  buildMesh(): Float32Array {
    const m = new MeshBuilder();
    for (let j = 0; j < CELLS; j++) {
      for (let i = 0; i < CELLS; i++) {
        const x0 = -ARENA / 2 + i * CELL, z0 = -ARENA / 2 + j * CELL;
        const x1 = x0 + CELL, z1 = z0 + CELL;
        const h00 = this.h(i, j), h10 = this.h(i + 1, j);
        const h01 = this.h(i, j + 1), h11 = this.h(i + 1, j + 1);
        const a: Vec3 = [x0, h00, z0], b: Vec3 = [x1, h10, z0];
        const c: Vec3 = [x1, h11, z1], d: Vec3 = [x0, h01, z1];

        const cx = x0 + CELL / 2, cz = z0 + CELL / 2;
        const rise = Math.max(Math.abs(h10 - h00), Math.abs(h01 - h00), Math.abs(h11 - h00));
        const slope = rise / CELL;
        const mid = (h00 + h10 + h01 + h11) / 4;
        // the two facets of a cell are shaded apart very slightly, which is
        // what makes the ground read as folded rather than as a gradient
        m.triangle(a, c, b, this.facetColour(cx, cz, slope, mid, hash2(i, j, this.seed)));
        m.triangle(a, d, c, this.facetColour(cx, cz, slope, mid, hash2(i, j, this.seed + 91)));
      }
    }
    return m.build();
  }

  /** A flat sheet of water, only where the terrain actually dips below it. */
  buildWaterMesh(): Float32Array | null {
    if (!this.hasWater) return null;
    const m = new MeshBuilder();
    const s = ARENA / 2 + 40;    // overshoot the arena so there is no visible edge
    const y = this.waterLevel;
    const c = this.biome.water;
    m.quad([-s, y, -s], [-s, y, s], [s, y, s], [s, y, -s], c);
    return m.build();
  }
}
