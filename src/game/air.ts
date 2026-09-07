import type { Installation, Installations } from './installations';
import type { Division } from './types';
import { TEMPLATES } from './scenario';

/**
 * Air operations.
 *
 * An air wing is not a manoeuvre unit: it lives at an airfield and reaches out
 * from it. Everything it does is a sortie that starts and ends at its base -
 * a strike out to a target and back, or a ferry flight to another field, which
 * is the only way its base ever changes.
 */

export type MissionKind = 'strike' | 'ferry';

export interface Mission {
  division: number;
  kind: MissionKind;
  /** where the aircraft are flying from */
  from: [number, number];
  /** the target, or the destination field for a ferry */
  to: [number, number];
  /** province being struck, if this is a strike */
  target: number | null;
  /** the field a ferry ends at */
  field: Installation | null;
  /** 0..1 along the whole sortie, out and back for a strike */
  progress: number;
  /** total sortie distance in km */
  km: number;
  /** set once the strike has been delivered */
  struck: boolean;
}

/** Combat radius in km: how far from its field a wing can reach and return. */
export function combatRadius(d: Division): number {
  // the template's speed stands in for endurance; a wing flies out and back
  return TEMPLATES[d.template].speed * 1.6;
}

const km = (a: [number, number], b: [number, number]) => {
  const lat = ((a[1] + b[1]) / 2) * (Math.PI / 180);
  return Math.hypot((b[0] - a[0]) * 111.32 * Math.cos(lat), (b[1] - a[1]) * 110.54);
};

export class AirOperations {
  readonly missions = new Map<number, Mission>();
  /** division id -> the field it operates from */
  readonly bases = new Map<number, Installation>();

  constructor(private installations: Installations) {}

  /** Station a wing at the field nearest to where it sits. */
  station(d: Division) {
    const field = this.installations.nearest(d.pos[0], d.pos[1], 'air', 4);
    if (field) this.bases.set(d.id, field);
    return field;
  }

  baseOf(d: Division): Installation | null {
    return this.bases.get(d.id) ?? this.station(d);
  }

  /** Can this wing reach that point and get home again? */
  inRange(d: Division, at: [number, number]): boolean {
    const base = this.baseOf(d);
    if (!base) return false;
    return km([base.lon, base.lat], at) <= combatRadius(d);
  }

  /**
   * Order a sortie. A *friendly* field inside the radius is a ferry; anything
   * else within reach is a strike. Out of range, nothing happens.
   *
   * The friendly test matters: enemy provinces often contain airfields, and
   * without it an attack order quietly turned into a redeployment onto the
   * target.
   */
  order(
    d: Division,
    at: [number, number],
    province: number | null,
    friendlyField: (field: Installation) => boolean,
  ): Mission | null {
    const base = this.baseOf(d);
    if (!base) return null;
    const from: [number, number] = [base.lon, base.lat];
    const distance = km(from, at);
    if (distance > combatRadius(d)) return null;

    const near = this.installations.nearest(at[0], at[1], 'air', 0.3);
    const field = near && near !== base && friendlyField(near) ? near : null;
    const kind: MissionKind = field ? 'ferry' : 'strike';
    const mission: Mission = {
      division: d.id,
      kind,
      from,
      to: kind === 'ferry' ? [field!.lon, field!.lat] as [number, number] : at,
      target: kind === 'strike' ? province : null,
      field: kind === 'ferry' ? field : null,
      progress: 0,
      km: kind === 'ferry' ? distance : distance * 2,
      struck: false,
    };
    this.missions.set(d.id, mission);
    return mission;
  }

  /** Where a wing currently is: at its field, or somewhere along its sortie. */
  position(d: Division): [number, number] {
    const mission = this.missions.get(d.id);
    const base = this.baseOf(d);
    if (!mission) return base ? [base.lon, base.lat] : d.pos;
    if (mission.kind === 'ferry') {
      const t = mission.progress;
      return [
        mission.from[0] + (mission.to[0] - mission.from[0]) * t,
        mission.from[1] + (mission.to[1] - mission.from[1]) * t,
      ];
    }
    // out and back: the first half flies to the target, the second returns
    const t = mission.progress < 0.5 ? mission.progress * 2 : (1 - mission.progress) * 2;
    return [
      mission.from[0] + (mission.to[0] - mission.from[0]) * t,
      mission.from[1] + (mission.to[1] - mission.from[1]) * t,
    ];
  }

  /**
   * Advance every sortie. Returns the strikes that landed this step so the
   * simulation can apply their damage.
   */
  step(hours: number, wings: Division[]): Mission[] {
    const delivered: Mission[] = [];
    for (const d of wings) {
      const mission = this.missions.get(d.id);
      if (!mission) continue;
      const speed = TEMPLATES[d.template].speed;      // km/h
      mission.progress += (speed * hours) / Math.max(1, mission.km);

      if (!mission.struck && mission.kind === 'strike' && mission.progress >= 0.5) {
        mission.struck = true;
        delivered.push(mission);
      }
      if (mission.progress >= 1) {
        if (mission.kind === 'ferry' && mission.field) {
          this.bases.set(d.id, mission.field);
          d.pos = [mission.field.lon, mission.field.lat];
        }
        this.missions.delete(d.id);
      }
    }
    return delivered;
  }
}
