import { identity, mat4, rotateX, rotateY, rotateZ, scale, translate, type Vec3 } from './glx';
import type { CubeBatch } from './renderer';

/**
 * A soldier, assembled from eleven boxes.
 *
 * The proportions are deliberately wrong: the head is about a fifth of the
 * body and the limbs are stubby. Correct human proportions at this polygon
 * budget read as a mannequin, whereas an oversized head gives a silhouette
 * that stays legible at fifty metres, which is the whole job here.
 */
export interface Look {
  uniform: Vec3;
  trousers: Vec3;
  helmet: Vec3;
  skin: Vec3;
  /** the nation's colour, worn as a shoulder flash and carried as a flag */
  accent: Vec3;
  /** overall scale; 1 is a 1.9 m soldier */
  build: number;
}

export interface Pose {
  x: number;
  y: number;      // ground height under the feet
  z: number;
  yaw: number;
  /** advances with distance walked, not with time, so the feet do not skate */
  phase: number;
  /** metres per second, which sets how hard the limbs swing */
  speed: number;
  /** 0 standing, 1 fully crouched */
  crouch: number;
  /** seconds, for the idle sway */
  clock: number;
}

const HIP = 0.80;
const SHOULDER = 1.36;

const scratch = mat4();

/** A box centred on a point in the body's own frame. */
function block(
  batch: CubeBatch, p: Pose, lean: number, bob: number,
  px: number, py: number, pz: number, sx: number, sy: number, sz: number,
  tint: Vec3, shade: number, build: number, spin = 0,
) {
  const m = scratch;
  identity(m);
  translate(m, p.x, p.y + bob, p.z);
  rotateY(m, p.yaw);
  scale(m, build, build, build);
  rotateX(m, lean);
  translate(m, px, py, pz);
  if (spin) rotateY(m, spin);
  scale(m, sx, sy, sz);
  batch.add(m, tint, shade);
}

/** A limb, hanging from a joint it swings about. */
function limb(
  batch: CubeBatch, p: Pose, lean: number, bob: number,
  jx: number, jy: number, jz: number, swing: number, splay: number,
  sx: number, sy: number, sz: number, tint: Vec3, shade: number, build: number,
) {
  const m = scratch;
  identity(m);
  translate(m, p.x, p.y + bob, p.z);
  rotateY(m, p.yaw);
  scale(m, build, build, build);
  rotateX(m, lean);
  translate(m, jx, jy, jz);
  rotateX(m, swing);
  rotateZ(m, splay);
  translate(m, 0, -sy / 2, 0);
  scale(m, sx, sy, sz);
  batch.add(m, tint, shade);
}

/**
 * Queue one soldier's boxes.
 *
 * The gait is driven by `phase`, which the caller advances by distance walked
 * rather than by elapsed time - tie it to a clock and the feet slide whenever
 * the character is moving at anything other than full speed.
 */
