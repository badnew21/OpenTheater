import type { Scenario } from './scenario';
import type { Sim } from './sim';
import type { ArmyStore } from './armies';
import type { Production } from './production';
import type { Division } from './types';

/**
 * Saving and loading.
 *
 * Only state that cannot be derived is stored: who holds what, where every
 * formation is and what shape it is in, research, industry and diplomacy. The
 * map, the province graph, the road network and the order of battle are all
 * rebuilt from the generated data on load.
 */

const KEY = 'theatre.save.v1';
export const SAVE_VERSION = 1;

interface SavedNation {
  id: number;
  techs: string[];
  researching: { id: string; progress: number } | null;
  factories: number;
  manpower: number;
}

interface SavedGame {
  version: number;
  saved: string;
  date: number;
  playerId: number;
  owner: number[];
  controller: number[];
  divisions: Division[];
  nations: SavedNation[];
  wars: string[];
  peaceOffers: [string, number][];
  armies: { id: number; owner: number; name: string; general: string; divisions: number[] }[];
  industry: [number, { stockpile: number; queue: unknown[]; deploy: number }][];
}

export function saveGame(
  scn: Scenario, sim: Sim, armies: ArmyStore, production: Production, playerId: number,
): { ok: boolean; bytes: number; error?: string } {
  const data: SavedGame = {
    version: SAVE_VERSION,
    saved: new Date().toISOString(),
    date: sim.date.getTime(),
    playerId,
    owner: Array.from(scn.owner),
    controller: Array.from(scn.controller),
    divisions: scn.divisions,
    nations: [...scn.nations.values()].map((n) => ({
      id: n.id,
      techs: [...n.techs],
      researching: n.researching,
      factories: n.factories,
      manpower: n.manpower,
    })),
    wars: [...scn.wars],
    peaceOffers: [...scn.peaceOffers],
    armies: armies.armies,
    industry: [...production.byNation],
  };

  try {
    const json = JSON.stringify(data);
    localStorage.setItem(KEY, json);
    return { ok: true, bytes: json.length };
  } catch (err) {
    // the usual cause is the 5 MB localStorage quota
    return { ok: false, bytes: 0, error: err instanceof Error ? err.message : String(err) };
  }
}

export function hasSave(): boolean {
  try { return !!localStorage.getItem(KEY); } catch { return false; }
}

export function savedAt(): string | null {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return null;
    return (JSON.parse(raw) as SavedGame).saved;
  } catch { return null; }
}

export function loadGame(
  scn: Scenario, sim: Sim, armies: ArmyStore, production: Production,
): { ok: boolean; playerId?: number; error?: string } {
  let data: SavedGame;
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return { ok: false, error: 'no saved game' };
    data = JSON.parse(raw) as SavedGame;
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
  if (data.version !== SAVE_VERSION) return { ok: false, error: 'saved game is from an older build' };
  if (data.owner.length !== scn.owner.length) {
    return { ok: false, error: 'the world has been regenerated since that save' };
  }

  scn.owner.set(data.owner);
  scn.controller.set(data.controller);

  scn.divisions.length = 0;
  scn.divisions.push(...data.divisions);
  sim.byId.clear();
  for (const d of scn.divisions) sim.byId.set(d.id, d);
  sim.battles.clear();
  sim.date = new Date(data.date);
  sim.speed = 0;

  for (const saved of data.nations) {
    const n = scn.nations.get(saved.id);
    if (!n) continue;
    n.techs = new Set(saved.techs);
    n.researching = saved.researching;
    n.factories = saved.factories;
    n.manpower = saved.manpower;
  }

  scn.wars.clear();
  for (const w of data.wars) scn.wars.add(w);
  scn.peaceOffers.clear();
  for (const [k, v] of data.peaceOffers) scn.peaceOffers.set(k, v);

  armies.armies = data.armies;
  production.byNation.clear();
  for (const [id, state] of data.industry) production.byNation.set(id, state as never);

  return { ok: true, playerId: data.playerId };
}
