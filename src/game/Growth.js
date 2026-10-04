// "Random tick" systems (SPEC §7): saplings -> trees, crops, farmland decay, grass spread, torch registry.
import { BLOCK_BY_KEY } from '../data/blocks.js';

const ID = (k) => BLOCK_BY_KEY[k].id;
const SAPLING = ID('oak_sapling'), W0 = ID('wheat_0'), W3 = ID('wheat_3'), FARM = ID('farmland'), DIRT = ID('dirt'), GRASS = ID('grass');
const TORCH = ID('torch'), WATER = ID('water'), LOG = ID('oak_log'), LEAVES = ID('oak_leaves');
const k3 = (x, y, z) => `${x},${y},${z}`;
const rr = (a, b) => a + Math.random() * (b - a);

export class Growth {
  constructor(game) {
    this.g = game;
    this.items = new Map();
    this.dirt = new Set(); this.dirtList = []; this.dirtListT = 0; this.spreadT = 0;
    this.torches = new Set();
  }

  clear() { this.items.clear(); this.dirt.clear(); this.torches.clear(); this.dirtList = []; }
  scan() { this.clear(); this.g.world.forEachBlock((x, y, z, id) => this.track(x, y, z, 0, id)); }

  water(x, y, z, r = 4) {
    const w = this.g.world;
    for (let dx = -r; dx <= r; dx++) for (let dz = -r; dz <= r; dz++) for (let dy = 0; dy <= 1; dy++)
      if (w.getBlock(x + dx, y + dy, z + dz) === WATER) return true;
    return false;
  }

  track(x, y, z, old, id) {
    const k = k3(x, y, z);
    if (old !== id) { this.items.delete(k); if (old === DIRT) this.dirt.delete(k); if (old === TORCH) this.torches.delete(k); }
    if (id === SAPLING) this.items.set(k, { x, y, z, type: 'sapling', t: rr(60, 150) });
    else if (id >= W0 && id < W3) this.items.set(k, { x, y, z, type: 'crop', t: rr(40, 90) * (this.water(x, y - 1, z) ? 0.5 : 1) });
    else if (id === FARM) this.items.set(k, { x, y, z, type: 'farm', t: rr(100, 140) });
    else if (id === DIRT) this.dirt.add(k);
    else if (id === TORCH) this.torches.add(k);
  }

  nearTorch(x, y, z, r = 7) {
    for (const k of this.torches) {
      const [a, b, c] = k.split(',').map(Number);
      if (Math.abs(a - x) <= r && Math.abs(b - y) <= r && Math.abs(c - z) <= r) return true;
    }
    return false;
  }

  update(dt) {
    const w = this.g.world;
    for (const [k, it] of this.items) {
      it.t -= dt;
      if (it.t > 0) continue;
      const id = w.getBlock(it.x, it.y, it.z);
      if (it.type === 'crop') {
        if (id < W0 || id >= W3 || w.getBlock(it.x, it.y - 1, it.z) !== FARM) { this.items.delete(k); continue; }
        w.setBlock(it.x, it.y, it.z, id + 1); // onChange re-tracks with a new timer
      } else if (it.type === 'sapling') {
        if (id !== SAPLING) { this.items.delete(k); continue; }
        if (!this.growTree(it.x, it.y, it.z)) it.t = 30;
      } else if (it.type === 'farm') {
        if (id !== FARM) { this.items.delete(k); continue; }
        const above = w.getBlock(it.x, it.y + 1, it.z);
        if ((above >= W0 && above <= W3) || this.water(it.x, it.y, it.z)) it.t = 120;
        else { w.setBlock(it.x, it.y, it.z, DIRT); this.items.delete(k); }
      }
    }
    // grass spread
    this.spreadT += dt; this.dirtListT += dt;
    if (this.dirtListT > 5) { this.dirtListT = 0; this.dirtList = Array.from(this.dirt); }
    if (this.spreadT > 1 && this.dirtList.length) {
      this.spreadT = 0;
      for (let i = 0; i < 4; i++) {
        const k = this.dirtList[Math.floor(Math.random() * this.dirtList.length)];
        if (!this.dirt.has(k) || Math.random() > 0.22) continue;
        const [x, y, z] = k.split(',').map(Number);
        if ((x === 0 && y === 0 && z === 0) || w.getBlock(x, y + 1, z) !== 0) continue;
        let near = false;
        for (let dx = -1; dx <= 1 && !near; dx++) for (let dz = -1; dz <= 1 && !near; dz++) for (let dy = -1; dy <= 1; dy++)
          if (w.getBlock(x + dx, y + dy, z + dz) === GRASS) { near = true; break; }
        if (near) w.setBlock(x, y, z, GRASS);
      }
    }
  }

  growTree(x, y, z) {
    const w = this.g.world;
    const below = w.getBlock(x, y - 1, z);
    if (below !== GRASS && below !== DIRT) return false;
    const h = 4 + Math.floor(Math.random() * 3);
    for (let i = 1; i <= h; i++) { const b = w.getBlock(x, y + i, z); if (b !== 0 && b !== LEAVES) return false; }
    // not inside the player
    const p = this.g.player;
    if (Math.abs(p.x - (x + 0.5)) < 0.8 && Math.abs(p.z - (z + 0.5)) < 0.8 && p.y < y + h + 1 && p.y + 1.8 > y) return false;
    w.setBlock(x, y, z, LOG);
    for (let i = 1; i <= h; i++) w.setBlock(x, y + i, z, LOG);
    const leaf = (lx, ly, lz) => { if (w.getBlock(lx, ly, lz) === 0) w.setBlock(lx, ly, lz, LEAVES); };
    for (let dy = h - 2; dy <= h + 1; dy++) {
      const r = dy >= h ? 1 : 2;
      for (let dx = -r; dx <= r; dx++) for (let dz = -r; dz <= r; dz++) {
        const corner = Math.abs(dx) === r && Math.abs(dz) === r;
        if (corner && (dy === h + 1 || r === 2 ? Math.random() < 0.5 || dy === h + 1 : false)) continue;
        if (dx === 0 && dz === 0 && dy <= h) continue;
        leaf(x + dx, y + dy, z + dz);
      }
    }
    this.g.events.emit('grow', 'tree');
    return true;
  }
}
