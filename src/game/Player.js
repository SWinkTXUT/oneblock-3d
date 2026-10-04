// Player controller: physics, survival stats (SPEC §10).
import { moveEntity } from './physics.js';
import { BLOCK_BY_KEY } from '../data/blocks.js';
import { ITEMS } from '../data/items.js';
import { armorReduction } from './rules.js';

const WATER = BLOCK_BY_KEY.water.id;
export const EYE = 1.62;
export const KNOCK = 0.35;
const WALK = 4.3, SPRINT = 5.6, SNEAK = 1.3, GRAVITY = 32, JUMP = 9;

export class Player {
  constructor() {
    this.hw = 0.3; this.h = 1.8;
    this.reset(0.5, 1, 0.5);
  }

  reset(x, y, z) {
    this.x = x; this.y = y; this.z = z;
    this.vx = this.vy = this.vz = 0;
    this.yaw = 0; this.pitch = 0;
    this.onGround = false; this.inWater = false; this.headUnder = false;
    this.sprinting = false; this.sneaking = false;
    this.health = 20; this.hunger = 20; this.saturation = 5; this.exhaustion = 0;
    this.fallDist = 0; this.invuln = 0; this.regenT = 0; this.starveT = 0;
    this.attackCd = 0; this.poison = 0;
    this.dead = false; this.deathCause = '';
    this.walkDist = 0; this.eyeOff = 0;
    this.lastW = 0; this.sprintTap = 0; this.hover = false; this.kb = null;
  }

  get eye() { return { x: this.x, y: this.y + EYE - this.eyeOff, z: this.z }; }
  get forward() {
    const cp = Math.cos(this.pitch);
    return { x: -Math.sin(this.yaw) * cp, y: Math.sin(this.pitch), z: -Math.cos(this.yaw) * cp };
  }

  /** input: { f, r (−1..1), jump, sneak, sprint } ; ev: callbacks { land(fall), splash, step(blockKey), hurt(amount, cause), die(cause) } */
  update(dt, input, world, ev) {
    if (this.dead) return;
    this.invuln = Math.max(0, this.invuln - dt);
    this.attackCd = Math.max(0, this.attackCd - dt);

    const mid = world.getBlock(this.x, this.y + 0.4, this.z) === WATER || world.getBlock(this.x, this.y + 0.05, this.z) === WATER;
    const head = world.getBlock(this.x, this.y + EYE, this.z) === WATER;
    if (mid && !this.inWater) ev.splash && ev.splash();
    this.inWater = mid; this.headUnder = head;

    this.sneaking = !!input.sneak && !this.inWater;
    const moving = input.f !== 0 || input.r !== 0;
    // sprint: ctrl held / double-tap W (input.sprint), cancelled by stopping
    if (input.sprint && input.f > 0 && !this.sneaking && this.hunger > 6) this.sprinting = true;
    if (!moving || input.f <= 0 || this.sneaking || this.hunger <= 6) this.sprinting = false;

    let speed = this.sneaking ? SNEAK : this.sprinting ? SPRINT : WALK;
    if (this.inWater) speed *= 0.55;
    let wx = 0, wz = 0;
    if (moving) {
      const sy = Math.sin(this.yaw), cy = Math.cos(this.yaw);
      wx = -sy * input.f + cy * input.r;
      wz = -cy * input.f - sy * input.r;
      const l = Math.hypot(wx, wz); wx = (wx / l) * speed; wz = (wz / l) * speed;
    }
    const k = 1 - Math.exp(-(this.onGround ? 16 : this.inWater ? 5 : 4) * dt);
    this.vx += (wx - this.vx) * k; this.vz += (wz - this.vz) * k;

    // vertical
    if (this.inWater) {
      const target = input.jump ? 3.6 : -2.2;
      this.vy += (target - this.vy) * (1 - Math.exp(-6 * dt));
      this.fallDist = 0;
    } else if (this.hover) {
      this.vy = 0; this.fallDist = 0; // held above the One Block while it regenerates
    } else {
      this.vy = Math.max(-78, this.vy - GRAVITY * dt);
    }
    if (input.jump && this.onGround && !this.inWater) {
      this.vy = JUMP;
      this.addExhaustion(this.sprinting ? 0.2 : 0.05);
    }

    const guard = this.sneaking && this.onGround ? (e) => {
      const b = world.getCollisionBoxes(e.x - this.hw, e.y - 0.5, e.z - this.hw, e.x + this.hw, e.y - 0.05, e.z + this.hw);
      return b.length > 0;
    } : null;
    if (this.kb) { // knockback is a capped displacement (<= 0.35 blocks) that respects the sneak edge guard
      moveEntity(world, this, this.kb.x, 0, this.kb.z, guard);
      this.kb = null;
    }

    const px = this.x, pz = this.z, py = this.y;
    const r = moveEntity(world, this, this.vx * dt, this.vy * dt, this.vz * dt, guard);
    if (r.hitX) this.vx = 0;
    if (r.hitZ) this.vz = 0;
    // climb out of water at a ledge
    if (this.inWater && input.jump && (r.hitX || r.hitZ) && !head) this.vy = Math.max(this.vy, 6.5);
    const wasGround = this.onGround;
    this.onGround = r.onGround || (!!this.hover && !this.inWater);
    if (r.hitY) { if (this.vy > 0) this.vy = 0; else if (r.onGround) this.vy = 0; }

    // fall tracking
    if (!this.onGround && !this.inWater && this.y < py) this.fallDist += py - this.y;
    if (this.onGround && !wasGround || (this.onGround && this.fallDist > 0)) {
      const fd = this.fallDist; this.fallDist = 0;
      if (fd > 3 && !this.inWater) { this.hurt(Math.ceil(fd - 3), 'Fell from a high place', { ignoreArmor: true, noKnock: true }, ev); ev.land && ev.land(fd); }
      else if (fd > 0.8 && !wasGround) ev.land && ev.land(fd);
    }
    if (this.inWater) this.fallDist = 0;

    // walked distance (steps + exhaustion)
    const dist = Math.hypot(this.x - px, this.z - pz);
    if (this.onGround && !this.inWater) {
      this.walkDist += dist;
      const stride = this.sprinting ? 2.0 : this.sneaking ? 2.4 : 1.7;
      if (this.walkDist > stride) { this.walkDist = 0; ev.step && ev.step(); }
      this.addExhaustion(dist * (this.sprinting ? 0.1 : 0.02));
    }
    this.eyeOff += ((this.sneaking ? 0.22 : 0) - this.eyeOff) * (1 - Math.exp(-14 * dt));

    // void
    if (this.y < -40 && !this.dead) { this.kill('You fell out of the world', ev); return; }

    this.tickHunger(dt, ev);
  }

