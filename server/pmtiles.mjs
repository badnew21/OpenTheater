// Minimal PMTiles v3 reader for a local archive.
// Spec: https://github.com/protomaps/PMTiles/blob/main/spec/v3/spec.md
import fs from 'node:fs';
import zlib from 'node:zlib';

const COMPRESSION = { 1: 'none', 2: 'gzip', 3: 'brotli', 4: 'zstd' };

function decompress(buf, kind) {
  switch (COMPRESSION[kind]) {
    case 'none': return buf;
    case 'gzip': return zlib.gunzipSync(buf);
    case 'brotli': return zlib.brotliDecompressSync(buf);
    case 'zstd': return zlib.zstdDecompressSync(buf);
    default: throw new Error(`unsupported compression ${kind}`);
  }
}

/** Interleave z/x/y into the archive's Hilbert-curve tile id. */
export function zxyToTileId(z, x, y) {
  if (z < 0 || z > 26) throw new Error(`zoom ${z} out of range`);
  const n = 2 ** z;
  if (x < 0 || y < 0 || x >= n || y >= n) return -1;
  let acc = 0;
  for (let t = 0; t < z; t++) acc += 4 ** t;
  let tx = x, ty = y, d = 0;
  for (let s = n / 2; s > 0; s /= 2) {
    const rx = (tx & s) > 0 ? 1 : 0;
    const ry = (ty & s) > 0 ? 1 : 0;
    d += s * s * ((3 * rx) ^ ry);
    if (ry === 0) {
      if (rx === 1) { tx = s - 1 - tx; ty = s - 1 - ty; }
      const t = tx; tx = ty; ty = t;
    }
  }
  return acc + d;
}

class Reader {
  constructor(buf) { this.b = buf; this.p = 0; }
  varint() {
    let shift = 0, result = 0;
    for (;;) {
      const b = this.b[this.p++];
      result += (b & 0x7f) * 2 ** shift;   // stays exact past 32 bits
      if (b < 0x80) return result;
      shift += 7;
    }
  }
}

function decodeDirectory(buf) {
  const r = new Reader(buf);
  const n = r.varint();
  const entries = new Array(n);
  let last = 0;
  for (let i = 0; i < n; i++) { last += r.varint(); entries[i] = { tileId: last, offset: 0, length: 0, runLength: 0 }; }
  for (let i = 0; i < n; i++) entries[i].runLength = r.varint();
  for (let i = 0; i < n; i++) entries[i].length = r.varint();
  for (let i = 0; i < n; i++) {
    const v = r.varint();
    entries[i].offset = v === 0 && i > 0
      ? entries[i - 1].offset + entries[i - 1].length   // 0 means "directly after the previous"
      : v - 1;
  }
  return entries;
}

function findEntry(entries, tileId) {
  let lo = 0, hi = entries.length - 1, best = -1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (entries[mid].tileId <= tileId) { best = mid; lo = mid + 1; } else hi = mid - 1;
  }
  if (best < 0) return null;
  const e = entries[best];
  if (e.runLength === 0) return e;                       // leaf directory pointer
  return tileId < e.tileId + e.runLength ? e : null;
}

/** Bounded LRU keyed by number or string. */
class LRU {
  constructor(limit) { this.limit = limit; this.m = new Map(); }
  get(k) {
    const v = this.m.get(k);
    if (v === undefined) return undefined;
    this.m.delete(k); this.m.set(k, v);
    return v;
  }
  set(k, v) {
    if (this.m.has(k)) this.m.delete(k);
    this.m.set(k, v);
    if (this.m.size > this.limit) this.m.delete(this.m.keys().next().value);
  }
}

/** Same, but evicts on total byte weight rather than entry count. */
class ByteLRU {
  constructor(maxBytes) { this.max = maxBytes; this.bytes = 0; this.m = new Map(); }
  get(k) {
    const v = this.m.get(k);
    if (v === undefined) return undefined;
    this.m.delete(k); this.m.set(k, v);
    return v;
  }
  set(k, v) {
    const prev = this.m.get(k);
    if (prev) { this.bytes -= prev.length; this.m.delete(k); }
    this.m.set(k, v);
    this.bytes += v.length;
    while (this.bytes > this.max && this.m.size > 1) {
      const first = this.m.keys().next().value;
      this.bytes -= this.m.get(first).length;
      this.m.delete(first);
    }
  }
}

