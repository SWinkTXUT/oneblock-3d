// Base mob: physics, hurt flash, knockback, death animation. Subclasses implement think(dt, game).
import { moveEntity } from '../physics.js';

export class Mob {
  constructor(game, kind, x, y, z, model, { hw, h, hp }) {
    this.game = game; this.kind = kind;
    this.x = x; this.y = y; this.z = z; this.vx = this.vy = this.vz = 0;
    this.hw = hw; this.h = h; this.hp = hp; this.maxHp = hp;
    this.ry = Math.random() * Math.PI * 2;
    this.model = model; this.group = model.group; this.mats = model.mats; this.parts = model.parts;
    this.age = 0; this.hurtT = 0; this.kbT = 0; this.dead = false; this.deadT = 0; this.remove = false;
    this.onGround = false; this.speed = 0; this.wantJump = false; this.walkPhase = 0; this.walkAmt = 0;
    this.hover = false; this.fireT = 0; this.soundT = 3 + Math.random() * 8; this.blocked = false;
    game.renderer.scene.add(this.group);
    this.sync();
  }

  dist2(px, py, pz) { return (this.x - px) ** 2 + (this.y - py) ** 2 + (this.z - pz) ** 2; }

  update(dt) {
    const g = this.game, w = g.world;
    this.age += dt;
    if (this.hurtT > 0) this.hurtT -= dt;
    if (this.kbT > 0) this.kbT -= dt;
    if (this.dead) {
      this.deadT += dt;
      this.vx *= 0.9; this.vz *= 0.9;
    } else this.think(dt);

    // steering
    if (!this.dead && this.kbT <= 0) {
      const tx = Math.sin(this.ry) * this.speed, tz = Math.cos(this.ry) * this.speed;
      const k = 1 - Math.exp(-(this.onGround ? 10 : 2) * dt);
      this.vx += (tx - this.vx) * k; this.vz += (tz - this.vz) * k;
    } else if (this.onGround) { const f = Math.exp(-6 * dt); this.vx *= f; this.vz *= f; }

    const inWater = w.getBlock(this.x, this.y + 0.3, this.z) === g.WATER;
    if (inWater) { this.vy += (1.5 - this.vy) * (1 - Math.exp(-4 * dt)); this.vx *= 0.9; this.vz *= 0.9; }
    else if (this.hover) this.vy = 0;
    else this.vy = Math.max(-60, this.vy - 32 * dt);
    if (this.wantJump && (this.onGround || inWater) && !this.dead) { this.vy = inWater ? 3 : 8.2; }
    this.wantJump = false;

    const r = moveEntity(w, this, this.vx * dt, this.vy * dt, this.vz * dt);
    this.blocked = r.hitX || r.hitZ;
    if (r.hitX) this.vx = 0;
    if (r.hitZ) this.vz = 0;
    if (r.hitY) this.vy = 0;
    this.onGround = r.onGround;
    if (this.y < -40) { this.remove = true; this.group.removeFromParent(); return; }

    // animation
    const hs = Math.hypot(this.vx, this.vz);
    this.walkAmt += ((this.dead ? 0 : Math.min(1, hs / 2)) - this.walkAmt) * Math.min(1, dt * 10);
    this.walkPhase += hs * dt * 4.2;
    this.animate(dt);
    // hurt flash
    const f = this.hurtT > 0 ? 0.55 : 0;
    for (const m of this.mats) m.emissive.setRGB(f, f * 0.1, f * 0.1);
    if (this.dead) {
      const t = Math.min(1, this.deadT / 0.4);
      this.group.rotation.z = t * Math.PI / 2;
      if (this.deadT > 0.9) this.finishDeath();
    }
    this.sync();
  }

  sync() {
    this.group.position.set(this.x, this.y, this.z);
    this.group.rotation.y = this.ry;
  }

  hit(dmg, from, { knock = 1 } = {}) {
    if (this.dead) return false;
    this.hp -= dmg; this.hurtT = 0.4;
    if (from) {
      const dx = this.x - from.x, dz = this.z - from.z, l = Math.hypot(dx, dz) || 1;
      this.vx = (dx / l) * 5.5 * knock; this.vz = (dz / l) * 5.5 * knock; this.vy = 4.2 * knock; this.kbT = 0.25;
    }
    this.onHurt(from);
    if (this.hp <= 0) this.die(); else this.game.sound.play(this.hurtSound, { pitch: 1 });
    return true;
  }

  die() {
    if (this.dead) return;
    this.dead = true; this.deadT = 0;
    this.game.sound.play(this.deathSound || this.hurtSound);
    this.onDeath();
  }
  finishDeath() {
    this.remove = true;
    this.group.removeFromParent();
    this.game.renderer.spawnParticles('poof', this.x, this.y + this.h * 0.5, this.z);
  }
  dispose() { this.group.removeFromParent(); for (const m of this.mats) m.dispose(); }
  onHurt() {}
  onDeath() {}
  think() {}
  animate() {}

  /** ground exists ahead (within `depth` blocks below)? */
  groundAhead(dist, depth = 1) {
    const w = this.game.world;
    const ax = this.x + Math.sin(this.ry) * dist, az = this.z + Math.cos(this.ry) * dist;
    for (let d = 0; d <= depth; d++) if (w.isSolid(Math.floor(ax), Math.floor(this.y - 0.4 - d), Math.floor(az))) return true;
    return false;
  }
}
