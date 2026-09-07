import { hexToRgb, type Vec3 } from './glx';
import type { Terrain } from '../game/types';

export type PropKind = 'tree' | 'conifer' | 'palm' | 'rock' | 'bush' | 'reed' | 'building' | 'cactus';

export interface Biome {
  /** the two ground tones the terrain is mottled between */
  ground: Vec3;
  ground2: Vec3;
  /** exposed on steep faces */
  rock: Vec3;
  /** caps high ground, if the terrain has any */
  cap: Vec3 | null;
  capHeight: number;
  foliage: Vec3;
  foliage2: Vec3;
  trunk: Vec3;
  sky: Vec3;
  horizon: Vec3;
  water: Vec3;
  /** metres of relief across the arena, before terracing */
  relief: number;
  /** carve the noise into ridges and aretes rather than rolling lumps */
  ridged: boolean;
  /** height of one terrace step; 0 keeps the ground smooth */
  step: number;
  /** props per hectare, and the mix they are drawn from */
  density: number;
  mix: PropKind[];
}

const rgb = hexToRgb;

/**
 * How each terrain type reads on the ground.
 *
 * The colours are flat and a little chalky on purpose: the renderer shades
 * every face by a three-step ramp rather than a smooth falloff, so tones that
 * are already close together turn to mush once the ramp banding lands on them.
 */
