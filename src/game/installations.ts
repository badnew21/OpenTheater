/** Airfields, ports and bases pulled out of the archive by tools/network.mjs. */
export type InstallationType = 'air' | 'port' | 'base';

export interface Installation {
  t: InstallationType;
  n: string;
  lon: number;
  lat: number;
  /** province it sits in */
  p: number;
  /** ports that are really just a coastal city */
  city?: number;
}

export class Installations {
  readonly all: Installation[];
  /** province id -> installations in it */
  private byProvince = new Map<number, Installation[]>();

  private constructor(all: Installation[]) {
    this.all = all;
    for (const i of all) {
      const list = this.byProvince.get(i.p) ?? [];
      list.push(i);
      this.byProvince.set(i.p, list);
    }
  }

  static async load(): Promise<Installations> {
    const data = await fetch('/data/installations.json', { cache: 'no-store' }).then((r) => r.json());
    return new Installations(data.installations as Installation[]);
  }

  in(province: number, type?: InstallationType): Installation[] {
    const list = this.byProvince.get(province) ?? [];
    return type ? list.filter((i) => i.t === type) : list;
  }

  has(province: number, type: InstallationType) { return this.in(province, type).length > 0; }

  /** Closest installation of a type to a point, within `maxDeg`. */
  nearest(lon: number, lat: number, type: InstallationType, maxDeg = 3): Installation | null {
    let best: Installation | null = null, bestD = maxDeg * maxDeg;
    for (const i of this.all) {
      if (i.t !== type) continue;
      const d = (i.lon - lon) ** 2 + (i.lat - lat) ** 2;
      if (d < bestD) { bestD = d; best = i; }
    }
    return best;
  }

  /** Provinces where a nation can base this kind of force. */
  basesOf(type: InstallationType, owner: (province: number) => boolean): Installation[] {
    return this.all.filter((i) => i.t === type && i.p >= 0 && owner(i.p));
  }

  get counts() {
    const c = { air: 0, port: 0, base: 0 };
    for (const i of this.all) c[i.t]++;
    return c;
  }
}
