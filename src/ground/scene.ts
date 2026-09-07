import { hexToRgb, lookAt, mat4, mixRgb, multiply, perspective, type Vec3 } from './glx';
import { unitCube } from './mesh';
import { biomeFor, type Biome } from './palette';
import { buildProps, type Obstacle } from './props';
import { CubeBatch, Renderer, StaticMesh } from './renderer';
import { ARENA, Rng, Terrain } from './terrain';
import { drawActor, drawFlag, type Look, type Pose } from './actor';
import type { Input } from './input';
import type { Terrain as TerrainKind } from '../game/types';

/** One formation that is present on this ground, as the scene needs it. */
export interface SquadSpec {
  name: string;
  nation: string;
  colour: string;
  hostile: boolean;
  /** 0..1; decides how many men are still standing in the ranks */
  strength: number;
}

/** Everything the scene needs to know about where it has been dropped. */
export interface Deployment {
  province: number;
  place: string;
  region: string;
  kind: TerrainKind;
  coastal: boolean;
  playerColour: string;
  squads: SquadSpec[];
}

const WALK = 3.1;
const SPRINT = 6.4;
const CROUCH_SPEED = 1.5;
const GRAVITY = 22;
const JUMP = 7.2;
const EYE = 1.62;
const MAX_SOLDIERS = 180;
// Ink lines, in metres. Thin enough not to bleed across a limb, thick enough
// to survive the distance: below about 0.04 they vanish at any normal camera
// range, and above 0.15 the expanded hull of an arm pushes out through the
// chest and the figure turns into a blob.
const ACTOR_OUTLINE = 0.06;
const PROP_OUTLINE = 0.1;

const clamp = (v: number, lo: number, hi: number) => (v < lo ? lo : v > hi ? hi : v);

/** Shortest signed way round from a to b. */
function angleDelta(a: number, b: number): number {
  let d = (b - a) % (Math.PI * 2);
  if (d > Math.PI) d -= Math.PI * 2;
  if (d < -Math.PI) d += Math.PI * 2;
  return d;
}

interface Soldier {
  x: number; z: number; yaw: number;
  homeX: number; homeZ: number;
  toX: number; toZ: number;
  wait: number;
  phase: number;
  speed: number;
  look: Look;
  hostile: boolean;
  squad: number;
}

interface Squad {
  spec: SquadSpec;
  x: number; z: number;
  yaw: number;
  colour: Vec3;
  men: number;
}

/**
 * Obstacles bucketed by an 8 m grid. Walking into a forest otherwise means
 * testing the character against every trunk on the map, every frame, for
 * everyone on it.
 */
class ObstacleGrid {
  private cells = new Map<number, Obstacle[]>();
  private readonly size = 8;

  constructor(obstacles: Obstacle[]) {
    for (const o of obstacles) {
      const reach = Math.ceil(o.r / this.size);
      const cx = Math.floor(o.x / this.size), cz = Math.floor(o.z / this.size);
      for (let dz = -reach; dz <= reach; dz++) {
        for (let dx = -reach; dx <= reach; dx++) {
          const k = this.key(cx + dx, cz + dz);
          const list = this.cells.get(k);
          if (list) list.push(o); else this.cells.set(k, [o]);
        }
      }
    }
  }

  private key(cx: number, cz: number) { return cx * 73856093 ^ cz * 19349663; }

  /** Push a circle out of anything it has walked into. */
  resolve(x: number, z: number, radius: number): [number, number] {
    const list = this.cells.get(this.key(Math.floor(x / this.size), Math.floor(z / this.size)));
    if (!list) return [x, z];
    let px = x, pz = z;
    for (const o of list) {
      const dx = px - o.x, dz = pz - o.z;
      const min = o.r + radius;
      const d2 = dx * dx + dz * dz;
      if (d2 >= min * min) continue;
      const d = Math.sqrt(d2) || 0.0001;
      px = o.x + (dx / d) * min;
      pz = o.z + (dz / d) * min;
    }
    return [px, pz];
  }
}

/**
 * The playable ground: one province, rendered as a walkable box of country
 * with whatever formations the campaign says are standing on it.
 */
export class GroundScene {
  readonly terrain: Terrain;
  readonly biome: Biome;
  private renderer: Renderer;
  private ground: StaticMesh;
  private props: StaticMesh;
  private water: StaticMesh | null;
  private cubes: CubeBatch;
  private shadows: CubeBatch;
  private grid: ObstacleGrid;
  private squads: Squad[] = [];
  private soldiers: Soldier[] = [];
  private playerLook: Look;