export const BIOMES: Record<Terrain, Biome> = {
  plains: {
    ground: rgb('#7fa04f'), ground2: rgb('#6b8c44'), rock: rgb('#8a8272'), cap: null, capHeight: 0,
    foliage: rgb('#4f7a3a'), foliage2: rgb('#5f8c42'), trunk: rgb('#6b5334'),
    sky: rgb('#7fb6e0'), horizon: rgb('#cfe3ee'), water: rgb('#3f7fa8'),
    relief: 9, ridged: false, step: 0, density: 5, mix: ['tree', 'bush', 'bush', 'rock'],
  },
  farmland: {
    ground: rgb('#93a352'), ground2: rgb('#7f8f45'), rock: rgb('#8a8272'), cap: null, capHeight: 0,
    foliage: rgb('#5c8a3c'), foliage2: rgb('#6d9a45'), trunk: rgb('#6b5334'),
    sky: rgb('#83b8de'), horizon: rgb('#d6e6ee'), water: rgb('#3f7fa8'),
    relief: 6, ridged: false, step: 0, density: 3, mix: ['tree', 'bush', 'building'],
  },
  forest: {
    ground: rgb('#5c7a3e'), ground2: rgb('#4c6835'), rock: rgb('#726c5e'), cap: null, capHeight: 0,
    foliage: rgb('#3d6630'), foliage2: rgb('#4a7a38'), trunk: rgb('#5c4529'),
    sky: rgb('#7aabd0'), horizon: rgb('#c2dae2'), water: rgb('#38708f'),
    relief: 14, ridged: false, step: 0, density: 26, mix: ['tree', 'tree', 'conifer', 'bush', 'rock'],
  },
  taiga: {
    ground: rgb('#5a6f52'), ground2: rgb('#4b5f47'), rock: rgb('#6f6f68'), cap: rgb('#e2ecf0'), capHeight: 0.72,
    foliage: rgb('#33553f'), foliage2: rgb('#3f6349'), trunk: rgb('#4f3d2a'),
    sky: rgb('#8fb2c8'), horizon: rgb('#d4e2e8'), water: rgb('#3a6b84'),
    relief: 20, ridged: false, step: 0, density: 22, mix: ['conifer', 'conifer', 'rock', 'bush'],
  },
  hills: {
    ground: rgb('#7d9350'), ground2: rgb('#6a7f45'), rock: rgb('#877f6e'), cap: null, capHeight: 0,
    foliage: rgb('#4a7038'), foliage2: rgb('#587f40'), trunk: rgb('#634c30'),
    sky: rgb('#7fb2da'), horizon: rgb('#cde0ea'), water: rgb('#3f7fa8'),
    relief: 28, ridged: false, step: 2.2, density: 8, mix: ['tree', 'bush', 'rock', 'rock'],
  },
  mountain: {
    ground: rgb('#8a8375'), ground2: rgb('#756f63'), rock: rgb('#9a9287'), cap: rgb('#eef4f7'), capHeight: 0.6,
    foliage: rgb('#3f5d3a'), foliage2: rgb('#4a6b42'), trunk: rgb('#4f3d2a'),
    sky: rgb('#6fa6d6'), horizon: rgb('#dceaf2'), water: rgb('#3a6f92'),
    relief: 44, ridged: true, step: 3, density: 9, mix: ['rock', 'rock', 'conifer', 'rock'],
  },
  desert: {
    ground: rgb('#dcc384'), ground2: rgb('#c9ad6f'), rock: rgb('#b09268'), cap: null, capHeight: 0,
    foliage: rgb('#8a9a54'), foliage2: rgb('#9aa860'), trunk: rgb('#8a6b45'),
    sky: rgb('#8fc0e2'), horizon: rgb('#f0dfbe'), water: rgb('#4f8fae'),
    relief: 16, ridged: false, step: 0, density: 3, mix: ['cactus', 'rock', 'rock', 'bush'],
  },
  jungle: {
    ground: rgb('#4f7538'), ground2: rgb('#426330'), rock: rgb('#6b6a55'), cap: null, capHeight: 0,
    foliage: rgb('#2f6630'), foliage2: rgb('#3d7a38'), trunk: rgb('#584428'),
    sky: rgb('#8ec2d4'), horizon: rgb('#c8e0d8'), water: rgb('#3f7f7a'),
    relief: 22, ridged: false, step: 0, density: 34, mix: ['palm', 'tree', 'tree', 'bush', 'bush'],
  },
  marsh: {
    ground: rgb('#66774a'), ground2: rgb('#556340'), rock: rgb('#6b6a5c'), cap: null, capHeight: 0,
    foliage: rgb('#5f7a3f'), foliage2: rgb('#6d8a48'), trunk: rgb('#54452c'),
    sky: rgb('#93b4c4'), horizon: rgb('#cdd9d6'), water: rgb('#4a6b5c'),
    relief: 5, ridged: false, step: 0, density: 16, mix: ['reed', 'reed', 'bush', 'tree'],
  },
  tundra: {
    ground: rgb('#8f9276'), ground2: rgb('#7c8067'), rock: rgb('#8a8880'), cap: rgb('#e6eef2'), capHeight: 0.68,
    foliage: rgb('#5f6f4a'), foliage2: rgb('#6d7d55'), trunk: rgb('#5c4b34'),
    sky: rgb('#9ab8cc'), horizon: rgb('#dde8ec'), water: rgb('#4a7590'),
    relief: 18, ridged: false, step: 0, density: 5, mix: ['rock', 'bush', 'conifer'],
  },
  arctic: {
    ground: rgb('#e4edf2'), ground2: rgb('#cfdde6'), rock: rgb('#9fadb6'), cap: rgb('#f6fbff'), capHeight: 0.35,
    foliage: rgb('#7f9aa8'), foliage2: rgb('#8fa8b4'), trunk: rgb('#6b7784'),
    sky: rgb('#a8c8dc'), horizon: rgb('#eef6fa'), water: rgb('#5f8fa8'),
    relief: 14, ridged: false, step: 1.6, density: 3, mix: ['rock', 'rock'],
  },
  urban: {
    ground: rgb('#7d7d72'), ground2: rgb('#6b6b62'), rock: rgb('#8a8a80'), cap: null, capHeight: 0,
    foliage: rgb('#4f7a3f'), foliage2: rgb('#5c8a48'), trunk: rgb('#63503a'),
    sky: rgb('#8fb0c8'), horizon: rgb('#d2dde4'), water: rgb('#44718c'),
    relief: 7, ridged: false, step: 0, density: 11, mix: ['building', 'building', 'tree', 'rock'],
  },
} as unknown as Record<Terrain, Biome>;

export const biomeFor = (t: Terrain): Biome => BIOMES[t] ?? BIOMES.plains;
