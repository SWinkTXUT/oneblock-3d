// Dropped item entities: spin/bob, gravity, magnetise, merge, despawn (SPEC §9).
import * as THREE from 'three';
import { moveEntity } from './physics.js';
import { maxStack, maxDurability } from './Inventory.js';

const MAX_DROPS = 140;

export class Drops {
  constructor(game) { this.game = game; this.list = []; this.mergeT = 0; }

  spawn(key, n, x, y, z, vel, dur) {
    const g = this.game;
    if (this.list.length >= MAX_DROPS) { const old = this.list.shift(); old.group.removeFromParent(); }
    const group = new THREE.Group();
    let mesh = null;
    try { mesh = g.renderer.createItemMesh(key); } catch (e) { mesh = null; }
    if (!mesh) mesh = new THREE.Mesh(new THREE.BoxGeometry(0.25, 0.25, 0.25), new THREE.MeshBasicMaterial({ color: 0xffffff }));
    group.add(mesh);
    g.renderer.scene.add(group);
    const a = Math.random() * Math.PI * 2;
    const d = {
      key, n, dur, x, y, z, hw: 0.125, h: 0.25,
      vx: vel ? vel.x : Math.cos(a) * (0.1 + Math.random() * 0.5), vy: vel ? vel.y : 3 + Math.random() * 1.5, vz: vel ? vel.z : Math.sin(a) * (0.1 + Math.random() * 0.5),
      age: 0, delay: 0.25, group, mesh, phase: Math.random() * 6.28, onGround: false,
    };
    this.list.push(d);
    this.place(d, 0);
    return d;
  }

  place(d, t) {
    d.group.position.set(d.x, d.y + 0.2 + Math.sin(d.phase + t * 2.4) * 0.05, d.z);
    d.mesh.rotation.y = d.phase + t * 1.6;
  }

  update(dt) {
    const g = this.game, p = g.player, w = g.world;
    this.mergeT += dt;
    for (let i = this.list.length - 1; i >= 0; i--) {
      const d = this.list[i];
      d.age += dt; d.delay -= dt;
      let remove = d.age > 300 || d.y < -40;
      if (!remove) {
        const dx = p.x - d.x, dy = p.y + 0.9 - (d.y + 0.1), dz = p.z - d.z;
        const dist = Math.hypot(dx, dy, dz);
        if (!p.dead && d.delay <= 0 && dist < 1.5 && g.inv.canAdd(d.key, 1)) {
          // magnetise
          d.vx = dx / dist * 8; d.vy = dy / dist * 8; d.vz = dz / dist * 8;
          d.magnet = true;
          if (dist < 0.55) {
            const left = g.inv.add(d.key, d.n, d.dur);
            const got = d.n - left;
            if (got > 0) { g.sound.play('pop', { pitch: 0.9 + Math.random() * 0.4, minGap: 40 }); g.events.emit('pickup', d.key); g.ui.dirtyInv(); }
            d.n = left;
            if (left <= 0) remove = true;
          }
        } else if (d.magnet) { d.magnet = false; }
        if (!d.magnet) {
          d.vy = Math.max(-40, d.vy - 22 * dt);
          const f = d.onGround ? Math.exp(-8 * dt) : Math.exp(-0.8 * dt);
          d.vx *= f; d.vz *= f;
        }
        const r = moveEntity(w, d, d.vx * dt, d.vy * dt, d.vz * dt);
        if (r.hitY) { if (d.vy < 0) d.vy = d.magnet ? d.vy : 0; else d.vy = 0; }
        if (r.hitX) d.vx *= -0.3;
        if (r.hitZ) d.vz *= -0.3;
        d.onGround = r.onGround;
        // water: float
        if (w.getBlock(d.x, d.y + 0.1, d.z) === g.WATER) { d.vy = Math.min(2, d.vy + 40 * dt); d.vx *= 0.95; d.vz *= 0.95; }
      }
      if (remove) { d.group.removeFromParent(); this.list.splice(i, 1); continue; }
      this.place(d, d.age);
    }
    if (this.mergeT > 0.6) {
      this.mergeT = 0;
      for (let i = 0; i < this.list.length; i++) {
        const a = this.list[i]; if (!a || a.n <= 0 || maxDurability(a.key)) continue;
        for (let j = i + 1; j < this.list.length; j++) {
          const b = this.list[j];
          if (b.key !== a.key || maxDurability(b.key) || Math.abs(a.x - b.x) > 0.8 || Math.abs(a.z - b.z) > 0.8 || Math.abs(a.y - b.y) > 0.8) continue;
          const room = maxStack(a.key) - a.n; if (room <= 0) break;
          const t = Math.min(room, b.n); a.n += t; b.n -= t; a.age = Math.min(a.age, b.age);
          if (b.n <= 0) { b.group.removeFromParent(); this.list.splice(j, 1); j--; }
        }
      }
    }
  }

  clear() { for (const d of this.list) d.group.removeFromParent(); this.list.length = 0; }
}
