import { Sheep } from './Sheep.js';
import { Zombie } from './Zombie.js';
import { rayAabb } from '../physics.js';
import { zombieCap } from '../spawning.js';

export class MobManager {
  constructor(game) { this.g = game; this.list = []; this.spawnT = 2; this.zombieT = 8; }

  count(kind) { let n = 0; for (const m of this.list) if (m.kind === kind && !m.dead) n++; return n; }

  spawn(kind, x, y, z) {
    const m = kind === 'sheep' ? new Sheep(this.g, x, y, z) : new Zombie(this.g, x, y, z);
    this.list.push(m);
    return m;
  }

  clear() { for (const m of this.list) m.dispose(); this.list.length = 0; }

  raycast(origin, dir, maxDist) {
    let best = null, bd = maxDist;
    for (const m of this.list) {
      if (m.dead) continue;
      const d = rayAabb(origin, dir, m.x - m.hw, m.y, m.z - m.hw, m.x + m.hw, m.y + m.h, m.z + m.hw, bd);
      if (d >= 0 && d < bd) { bd = d; best = m; }
    }
    return best ? { mob: best, dist: bd } : null;
  }

  /** Any non-dead mob overlapping this cell? */
  overlapsCell(bx, by, bz) {
    for (const m of this.list) {
      if (m.dead) continue;
      if (m.x + m.hw > bx && m.x - m.hw < bx + 1 && m.y + m.h > by && m.y < by + 1 && m.z + m.hw > bz && m.z - m.hw < bz + 1) return true;
    }
    return false;
  }

  update(dt) {
    const g = this.g;
    for (let i = this.list.length - 1; i >= 0; i--) {
      const m = this.list[i];
      m.update(dt);
      if (!m.remove && m.age > 300 && !g.nearestSeat(m.x, m.y, m.z, 32)) m.remove = true;
      if (m.remove) { m.dispose(); this.list.splice(i, 1); }
    }
    this.spawnT -= dt; this.zombieT -= dt;
    const anyLiving = g.seats.some((s) => !s.player.dead);
    if (this.spawnT <= 0 && anyLiving) { this.spawnT = 2.5; this.trySpawn('sheep'); }
    if (this.zombieT <= 0 && anyLiving) { this.zombieT = 8; this.trySpawn('zombie'); }
  }

  trySpawn(which) {
    const g = this.g, w = g.world;
    const living = g.seats.filter((s) => !s.player.dead);
    if (!living.length || this.list.length >= 14) return;
    const p = living[Math.floor(Math.random() * living.length)].player; // spawn around a random living player
    const night = g.isNight();
    let kind = null;
    if (which === 'zombie') { if (night && this.count('zombie') < zombieCap(g.surfaceCount())) kind = 'zombie'; }
    else if (!night && g.isDay() && this.count('sheep') < 4 && Math.random() < 0.3) kind = 'sheep';
    if (!kind) return;
    for (let a = 0; a < 24; a++) {
      const ang = Math.random() * Math.PI * 2;
      const r = kind === 'zombie' ? 4 + Math.random() * 20 : 5 + Math.random() * 19;
      const x = Math.floor(p.x + Math.cos(ang) * r), z = Math.floor(p.z + Math.sin(ang) * r);
      const y = w.topSolidY(x, z);
      if (y === null || y === undefined) continue;
      if (w.isSolid(x, y + 1, z) || w.isSolid(x, y + 2, z)) continue;
      if (w.getBlock(x, y + 1, z) === g.WATER) continue;
      if (Math.abs(y + 1 - p.y) > 14) continue;
      if (kind === 'sheep' && w.getBlock(x, y, z) !== g.GRASS) continue;
      if (kind === 'zombie' && g.growth.nearTorch(x, y, z, 7)) continue;
      this.spawn(kind, x + 0.5, y + 1, z + 0.5);
      return;
    }
  }
}
