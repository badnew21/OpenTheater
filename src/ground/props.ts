import { MeshBuilder } from './mesh';
import { Rng, type Terrain } from './terrain';
import type { Vec3 } from './glx';
import type { Biome, PropKind } from './palette';

/** Something on the ground the character cannot walk through. */
export interface Obstacle { x: number; z: number; r: number }

export interface Props {
  mesh: Float32Array;
  obstacles: Obstacle[];
  count: number;
}

const shade = (c: Vec3, f: number): Vec3 => [c[0] * f, c[1] * f, c[2] * f];

function broadleaf(m: MeshBuilder, x: number, y: number, z: number, b: Biome, rng: Rng) {
  const h = rng.range(3.4, 6.2);
  const yaw = rng.range(0, Math.PI);
  m.box([x, y + h / 2, z], [0.42, h, 0.42], b.trunk, yaw);
  // canopy as a stack of offset slabs: cheaper than a sphere and it reads
  // better at this fidelity, where a smooth ball just looks like a mistake
  const leaf = rng.next() > 0.5 ? b.foliage : b.foliage2;
  const w = rng.range(2.6, 4.0);
  m.box([x, y + h + 0.2, z], [w, 1.5, w], leaf, yaw);
  m.box([x + rng.range(-0.4, 0.4), y + h + 1.4, z + rng.range(-0.4, 0.4)],
    [w * 0.74, 1.3, w * 0.74], shade(leaf, 1.08), yaw + 0.6);
  m.box([x, y + h + 2.3, z], [w * 0.44, 0.9, w * 0.44], shade(leaf, 0.92), yaw - 0.4);
}

function conifer(m: MeshBuilder, x: number, y: number, z: number, b: Biome, rng: Rng) {
  const h = rng.range(4.5, 8.5);
  const yaw = rng.range(0, Math.PI);
  m.box([x, y + h * 0.3, z], [0.38, h * 0.6, 0.38], b.trunk, yaw);
  const leaf = rng.next() > 0.5 ? b.foliage : b.foliage2;
  const w = rng.range(2.2, 3.2);
  // three tapering tiers make a spruce silhouette out of straight edges
  m.frustum([x, y + h * 0.25, z], [w, 0, w], 0.55, h * 0.34, leaf, yaw);
  m.frustum([x, y + h * 0.52, z], [w * 0.78, 0, w * 0.78], 0.5, h * 0.3, shade(leaf, 1.06), yaw);
  m.frustum([x, y + h * 0.76, z], [w * 0.52, 0, w * 0.52], 0.12, h * 0.32, shade(leaf, 0.94), yaw);
}

function palm(m: MeshBuilder, x: number, y: number, z: number, b: Biome, rng: Rng) {
  const h = rng.range(5, 8);
  const lean = rng.range(-0.5, 0.5);
  // the trunk is a short stack, each segment nudged over, so it curves
  const seg = 5;
  for (let i = 0; i < seg; i++) {
    const t = i / seg;
    m.box([x + lean * t * t * 2, y + h * (t + 0.5 / seg), z + lean * t * t],
      [0.4, h / seg + 0.05, 0.4], shade(b.trunk, 1 - t * 0.1), t);
  }
  const tx = x + lean * 2, tz = z + lean;
  const leaf = b.foliage2;
  for (let i = 0; i < 6; i++) {
    const a = (i / 6) * Math.PI * 2 + rng.range(0, 0.5);
    m.box([tx + Math.cos(a) * 1.5, y + h - 0.25, tz + Math.sin(a) * 1.5],
      [3.2, 0.28, 0.9], shade(leaf, i % 2 ? 1 : 0.9), -a);
  }
}

function rock(m: MeshBuilder, x: number, y: number, z: number, b: Biome, rng: Rng) {
  const w = rng.range(1.1, 3.4);
  const h = rng.range(0.8, 2.6);
  const yaw = rng.range(0, Math.PI);
  m.frustum([x, y - 0.3, z], [w, 0, w * rng.range(0.7, 1.3)], rng.range(0.4, 0.8), h,
    shade(b.rock, rng.range(0.9, 1.1)), yaw);
  if (rng.next() > 0.55) {
    m.frustum([x + rng.range(-0.8, 0.8), y - 0.2, z + rng.range(-0.8, 0.8)],
      [w * 0.5, 0, w * 0.5], 0.6, h * 0.6, shade(b.rock, 0.85), yaw + 1);
  }
}

function bush(m: MeshBuilder, x: number, y: number, z: number, b: Biome, rng: Rng) {
  const w = rng.range(0.9, 1.8);
  const leaf = rng.next() > 0.5 ? b.foliage : b.foliage2;
  m.box([x, y + w * 0.35, z], [w, w * 0.7, w * 0.9], leaf, rng.range(0, Math.PI));
  if (rng.next() > 0.5) {
    m.box([x + rng.range(-0.5, 0.5), y + w * 0.55, z + rng.range(-0.5, 0.5)],
      [w * 0.6, w * 0.5, w * 0.6], shade(leaf, 1.1), rng.range(0, Math.PI));
  }
}

function reeds(m: MeshBuilder, x: number, y: number, z: number, b: Biome, rng: Rng) {
  const n = 4 + rng.int(5);
  for (let i = 0; i < n; i++) {
    const h = rng.range(1.2, 2.4);
    m.box([x + rng.range(-0.9, 0.9), y + h / 2, z + rng.range(-0.9, 0.9)],
      [0.14, h, 0.14], shade(b.foliage2, rng.range(0.85, 1.15)), rng.range(0, Math.PI));
  }
}

