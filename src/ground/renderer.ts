import { createProgram, uniforms, type Mat4, type Vec3 } from './glx';
import { FLOATS_PER_VERTEX } from './mesh';

/**
 * Everything is drawn by one program: untextured, vertex-coloured, flat-shaded
 * geometry, optionally instanced, optionally inflated into a black outline.
 *
 * The outline is the whole trick behind the look. Each shape is drawn a second
 * time with the front faces culled and the vertices pushed outward, so only the
 * part of the inflated copy that falls outside the real one survives - a hard
 * ink line around every silhouette, which is what makes flat colour read as
 * drawn rather than as untextured.
 */
const VERT = `#version 300 es
layout(location = 0) in vec3 aPos;
layout(location = 1) in vec3 aNormal;
layout(location = 2) in vec3 aColor;
layout(location = 3) in vec3 aExpand;
layout(location = 4) in mat4 aModel;
layout(location = 8) in vec3 aTint;
layout(location = 9) in float aShade;

uniform mat4 uViewProj;
uniform float uOutline;

out vec3 vNormal;
out vec3 vColor;
out float vDepth;

void main() {
  vec4 world = aModel * vec4(aPos, 1.0);
  mat3 rot = mat3(aModel);
  // pushed out in world space, so the line keeps its width on a limb that has
  // been squashed into a plank
  if (uOutline > 0.0) world.xyz += normalize(rot * aExpand) * uOutline;
  vNormal = rot * aNormal;
  vColor = aColor * aTint * aShade;
  gl_Position = uViewProj * world;
  vDepth = gl_Position.w;
}`;

const FRAG = `#version 300 es
precision highp float;

in vec3 vNormal;
in vec3 vColor;
in float vDepth;

uniform vec3 uLightDir;
uniform vec3 uFogColor;
uniform float uFogNear;
uniform float uFogFar;
uniform float uIsOutline;
uniform float uAlpha;

out vec4 frag;

void main() {
  vec3 n = normalize(vNormal);
  float d = max(dot(n, uLightDir), 0.0);
  // a three-step ramp rather than a smooth falloff: facets stay flat and the
  // edge between two faces of a block stays a hard line
  float band = d > 0.62 ? 1.0 : (d > 0.26 ? 0.83 : 0.66);
  // a little sky bounce from above and warm ground bounce from below
  float up = n.y * 0.5 + 0.5;
  vec3 lit = vColor * band * (0.88 + 0.22 * up);
  vec3 col = mix(lit, vec3(0.06, 0.05, 0.08), uIsOutline);
  float fog = smoothstep(uFogNear, uFogFar, vDepth);
  frag = vec4(mix(col, uFogColor, fog), uAlpha);
}`;

/** A screen-filling gradient, shifted by where the camera is looking. */
const SKY_VERT = `#version 300 es
const vec2 verts[3] = vec2[3](vec2(-1.0, -1.0), vec2(3.0, -1.0), vec2(-1.0, 3.0));
out vec2 vUv;
void main() {
  vec2 p = verts[gl_VertexID];
  vUv = p * 0.5 + 0.5;
  gl_Position = vec4(p, 0.0, 1.0);
}`;

const SKY_FRAG = `#version 300 es
precision highp float;
in vec2 vUv;
uniform vec3 uSky;
uniform vec3 uHorizon;
uniform float uShift;
out vec4 frag;
void main() {
  float t = clamp(vUv.y + uShift, 0.0, 1.0);
  frag = vec4(mix(uHorizon, uSky, smoothstep(0.0, 0.85, t)), 1.0);
}`;

const INSTANCE_FLOATS = 20;   // model 16, tint 3, shade 1
const STRIDE = FLOATS_PER_VERTEX * 4;

/** Wires the per-vertex and per-instance attributes onto a fresh VAO. */
function makeVao(
  gl: WebGL2RenderingContext, vertexBuffer: WebGLBuffer, instanceBuffer: WebGLBuffer,
): WebGLVertexArrayObject {
  const vao = gl.createVertexArray()!;
  gl.bindVertexArray(vao);

  gl.bindBuffer(gl.ARRAY_BUFFER, vertexBuffer);
  for (let i = 0; i < 4; i++) {
    gl.enableVertexAttribArray(i);
    gl.vertexAttribPointer(i, 3, gl.FLOAT, false, STRIDE, i * 12);
  }

  gl.bindBuffer(gl.ARRAY_BUFFER, instanceBuffer);
  const istride = INSTANCE_FLOATS * 4;
  for (let c = 0; c < 4; c++) {
    const loc = 4 + c;
    gl.enableVertexAttribArray(loc);
    gl.vertexAttribPointer(loc, 4, gl.FLOAT, false, istride, c * 16);
    gl.vertexAttribDivisor(loc, 1);
  }
  gl.enableVertexAttribArray(8);
  gl.vertexAttribPointer(8, 3, gl.FLOAT, false, istride, 64);
  gl.vertexAttribDivisor(8, 1);
  gl.enableVertexAttribArray(9);
  gl.vertexAttribPointer(9, 1, gl.FLOAT, false, istride, 76);
  gl.vertexAttribDivisor(9, 1);

  gl.bindVertexArray(null);
  return vao;
}

