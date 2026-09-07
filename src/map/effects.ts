/**
 * Combat effects: tracer fire, muzzle flashes and shell impacts.
 *
 * Everything is stored in geographic coordinates and projected at draw time,
 * so an explosion stays where it happened while the camera moves. Arrays are
 * compacted in place rather than spliced, and the whole system is skipped
 * above the zoom where you could not see it anyway.
 */

export interface Tracer {
  x0: number; y0: number; x1: number; y1: number;
  t: number; life: number; hot: boolean;
}
export interface Burst {
  x: number; y: number;
  t: number; life: number;
  /** metres */
  radius: number;
  heavy: boolean;
}
export interface Smoke {
  x: number; y: number; t: number; life: number; radius: number;
  driftX: number; driftY: number;
}

const MAX_TRACERS = 260;
const MAX_BURSTS = 90;
const MAX_SMOKE = 120;

export class Effects {
  tracers: Tracer[] = [];
  bursts: Burst[] = [];
  smoke: Smoke[] = [];

  get count() { return this.tracers.length + this.bursts.length + this.smoke.length; }

  fire(from: [number, number], to: [number, number], hot: boolean) {
    if (this.tracers.length >= MAX_TRACERS) return;
    this.tracers.push({
      x0: from[0], y0: from[1], x1: to[0], y1: to[1],
      t: 0, life: hot ? 0.28 : 0.16, hot,
    });
  }

  burst(at: [number, number], heavy: boolean) {
    if (this.bursts.length >= MAX_BURSTS) return;
    this.bursts.push({
      x: at[0], y: at[1], t: 0,
      life: heavy ? 0.75 : 0.32,
      radius: heavy ? 55 + Math.random() * 45 : 12 + Math.random() * 10,
      heavy,
    });
    if (heavy && this.smoke.length < MAX_SMOKE) {
      this.smoke.push({
        x: at[0], y: at[1], t: 0, life: 4.5 + Math.random() * 3,
        radius: 40 + Math.random() * 40,
        driftX: (Math.random() - 0.4) * 1.6e-5,
        driftY: (Math.random() - 0.3) * 1.1e-5,
      });
    }
  }

  update(dt: number) {
    let n = 0;
    for (const p of this.tracers) { p.t += dt; if (p.t < p.life) this.tracers[n++] = p; }
    this.tracers.length = n;
    n = 0;
    for (const b of this.bursts) { b.t += dt; if (b.t < b.life) this.bursts[n++] = b; }
    this.bursts.length = n;
    n = 0;
    for (const s of this.smoke) {
      s.t += dt;
      s.x += s.driftX * dt * 60;
      s.y += s.driftY * dt * 60;
      if (s.t < s.life) this.smoke[n++] = s;
    }
    this.smoke.length = n;
  }

  clear() { this.tracers.length = 0; this.bursts.length = 0; this.smoke.length = 0; }

  /**
   * @param project ground position -> screen pixels
   * @param mPerPx  metres per screen pixel, for sizing blasts on the ground
   */
  draw(
    ctx: CanvasRenderingContext2D,
    project: (c: [number, number]) => { x: number; y: number },
    mPerPx: number,
  ) {
    ctx.save();

    // smoke first: everything else happens through it
    for (const s of this.smoke) {
      const k = s.t / s.life;
      const p = project([s.x, s.y]);
      const r = Math.max(2, (s.radius * (0.6 + k * 1.9)) / mPerPx);
      const a = 0.28 * (1 - k) ** 1.4;
      if (a < 0.02) continue;
      const g = ctx.createRadialGradient(p.x, p.y, 0, p.x, p.y, r);
      g.addColorStop(0, `rgba(64,58,52,${a})`);
      g.addColorStop(1, 'rgba(64,58,52,0)');
      ctx.fillStyle = g;
      ctx.beginPath();
      ctx.arc(p.x, p.y, r, 0, Math.PI * 2);
      ctx.fill();
    }

    // tracers: a bright bolt travelling the firing line
    ctx.lineCap = 'round';
    for (const t of this.tracers) {
      const k = t.t / t.life;
      const a = project([t.x0, t.y0]);
      const b = project([t.x1, t.y1]);
      const hx = a.x + (b.x - a.x) * k, hy = a.y + (b.y - a.y) * k;
      const tail = t.hot ? 0.22 : 0.14;
      const sx = a.x + (b.x - a.x) * Math.max(0, k - tail);
      const sy = a.y + (b.y - a.y) * Math.max(0, k - tail);
      ctx.strokeStyle = t.hot ? `rgba(255,214,140,${0.95 * (1 - k)})` : `rgba(255,236,190,${0.75 * (1 - k)})`;
      ctx.lineWidth = t.hot ? 1.8 : 1.1;
      ctx.beginPath();
      ctx.moveTo(sx, sy);
      ctx.lineTo(hx, hy);
      ctx.stroke();

      if (k < 0.16) {                       // muzzle flash at the shooter
        ctx.fillStyle = `rgba(255,226,150,${0.9 - k * 5})`;
        ctx.beginPath();
        ctx.arc(a.x, a.y, t.hot ? 3.2 : 2.2, 0, Math.PI * 2);
        ctx.fill();
      }
    }

    // impacts
    for (const b of this.bursts) {
      const k = b.t / b.life;
      const p = project([b.x, b.y]);
      const r = Math.max(1.5, (b.radius * (0.35 + k * 1.5)) / mPerPx);
      if (b.heavy) {
        const g = ctx.createRadialGradient(p.x, p.y, 0, p.x, p.y, r);
        g.addColorStop(0, `rgba(255,240,200,${0.95 * (1 - k)})`);
        g.addColorStop(0.35, `rgba(255,150,60,${0.8 * (1 - k)})`);
        g.addColorStop(1, 'rgba(255,90,30,0)');
        ctx.fillStyle = g;
        ctx.beginPath();
        ctx.arc(p.x, p.y, r, 0, Math.PI * 2);
        ctx.fill();

        ctx.strokeStyle = `rgba(255,190,110,${0.5 * (1 - k)})`;
        ctx.lineWidth = 1.4;
        ctx.beginPath();
        ctx.arc(p.x, p.y, r * 1.25, 0, Math.PI * 2);
        ctx.stroke();
      } else {
        ctx.fillStyle = `rgba(255,205,120,${0.85 * (1 - k)})`;
        ctx.beginPath();
        ctx.arc(p.x, p.y, Math.max(1, r * 0.5), 0, Math.PI * 2);
        ctx.fill();
      }
    }
    ctx.restore();
  }
}