  // --- the character --------------------------------------------------------
  private px = 0; private py = 0; private pz = 0;
  private vy = 0;
  private vx = 0; private vz = 0;
  private facing = 0;
  private phase = 0;
  private grounded = true;
  private crouch = 0;

  // --- the camera -----------------------------------------------------------
  private yaw = 0;
  private pitch = -0.16;
  private distance = 5.6;
  private clock = 0;

  private view = mat4();
  private proj = mat4();
  private viewProj = mat4();
  private light: Vec3;

  /** Read by the HUD each frame. */
  readonly status = {
    speed: 0, height: 0, friendlies: 0, hostiles: 0, nearest: Infinity,
    firstPerson: false, wading: false, props: 0,
  };

  constructor(canvas: HTMLCanvasElement, readonly deployment: Deployment) {
    this.biome = biomeFor(deployment.kind);
    const seed = (deployment.province + 1) * 2246822519 % 2147483647;
    this.terrain = new Terrain(seed, this.biome, deployment.coastal);

    this.renderer = new Renderer(canvas);
    const gl = this.renderer.gl;
    this.ground = new StaticMesh(gl, this.terrain.buildMesh(), this.renderer.identityBuffer);
    const props = buildProps(this.terrain, this.biome, seed);
    this.props = new StaticMesh(gl, props.mesh, this.renderer.identityBuffer);
    this.status.props = props.count;
    this.grid = new ObstacleGrid(props.obstacles);
    const waterMesh = this.terrain.buildWaterMesh();
    this.water = waterMesh ? new StaticMesh(gl, waterMesh, this.renderer.identityBuffer) : null;
    const cube = unitCube();
    this.cubes = new CubeBatch(gl, cube);
    this.shadows = new CubeBatch(gl, cube, 256);

    // the sun sits where the province's seed puts it, so two neighbouring
    // provinces do not look like the same photograph
    const rng = new Rng(seed ^ 0x5f3a);
    const sunAngle = rng.range(0.6, 2.4);
    const sunHeight = rng.range(0.55, 0.85);
    const flat = Math.sqrt(1 - sunHeight * sunHeight);
    this.light = [Math.cos(sunAngle) * flat, sunHeight, Math.sin(sunAngle) * flat];

    this.playerLook = this.makeLook(deployment.playerColour, true);
    this.deploy(rng);

    // stand the player on solid ground at the centre of the clearing
    const spawn = this.findSpawn();
    this.px = spawn[0]; this.pz = spawn[1];
    this.py = this.terrain.heightAt(this.px, this.pz);
    // face the middle of the enemy line, not whichever flank happens to be
    // first in the list
    const watch = this.squads.filter((s) => s.spec.hostile);
    const look = watch.length ? watch : this.squads;
    if (look.length) {
      const cx = look.reduce((a, s) => a + s.x, 0) / look.length;
      const cz = look.reduce((a, s) => a + s.z, 0) / look.length;
      this.facing = Math.atan2(-(cx - this.px), -(cz - this.pz));
    }
    this.yaw = this.facing;
  }

  private makeLook(colourHex: string, player: boolean): Look {
    const accent = hexToRgb(colourHex);
    // the uniform is the nation's colour dragged most of the way to a drab, so
    // that a dozen nations stay tellable apart without looking like bunting
    const drab: Vec3 = [0.29, 0.3, 0.25];
    return {
      uniform: mixRgb(drab, accent, player ? 0.42 : 0.3),
      trousers: mixRgb([0.22, 0.23, 0.2], accent, 0.16),
      helmet: mixRgb([0.24, 0.26, 0.22], accent, player ? 0.3 : 0.18),
      skin: [0.78, 0.6, 0.47],
      accent,
      build: 1,
    };
  }