/** A mesh already baked into world coordinates, drawn as a single instance. */
export class StaticMesh {
  readonly vao: WebGLVertexArrayObject;
  readonly count: number;
  private vbo: WebGLBuffer;

  constructor(private gl: WebGL2RenderingContext, data: Float32Array, identityBuffer: WebGLBuffer) {
    this.vbo = gl.createBuffer()!;
    gl.bindBuffer(gl.ARRAY_BUFFER, this.vbo);
    gl.bufferData(gl.ARRAY_BUFFER, data, gl.STATIC_DRAW);
    this.count = data.length / FLOATS_PER_VERTEX;
    this.vao = makeVao(gl, this.vbo, identityBuffer);
  }

  dispose() {
    this.gl.deleteBuffer(this.vbo);
    this.gl.deleteVertexArray(this.vao);
  }
}

/**
 * The unit cube, drawn once per body part per frame. Characters are the only
 * thing that moves, so they are the only thing that pays for a buffer upload.
 */
export class CubeBatch {
  readonly vao: WebGLVertexArrayObject;
  readonly vertexCount: number;
  private vbo: WebGLBuffer;
  private ibo: WebGLBuffer;
  private data: Float32Array;
  private n = 0;

  constructor(private gl: WebGL2RenderingContext, cube: Float32Array, capacity = 4096) {
    this.vbo = gl.createBuffer()!;
    gl.bindBuffer(gl.ARRAY_BUFFER, this.vbo);
    gl.bufferData(gl.ARRAY_BUFFER, cube, gl.STATIC_DRAW);
    this.vertexCount = cube.length / FLOATS_PER_VERTEX;

    this.data = new Float32Array(capacity * INSTANCE_FLOATS);
    this.ibo = gl.createBuffer()!;
    gl.bindBuffer(gl.ARRAY_BUFFER, this.ibo);
    gl.bufferData(gl.ARRAY_BUFFER, this.data.byteLength, gl.DYNAMIC_DRAW);
    this.vao = makeVao(gl, this.vbo, this.ibo);
  }

  get count() { return this.n; }

  reset() { this.n = 0; }

  add(model: Mat4, tint: Vec3, shade: number) {
    if ((this.n + 1) * INSTANCE_FLOATS > this.data.length) this.grow();
    const o = this.n * INSTANCE_FLOATS;
    this.data.set(model, o);
    this.data[o + 16] = tint[0];
    this.data[o + 17] = tint[1];
    this.data[o + 18] = tint[2];
    this.data[o + 19] = shade;
    this.n++;
  }

  private grow() {
    const bigger = new Float32Array(this.data.length * 2);
    bigger.set(this.data);
    this.data = bigger;
    this.gl.bindBuffer(this.gl.ARRAY_BUFFER, this.ibo);
    this.gl.bufferData(this.gl.ARRAY_BUFFER, bigger.byteLength, this.gl.DYNAMIC_DRAW);
  }

  upload() {
    if (!this.n) return;
    this.gl.bindBuffer(this.gl.ARRAY_BUFFER, this.ibo);
    this.gl.bufferSubData(this.gl.ARRAY_BUFFER, 0,
      this.data.subarray(0, this.n * INSTANCE_FLOATS));
  }

  dispose() {
    this.gl.deleteBuffer(this.vbo);
    this.gl.deleteBuffer(this.ibo);
    this.gl.deleteVertexArray(this.vao);
  }
}

export interface SceneColours {
  sky: Vec3;
  horizon: Vec3;
  fog: Vec3;
}

export class Renderer {
  readonly gl: WebGL2RenderingContext;
  private prog: WebGLProgram;
  private u: Record<string, WebGLUniformLocation>;
  private skyProg: WebGLProgram;
  private skyU: Record<string, WebGLUniformLocation>;
  private emptyVao: WebGLVertexArrayObject;
  /** the single identity instance that every static mesh is drawn with */
  readonly identityBuffer: WebGLBuffer;

  constructor(canvas: HTMLCanvasElement) {
    const gl = canvas.getContext('webgl2', {
      antialias: true, alpha: false, depth: true, powerPreference: 'high-performance',
    });
    if (!gl) throw new Error('WebGL2 is not available in this browser');
    this.gl = gl;

    this.prog = createProgram(gl, VERT, FRAG);
    this.u = uniforms(gl, this.prog);
    this.skyProg = createProgram(gl, SKY_VERT, SKY_FRAG);
    this.skyU = uniforms(gl, this.skyProg);
    this.emptyVao = gl.createVertexArray()!;

    const identity = new Float32Array(INSTANCE_FLOATS);
    identity.set([1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]);
    identity[16] = 1; identity[17] = 1; identity[18] = 1; identity[19] = 1;
    this.identityBuffer = gl.createBuffer()!;
    gl.bindBuffer(gl.ARRAY_BUFFER, this.identityBuffer);
    gl.bufferData(gl.ARRAY_BUFFER, identity, gl.STATIC_DRAW);

    gl.enable(gl.DEPTH_TEST);
    gl.enable(gl.CULL_FACE);
    gl.cullFace(gl.BACK);
    gl.frontFace(gl.CCW);
  }

