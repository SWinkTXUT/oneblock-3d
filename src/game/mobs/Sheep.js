import { Mob } from './Mob.js';
import { buildSheep } from './MobModels.js';

export class Sheep extends Mob {
  constructor(game, x, y, z) {
    super(game, 'sheep', x, y, z, buildSheep(), { hw: 0.45, h: 1.3, hp: 8 });
    this.hurtSound = 'sheep_hurt';
    this.sheared = false; this.regrowT = 0;
    this.state = 'idle'; this.stateT = 1 + Math.random() * 3; this.fleeT = 0; this.eatT = 0; this.headDown = 0;
    this.applyWool();
  }

  applyWool() { this.parts.woolBody.visible = !this.sheared; this.parts.woolCap.visible = !this.sheared; }

  shear() {
    if (this.sheared || this.dead) return false;
    this.sheared = true; this.regrowT = 150; this.applyWool(); return true;
  }

  onHurt() { this.fleeT = 3; this.state = 'flee'; this.ry = Math.random() * Math.PI * 2; }
  onDeath() {
    const g = this.game;
    if (!this.sheared) g.dropItem('white_wool', 1, this.x, this.y + 0.5, this.z);
    g.dropItem('raw_mutton', 1 + (Math.random() < 0.5 ? 1 : 0), this.x, this.y + 0.5, this.z);
  }

  think(dt) {
    const g = this.game, w = g.world;
    if (this.sheared) { this.regrowT -= dt; if (this.regrowT <= 0) { this.sheared = false; this.applyWool(); } }
    this.soundT -= dt;
    if (this.soundT <= 0) { this.soundT = 8 + Math.random() * 14; if (g.nearestSeat(this.x, this.y, this.z, 20)) g.sound.play('baa', { vol: 0.6, pitch: 0.9 + Math.random() * 0.3 }); }

    this.stateT -= dt;
    this.speed = 0;
    if (this.state === 'flee') {
      this.fleeT -= dt;
      this.speed = 3.2;
      if (this.fleeT <= 0) { this.state = 'idle'; this.stateT = 1; }
    } else if (this.state === 'eat') {
      this.eatT -= dt;
      if (this.eatT <= 0) {
        const bx = Math.floor(this.x), by = Math.floor(this.y - 0.5), bz = Math.floor(this.z);
        if (w.getBlock(bx, by, bz) === g.GRASS && !(bx === 0 && by === 0 && bz === 0)) {
          w.setBlock(bx, by, bz, g.DIRT);
          g.sound.play('dig_dirt', { vol: 0.5 });
          if (this.sheared) { this.sheared = false; this.applyWool(); }
        }
        this.state = 'idle'; this.stateT = 1 + Math.random() * 3;
      }
    } else if (this.state === 'wander') {
      this.speed = 1.1;
      if (this.stateT <= 0) { this.state = 'idle'; this.stateT = 1.5 + Math.random() * 4; }
    } else if (this.stateT <= 0) {
      const r = Math.random();
      const bx = Math.floor(this.x), by = Math.floor(this.y - 0.5), bz = Math.floor(this.z);
      if (r < 0.25 && w.getBlock(bx, by, bz) === g.GRASS && !(bx === 0 && by === 0 && bz === 0) && this.onGround) { this.state = 'eat'; this.eatT = 2; }
      else { this.state = 'wander'; this.stateT = 1.5 + Math.random() * 3; this.ry = Math.random() * Math.PI * 2; }
    }
    if (this.speed > 0) {
      if (!this.groundAhead(0.7, 0)) { this.speed = 0; if (this.state === 'wander') { this.ry += Math.PI * (0.6 + Math.random() * 0.8); } else if (this.state === 'flee') this.ry += Math.PI * 0.7; }
      else if (this.blocked && this.onGround) this.wantJump = true;
    }
  }

  animate(dt) {
    const sw = Math.sin(this.walkPhase) * 0.9 * this.walkAmt;
    const L = this.parts.legs;
    L[0].rotation.x = sw; L[3].rotation.x = sw; L[1].rotation.x = -sw; L[2].rotation.x = -sw;
    const target = this.state === 'eat' ? 1 : 0;
    this.headDown += (target - this.headDown) * Math.min(1, dt * 8);
    this.parts.head.rotation.x = this.headDown * (1.0 + Math.sin(this.age * 14) * 0.12 * (this.state === 'eat' ? 1 : 0));
    this.parts.head.position.y = (19 - this.headDown * 5) / 16;
  }
}