  /** Lay the formations out as a line of battle, the two sides facing. */
  private deploy(rng: Rng) {
    const friendly = this.deployment.squads.filter((s) => !s.hostile);
    const hostile = this.deployment.squads.filter((s) => s.hostile);
    let budget = MAX_SOLDIERS;

    // Your own people stand around you and the enemy forms up across the
    // field: close enough to count their flags, far enough that walking over
    // there is a decision.
    const place = (list: SquadSpec[], side: number) => {
      list.forEach((spec, i) => {
        const spread = list.length > 1 ? (i / (list.length - 1) - 0.5) : 0;
        const x = spread * Math.min(150, list.length * 34) + rng.range(-8, 8);
        const z = side * (side > 0 ? rng.range(17, 34) : rng.range(58, 96));
        // formations do not stand in the sea
        if (this.terrain.submerged(x, z)) return;
        const squad: Squad = {
          spec, x, z, colour: hexToRgb(spec.colour),
          // forward is (-sin yaw, -cos yaw), so a formation standing on the
          // +Z side turns to yaw 0 to look back across the field, not to PI
          yaw: side > 0 ? 0 : Math.PI,
          men: 0,
        };
        const want = Math.min(12, Math.max(3, Math.round(3 + spec.strength * 9)));
        const men = Math.min(want, budget);
        budget -= men;
        squad.men = men;
        const index = this.squads.length;
        this.squads.push(squad);

        const look = this.makeLook(spec.colour, false);
        for (let n = 0; n < men; n++) {
          // four to a rank, which reads as a formation rather than a crowd
          const col = n % 4, row = Math.floor(n / 4);
          const sx = x + (col - 1.5) * 2.2 + rng.range(-0.4, 0.4);
          const sz = z + row * 2.4 * (side > 0 ? 1 : -1) + rng.range(-0.4, 0.4);
          this.soldiers.push({
            x: sx, z: sz, yaw: squad.yaw,
            homeX: sx, homeZ: sz, toX: sx, toZ: sz,
            wait: rng.range(0, 6), phase: rng.range(0, Math.PI * 2), speed: 0,
            look: { ...look, build: rng.range(0.94, 1.07) },
            hostile: spec.hostile, squad: index,
          });
        }
      });
    };

    place(friendly, 1);
    place(hostile, -1);
  }

  /** Somewhere dry and reasonably level near the middle of the arena. */
  private findSpawn(): [number, number] {
    if (!this.terrain.submerged(0, 0) && this.terrain.slopeAt(0, 0) < 0.5) return [0, 0];
    for (let r = 6; r < 90; r += 6) {
      for (let a = 0; a < 12; a++) {
        const t = (a / 12) * Math.PI * 2;
        const x = Math.cos(t) * r, z = Math.sin(t) * r;
        if (!this.terrain.submerged(x, z) && this.terrain.slopeAt(x, z) < 0.5) return [x, z];
      }
    }
    return [0, 0];
  }

  // --- simulation -----------------------------------------------------------

  update(dt: number, input: Input) {
    this.clock += dt;
    this.look(input);
    this.movePlayer(dt, input);
    this.moveSoldiers(dt);
    this.report();
  }

  private look(input: Input) {
    const [dx, dy] = input.takeLook();
    const sens = 0.0022;
    this.yaw -= dx * sens;
    this.pitch = clamp(this.pitch - dy * sens, -1.25, 1.15);
    const wheel = input.takeWheel();
    if (wheel) this.distance = clamp(this.distance + wheel * 0.006, 0.6, 16);
  }