export class PMTiles {
  /**
   * @param {string} path archive on local disk
   * @param {{dirCache?:number, tileCacheBytes?:number}} [opts]
   */
  constructor(path, { dirCache = 8192, tileCacheBytes = 256 << 20 } = {}) {
    this.path = path;
    this.fd = fs.openSync(path, 'r');
    this.fhPromise = null;               // promise-based handle, opened once, lazily
    this.header = this._readHeader();
    this.metadata = JSON.parse(decompress(
      this._read(this.header.metadataOffset, this.header.metadataLength),
      this.header.internalCompression).toString('utf8'));
    this.root = decodeDirectory(decompress(
      this._read(this.header.rootOffset, this.header.rootLength), this.header.internalCompression));
    this._leaves = new LRU(dirCache);          // leaf offset -> decoded entries
    this._tiles = new ByteLRU(tileCacheBytes); // tile id -> raw (still gzipped) bytes
    this._inflight = new Map();               // tile id -> pending read
    this._leafInflight = new Map();           // leaf offset -> pending page load
    this.stats = { tiles: 0, tileHits: 0, leafReads: 0, leafHits: 0, misses: 0, bytes: 0 };
  }

  _read(offset, length) {
    const b = Buffer.allocUnsafe(length);
    fs.readSync(this.fd, b, 0, length, offset);
    return b;
  }

  _handle() {
    // memoise the promise itself: concurrent callers must not each open an fd
    if (!this.fhPromise) this.fhPromise = fs.promises.open(this.path, 'r');
    return this.fhPromise;
  }

  async _readAsync(offset, length) {
    const fh = await this._handle();
    const b = Buffer.allocUnsafe(length);
    await fh.read(b, 0, length, offset);
    return b;
  }

  _readHeader() {
    const b = this._read(0, 127);
    if (b.toString('utf8', 0, 7) !== 'PMTiles') throw new Error('not a PMTiles archive');
    if (b[7] !== 3) throw new Error(`unsupported PMTiles version ${b[7]}`);
    const u64 = (o) => Number(b.readBigUInt64LE(o));
    return {
      rootOffset: u64(8), rootLength: u64(16),
      metadataOffset: u64(24), metadataLength: u64(32),
      leafOffset: u64(40), leafLength: u64(48),
      dataOffset: u64(56), dataLength: u64(64),
      addressedTiles: u64(72), tileEntries: u64(80), tileContents: u64(88),
      clustered: !!b[96], internalCompression: b[97], tileCompression: b[98], tileType: b[99],
      minZoom: b[100], maxZoom: b[101],
      bounds: [b.readInt32LE(102) / 1e7, b.readInt32LE(106) / 1e7,
               b.readInt32LE(110) / 1e7, b.readInt32LE(114) / 1e7],
      center: [b.readInt32LE(119) / 1e7, b.readInt32LE(123) / 1e7], centerZoom: b[118],
    };
  }

  _leafSync(offset, length) {
    const hit = this._leaves.get(offset);
    if (hit) { this.stats.leafHits++; return hit; }
    this.stats.leafReads++;
    const entries = decodeDirectory(decompress(
      this._read(this.header.leafOffset + offset, length), this.header.internalCompression));
    this._leaves.set(offset, entries);
    return entries;
  }

  _leafAsync(offset, length) {
    const hit = this._leaves.get(offset);
    if (hit) { this.stats.leafHits++; return hit; }
    // A cold viewport asks for hundreds of tiles that share a handful of leaf
    // pages. Without this, every one of them reads and gunzips the same page.
    const pending = this._leafInflight.get(offset);
    if (pending) { this.stats.leafHits++; return pending; }
    this.stats.leafReads++;
    const job = this._readAsync(this.header.leafOffset + offset, length)
      .then((buf) => {
        const entries = decodeDirectory(decompress(buf, this.header.internalCompression));
        this._leaves.set(offset, entries);
        return entries;
      })
      .finally(() => this._leafInflight.delete(offset));
    this._leafInflight.set(offset, job);
    return job;
  }