  addExhaustion(v) { this.exhaustion += v; }

  tickHunger(dt, ev) {
    if (this.poison > 0) { this.poison -= dt; this.exhaustion += 0.6 * dt; }
    while (this.exhaustion >= 4) {
      this.exhaustion -= 4;
      if (this.saturation > 0) this.saturation = Math.max(0, this.saturation - 1);
      else this.hunger = Math.max(0, this.hunger - 1);
    }
    if (this.hunger >= 18 && this.health < 20) {
      this.regenT += dt;
      if (this.regenT >= 4) { this.regenT = 0; this.health = Math.min(20, this.health + 1); this.addExhaustion(1.5); }
    } else this.regenT = 0;
    if (this.hunger <= 0) {
      this.starveT += dt;
      if (this.starveT >= 4) { this.starveT = 0; if (this.health > 1) this.hurt(1, 'Starved to death', { ignoreArmor: true, noKnock: true, force: true }, ev); }
    } else this.starveT = 0;
  }

  eat(foodDef) {
    this.hunger = Math.min(20, this.hunger + foodDef.hunger);
    this.saturation = Math.min(this.hunger, this.saturation + foodDef.saturation);
    if (foodDef.poisonChance && Math.random() < foodDef.poisonChance) this.poison = 12;
  }

  /** opts: { ignoreArmor, from:{x,z}, noKnock, force, inv } */
  hurt(amount, cause, opts = {}, ev = {}) {
    if (this.dead) return false;
    if (this.invuln > 0 && !opts.force) return false;
    if (!opts.ignoreArmor && opts.inv) {
      amount *= 1 - armorReduction(opts.inv.armorPoints());
      for (let i = 0; i < 4; i++) {
        const a = opts.inv.armor[i]; if (!a) continue;
        a.dur = (a.dur ?? 1) - 1;
        if (a.dur <= 0) { opts.inv.armor[i] = null; ev.breakItem && ev.breakItem(a.key); }
      }
    }
    amount = Math.max(0.5, amount);
    this.health -= amount;
    this.invuln = opts.force ? this.invuln : 0.5;
    if (opts.from && !opts.noKnock) {
      let dx = this.x - opts.from.x, dz = this.z - opts.from.z;
      const l = Math.hypot(dx, dz);
      if (l < 1e-3) { dx = 1; dz = 0; } // directly on top: any direction, still capped
      const n = Math.hypot(dx, dz);
      this.kb = { x: (dx / n) * KNOCK, z: (dz / n) * KNOCK };
    }
    ev.hurt && ev.hurt(amount, cause);
    if (this.health <= 0) { this.health = 0; this.kill(cause, ev); }
    return true;
  }

  kill(cause, ev) {
    if (this.dead) return;
    this.dead = true; this.health = 0; this.deathCause = cause;
    ev && ev.die && ev.die(cause);
  }

  serialize() {
    return { x: this.x, y: this.y, z: this.z, yaw: this.yaw, pitch: this.pitch, health: this.health, hunger: this.hunger, sat: this.saturation };
  }
  deserialize(d) {
    if (!d) return;
    this.reset(d.x, d.y, d.z);
    this.yaw = d.yaw || 0; this.pitch = d.pitch || 0;
    this.health = d.health > 0 ? d.health : 20; this.hunger = d.hunger ?? 20; this.saturation = d.sat ?? 5;
  }
}

export const isFood = (key) => !!(ITEMS[key] && ITEMS[key].food);
