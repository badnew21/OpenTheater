import type { Division } from './types';
import type { World } from './world';

/** Lines the player draws on the map to say what the army should do. */
export type PlanKind = 'front' | 'invasion' | 'fallback';

export interface Plan {
  id: number;
  kind: PlanKind;
  owner: number;
  points: [number, number][];
  /** division ids assigned to this plan */
  assigned: number[];
  label: string;
}

export const PLAN_STYLE: Record<PlanKind, { color: string; label: string; key: string }> = {
  front:    { color: '#cbb392', label: 'Front line',   key: 'F' },
  invasion: { color: '#d1614a', label: 'Invasion',     key: 'I' },
  fallback: { color: '#6f93c4', label: 'Fallback line', key: 'B' },
};

export class PlanStore {
  plans: Plan[] = [];
  private nextId = 1;
  /** the plan currently being drawn, if any */
  draft: Plan | null = null;

  start(kind: PlanKind, owner: number) {
    this.draft = {
      id: this.nextId++, kind, owner, points: [], assigned: [],
      label: `${PLAN_STYLE[kind].label} ${this.plans.filter((p) => p.kind === kind).length + 1}`,
    };
  }

  addPoint(lon: number, lat: number) {
    this.draft?.points.push([lon, lat]);
  }

  finish(): Plan | null {
    const d = this.draft;
    this.draft = null;
    if (!d || d.points.length < 2) return null;
    this.plans.push(d);
    return d;
  }

  cancel() { this.draft = null; }

  remove(id: number) { this.plans = this.plans.filter((p) => p.id !== id); }

  forOwner(owner: number) { return this.plans.filter((p) => p.owner === owner); }

  /** Points evenly spaced along a plan, one per unit that has to hold it. */
  static stations(plan: Plan, count: number): [number, number][] {
    if (count <= 0) return [];
    const pts = plan.points;
    const segLen: number[] = [];
    let total = 0;
    for (let i = 1; i < pts.length; i++) {
      const d = Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]);
      segLen.push(d);
      total += d;
    }
    if (total === 0) return pts.slice(0, 1);
    const out: [number, number][] = [];
    for (let k = 0; k < count; k++) {
      let want = total * ((k + 0.5) / count);
      let i = 0;
      while (i < segLen.length && want > segLen[i]) { want -= segLen[i]; i++; }
      const a = pts[Math.min(i, pts.length - 1)], b = pts[Math.min(i + 1, pts.length - 1)];
      const t = segLen[i] ? want / segLen[i] : 0;
      out.push([a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t]);
    }
    return out;
  }

  /** Nearest province to each station, so units have somewhere to march to. */
  static targets(plan: Plan, world: World, count: number): number[] {
    return PlanStore.stations(plan, count).map(([lon, lat]) => {
      let best = 0, bestD = Infinity;
      for (const p of world.provinces) {
        const d = (p.lon - lon) ** 2 + (p.lat - lat) ** 2;
        if (d < bestD) { bestD = d; best = p.id; }
      }
      return best;
    });
  }

  assign(plan: Plan, divisions: Division[]) {
    plan.assigned = divisions.map((d) => d.id);
  }
}