export function drawActor(batch: CubeBatch, p: Pose, look: Look, carriesRifle = true) {
  const b = look.build;
  const run = Math.min(1, p.speed / 4.6);
  const swing = Math.sin(p.phase) * (0.15 + run * 0.75);
  const counter = Math.sin(p.phase + Math.PI) * (0.15 + run * 0.75);
  // two footfalls per cycle, so the bob runs at twice the stride
  const bob = (Math.abs(Math.sin(p.phase)) - 0.5) * 0.055 * run
    + Math.sin(p.clock * 1.7) * 0.012
    - p.crouch * 0.28;
  const lean = run * 0.22 + p.crouch * 0.3;
  const crouchDrop = p.crouch * 0.22;

  // legs
  limb(batch, p, lean, bob, -0.16, HIP - crouchDrop, 0, swing, 0.03,
    0.27, HIP - 0.06, 0.27, look.trousers, 1, b);
  limb(batch, p, lean, bob, 0.16, HIP - crouchDrop, 0, counter, -0.03,
    0.27, HIP - 0.06, 0.27, look.trousers, 0.94, b);
  // boots, which give the leg a joint without needing one
  limb(batch, p, lean, bob, -0.16, HIP - crouchDrop - (HIP - 0.1), swing * 0.5, 0, 0,
    0.29, 0.16, 0.36, [0.13, 0.12, 0.11], 1, b);
  limb(batch, p, lean, bob, 0.16, HIP - crouchDrop - (HIP - 0.1), counter * 0.5, 0, 0,
    0.29, 0.16, 0.36, [0.13, 0.12, 0.11], 1, b);

  // torso and webbing
  block(batch, p, lean, bob, 0, HIP + 0.29 - crouchDrop, 0, 0.62, 0.66, 0.4, look.uniform, 1, b);
  block(batch, p, lean, bob, 0, HIP + 0.32 - crouchDrop, -0.26, 0.36, 0.44, 0.2,
    [look.uniform[0] * 0.7, look.uniform[1] * 0.7, look.uniform[2] * 0.72], 1, b);
  // the nation's colour, worn where it can be seen from the front
  block(batch, p, lean, bob, 0, HIP + 0.5 - crouchDrop, 0.205, 0.3, 0.16, 0.03, look.accent, 1.1, b);

  // arms, swung opposite to the legs
  const armSwing = carriesRifle ? -0.9 - run * 0.1 : counter;
  const armSwing2 = carriesRifle ? -1.0 - run * 0.1 : swing;
  limb(batch, p, lean, bob, -0.42, SHOULDER - crouchDrop, 0, armSwing, 0.12,
    0.22, 0.58, 0.22, look.uniform, 0.92, b);
  limb(batch, p, lean, bob, 0.42, SHOULDER - crouchDrop, 0, armSwing2, -0.12,
    0.22, 0.58, 0.22, look.uniform, 0.86, b);

  // head, neck and helmet
  block(batch, p, lean, bob, 0, HIP + 0.68 - crouchDrop, 0, 0.2, 0.12, 0.2, look.skin, 0.8, b);
  block(batch, p, lean, bob, 0, HIP + 0.94 - crouchDrop, 0, 0.44, 0.44, 0.42, look.skin, 1, b);
  block(batch, p, lean, bob, 0, HIP + 1.18 - crouchDrop, -0.02, 0.52, 0.16, 0.5, look.helmet, 1, b);
  block(batch, p, lean, bob, 0, HIP + 1.1 - crouchDrop, 0.16, 0.46, 0.1, 0.24, look.helmet, 0.9, b);

  if (carriesRifle) {
    // held across the body at port arms
    block(batch, p, lean, bob, 0.06, HIP + 0.5 - crouchDrop, 0.3, 0.1, 0.1, 0.86,
      [0.17, 0.15, 0.14], 1, b, -0.5);
    block(batch, p, lean, bob, 0.16, HIP + 0.42 - crouchDrop, 0.16, 0.09, 0.22, 0.24,
      [0.24, 0.18, 0.13], 1, b, -0.5);
  }
}

/** A squad standard: a pole and a banner in the nation's colour. */
export function drawFlag(batch: CubeBatch, x: number, y: number, z: number, yaw: number,
                        colour: Vec3, clock: number) {
  const m = scratch;
  const pole = 3.4;
  identity(m);
  translate(m, x, y + pole / 2, z);
  scale(m, 0.09, pole, 0.09);
  batch.add(m, [0.26, 0.2, 0.14], 1);

  // three panels, each lagging the one before it, which reads as a ripple
  for (let i = 0; i < 3; i++) {
    const wave = Math.sin(clock * 2.4 - i * 0.9) * 0.14;
    identity(m);
    translate(m, x, y + pole - 0.45, z);
    rotateY(m, yaw + wave);
    translate(m, 0.32 + i * 0.52, 0, 0);
    rotateZ(m, wave * 0.5);
    scale(m, 0.52, 0.62, 0.06);
    batch.add(m, colour, i % 2 ? 0.9 : 1.05);
  }
}
