// Sparse chunked voxel world. See SPEC §3/§4.
import { BLOCKS, BLOCK_BY_KEY } from '../data/blocks.js';
import { Chunk, CS, lidx } from './Chunk.js';

export const MIN_X = -64, MAX_X = 63;
export const MIN_Y = -32, MAX_Y = 95;
export const MIN_Z = -64, MAX_Z = 63;

const WATER = BLOCK_BY_KEY.water.id;

// chunk coords: cx,cz in [-4,3], cy in [-2,5]  -> 8*8*8 = 512 keys
export const chunkKey = (cx, cy, cz) => ((cy + 2) * 8 + (cz + 4)) * 8 + (cx + 4);
export const keyToChunk = (k) => ({ cx: (k & 7) - 4, cz: ((k >> 3) & 7) - 4, cy: (k >> 6) - 2 });

const posKey = (x, y, z) => ((y + 32) * 128 + (z + 64)) * 128 + (x + 64);

const SOLID = new Uint8Array(256);
const BOX_H = new Float32Array(256).fill(1);
const EMIT = new Uint8Array(256);
for (const b of BLOCKS) {
  if (!b) continue;
  SOLID[b.id] = b.solid ? 1 : 0;
  if (b.shape === 'farmland') BOX_H[b.id] = 15 / 16;
  if (b.shape === 'bed') BOX_H[b.id] = 9 / 16;
  EMIT[b.id] = b.light >= 6 ? 1 : 0; // real point-light emitters (torch, glowstone, magma, lit furnace)
}

export class World {
  constructor() {
    this.chunkArr = new Array(512).fill(null);
    this.chunks = new Map(); // key -> Chunk (only existing chunks)
    this.dirty = new Set(); // chunk keys the renderer should (re)mesh; renderer deletes entries
    this.emitters = new Map(); // posKey -> {x,y,z,id} for light-emitting blocks (used by Renderer)
    this.listeners = new Set();
    this.resetListeners = new Set();
    this.version = 0; // bumps on every change
    // Initially only the One Block exists (SPEC §3).
    this.setBlock(0, 0, 0, BLOCK_BY_KEY.grass.id);
  }

  static inBounds(x, y, z) {
    return x >= MIN_X && x <= MAX_X && y >= MIN_Y && y <= MAX_Y && z >= MIN_Z && z <= MAX_Z;
  }

  getBlock(x, y, z) {
    x = Math.floor(x); y = Math.floor(y); z = Math.floor(z);
    if (x < MIN_X || x > MAX_X || y < MIN_Y || y > MAX_Y || z < MIN_Z || z > MAX_Z) return 0;
    const c = this.chunkArr[chunkKey(x >> 4, y >> 4, z >> 4)];
    return c ? c.data[lidx(x & 15, y & 15, z & 15)] : 0;
  }

  setBlock(x, y, z, id) {
    x = Math.floor(x); y = Math.floor(y); z = Math.floor(z);
    if (x < MIN_X || x > MAX_X || y < MIN_Y || y > MAX_Y || z < MIN_Z || z > MAX_Z) return false;
    id = id | 0;
    if (id < 0 || !BLOCKS[id]) return false;
    const cx = x >> 4, cy = y >> 4, cz = z >> 4;
    const key = chunkKey(cx, cy, cz);
    let c = this.chunkArr[key];
    if (!c) {
      if (id === 0) return true;
      c = new Chunk(cx, cy, cz);
      this.chunkArr[key] = c;
      this.chunks.set(key, c);
    }
    const lx = x & 15, ly = y & 15, lz = z & 15;
    const i = lidx(lx, ly, lz);
    const old = c.data[i];
    if (old === id) return true;
    c.data[i] = id;
    if (old === 0) c.count++;
    if (id === 0) c.count--;
    // emitters
    const pk = posKey(x, y, z);
    if (EMIT[id]) this.emitters.set(pk, { x, y, z, id });
    else if (EMIT[old]) this.emitters.delete(pk);
    this._markDirty(cx, cy, cz, lx, ly, lz);
    if (c.count === 0) {
      this.chunkArr[key] = null;
      this.chunks.delete(key);
    }
    this.version++;
    for (const cb of this.listeners) {
      try { cb(x, y, z, old, id); } catch (e) { console.error(e); }
    }
    return true;
  }

