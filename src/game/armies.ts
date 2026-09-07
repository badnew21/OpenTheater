import type { Division } from './types';
import type { Scenario } from './scenario';

/**
 * Armies: the player's own grouping of formations under a commander.
 *
 * Distinct from the automatic corps/army hierarchy the map draws - that one is
 * geographic and exists so counters can aggregate. This one is deliberate: you
 * make an army, you put brigades in it, and you order it as a unit.
 */

export interface Army {
  id: number;
  owner: number;
  name: string;
  general: string;
  /** division ids under this command */
  divisions: number[];
}

/** Command limit: how many formations one army can hold. */
export const COMMAND_LIMIT = 24;

const SURNAMES = [
  'Brandt', 'Keller', 'Adler', 'Ritter', 'Falk', 'Hoffmann', 'Vogel', 'Stein',
  'Wolff', 'Kraus', 'Berger', 'Reiter', 'Sommer', 'Lange', 'Haas', 'Roth',
];
const RANKS = ['Gen.', 'Lt. Gen.', 'Maj. Gen.'];
const ORDINALS = ['1st', '2nd', '3rd', '4th', '5th', '6th', '7th', '8th', '9th', '10th'];

export class ArmyStore {
  armies: Army[] = [];
  private nextId = 1;

  constructor(private scn: Scenario) {}

  forOwner(owner: number) { return this.armies.filter((a) => a.owner === owner); }

  create(owner: number): Army {
    const mine = this.forOwner(owner);
    const seed = this.nextId * 7919;
    const army: Army = {
      id: this.nextId++,
      owner,
      name: `${ORDINALS[mine.length % ORDINALS.length]} Army`,
      general: `${RANKS[seed % RANKS.length]} ${SURNAMES[seed % SURNAMES.length]}`,
      divisions: [],
    };
    this.armies.push(army);
    return army;
  }

  disband(id: number) {
    const army = this.byId(id);
    if (army) for (const d of this.divisionsOf(army)) delete d.army;
    this.armies = this.armies.filter((a) => a.id !== id);
  }

  byId(id: number) { return this.armies.find((a) => a.id === id); }

  divisionsOf(army: Army): Division[] {
    return army.divisions
      .map((id) => this.scn.divisions.find((d) => d.id === id))
      .filter((d): d is Division => !!d);
  }

  /** Put formations under a command, taking them out of any other. */
  assign(army: Army, divisions: Division[]): { added: number; rejected: number } {
    let added = 0, rejected = 0;
    for (const d of divisions) {
      if (d.owner !== army.owner) { rejected++; continue; }
      if (army.divisions.includes(d.id)) continue;
      if (army.divisions.length >= COMMAND_LIMIT) { rejected++; continue; }
      if (d.army !== undefined) {
        const old = this.byId(d.army);
        if (old) old.divisions = old.divisions.filter((x) => x !== d.id);
      }
      army.divisions.push(d.id);
      d.army = army.id;
      added++;
    }
    return { added, rejected };
  }

  /** Drop formations that no longer exist, so counts stay honest. */
  prune() {
    const alive = new Set(this.scn.divisions.map((d) => d.id));
    for (const a of this.armies) a.divisions = a.divisions.filter((id) => alive.has(id));
  }
}
