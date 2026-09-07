import type { Vec3 } from './glx';

/**
 * Flat-shaded geometry, built on the CPU and handed to the GPU once.
 *
 * Every vertex carries four things: its position, the face normal (duplicated
 * per face, which is what makes the shading flat rather than smooth), its
 * colour, and an expansion direction. The last one exists for the outline
 * pass - pushing a box's vertices along their *face* normals leaves the
 * silhouette notched at the corners, so each vertex also stores the direction
 * from the shape's centre, which pushes corners outward as a piece.
 */
export const FLOATS_PER_VERTEX = 12;   // pos 3, normal 3, colour 3, expand 3

export class MeshBuilder {
  private data: number[] = [];

  get vertexCount() { return this.data.length / FLOATS_PER_VERTEX; }

  /** Interleaved vertex buffer, ready for `gl.bufferData`. */
  build(): Float32Array { return new Float32Array(this.data); }

  private vertex(p: Vec3, n: Vec3, c: Vec3, e: Vec3) {
    this.data.push(p[0], p[1], p[2], n[0], n[1], n[2], c[0], c[1], c[2], e[0], e[1], e[2]);
  }

  /**
   * A triangle, with its normal derived from the winding. Expansion falls back
   * to the face normal, which is right for anything flat.
   */
  triangle(a: Vec3, b: Vec3, c: Vec3, colour: Vec3, expand?: [Vec3, Vec3, Vec3]) {
    const ux = b[0] - a[0], uy = b[1] - a[1], uz = b[2] - a[2];
    const vx = c[0] - a[0], vy = c[1] - a[1], vz = c[2] - a[2];
    let nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
    const len = Math.hypot(nx, ny, nz) || 1;
    nx /= len; ny /= len; nz /= len;
    const n: Vec3 = [nx, ny, nz];
    this.vertex(a, n, colour, expand?.[0] ?? n);
    this.vertex(b, n, colour, expand?.[1] ?? n);
    this.vertex(c, n, colour, expand?.[2] ?? n);
  }

  /** A quad as two triangles, wound counter-clockwise from the front. */
  quad(a: Vec3, b: Vec3, c: Vec3, d: Vec3, colour: Vec3, expand?: [Vec3, Vec3, Vec3, Vec3]) {
    this.triangle(a, b, c, colour, expand && [expand[0], expand[1], expand[2]]);
    this.triangle(a, c, d, colour, expand && [expand[0], expand[2], expand[3]]);
  }

