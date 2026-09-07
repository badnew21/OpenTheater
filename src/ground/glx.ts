/**
 * The small slice of 3D that the ground mode needs: column-major 4x4 matrices
 * and enough WebGL2 plumbing to put flat-shaded blocks on screen.
 *
 * Deliberately not a library. The whole renderer draws one kind of thing - an
 * untextured, vertex-coloured, flat-shaded mesh - so a general engine would be
 * mostly dead weight, and the map already ships its own renderer.
 */

export type Mat4 = Float32Array;
export type Vec3 = [number, number, number];

export const mat4 = (): Mat4 =>
  new Float32Array([1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]);

export function identity(out: Mat4): Mat4 {
  out[0] = 1; out[1] = 0; out[2] = 0; out[3] = 0;
  out[4] = 0; out[5] = 1; out[6] = 0; out[7] = 0;
  out[8] = 0; out[9] = 0; out[10] = 1; out[11] = 0;
  out[12] = 0; out[13] = 0; out[14] = 0; out[15] = 1;
  return out;
}

/** out = a * b, both column-major. */
export function multiply(out: Mat4, a: Mat4, b: Mat4): Mat4 {
  for (let c = 0; c < 4; c++) {
    const b0 = b[c * 4], b1 = b[c * 4 + 1], b2 = b[c * 4 + 2], b3 = b[c * 4 + 3];
    out[c * 4] = a[0] * b0 + a[4] * b1 + a[8] * b2 + a[12] * b3;
    out[c * 4 + 1] = a[1] * b0 + a[5] * b1 + a[9] * b2 + a[13] * b3;
    out[c * 4 + 2] = a[2] * b0 + a[6] * b1 + a[10] * b2 + a[14] * b3;
    out[c * 4 + 3] = a[3] * b0 + a[7] * b1 + a[11] * b2 + a[15] * b3;
  }
  return out;
}

/** Post-multiply by a translation, the way gl-matrix does it. */
export function translate(out: Mat4, x: number, y: number, z: number): Mat4 {
  out[12] += out[0] * x + out[4] * y + out[8] * z;
  out[13] += out[1] * x + out[5] * y + out[9] * z;
  out[14] += out[2] * x + out[6] * y + out[10] * z;
  out[15] += out[3] * x + out[7] * y + out[11] * z;
  return out;
}

export function rotateX(out: Mat4, rad: number): Mat4 {
  const s = Math.sin(rad), c = Math.cos(rad);
  const a4 = out[4], a5 = out[5], a6 = out[6], a7 = out[7];
  const a8 = out[8], a9 = out[9], a10 = out[10], a11 = out[11];
  out[4] = a4 * c + a8 * s; out[5] = a5 * c + a9 * s;
  out[6] = a6 * c + a10 * s; out[7] = a7 * c + a11 * s;
  out[8] = a8 * c - a4 * s; out[9] = a9 * c - a5 * s;
  out[10] = a10 * c - a6 * s; out[11] = a11 * c - a7 * s;
  return out;
}

export function rotateY(out: Mat4, rad: number): Mat4 {
  const s = Math.sin(rad), c = Math.cos(rad);
  const a0 = out[0], a1 = out[1], a2 = out[2], a3 = out[3];
  const a8 = out[8], a9 = out[9], a10 = out[10], a11 = out[11];
  out[0] = a0 * c - a8 * s; out[1] = a1 * c - a9 * s;
  out[2] = a2 * c - a10 * s; out[3] = a3 * c - a11 * s;
  out[8] = a0 * s + a8 * c; out[9] = a1 * s + a9 * c;
  out[10] = a2 * s + a10 * c; out[11] = a3 * s + a11 * c;
  return out;
}

export function rotateZ(out: Mat4, rad: number): Mat4 {
  const s = Math.sin(rad), c = Math.cos(rad);
  const a0 = out[0], a1 = out[1], a2 = out[2], a3 = out[3];
  const a4 = out[4], a5 = out[5], a6 = out[6], a7 = out[7];
  out[0] = a0 * c + a4 * s; out[1] = a1 * c + a5 * s;
  out[2] = a2 * c + a6 * s; out[3] = a3 * c + a7 * s;
  out[4] = a4 * c - a0 * s; out[5] = a5 * c - a1 * s;
  out[6] = a6 * c - a2 * s; out[7] = a7 * c - a3 * s;
  return out;
}