  private movePlayer(dt: number, input: Input) {
    // walk direction is read in the camera's frame, which is what makes the
    // controls feel the same no matter which way the character is facing
    const fx = -Math.sin(this.yaw), fz = -Math.cos(this.yaw);
    const rx = Math.cos(this.yaw), rz = -Math.sin(this.yaw);
    let mx = 0, mz = 0;
    if (input.down('KeyW', 'ArrowUp')) { mx += fx; mz += fz; }
    if (input.down('KeyS', 'ArrowDown')) { mx -= fx; mz -= fz; }
    if (input.down('KeyD', 'ArrowRight')) { mx += rx; mz += rz; }
    if (input.down('KeyA', 'ArrowLeft')) { mx -= rx; mz -= rz; }
    const len = Math.hypot(mx, mz);
    if (len > 0) { mx /= len; mz /= len; }

    const wantCrouch = input.down('ControlLeft', 'ControlRight', 'KeyC');
    this.crouch += ((wantCrouch ? 1 : 0) - this.crouch) * Math.min(1, dt * 10);

    const wading = this.terrain.hasWater
      && this.py < this.terrain.waterLevel - 0.15;
    let top = input.down('ShiftLeft', 'ShiftRight') ? SPRINT : WALK;
    if (wantCrouch) top = CROUCH_SPEED;
    if (wading) top *= 0.45;
    // uphill costs you speed, downhill gives a little back
    const slope = this.terrain.slopeAt(this.px, this.pz);
    top *= clamp(1 - slope * 0.35, 0.45, 1.1);

    // accelerate toward the wanted velocity rather than snapping to it; in the
    // air you keep most of your momentum and only steer a little
    const control = this.grounded ? 12 : 2.2;
    const targetX = mx * top, targetZ = mz * top;
    this.vx += (targetX - this.vx) * Math.min(1, dt * control);
    this.vz += (targetZ - this.vz) * Math.min(1, dt * control);

    if (this.grounded && input.down('Space')) { this.vy = JUMP; this.grounded = false; }
    this.vy -= GRAVITY * dt;

    let nx = this.px + this.vx * dt;
    let nz = this.pz + this.vz * dt;
    [nx, nz] = this.grid.resolve(nx, nz, 0.42);

    // the arena has a soft edge: you are stopped rather than falling off it
    const edge = ARENA / 2 - 4;
    nx = clamp(nx, -edge, edge);
    nz = clamp(nz, -edge, edge);
    this.px = nx; this.pz = nz;

    const ground = this.terrain.heightAt(this.px, this.pz);
    this.py += this.vy * dt;
    if (this.py <= ground) {
      this.py = ground;
      this.vy = 0;
      this.grounded = true;
    } else if (this.py > ground + 0.02) {
      this.grounded = false;
    }

    const planar = Math.hypot(this.vx, this.vz);
    // the stride advances with distance covered, so the feet never skate
    if (this.grounded) this.phase += (planar / 1.55) * dt * Math.PI * 2;
    if (planar > 0.35) {
      const want = Math.atan2(-this.vx, -this.vz);
      this.facing += angleDelta(this.facing, want) * Math.min(1, dt * 12);
    }
    this.status.speed = planar;
    this.status.height = this.py;
    this.status.wading = wading;
  }

  private moveSoldiers(dt: number) {
    for (const s of this.soldiers) {
      const dxp = this.px - s.x, dzp = this.pz - s.z;
      const toPlayer = Math.hypot(dxp, dzp);

      // close enough to notice you: turn and watch, and stop milling about
      if (toPlayer < 16) {
        s.speed += (0 - s.speed) * Math.min(1, dt * 6);
        const want = Math.atan2(-dxp, -dzp);
        s.yaw += angleDelta(s.yaw, want) * Math.min(1, dt * 4);
        s.wait = Math.max(s.wait, 1.5);
        continue;
      }

      s.wait -= dt;
      const dx = s.toX - s.x, dz = s.toZ - s.z;
      const d = Math.hypot(dx, dz);
      if (d < 0.6) {
        s.speed += (0 - s.speed) * Math.min(1, dt * 5);
        if (s.wait <= 0) {
          // drift about the spot the formation was posted to, never far
          const a = Math.random() * Math.PI * 2;
          const r = Math.random() * 4.5;
          s.toX = s.homeX + Math.cos(a) * r;
          s.toZ = s.homeZ + Math.sin(a) * r;
          s.wait = 2 + Math.random() * 7;
        }
      } else {
        const step = 1.35;
        s.speed += (step - s.speed) * Math.min(1, dt * 4);
        const vx = (dx / d) * s.speed, vz = (dz / d) * s.speed;
        let nx = s.x + vx * dt, nz = s.z + vz * dt;
        [nx, nz] = this.grid.resolve(nx, nz, 0.4);
        s.x = nx; s.z = nz;
        const want = Math.atan2(-vx, -vz);
        s.yaw += angleDelta(s.yaw, want) * Math.min(1, dt * 6);
        s.phase += (s.speed / 1.55) * dt * Math.PI * 2;
      }
    }
  }

  private report() {
    let friendlies = 0, hostiles = 0, nearest = Infinity;
    for (const s of this.soldiers) {
      if (s.hostile) hostiles++; else friendlies++;
      if (!s.hostile) continue;
      const d = Math.hypot(s.x - this.px, s.z - this.pz);
      if (d < nearest) nearest = d;
    }
    this.status.friendlies = friendlies;
    this.status.hostiles = hostiles;
    this.status.nearest = nearest;
    this.status.firstPerson = this.distance < 1.35;
  }

  // --- drawing --------------------------------------------------------------