  /** Resize the drawing buffer to the element, capped so 4K does not crawl. */
  resize(): { width: number; height: number } {
    const gl = this.gl;
    const canvas = gl.canvas as HTMLCanvasElement;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const w = Math.max(1, Math.round(canvas.clientWidth * dpr));
    const h = Math.max(1, Math.round(canvas.clientHeight * dpr));
    if (canvas.width !== w || canvas.height !== h) { canvas.width = w; canvas.height = h; }
    gl.viewport(0, 0, w, h);
    return { width: w, height: h };
  }

  beginFrame(colours: SceneColours, pitchShift: number) {
    const gl = this.gl;
    gl.clearColor(colours.horizon[0], colours.horizon[1], colours.horizon[2], 1);
    gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);

    // the sky writes no depth, so everything else draws over it regardless
    gl.disable(gl.DEPTH_TEST);
    gl.useProgram(this.skyProg);
    gl.bindVertexArray(this.emptyVao);
    gl.uniform3fv(this.skyU.uSky, colours.sky);
    gl.uniform3fv(this.skyU.uHorizon, colours.horizon);
    gl.uniform1f(this.skyU.uShift, pitchShift);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
    gl.enable(gl.DEPTH_TEST);

    gl.useProgram(this.prog);
    gl.uniform3fv(this.u.uFogColor, colours.fog);
  }

  setCamera(viewProj: Mat4, light: Vec3, fogNear: number, fogFar: number) {
    const gl = this.gl;
    gl.useProgram(this.prog);
    gl.uniformMatrix4fv(this.u.uViewProj, false, viewProj);
    gl.uniform3fv(this.u.uLightDir, light);
    gl.uniform1f(this.u.uFogNear, fogNear);
    gl.uniform1f(this.u.uFogFar, fogFar);
    gl.uniform1f(this.u.uAlpha, 1);
  }

  /** Fill pass, then - where asked for - the inflated black silhouette. */
  drawStatic(mesh: StaticMesh, outline = 0) {
    const gl = this.gl;
    gl.bindVertexArray(mesh.vao);
    this.pass(() => gl.drawArrays(gl.TRIANGLES, 0, mesh.count), outline);
  }

  drawCubes(batch: CubeBatch, outline = 0) {
    if (!batch.count) return;
    const gl = this.gl;
    batch.upload();
    gl.bindVertexArray(batch.vao);
    this.pass(() => gl.drawArraysInstanced(gl.TRIANGLES, 0, batch.vertexCount, batch.count), outline);
  }

  private pass(draw: () => void, outline: number) {
    const gl = this.gl;
    gl.uniform1f(this.u.uOutline, 0);
    gl.uniform1f(this.u.uIsOutline, 0);
    draw();
    if (outline <= 0) return;
    gl.cullFace(gl.FRONT);
    gl.uniform1f(this.u.uOutline, outline);
    gl.uniform1f(this.u.uIsOutline, 1);
    draw();
    gl.cullFace(gl.BACK);
    gl.uniform1f(this.u.uOutline, 0);
    gl.uniform1f(this.u.uIsOutline, 0);
  }

  /**
   * Blob shadows: flattened boxes laid on the ground under everything that
   * stands on it. Blended and depth-write-off so they darken the terrain
   * instead of z-fighting with it, and tinted black so the light ramp cannot
   * lift them back out again.
   */
  drawShadows(batch: CubeBatch) {
    if (!batch.count) return;
    const gl = this.gl;
    batch.upload();
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
    gl.depthMask(false);
    gl.uniform1f(this.u.uAlpha, 0.24);
    gl.bindVertexArray(batch.vao);
    gl.drawArraysInstanced(gl.TRIANGLES, 0, batch.vertexCount, batch.count);
    gl.uniform1f(this.u.uAlpha, 1);
    gl.depthMask(true);
    gl.disable(gl.BLEND);
  }

  /** Water goes last and translucent, so anything wading shows through it. */
  drawWater(mesh: StaticMesh) {
    const gl = this.gl;
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
    gl.depthMask(false);
    gl.disable(gl.CULL_FACE);
    gl.uniform1f(this.u.uAlpha, 0.78);
    gl.bindVertexArray(mesh.vao);
    gl.drawArrays(gl.TRIANGLES, 0, mesh.count);
    gl.uniform1f(this.u.uAlpha, 1);
    gl.enable(gl.CULL_FACE);
    gl.depthMask(true);
    gl.disable(gl.BLEND);
  }

  dispose() {
    const gl = this.gl;
    gl.deleteProgram(this.prog);
    gl.deleteProgram(this.skyProg);
    gl.deleteVertexArray(this.emptyVao);
    gl.deleteBuffer(this.identityBuffer);
    // drop the backing drawing buffer rather than waiting for a GC that may
    // never come; a leaked context stops the next one from being created
    gl.getExtension('WEBGL_lose_context')?.loseContext();
  }
}
