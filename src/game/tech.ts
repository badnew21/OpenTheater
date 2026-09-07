/** A present-day research tree: five branches, four tiers each. */
export interface TechNode {
  id: string;
  name: string;
  branch: 'land' | 'fires' | 'air' | 'logistics' | 'command';
  tier: number;
  days: number;
  requires: string[];
  effect: string;
  modifier: { stat: string; value: number };
}

const N = (
  id: string, name: string, branch: TechNode['branch'], tier: number, days: number,
  requires: string[], effect: string, stat: string, value: number,
): TechNode => ({ id, name, branch, tier, days, requires, effect, modifier: { stat, value } });

export const TECHS: TechNode[] = [
  N('lnd1', 'Modular Body Armour', 'land', 0, 45, [], '+10% defence', 'defence', 0.10),
  N('lnd2', 'Thermal Optics', 'land', 1, 80, ['lnd1'], '+10% soft attack', 'softAttack', 0.10),
  N('lnd3', 'Active Protection', 'land', 2, 130, ['lnd2'], '+14% armour', 'armour', 0.14),
  N('lnd4', 'Networked Squads', 'land', 3, 180, ['lnd3'], '+15% breakthrough', 'breakthrough', 0.15),

  N('fir1', 'Precision Artillery', 'fires', 0, 60, [], '+12% soft attack', 'softAttack', 0.12),
  N('fir2', 'Counter-battery Radar', 'fires', 1, 100, ['fir1'], '+10% defence', 'defence', 0.10),
  N('fir3', 'Rocket Artillery', 'fires', 2, 150, ['fir2'], '+15% hard attack', 'hardAttack', 0.15),
  N('fir4', 'Hypersonic Fires', 'fires', 3, 220, ['fir3'], '+18% breakthrough', 'breakthrough', 0.18),

  N('air1', 'Armed Drones', 'air', 0, 70, [], '+12% hard attack', 'hardAttack', 0.12),
  N('air2', 'Integrated Air Defence', 'air', 1, 115, ['air1'], '+12% defence', 'defence', 0.12),
  N('air3', 'Electronic Warfare', 'air', 2, 165, ['air2'], '+10% organisation', 'organisation', 0.10),
  N('air4', 'Drone Swarms', 'air', 3, 230, ['air3'], '+15% soft attack', 'softAttack', 0.15),

  N('log1', 'Containerised Supply', 'logistics', 0, 55, [], '+15% supply', 'supply', 0.15),
  N('log2', 'Rail & Sealift', 'logistics', 1, 95, ['log1'], '+12% movement speed', 'speed', 0.12),
  N('log3', 'Dispersed Production', 'logistics', 2, 145, ['log2'], '+15% production', 'production', 0.15),
  N('log4', 'War Economy', 'logistics', 3, 210, ['log3'], '+20% production', 'production', 0.20),

  N('cmd1', 'Satellite ISR', 'command', 0, 75, [], '+10% breakthrough', 'breakthrough', 0.10),
  N('cmd2', 'Cyber Operations', 'command', 1, 120, ['cmd1'], '+10% org recovery', 'orgRecovery', 0.10),
  N('cmd3', 'AI Targeting', 'command', 2, 175, ['cmd2'], '+12% soft attack', 'softAttack', 0.12),
  N('cmd4', 'Joint All-Domain C2', 'command', 3, 250, ['cmd3'], '+15% org recovery', 'orgRecovery', 0.15),
];

export const BRANCHES = ['land', 'fires', 'air', 'logistics', 'command'] as const;

export const techById = new Map(TECHS.map((t) => [t.id, t]));

export function available(known: Set<string>, id: string): boolean {
  const t = techById.get(id);
  return !!t && !known.has(id) && t.requires.every((r) => known.has(r));
}

/** Combined multiplier a nation's researched techs give to one stat. */
export function bonus(known: Set<string>, stat: string): number {
  let m = 1;
  for (const id of known) {
    const t = techById.get(id);
    if (t?.modifier.stat === stat) m *= 1 + t.modifier.value;
  }
  return m;
}