  render() {
    const { width, height } = this.renderer.resize();
    const aspect = width / Math.max(1, height);

    const headY = this.py + EYE - this.crouch * 0.45;
    const target: Vec3 = [this.px, headY, this.pz];
    const cp = Math.cos(this.pitch), sp = Math.sin(this.pitch);
    const dir: Vec3 = [-Math.sin(this.yaw) * cp, sp, -Math.cos(this.yaw) * cp];

    // pull the camera in rather than let the ground grow through it
    let dist = this.distance;
    for (let i = 1; i <= 8; i++) {
      const t = (i / 8) * this.distance;
      const sx = target[0] - dir[0] * t;
      const sy = target[1] - dir[1] * t;
      const sz = target[2] - dir[2] * t;
      if (sy < this.terrain.heightAt(sx, sz) + 0.45) { dist = Math.max(0.5, t - 0.35); break; }
    }
    const firstPerson = dist < 1.35;
    const eye: Vec3 = firstPerson
      ? [this.px - dir[0] * 0.1, headY, this.pz - dir[2] * 0.1]
      : [target[0] - dir[0] * dist, target[1] - dir[1] * dist, target[2] - dir[2] * dist];
    eye[1] = Math.max(eye[1], this.terrain.heightAt(eye[0], eye[2]) + 0.4);

    lookAt(this.view, eye, [eye[0] + dir[0], eye[1] + dir[1], eye[2] + dir[2]]);
    perspective(this.proj, (firstPerson ? 74 : 62) * Math.PI / 180, aspect, 0.1, 900);
    multiply(this.viewProj, this.proj, this.view);

    const colours = { sky: this.biome.sky, horizon: this.biome.horizon, fog: this.biome.horizon };
    this.renderer.beginFrame(colours, this.pitch * 0.42);
    this.renderer.setCamera(this.viewProj, this.light, 125, 265);

    this.renderer.drawStatic(this.ground, 0);
    this.renderer.drawStatic(this.props, PROP_OUTLINE);

    this.cubes.reset();
    this.shadows.reset();
    this.queueActors(firstPerson);
    this.renderer.drawCubes(this.cubes, ACTOR_OUTLINE);
    this.renderer.drawShadows(this.shadows);

    if (this.water) this.renderer.drawWater(this.water);
  }

  /**
   * A soft patch on the ground under a figure. Lifted clear of the surface
   * rather than laid flat on it: at this facet size a shadow sitting exactly
   * on the ground z-fights across half the field.
   */
  private shadow(x: number, z: number, size: number, lift = 1) {
    const m = mat4();
    m[12] = x;
    m[13] = this.terrain.heightAt(x, z) + 0.09;
    m[14] = z;
    m[0] = size; m[5] = 0.02; m[10] = size * 0.8;
    this.shadows.add(m, [0, 0, 0], lift);
  }

  private queueActors(firstPerson: boolean) {
    const pose: Pose = {
      x: this.px, y: this.py, z: this.pz, yaw: this.facing,
      phase: this.phase, speed: this.status.speed, crouch: this.crouch, clock: this.clock,
    };
    if (!firstPerson) {
      drawActor(this.cubes, pose, this.playerLook);
      // the shadow shrinks as you leave the ground, which is the only cue
      // a jump has that the camera does not already give you
      const air = Math.max(0, this.py - this.terrain.heightAt(this.px, this.pz));
      this.shadow(this.px, this.pz, 0.95 / (1 + air * 0.5));
    }

    for (const s of this.soldiers) {
      // nothing behind you at two hundred metres is worth a draw call
      if (Math.abs(s.x - this.px) > 200 || Math.abs(s.z - this.pz) > 200) continue;
      drawActor(this.cubes, {
        x: s.x, y: this.terrain.heightAt(s.x, s.z), z: s.z, yaw: s.yaw,
        phase: s.phase, speed: s.speed, crouch: 0, clock: this.clock,
      }, s.look);
      this.shadow(s.x, s.z, 0.9);
    }

    for (const sq of this.squads) {
      if (!sq.men) continue;
      const fx = sq.x - 3.4;
      drawFlag(this.cubes, fx, this.terrain.heightAt(fx, sq.z), sq.z, sq.yaw, sq.colour, this.clock);
      this.shadow(fx, sq.z, 0.5);
    }
  }

  dispose() {
    this.ground.dispose();
    this.props.dispose();
    this.water?.dispose();
    this.cubes.dispose();
    this.shadows.dispose();
    this.renderer.dispose();
  }
}