function cactus(m: MeshBuilder, x: number, y: number, z: number, b: Biome, rng: Rng) {
  const h = rng.range(1.8, 3.4);
  const c = b.foliage;
  m.box([x, y + h / 2, z], [0.6, h, 0.6], c);
  const arm = (side: number) => {
    const ay = y + h * rng.range(0.4, 0.62);
    m.box([x + side * 0.6, ay, z], [0.9, 0.5, 0.5], shade(c, 0.94));
    m.box([x + side * 0.95, ay + 0.5, z], [0.5, 1.2, 0.5], shade(c, 0.98));
  };
  if (rng.next() > 0.35) arm(1);
  if (rng.next() > 0.5) arm(-1);
}

function building(m: MeshBuilder, x: number, y: number, z: number, b: Biome, rng: Rng, urban: boolean) {
  const w = rng.range(5, 9);
  const d = rng.range(5, 9);
  const h = urban ? rng.range(6, 17) : rng.range(3.2, 5);
  const yaw = rng.range(0, Math.PI);
  const wall = shade(b.rock, rng.range(0.92, 1.12));
  // sunk into the ground so a slope cannot leave it standing on one corner
  m.box([x, y + h / 2 - 0.8, z], [w, h + 1.6, d], wall, yaw);
  if (urban) {
    // a parapet, which is all the roof detail this fidelity needs
    m.box([x, y + h + 0.2, z], [w * 0.98, 0.5, d * 0.98], shade(wall, 0.8), yaw);
    const rows = Math.max(1, Math.floor(h / 3.2));
    for (let r = 0; r < rows; r++) {
      const wy = y + 1.6 + r * 3.2;
      // a band of windows per storey, on the two faces you are likely to see
      m.box([x, wy, z], [w * 1.005, 0.9, d * 0.62], [0.14, 0.16, 0.2], yaw);
      m.box([x, wy, z], [w * 0.62, 0.9, d * 1.005], [0.14, 0.16, 0.2], yaw);
    }
  } else {
    // a gabled roof from two leaning slabs
    const roof = shade(b.rock, 0.66);
    m.frustum([x, y + h - 0.8, z], [w * 1.12, 0, d * 1.12], 0.12, 2.2, roof, yaw);
    m.box([x + Math.sin(yaw) * (d / 2), y + 0.2, z + Math.cos(yaw) * (d / 2)],
      [1.1, 2.1, 0.2], [0.2, 0.15, 0.11], yaw);
  }
  return Math.max(w, d) / 2;
}

const RADIUS: Record<PropKind, number> = {
  tree: 0.6, conifer: 0.6, palm: 0.5, rock: 1.3, bush: 0, reed: 0, building: 4, cactus: 0.6,
};

/**
 * Scatter the biome's props over the terrain.
 *
 * Placement is a jittered grid rather than pure noise: pure random scattering
 * clumps badly, and a forest with bald patches and knots of six trees in one
 * spot looks broken rather than natural.
 */
export function buildProps(terrain: Terrain, biome: Biome, seed: number): Props {
  const m = new MeshBuilder();
  const obstacles: Obstacle[] = [];
  const rng = new Rng(seed * 2654435761 + 17);
  const hectares = (terrain.size * terrain.size) / 10000;
  const target = Math.round(biome.density * hectares);
  if (target <= 0) return { mesh: m.build(), obstacles, count: 0 };

  const cols = Math.max(1, Math.round(Math.sqrt(target)));
  const spacing = terrain.size / cols;
  let count = 0;

  for (let j = 0; j < cols; j++) {
    for (let i = 0; i < cols; i++) {
      const x = -terrain.size / 2 + (i + 0.5) * spacing + rng.range(-spacing * 0.42, spacing * 0.42);
      const z = -terrain.size / 2 + (j + 0.5) * spacing + rng.range(-spacing * 0.42, spacing * 0.42);

      // leave the deployment ground clear, and keep off cliffs and open water
      if (Math.hypot(x, z) < 11) continue;
      if (terrain.submerged(x, z)) continue;
      // rocks and scrub cling to ground that a building could never sit on
      if (terrain.slopeAt(x, z) > 0.9) continue;

      const kind = rng.pick(biome.mix);
      const y = terrain.heightAt(x, z);
      let r = RADIUS[kind];

      switch (kind) {
        case 'tree': broadleaf(m, x, y, z, biome, rng); break;
        case 'conifer': conifer(m, x, y, z, biome, rng); break;
        case 'palm': palm(m, x, y, z, biome, rng); break;
        case 'rock': rock(m, x, y, z, biome, rng); break;
        case 'bush': bush(m, x, y, z, biome, rng); break;
        case 'reed': reeds(m, x, y, z, biome, rng); break;
        case 'cactus': cactus(m, x, y, z, biome, rng); break;
        case 'building': {
          if (terrain.slopeAt(x, z) > 0.3) continue;   // no houses on a hillside
          r = building(m, x, y, z, biome, rng, biome.density > 8);
          break;
        }
      }
      if (r > 0) obstacles.push({ x, z, r });
      count++;
    }
  }
  return { mesh: m.build(), obstacles, count };
}