export function scale(out: Mat4, x: number, y: number, z: number): Mat4 {
  out[0] *= x; out[1] *= x; out[2] *= x; out[3] *= x;
  out[4] *= y; out[5] *= y; out[6] *= y; out[7] *= y;
  out[8] *= z; out[9] *= z; out[10] *= z; out[11] *= z;
  return out;
}

export function perspective(out: Mat4, fovy: number, aspect: number, near: number, far: number): Mat4 {
  const f = 1 / Math.tan(fovy / 2);
  identity(out);
  out[0] = f / aspect;
  out[5] = f;
  out[10] = (far + near) / (near - far);
  out[11] = -1;
  out[14] = (2 * far * near) / (near - far);
  out[15] = 0;
  return out;
}

export function lookAt(out: Mat4, eye: Vec3, target: Vec3, up: Vec3 = [0, 1, 0]): Mat4 {
  let zx = eye[0] - target[0], zy = eye[1] - target[1], zz = eye[2] - target[2];
  let len = Math.hypot(zx, zy, zz) || 1;
  zx /= len; zy /= len; zz /= len;

  let xx = up[1] * zz - up[2] * zy;
  let xy = up[2] * zx - up[0] * zz;
  let xz = up[0] * zy - up[1] * zx;
  len = Math.hypot(xx, xy, xz);
  // eye directly above the target: any horizontal axis will do
  if (len < 1e-6) { xx = 1; xy = 0; xz = 0; } else { xx /= len; xy /= len; xz /= len; }

  const yx = zy * xz - zz * xy;
  const yy = zz * xx - zx * xz;
  const yz = zx * xy - zy * xx;

  out[0] = xx; out[1] = yx; out[2] = zx; out[3] = 0;
  out[4] = xy; out[5] = yy; out[6] = zy; out[7] = 0;
  out[8] = xz; out[9] = yz; out[10] = zz; out[11] = 0;
  out[12] = -(xx * eye[0] + xy * eye[1] + xz * eye[2]);
  out[13] = -(yx * eye[0] + yy * eye[1] + yz * eye[2]);
  out[14] = -(zx * eye[0] + zy * eye[1] + zz * eye[2]);
  out[15] = 1;
  return out;
}

// --- shaders ---------------------------------------------------------------

function compile(gl: WebGL2RenderingContext, type: number, src: string): WebGLShader {
  const sh = gl.createShader(type)!;
  gl.shaderSource(sh, src);
  gl.compileShader(sh);
  if (!gl.getShaderParameter(sh, gl.COMPILE_STATUS)) {
    const log = gl.getShaderInfoLog(sh);
    gl.deleteShader(sh);
    throw new Error(`shader failed to compile: ${log}`);
  }
  return sh;
}

export function createProgram(gl: WebGL2RenderingContext, vsSrc: string, fsSrc: string): WebGLProgram {
  const vs = compile(gl, gl.VERTEX_SHADER, vsSrc);
  const fs = compile(gl, gl.FRAGMENT_SHADER, fsSrc);
  const prog = gl.createProgram()!;
  gl.attachShader(prog, vs);
  gl.attachShader(prog, fs);
  gl.linkProgram(prog);
  // the shaders live on inside the program object; drop our references
  gl.deleteShader(vs);
  gl.deleteShader(fs);
  if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) {
    const log = gl.getProgramInfoLog(prog);
    gl.deleteProgram(prog);
    throw new Error(`program failed to link: ${log}`);
  }
  return prog;
}

/** Every uniform a program declares, looked up once. */
export function uniforms(gl: WebGL2RenderingContext, prog: WebGLProgram): Record<string, WebGLUniformLocation> {
  const out: Record<string, WebGLUniformLocation> = {};
  const n = gl.getProgramParameter(prog, gl.ACTIVE_UNIFORMS) as number;
  for (let i = 0; i < n; i++) {
    const info = gl.getActiveUniform(prog, i);
    if (!info) continue;
    const loc = gl.getUniformLocation(prog, info.name);
    if (loc) out[info.name] = loc;
  }
  return out;
}

/** '#rrggbb' or '#rgb' to linear-ish 0..1 triples. */
export function hexToRgb(hex: string): Vec3 {
  let h = hex.replace('#', '').trim();
  if (h.length === 3) h = h[0] + h[0] + h[1] + h[1] + h[2] + h[2];
  const v = parseInt(h, 16);
  if (!isFinite(v)) return [1, 0, 1];
  return [((v >> 16) & 255) / 255, ((v >> 8) & 255) / 255, (v & 255) / 255];
}

export function mixRgb(a: Vec3, b: Vec3, t: number): Vec3 {
  return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
}
