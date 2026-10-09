import { Mob } from './Mob.js';
import { buildZombie } from './MobModels.js';

export class Zombie extends Mob {
  constructor(game, x, y, z) {
    super(game, 'zombie', x, y, z, buildZombie(), { hw: 0.3, h: 1.95, hp: 20 });
    this.hurtSound = 'zombie_hurt'; this.deathSound = 'zombie_death';
    this.rise = 1.5; this.atkCd = 1.5; this.state = 'idle'; this.stateT = 1; this.burnTick = 0; this.jitter = Math.random() * 0.4;
  }

  onDeath() {
    const g = this.game;
    const n = Math.floor(Math.random() * 3);
    if (n) g.dropItem('rotten_flesh', n, this.x, this.y + 0.8, this.z);
    if (Math.random() < 0.05) g.dropItem('iron_ingot', 1, this.x, this.y + 0.8, this.z);
    if (Math.random() < 0.05) g.dropItem('carrot', 1, this.x, this.y + 0.8, this.z);
    g.events.emit('kill', 'zombie');
  }

  think(dt) {
    const g = this.game, w = g.world;
    const seat = g.nearestSeat(this.x, this.y, this.z);
    const p = seat ? seat.player : null;
    this.atkCd -= dt;
    this.soundT -= dt;
    if (this.rise > 0) { // rising from the ground: harmless and stationary
      this.rise -= dt; this.speed = 0; this.atkCd = Math.max(this.atkCd, 0.3);
      this.yOff = -this.h * Math.max(0, this.rise / 1.5) ** 1.5;
      if (Math.random() < dt * 14) g.renderer.spawnParticles('poof', this.x + (Math.random() - 0.5) * 0.6, this.y + 0.1, this.z + (Math.random() - 0.5) * 0.6);
      if (this.rise <= 0) this.yOff = 0;
      return;
    }
    const dx = p ? p.x - this.x : 99, dz = p ? p.z - this.z : 99, dy = p ? p.y - this.y : 99;
    const flat = Math.hypot(dx, dz);
    const near = !!p && !p.dead && flat < 16 && Math.abs(dy) < 12;
    if (this.soundT <= 0) { this.soundT = 4 + Math.random() * 6; if (flat < 24) g.sound.play('zombie_groan', { vol: Math.max(0.2, 1 - flat / 24) * 0.8 }); }

    // daylight burning
    if (g.isDay() && !this.dead) {
      const top = w.topSolidY(Math.floor(this.x), Math.floor(this.z));
      const exposed = top === null || top < Math.floor(this.y + this.h);
      const wet = w.getBlock(this.x, this.y + 0.3, this.z) === g.WATER;
      if (exposed && !wet) {
        this.fireT = 1;
        this.burnTick += dt;
        if (Math.random() < dt * 6) g.renderer.spawnParticles('flame', this.x + (Math.random() - 0.5) * 0.5, this.y + 0.4 + Math.random() * 1.2, this.z + (Math.random() - 0.5) * 0.5);
        if (this.burnTick >= 1) { this.burnTick = 0; g.sound.play('burn'); this.hit(1, null); this.hurtT = 0.25; }
      }
    }

    if (near) {
      this.ry = Math.atan2(dx, dz);
      this.speed = flat > 1.0 ? 2.6 : 0;
      if (this.groundAhead(0.8, 2) || dy < -1.5) { /* ok */ } else this.speed = 0;
      if (this.blocked && this.onGround) this.wantJump = true;
      if (flat < 1.15 && Math.abs(dy) < 1.6 && this.atkCd <= 0) {
        this.atkCd = 1.0;
        g.damageSeat(seat, 3, 'Slain by Zombie', this);
      }
    } else {
      this.stateT -= dt;
      if (this.state === 'wander') {
        this.speed = 1.0;
        if (this.stateT <= 0) { this.state = 'idle'; this.stateT = 2 + Math.random() * 4; }
        if (!this.groundAhead(0.8, 2)) { this.ry += Math.PI; this.speed = 0; }
        else if (this.blocked && this.onGround) this.wantJump = true;
      } else {
        this.speed = 0;
        if (this.stateT <= 0) { this.state = 'wander'; this.stateT = 2 + Math.random() * 3; this.ry = Math.random() * Math.PI * 2; }
      }
    }
  }

  animate() {
    const sw = Math.sin(this.walkPhase) * 0.85 * this.walkAmt;
    const P = this.parts;
    P.legL.rotation.x = sw; P.legR.rotation.x = -sw;
    P.armL.rotation.x = -Math.PI / 2 + Math.sin(this.age * 2 + this.jitter) * 0.08 - sw * 0.15;
    P.armR.rotation.x = -Math.PI / 2 + Math.cos(this.age * 2 + this.jitter) * 0.08 + sw * 0.15;
    P.head.rotation.x = 0;
  }
}
