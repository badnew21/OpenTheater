import type { IncomingMessage, ServerResponse } from 'node:http';

export declare const WORLD_FILE: string;

export interface World {
  pm: {
    header: Record<string, number | boolean | number[]>;
    metadata: Record<string, unknown>;
    stats: Record<string, number>;
    getTileRaw(z: number, x: number, y: number): Buffer | null;
    getTileRawAsync(z: number, x: number, y: number): Promise<Buffer | null>;
    getTilesRaw(coords: [number, number, number][]): Promise<(Buffer | null)[]>;
    cacheInfo: { leafPages: number; tiles: number; tileBytes: number };
    getTile(z: number, x: number, y: number): Buffer | null;
    tileEncoding: string;
  };
  handle(req: IncomingMessage, res: ServerResponse): Promise<boolean>;
  tilejson(origin: string): Record<string, unknown>;
}

export declare function createWorld(file?: string): World;