  /**
   * An axis-aligned box, optionally spun about Y. `centre` is the middle of
   * the box and `size` its full extent.
   *
   * Faces may be shaded individually: passing `topTint` lifts the top face and
   * the sides are stepped down a little, which is what gives a plain block its
   * readable form even before any light hits it.
   */
  box(centre: Vec3, size: Vec3, colour: Vec3, yaw = 0, faceShade = 1) {
    const hx = size[0] / 2, hy = size[1] / 2, hz = size[2] / 2;
    const cos = Math.cos(yaw), sin = Math.sin(yaw);
    // eight corners in local space, then spun and moved into place
    const corner = (sx: number, sy: number, sz: number): Vec3 => {
      const x = sx * hx, y = sy * hy, z = sz * hz;
      return [centre[0] + x * cos + z * sin, centre[1] + y, centre[2] - x * sin + z * cos];
    };
    // the outline pushes corners away from the box centre, not along a face
    const away = (sx: number, sy: number, sz: number): Vec3 => {
      const x = sx * hx, y = sy * hy, z = sz * hz;
      const l = Math.hypot(x, y, z) || 1;
      const wx = (x / l) * cos + (z / l) * sin;
      const wz = -(x / l) * sin + (z / l) * cos;
      return [wx, y / l, wz];
    };

    const p = {
      lbb: corner(-1, -1, -1), rbb: corner(1, -1, -1), rtb: corner(1, 1, -1), ltb: corner(-1, 1, -1),
      lbf: corner(-1, -1, 1), rbf: corner(1, -1, 1), rtf: corner(1, 1, 1), ltf: corner(-1, 1, 1),
    };
    const e = {
      lbb: away(-1, -1, -1), rbb: away(1, -1, -1), rtb: away(1, 1, -1), ltb: away(-1, 1, -1),
      lbf: away(-1, -1, 1), rbf: away(1, -1, 1), rtf: away(1, 1, 1), ltf: away(-1, 1, 1),
    };

    const shade = (f: number): Vec3 =>
      [colour[0] * f, colour[1] * f, colour[2] * f];

    // top is brightest, sides stepped down, the underside darkest - a cheap
    // stand-in for ambient occlusion that costs nothing at draw time
    const top = shade(faceShade);
    const side = shade(faceShade * 0.88);
    const bottom = shade(faceShade * 0.62);

    this.quad(p.ltf, p.rtf, p.rtb, p.ltb, top, [e.ltf, e.rtf, e.rtb, e.ltb]);          // +Y
    this.quad(p.lbb, p.rbb, p.rbf, p.lbf, bottom, [e.lbb, e.rbb, e.rbf, e.lbf]);       // -Y
    this.quad(p.lbf, p.rbf, p.rtf, p.ltf, side, [e.lbf, e.rbf, e.rtf, e.ltf]);         // +Z
    this.quad(p.rbb, p.lbb, p.ltb, p.rtb, side, [e.rbb, e.lbb, e.ltb, e.rtb]);         // -Z
    this.quad(p.rbf, p.rbb, p.rtb, p.rtf, side, [e.rbf, e.rbb, e.rtb, e.rtf]);         // +X
    this.quad(p.lbb, p.lbf, p.ltf, p.ltb, side, [e.lbb, e.lbf, e.ltf, e.ltb]);         // -X
  }

  /**
   * A tapered box: the top face can be smaller than the bottom one, and offset.
   * Rocks, tents and tree canopies all come from this.
   */
  frustum(base: Vec3, size: Vec3, topScale: number, height: number, colour: Vec3, yaw = 0) {
    const hx = size[0] / 2, hz = size[2] / 2;
    const tx = hx * topScale, tz = hz * topScale;
    const cos = Math.cos(yaw), sin = Math.sin(yaw);
    const at = (x: number, y: number, z: number): Vec3 =>
      [base[0] + x * cos + z * sin, base[1] + y, base[2] - x * sin + z * cos];
    const dir = (x: number, z: number): Vec3 => {
      const l = Math.hypot(x, z) || 1;
      return [(x / l) * cos + (z / l) * sin, 0.35, -(x / l) * sin + (z / l) * cos];
    };

    const b0 = at(-hx, 0, -hz), b1 = at(hx, 0, -hz), b2 = at(hx, 0, hz), b3 = at(-hx, 0, hz);
    const t0 = at(-tx, height, -tz), t1 = at(tx, height, -tz);
    const t2 = at(tx, height, tz), t3 = at(-tx, height, tz);
    const e0 = dir(-1, -1), e1 = dir(1, -1), e2 = dir(1, 1), e3 = dir(-1, 1);

    const shade = (f: number): Vec3 => [colour[0] * f, colour[1] * f, colour[2] * f];
    this.quad(t3, t2, t1, t0, shade(1), [e3, e2, e1, e0]);
    this.quad(b3, b2, t2, t3, shade(0.9), [e3, e2, e2, e3]);
    this.quad(b1, b0, t0, t1, shade(0.9), [e1, e0, e0, e1]);
    this.quad(b2, b1, t1, t2, shade(0.84), [e2, e1, e1, e2]);
    this.quad(b0, b3, t3, t0, shade(0.84), [e0, e3, e3, e0]);
  }
}

/**
 * The unit cube every character and every instanced prop is drawn from:
 * centred on the origin, one metre on a side, white so the instance tint
 * decides the colour.
 */
export function unitCube(): Float32Array {
  const m = new MeshBuilder();
  m.box([0, 0, 0], [1, 1, 1], [1, 1, 1]);
  return m.build();
}