  // Mark chunk dirty, plus any neighbour chunk (incl. diagonals) whose border AO/culling depends on this cell.
  _markDirty(cx, cy, cz, lx, ly, lz) {
    const ox = lx === 0 ? [0, -1] : lx === 15 ? [0, 1] : [0];
    const oy = ly === 0 ? [0, -1] : ly === 15 ? [0, 1] : [0];
    const oz = lz === 0 ? [0, -1] : lz === 15 ? [0, 1] : [0];
    for (const a of ox) for (const b of oy) for (const d of oz) {
      const nx = cx + a, ny = cy + b, nz = cz + d;
      if (nx < -4 || nx > 3 || ny < -2 || ny > 5 || nz < -4 || nz > 3) continue;
      this.dirty.add(chunkKey(nx, ny, nz));
    }
  }

  isSolid(x, y, z) {
    return SOLID[this.getBlock(x, y, z)] === 1;
  }

  getCollisionBoxes(minX, minY, minZ, maxX, maxY, maxZ) {
    const out = [];
    const x0 = Math.floor(minX), x1 = Math.floor(maxX);
    const y0 = Math.floor(minY), y1 = Math.floor(maxY);
    const z0 = Math.floor(minZ), z1 = Math.floor(maxZ);
    for (let y = y0; y <= y1; y++) {
      for (let z = z0; z <= z1; z++) {
        for (let x = x0; x <= x1; x++) {
          const id = this.getBlock(x, y, z);
          if (!id || !SOLID[id]) continue;
          const box = { minX: x, minY: y, minZ: z, maxX: x + 1, maxY: y + BOX_H[id], maxZ: z + 1 };
          // strict overlap
          if (box.maxX > minX && box.minX < maxX && box.maxY > minY && box.minY < maxY &&
              box.maxZ > minZ && box.minZ < maxZ) out.push(box);
        }
      }
    }
    return out;
  }

  // Voxel DDA (Amanatides & Woo). Skips air and water. Starting inside a block returns dist 0, zero normal.
  raycast(origin, dir, maxDist) {
    let dx = dir.x, dy = dir.y, dz = dir.z;
    const len = Math.hypot(dx, dy, dz);
    if (!len) return null;
    dx /= len; dy /= len; dz /= len;
    const ox = origin.x, oy = origin.y, oz = origin.z;
    let x = Math.floor(ox), y = Math.floor(oy), z = Math.floor(oz);
    const sx = dx > 0 ? 1 : -1, sy = dy > 0 ? 1 : -1, sz = dz > 0 ? 1 : -1;
    const tdx = dx !== 0 ? Math.abs(1 / dx) : Infinity;
    const tdy = dy !== 0 ? Math.abs(1 / dy) : Infinity;
    const tdz = dz !== 0 ? Math.abs(1 / dz) : Infinity;
    let tmx = dx > 0 ? (x + 1 - ox) * tdx : dx < 0 ? (ox - x) * tdx : Infinity;
    let tmy = dy > 0 ? (y + 1 - oy) * tdy : dy < 0 ? (oy - y) * tdy : Infinity;
    let tmz = dz > 0 ? (z + 1 - oz) * tdz : dz < 0 ? (oz - z) * tdz : Infinity;
    let nx = 0, ny = 0, nz = 0, t = 0;
    for (let i = 0; i < 2048; i++) {
      const id = this.getBlock(x, y, z);
      if (id !== 0 && id !== WATER) return { x, y, z, id, normal: { x: nx, y: ny, z: nz }, dist: t };
      if (tmx < tmy && tmx < tmz) {
        t = tmx; if (t > maxDist) return null;
        x += sx; tmx += tdx; nx = -sx; ny = 0; nz = 0;
      } else if (tmy < tmz) {
        t = tmy; if (t > maxDist) return null;
        y += sy; tmy += tdy; nx = 0; ny = -sy; nz = 0;
      } else {
        t = tmz; if (t > maxDist) return null;
        z += sz; tmz += tdz; nx = 0; ny = 0; nz = -sz;
      }
    }
    return null;
  }

