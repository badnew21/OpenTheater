import type { Division } from './types';
import type { Scenario } from './scenario';

/**
 * The chain of command.
 *
 * Brigades are grouped into corps, corps into armies, armies into an army
 * group per nation. Membership is built once and kept stable, so zooming
 * changes only which level you are looking at - nothing re-shuffles under the
 * cursor. Positions are recomputed from the members each frame.
 */

export interface Node {
  id: string;
  level: number;              // 0 army group, 1 army, 2 corps, 3 brigade
  owner: number;
  color: string;
  label: string;
  divisions: Division[];
  children: Node[];
  lon: number;
  lat: number;
}

const ORDINAL = ['I', 'II', 'III', 'IV', 'V', 'VI', 'VII', 'VIII', 'IX', 'X', 'XI', 'XII'];

/** Deterministic k-means over positions; small n, so a few passes is plenty. */
function cluster<T>(items: T[], k: number, pos: (t: T) => [number, number]): T[][] {
  if (items.length <= k) return items.map((i) => [i]);
  const sorted = [...items].sort((a, b) => {
    const [ax, ay] = pos(a), [bx, by] = pos(b);
    return ax + ay - (bx + by);
  });
  const step = sorted.length / k;
  let centres = Array.from({ length: k }, (_, i) => pos(sorted[Math.floor(i * step)]));
  let groups: T[][] = [];
  for (let iter = 0; iter < 5; iter++) {
    groups = Array.from({ length: k }, () => [] as T[]);
    for (const it of items) {
      const [x, y] = pos(it);
      let best = 0, bestD = Infinity;
      for (let c = 0; c < k; c++) {
        const d = (x - centres[c][0]) ** 2 + (y - centres[c][1]) ** 2;
        if (d < bestD) { bestD = d; best = c; }
      }
      groups[best].push(it);
    }
    centres = groups.map((g, i) => {
      if (!g.length) return centres[i];
      let x = 0, y = 0;
      for (const it of g) { const p = pos(it); x += p[0]; y += p[1]; }
      return [x / g.length, y / g.length] as [number, number];
    });
  }
  return groups.filter((g) => g.length);
}

/** Build the command tree for every nation that has troops. */
export function buildHierarchy(scn: Scenario, home: (d: Division) => [number, number]): Node[] {
  const byOwner = new Map<number, Division[]>();
  for (const d of scn.divisions) {
    const list = byOwner.get(d.owner) ?? [];
    list.push(d);
    byOwner.set(d.owner, list);
  }

  const roots: Node[] = [];
  for (const [owner, divisions] of byOwner) {
    const nation = scn.nations.get(owner)!;
    const make = (level: number, id: string, label: string, ds: Division[], children: Node[]): Node =>
      ({ id, level, owner, color: nation.color, label, divisions: ds, children, lon: 0, lat: 0 });

    const brigades = divisions.map((d) =>
      make(3, `b${d.id}`, d.name, [d], []));

    const corps = cluster(brigades, Math.max(1, Math.ceil(brigades.length / 3)), (n) => home(n.divisions[0]))
      .map((group, i) => make(2, `c${owner}:${i}`, `${ORDINAL[i % ORDINAL.length]} Corps`,
        group.flatMap((g) => g.divisions), group));

    const armies = cluster(corps, Math.max(1, Math.ceil(corps.length / 3)), (n) => home(n.divisions[0]))
      .map((group, i) => make(1, `a${owner}:${i}`, `${i + 1}${['st', 'nd', 'rd'][i] ?? 'th'} Army`,
        group.flatMap((g) => g.divisions), group));

    roots.push(make(0, `g${owner}`, `${nation.name} Forces`, divisions, armies));
  }
  return roots;
}

/** Refresh every node's position from where its brigades currently are. */
export function refreshPositions(node: Node, pos: (d: Division) => [number, number]): void {
  if (node.level === 3) {
    const [lon, lat] = pos(node.divisions[0]);
    node.lon = lon; node.lat = lat;
    return;
  }
  let lon = 0, lat = 0;
  for (const c of node.children) { refreshPositions(c, pos); lon += c.lon; lat += c.lat; }
  node.lon = lon / Math.max(1, node.children.length);
  node.lat = lat / Math.max(1, node.children.length);
}

/** All nodes at a given level, depth-first. */
export function nodesAtLevel(roots: Node[], level: number, out: Node[] = []): Node[] {
  for (const n of roots) {
    if (n.level === level) out.push(n);
    else if (n.level < level) nodesAtLevel(n.children, level, out);
  }
  return out;
}