  /** Walk the directory tree with whatever leaf pages are already cached. */
  _resolve(tileId, leafLoader) {
    let entries = this.root;
    for (let depth = 0; depth < 4; depth++) {
      const e = findEntry(entries, tileId);
      if (!e) return null;
      if (e.runLength !== 0) return e.length === 0 ? null : e;
      const leaf = leafLoader(e.offset, e.length);
      if (leaf && typeof leaf.then === 'function') return leaf.then((l) => this._resolveFrom(l, tileId, leafLoader));
      entries = leaf;
    }
    return null;
  }

  _resolveFrom(entries, tileId, leafLoader) {
    for (let depth = 0; depth < 4; depth++) {
      const e = findEntry(entries, tileId);
      if (!e) return null;
      if (e.runLength !== 0) return e.length === 0 ? null : e;
      const leaf = leafLoader(e.offset, e.length);
      if (leaf && typeof leaf.then === 'function') return leaf.then((l) => this._resolveFrom(l, tileId, leafLoader));
      entries = leaf;
    }
    return null;
  }

  /** Raw tile bytes in the archive's compression (gzip here), or null. Synchronous. */
  getTileRaw(z, x, y) {
    const { minZoom, maxZoom } = this.header;
    if (z < minZoom || z > maxZoom) return null;
    const tileId = zxyToTileId(z, x, y);
    if (tileId < 0) return null;
    const cached = this._tiles.get(tileId);
    if (cached !== undefined) { this.stats.tileHits++; return cached.length ? cached : null; }
    const e = this._resolve(tileId, (o, l) => this._leafSync(o, l));
    if (!e) { this.stats.misses++; this._tiles.set(tileId, EMPTY); return null; }
    const buf = this._read(this.header.dataOffset + e.offset, e.length);
    this.stats.tiles++; this.stats.bytes += buf.length;
    this._tiles.set(tileId, buf);
    return buf;
  }

  /** Async single tile: overlaps disk latency with other work. */
  async getTileRawAsync(z, x, y) {
    const { minZoom, maxZoom } = this.header;
    if (z < minZoom || z > maxZoom) return null;
    const tileId = zxyToTileId(z, x, y);
    if (tileId < 0) return null;
    const cached = this._tiles.get(tileId);
    if (cached !== undefined) { this.stats.tileHits++; return cached.length ? cached : null; }
    const pending = this._inflight.get(tileId);
    if (pending) return pending;                        // collapse duplicate requests
    const job = (async () => {
      const e = await this._resolve(tileId, (o, l) => this._leafAsync(o, l));
      if (!e) { this.stats.misses++; this._tiles.set(tileId, EMPTY); return null; }
      const buf = await this._readAsync(this.header.dataOffset + e.offset, e.length);
      this.stats.tiles++; this.stats.bytes += buf.length;
      this._tiles.set(tileId, buf);
      return buf;
    })().finally(() => this._inflight.delete(tileId));
    this._inflight.set(tileId, job);
    return job;
  }

  /**
   * Many tiles at once. Reads are issued concurrently, so the OS sees a deep
   * queue instead of one 100 µs round trip after another - this is what makes
   * a cold viewport arrive in one frame rather than one tile at a time.
   */
  getTilesRaw(coords) {
    return Promise.all(coords.map(([z, x, y]) => this.getTileRawAsync(z, x, y)));
  }

  getTile(z, x, y) {
    const raw = this.getTileRaw(z, x, y);
    return raw ? decompress(raw, this.header.tileCompression) : null;
  }

  get tileEncoding() { return COMPRESSION[this.header.tileCompression]; }

  get cacheInfo() {
    return { leafPages: this._leaves.m.size, tiles: this._tiles.m.size, tileBytes: this._tiles.bytes };
  }

  async close() {
    fs.closeSync(this.fd);
    if (this.fhPromise) await (await this.fhPromise).close();
  }
}

const EMPTY = Buffer.alloc(0);