  topSolidY(x, z) {
    x = Math.floor(x); z = Math.floor(z);
    if (x < MIN_X || x > MAX_X || z < MIN_Z || z > MAX_Z) return null;
    for (let cy = 5; cy >= -2; cy--) {
      const c = this.chunkArr[chunkKey(x >> 4, cy, z >> 4)];
      if (!c) continue;
      for (let ly = 15; ly >= 0; ly--) {
        const id = c.data[lidx(x & 15, ly, z & 15)];
        if (id && SOLID[id]) return cy * CS + ly;
      }
    }
    return null;
  }

  forEachBlock(cb) {
    for (const c of this.chunks.values()) {
      const bx = c.cx * CS, by = c.cy * CS, bz = c.cz * CS;
      const d = c.data;
      for (let ly = 0; ly < CS; ly++) for (let lz = 0; lz < CS; lz++) for (let lx = 0; lx < CS; lx++) {
        const id = d[lidx(lx, ly, lz)];
        if (id) cb(bx + lx, by + ly, bz + lz, id);
      }
    }
  }

  // Run-length encoded per chunk: { v:1, chunks:[[cx,cy,cz,[id,run,id,run,...]], ...] }
  serialize() {
    const chunks = [];
    for (const c of this.chunks.values()) {
      const rle = [];
      const d = c.data;
      let cur = d[0], run = 1;
      for (let i = 1; i < d.length; i++) {
        if (d[i] === cur) run++;
        else { rle.push(cur, run); cur = d[i]; run = 1; }
      }
      rle.push(cur, run);
      chunks.push([c.cx, c.cy, c.cz, rle]);
    }
    return { v: 1, chunks };
  }

  deserialize(obj) {
    // mark old chunks dirty so the renderer drops their meshes
    for (const k of this.chunks.keys()) this.dirty.add(k);
    this.chunkArr.fill(null);
    this.chunks.clear();
    this.emitters.clear();
    if (obj && Array.isArray(obj.chunks)) {
      for (const [cx, cy, cz, rle] of obj.chunks) {
        if (cx < -4 || cx > 3 || cy < -2 || cy > 5 || cz < -4 || cz > 3) continue;
        const c = new Chunk(cx, cy, cz);
        let p = 0;
        for (let i = 0; i < rle.length; i += 2) {
          const id = rle[i], run = rle[i + 1];
          if (id) {
            c.data.fill(id, p, p + run);
            c.count += run;
          }
          p += run;
        }
        if (!c.count) continue;
        const key = chunkKey(cx, cy, cz);
        this.chunkArr[key] = c;
        this.chunks.set(key, c);
        this.dirty.add(key);
        if (c.count) {
          const bx = cx * CS, by = cy * CS, bz = cz * CS;
          for (let ly = 0; ly < CS; ly++) for (let lz = 0; lz < CS; lz++) for (let lx = 0; lx < CS; lx++) {
            const id = c.data[lidx(lx, ly, lz)];
            if (id && EMIT[id]) {
              const x = bx + lx, y = by + ly, z = bz + lz;
              this.emitters.set(posKey(x, y, z), { x, y, z, id });
            }
          }
        }
      }
    }
    this.version++;
    for (const cb of this.resetListeners) {
      try { cb(); } catch (e) { console.error(e); }
    }
  }

  onChange(cb) {
    this.listeners.add(cb);
    return () => this.listeners.delete(cb);
  }

  // extra: fires after deserialize() replaced the whole world
  onReset(cb) {
    this.resetListeners.add(cb);
    return () => this.resetListeners.delete(cb);
  }

  // extra: number of non-air blocks
  countBlocks() {
    let n = 0;
    for (const c of this.chunks.values()) n += c.count;
    return n;
  }
}
