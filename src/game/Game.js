// Game orchestrator: loop, interaction, One Block regeneration, time, save/load. (SPEC §5–§13)
import { World } from '../world/World.js';
import { Renderer } from '../render/Renderer.js';
import { Sound } from '../audio/Sound.js';
import { BLOCKS, BLOCK_BY_KEY } from '../data/blocks.js';
import { ITEMS } from '../data/items.js';
import { PHASES, phaseIndexFor, phaseInfo, cycleOf, makeForcedPlan, rollNext, rollLoot } from '../data/phases.js';
import { Inventory, makeStack, maxDurability } from './Inventory.js';
import { Player } from './Player.js';
import { Input } from './Input.js';
import { Events } from './Events.js';
import { Drops } from './Drops.js';
import { Growth } from './Growth.js';
import { Goals } from './Goals.js';
import { MobManager } from './mobs/MobManager.js';
import { breakInfo, rollDrops, materialOf } from './rules.js';
import { overlapsCell } from './physics.js';
import { keyOf, newChest, newFurnace, tickFurnace, entityContents, serializeEntities, deserializeEntities } from './BlockEntities.js';
import { loadSettings, readSave, writeSave, clearSave } from './Save.js';
import { UI } from '../ui/UI.js';

const ID = (k) => BLOCK_BY_KEY[k].id;
const DAY_LEN = 600;
const REACH = 5;

export class Game {
  constructor(container) {
    this.container = container;
    this.WATER = ID('water'); this.GRASS = ID('grass'); this.DIRT = ID('dirt'); this.FARM = ID('farmland');
    this.FURNACE = ID('furnace'); this.LIT = ID('lit_furnace'); this.CHEST = ID('chest'); this.BED = ID('bed');
    this.TABLE = ID('crafting_table'); this.TORCH = ID('torch');

    this.settings = loadSettings();
    this.world = new World();
    this.renderer = new Renderer(container, this.world);
    this.renderer.setQuality(this.settings.quality);
    this.sound = new Sound(); this.sound.setVolume(this.settings.volume);
    this.events = new Events();
    this.inv = new Inventory();
    this.player = new Player();
    this.entities = new Map();
    this.state = { blocksBroken: 0, forced: makeForcedPlan(), time: 30, spawn: null };
    this.sel = 0;
    this.mode = 'title'; // 'title' | 'play'
    this.drops = new Drops(this);
    this.mobs = new MobManager(this);
    this.growth = new Growth(this);
    this.ui = new UI(this);
    this.goals = new Goals(this);
    this.input = new Input(this, container.querySelector('canvas') || container);

    this.regen = null; this.mining = null; this.mineCd = 0; this.swingT = 0; this.digT = 0;
    this.placeCd = 0; this.eatT = 0; this.eatSndT = 0; this.sleeping = 0; this.autosaveT = 0; this.lastHeld = undefined;
    this.camBob = 0; this.fovCur = this.settings.fov; this.titleT = 0; this.running = false; this.phaseIdx = 0; this.cycle = 1;
    this.stepFx = 0; this.hasWorld = false;
    this.targetBlock = null; this.targetMob = null; this.furnaceSnd = 0;

    this.pev = {
      land: (fd) => this.sound.play('land', { vol: Math.min(1.3, 0.4 + fd * 0.12) }),
      splash: () => { this.sound.play('splash'); const p = this.player; this.renderer.spawnParticles('poof', p.x, p.y + 0.2, p.z); },
      step: () => {
        const p = this.player;
        const id = this.world.getBlock(p.x, p.y - 0.2, p.z);
        this.sound.play('step_' + materialOf(BLOCKS[id] ? BLOCKS[id].key : 'stone'), { vol: p.sneaking ? 0.4 : 1 });
      },
      hurt: (amt, cause) => { this.sound.play('hurt'); this.renderer.setDamageFlash(); this.ui.damage(amt); },
      die: (cause) => this.onDeath(cause),
      breakItem: (key) => { this.sound.play('tool_break'); this.ui.message(`${ITEMS[key].name} broke!`); },
    };

    this.world.onChange((x, y, z, o, n) => this.onWorldChange(x, y, z, o, n));
    window.addEventListener('pagehide', () => this.save());
    document.addEventListener('visibilitychange', () => { if (document.hidden) this.save(); });
  }

  // ------------------------------------------------------------------ boot / worlds
  boot() {
    const d = readSave();
    if (d) { this.applySave(d); this.hasWorld = true; } else this.resetWorld(false);
    this.setHandVisible(false);
    this.ui.showTitle();
    this.running = true;
    this.last = performance.now();
    requestAnimationFrame((t) => this.frame(t));
  }

  hasSave() { return !!readSave(); }

  /** First-person hand is an optional nicety on Builder A's internals (renderer.hand); ignored if absent. */
  setHandVisible(v) { if (this.renderer.hand) this.renderer.hand.visible = v; }

  resetWorld(startLog) {
    const all = [];
    this.world.forEachBlock((x, y, z) => all.push([x, y, z]));
    for (const [x, y, z] of all) this.world.setBlock(x, y, z, 0);
    this.world.setBlock(0, 0, 0, startLog ? ID('oak_log') : this.GRASS);
    this.mobs.clear(); this.drops.clear(); this.entities.clear();
    this.inv.clear();
    this.state = { blocksBroken: 0, forced: makeForcedPlan(), time: 30, spawn: null };
    this.player.reset(0.5, 1, 0.5);
    this.goals.deserialize({});
    this.regen = null; this.mining = null; this.sel = 0;
    this.growth.scan();
    this.syncPhase(false);
    this.ui.dirtyInv();
  }

  newWorld() {
    clearSave();
    this.resetWorld(true);
    this.hasWorld = true;
    this.save();
  }

  startPlaying() {
    if (!this.hasWorld) this.newWorld();
    this.mode = 'play';
    this.setHandVisible(true);
    this.ui.hideTitle();
    this.sound.resume();
    this.lastHeld = undefined;
    this.ui.close(true);
    this.input.lock();
    this.autosaveT = 0;
  }

  toTitle() {
    this.save();
    this.mode = 'title';
    this.setHandVisible(false);
    this.input.unlock();
    this.ui.close(true);
    this.renderer.setHighlight(null); this.renderer.setBreakProgress(null, 0);
    this.renderer.setHeldItem(null); this.renderer.setUnderwater(false);
    this.ui.showTitle();
  }

  snapshot() {
    return {
      world: this.world.serialize(),
      player: this.player.serialize(),
      inv: this.inv.serialize(),
      entities: serializeEntities(this.entities),
      state: { ...this.state },
      goals: this.goals.serialize(),
      sel: this.sel,
    };
  }

  save() {
    if (!this.hasWorld || this.player.dead) return false;
    try { return writeSave(this.snapshot()); } catch (e) { console.warn('save failed', e); return false; }
  }

  applySave(d) {
    this.mobs.clear(); this.drops.clear();
    this.world.deserialize(d.world);
    this.inv.deserialize(d.inv);
    this.entities = deserializeEntities(d.entities);
    this.state = { blocksBroken: 0, forced: makeForcedPlan(), time: 30, spawn: null, ...(d.state || {}) };
    this.player.deserialize(d.player);
    this.goals.deserialize(d.goals);
    this.sel = d.sel || 0;
    this.regen = null;
    this.growth.scan();
    // stale lit furnaces / missing entities are tolerated
    this.syncPhase(false);
    this.ui.dirtyInv();
  }

  onLockChange(locked) {
    if (this.mode !== 'play' || locked) return;
    if (!this.ui.current && !this.player.dead) this.ui.open('pause');
  }
  onLockError() { if (this.mode === 'play' && !this.ui.current && !this.player.dead) this.ui.open('pause'); }

  // ------------------------------------------------------------------ time
  isNight() { const t = this.state.time; return t >= 345 && t < 555; }
  isDay() { const t = this.state.time; return t < 320 || t >= 560; }
  renderTime() {
    const s = this.state.time % DAY_LEN;
    let t;
    if (s < 300) t = 0.02 + (s / 300) * 0.40;
    else if (s < 360) t = 0.42 + ((s - 300) / 60) * 0.16;
    else if (s < 540) t = 0.58 + ((s - 360) / 180) * 0.34;
    else t = 0.92 + ((s - 540) / 60) * 0.10;
    return t % 1;
  }

  // ------------------------------------------------------------------ phases / one block
  syncPhase(announce) {
    const info = phaseInfo(this.state.blocksBroken);
    const changed = info.index !== this.phaseIdx || info.cycle !== this.cycle;
    this.phaseIdx = info.index; this.cycle = info.cycle;
    this.renderer.setPhaseAmbience(info.phase.key);
    if (announce && changed) {
      const first = info.index === 0;
      this.ui.banner(first ? `Cycle ${info.cycle}` : info.phase.name, first ? 'The One Block begins anew — Plains' : `Phase ${info.index + 1}`);
      this.sound.play('phase');
    }
  }

  onOneBroken() {
    this.state.blocksBroken++;
    const next = rollNext(this.state.blocksBroken, this.state.forced);
    this.regen = { t: 0.25, next };
    this.syncPhase(true);
  }

  /** While the One Block is regenerating, anything standing on it hovers instead of dropping through. */
  holdAboveOneBlock() {
    const over = (e) => this.regen && Math.abs(e.x - 0.5) < 0.5 + e.hw && Math.abs(e.z - 0.5) < 0.5 + e.hw && e.y > 0.9 && e.y < 1.2;
    this.player.hover = !!over(this.player);
    for (const m of this.mobs.list) m.hover = !!over(m);
  }

  placeOneBlock(next) {
    const w = this.world;
    // never materialise inside someone: lift them onto the new block
    const lift = (e) => { if (overlapsCell(e, 0, 0, 0)) { e.y = 1.001; e.vy = 0; } };
    lift(this.player); for (const m of this.mobs.list) lift(m);
    const idx = phaseIndexFor(this.state.blocksBroken);
    if (!next) next = rollNext(this.state.blocksBroken, this.state.forced);
    const id = ID(next.block);
    this.entities.delete(keyOf(0, 0, 0));
    w.setBlock(0, 0, 0, id);
    if (next.chest) this.entities.set(keyOf(0, 0, 0), newChest(rollLoot(idx)));
    this.renderer.spawnParticles('sparkle', 0.5, 1.0, 0.5);
    if (next.mob) this.mobs.spawn(next.mob, 0.5, 1.05, 0.5);
    this.regen = null;
  }

  // ------------------------------------------------------------------ main loop
  frame(now) {
    if (!this.running) return;
    requestAnimationFrame((t) => this.frame(t));
    let dt = (now - this.last) / 1000; this.last = now;
    if (!(dt > 0)) dt = 0.016;
    dt = Math.min(dt, 0.05);
    try {
      if (this.mode === 'title') this.updateTitle(dt);
      else this.updatePlay(dt);
    } catch (e) { console.error(e); }
    this.renderer.render(dt);
  }

  updateTitle(dt) {
    this.titleT += dt;
    this.state.time = (this.state.time + dt * 1.5) % DAY_LEN;
    // keep the title in bright daylight
    if (!(this.state.time < 280)) this.state.time = 20;
    this.renderer.setTimeOfDay(this.renderTime());
    const a = this.titleT * 0.12;
    const cam = this.renderer.camera;
    cam.position.set(0.5 + Math.cos(a) * 7.5, 3.6 + Math.sin(this.titleT * 0.3) * 0.4, 0.5 + Math.sin(a) * 7.5);
    cam.lookAt(0.5, 0.7, 0.5);
    if (innerWidth >= 900) cam.translateX(-2.6); // island sits right of the title menu
    this.mobs.update(dt);
    this.drops.update(dt);
  }

  updatePlay(dt) {
    const p = this.player, inp = this.input, ui = this.ui;
    const frozen = ui.pausesGame;
    if (!frozen) {
      this.state.time = (this.state.time + dt) % DAY_LEN;
      const active = inp.locked && !ui.current && !this.sleeping && !p.dead;
      if (this.sleeping > 0) this.sleeping -= dt;
      p.update(dt, active ? inp.moveInput() : { f: 0, r: 0, jump: false, sneak: false, sprint: false }, this.world, this.pev);
      if (active) this.updateInteraction(dt);
      else { this.renderer.setHighlight(null); this.renderer.setBreakProgress(null, 0); this.mining = null; this.eatT = 0; }
      this.updateWorld(dt);
    }
    this.syncCamera(dt);
    ui.update(dt);
  }

  updateWorld(dt) {
    const w = this.world;
    this.mineCd = Math.max(0, this.mineCd - dt); this.placeCd = Math.max(0, this.placeCd - dt);
    // One Block regen
    if (this.regen) { this.regen.t -= dt; if (this.regen.t <= 0) this.placeOneBlock(this.regen.next); }
    else if (w.getBlock(0, 0, 0) === 0) this.placeOneBlock(null);
    this.holdAboveOneBlock();
    this.mobs.update(dt);
    this.drops.update(dt);
    this.growth.update(dt);
    this.goals.poll(dt);
    // furnaces tick whether or not their UI is open
    for (const [k, e] of this.entities) {
      if (e.type !== 'furnace') continue;
      const changed = tickFurnace(e, dt);
      if (changed) {
        const [x, y, z] = k.split(',').map(Number);
        const cur = w.getBlock(x, y, z);
        if (cur === this.FURNACE || cur === this.LIT) w.setBlock(x, y, z, e.burn > 0 ? this.LIT : this.FURNACE);
      }
    }
    this.furnaceSnd -= dt;
    if (this.furnaceSnd <= 0) {
      this.furnaceSnd = 2.2 + Math.random();
      for (const [k, e] of this.entities) {
        if (e.type !== 'furnace' || e.burn <= 0) continue;
        const [x, y, z] = k.split(',').map(Number), p = this.player;
        const d = Math.hypot(x - p.x, y - p.y, z - p.z);
        if (d < 7) { this.sound.play('furnace', { vol: 1 - d / 7 }); this.renderer.spawnParticles('smoke', x + 0.5, y + 1.05, z + 0.5); break; }
      }
    }
    // underwater + time of day
    this.renderer.setUnderwater(this.player.headUnder);
    this.renderer.setTimeOfDay(this.renderTime());
    this.autosaveT += dt;
    if (this.autosaveT >= 30) { this.autosaveT = 0; this.save(); }
  }

  syncCamera(dt) {
    const p = this.player, cam = this.renderer.camera;
    const e = p.eye;
    cam.rotation.order = 'YXZ';
    cam.position.set(e.x, e.y, e.z);
    cam.rotation.set(p.pitch, p.yaw, 0);
    const targetFov = this.settings.fov + (p.sprinting ? 9 : 0);
    this.fovCur += (targetFov - this.fovCur) * Math.min(1, dt * 8);
    if (Math.abs(cam.fov - this.fovCur) > 0.05) { cam.fov = this.fovCur; cam.updateProjectionMatrix(); }
    // held item
    const s = this.inv.slots[this.sel];
    const key = s ? s.key : null;
    if (key !== this.lastHeld) { this.lastHeld = key; this.renderer.setHeldItem(key); }
  }

  // ------------------------------------------------------------------ interaction
  get held() { return this.inv.slots[this.sel]; }
  selectSlot(i) { this.sel = i; this.eatT = 0; this.ui.dirtyInv(); }

  updateInteraction(dt) {
    const p = this.player, inp = this.input, w = this.world, r = this.renderer;
    const origin = p.eye, dir = p.forward;
    const hit = w.raycast(origin, dir, REACH);
    const mh = this.mobs.raycast(origin, dir, Math.min(hit ? hit.dist : REACH, 4));
    this.targetBlock = hit; this.targetMob = mh ? mh.mob : null;
    r.setHighlight(hit && !mh ? hit : null);
    const held = this.held, heldKey = held ? held.key : null, heldDef = heldKey ? ITEMS[heldKey] : null;

    // ---- LMB: attack / mine
    if (inp.lmb && mh) {
      this.mining = null; r.setBreakProgress(null, 0);
      if (p.attackCd <= 0) this.attack(mh.mob, heldDef);
    } else if (inp.lmb && hit) {
      this.mineBlock(dt, hit, heldKey);
    } else {
      if (this.mining) { this.mining = null; r.setBreakProgress(null, 0); }
      if (inp.lmbEdge) { r.swingHand(); this.sound.play('whoosh', { vol: 0.5 }); p.attackCd = Math.max(p.attackCd, 0.25); }
    }
    inp.lmbEdge = false;

    // ---- RMB: use / place / eat
    const edge = inp.rmbEdge; inp.rmbEdge = false;
    let ate = false;
    if (inp.rmb && heldDef && heldDef.food && !(hit && this.isUsable(hit.id) && !p.sneaking) && !(mh && mh.mob.kind === 'sheep' && false)) {
      if (p.hunger < 20 || heldDef.food.poisonChance) {
        ate = true;
        this.eatT += dt; this.eatSndT -= dt;
        if (this.eatSndT <= 0) { this.eatSndT = 0.3; this.sound.play('eat', { vol: 0.5, minGap: 200 }); }
        if (this.eatT >= 1.6) {
          this.eatT = 0;
          p.eat(heldDef.food);
          this.consumeHeld(1);
          this.events.emit('eat', heldKey);
        }
      }
    }
    if (!ate) this.eatT = 0;
    if (!ate && inp.rmb && (edge || this.placeCd <= 0)) {
      if (this.useItem(hit, mh ? mh.mob : null, heldKey, edge)) { this.placeCd = 0.22; r.swingHand(); }
    }
  }

  isUsable(id) { return id === this.TABLE || id === this.FURNACE || id === this.LIT || id === this.CHEST || id === this.BED; }

  mineBlock(dt, hit, heldKey) {
    const r = this.renderer;
    const info = breakInfo(hit.id, heldKey);
    if (info.time === Infinity) { this.mining = null; r.setBreakProgress(null, 0); return; }
    if (!this.mining || this.mining.x !== hit.x || this.mining.y !== hit.y || this.mining.z !== hit.z || this.mining.id !== hit.id) {
      this.mining = { x: hit.x, y: hit.y, z: hit.z, id: hit.id, p: 0 };
    }
    if (this.mineCd > 0) return;
    const m = this.mining;
    this.swingT -= dt; this.digT -= dt;
    if (this.swingT <= 0) { this.swingT = 0.28; r.swingHand(); }
    if (this.digT <= 0 && info.time > 0) {
      this.digT = 0.2;
      this.sound.play('dig_' + materialOf(BLOCKS[hit.id].key), { vol: 0.8 });
      if (Math.random() < 0.6) r.spawnParticles('poof', hit.x + 0.5 + hit.normal.x * 0.5, hit.y + 0.5 + hit.normal.y * 0.5, hit.z + 0.5 + hit.normal.z * 0.5);
    }
    m.p += info.time <= 0 ? 1 : dt / info.time;
    r.setBreakProgress({ x: m.x, y: m.y, z: m.z }, Math.min(1, m.p));
    if (m.p >= 1) {
      this.breakBlock(m.x, m.y, m.z, true);
      this.mining = null; r.setBreakProgress(null, 0);
      this.mineCd = 0.18;
    }
  }

  /** Break a block (player mining or support loss). */
  breakBlock(x, y, z, byPlayer) {
    const w = this.world, id = w.getBlock(x, y, z);
    const def = BLOCKS[id]; if (!def || id === 0 || def.hardness < 0) return;
    const held = byPlayer ? this.held : null;
    const info = byPlayer ? breakInfo(id, held ? held.key : null) : { canHarvest: true };
    const isOne = x === 0 && y === 0 && z === 0;
    const drops = rollDrops(id, info.canHarvest);
    const ek = keyOf(x, y, z), ent = this.entities.get(ek);
    if (ent) { for (const s of entityContents(ent)) drops.push({ key: s.key, n: s.n, dur: s.dur }); this.entities.delete(ek); if (this.ui.current && this.ui.entityKey === ek) this.ui.close(); }
    const toWater = id === ID('ice') && !isOne;
    w.setBlock(x, y, z, toWater ? this.WATER : 0);
    this.renderer.spawnBlockParticles(x, y, z, id);
    this.sound.play('break_' + materialOf(def.key), { vol: 1 });
    for (const d of drops) this.dropItem(d.key, d.n, x + 0.5, y + 0.5, z + 0.5, d.dur);
    if (byPlayer) {
      if (held && ITEMS[held.key].tool && def.hardness > 0) this.damageHeld(1);
      this.player.addExhaustion(0.005);
      this.events.emit('break', def.key);
    }
    if (toWater) this.sound.play('splash', { vol: 0.5 });
    if (isOne) this.onOneBroken();
  }

  damageHeld(n) {
    const s = this.held; if (!s || s.dur === undefined) return;
    s.dur -= n;
    if (s.dur <= 0) {
      const key = s.key;
      this.inv.slots[this.sel] = null;
      this.pev.breakItem(key);
      const p = this.player; this.renderer.spawnParticles('poof', p.x, p.y + 1.2, p.z);
    }
    this.ui.dirtyInv();
  }

  consumeHeld(n = 1) {
    const s = this.held; if (!s) return;
    s.n -= n; if (s.n <= 0) this.inv.slots[this.sel] = null;
    this.ui.dirtyInv();
  }

  dropItem(key, n, x, y, z, dur, vel) {
    return this.drops.spawn(key, n, x, y, z, vel, dur);
  }

  dropHeld(all) {
    const s = this.held; if (!s) return;
    const p = this.player, f = p.forward, e = p.eye;
    const n = all ? s.n : 1;
    const d = this.dropItem(s.key, n, e.x + f.x * 0.4, e.y - 0.3, e.z + f.z * 0.4, s.dur, { x: f.x * 4.5, y: 2 + f.y * 3, z: f.z * 4.5 });
    d.delay = 1.6;
    this.consumeHeld(n);
    this.sound.play('whoosh');
  }

  attack(mob, heldDef) {
    const p = this.player;
    let dmg = heldDef && heldDef.tool ? heldDef.tool.damage : 1;
    const crit = !p.onGround && p.vy < 0 && !p.inWater;
    if (crit) { dmg *= 1.5; this.renderer.spawnParticles('crit', mob.x, mob.y + mob.h * 0.7, mob.z); }
    p.attackCd = 0.5;
    p.addExhaustion(0.1);
    this.renderer.swingHand();
    mob.hit(dmg, p);
    if (heldDef && heldDef.tool) this.damageHeld(1);
  }

  /** Returns true if something happened. */
  useItem(hit, mob, heldKey, edge) {
    const p = this.player, w = this.world;
    const def = heldKey ? ITEMS[heldKey] : null;
    // shear sheep
    if (mob && mob.kind === 'sheep' && heldKey === 'shears' && edge) {
      if (mob.shear()) {
        this.dropItem('white_wool', 1 + Math.floor(Math.random() * 3), mob.x, mob.y + 0.8, mob.z);
        this.sound.play('dig_wool'); this.damageHeld(1); this.events.emit('shear', 'sheep');
        return true;
      }
    }
    // bucket / water bucket
    if (heldKey === 'bucket' && edge) {
      const wh = this.raycastWater(REACH);
      if (wh) {
        w.setBlock(wh.x, wh.y, wh.z, 0);
        this.sound.play('splash', { vol: 0.6 });
        this.consumeHeld(1);
        const left = this.inv.add('water_bucket', 1); if (left) this.dropItem('water_bucket', 1, p.x, p.y + 1, p.z);
        this.ui.dirtyInv();
        return true;
      }
    }
    if (hit) {
      if (this.isUsable(hit.id) && !(p.sneaking && def) && edge) return this.useBlock(hit);
      if (!def) return false;
      if (def.tool && def.tool.type === 'hoe' && edge) {
        if ((hit.id === this.GRASS || hit.id === this.DIRT) && hit.normal.y !== -1 && w.getBlock(hit.x, hit.y + 1, hit.z) === 0) {
          w.setBlock(hit.x, hit.y, hit.z, this.FARM);
          this.sound.play('dig_dirt'); this.damageHeld(1);
          return true;
        }
        return false;
      }
      if (heldKey === 'water_bucket' && edge) {
        const c = { x: hit.x + hit.normal.x, y: hit.y + hit.normal.y, z: hit.z + hit.normal.z };
        const at = w.getBlock(c.x, c.y, c.z);
        if ((at === 0 || at === this.WATER) && !(c.x === 0 && c.y === 0 && c.z === 0)) {
          w.setBlock(c.x, c.y, c.z, this.WATER);
          this.sound.play('splash', { vol: 0.7 });
          this.inv.slots[this.sel] = makeStack('bucket', 1);
          this.ui.dirtyInv();
          return true;
        }
        return false;
      }
      if (def.places) return this.placeBlock(hit, def);
    }
    return false;
  }

  raycastWater(maxDist) {
    const p = this.player, w = this.world, o = p.eye, d = p.forward;
    for (let t = 0; t < maxDist; t += 0.05) {
      const x = Math.floor(o.x + d.x * t), y = Math.floor(o.y + d.y * t), z = Math.floor(o.z + d.z * t);
      const id = w.getBlock(x, y, z);
      if (id === this.WATER) return { x, y, z };
      if (id !== 0 && BLOCKS[id] && BLOCKS[id].solid) return null;
    }
    return null;
  }

  useBlock(hit) {
    const key = keyOf(hit.x, hit.y, hit.z);
    if (hit.id === this.TABLE) { this.openInventory(true); return true; }
    if (hit.id === this.FURNACE || hit.id === this.LIT) {
      if (!this.entities.has(key)) this.entities.set(key, newFurnace());
      this.ui.open('furnace', { key }); return true;
    }
    if (hit.id === this.CHEST) {
      if (!this.entities.has(key)) this.entities.set(key, newChest());
      this.ui.open('chest', { key }); return true;
    }
    if (hit.id === this.BED) { this.useBed(hit); return true; }
    return false;
  }

  openInventory(table) { this.ui.open('inventory', { table }); }

  nearTable() {
    const p = this.player, w = this.world;
    const cx = Math.floor(p.x), cy = Math.floor(p.y + 0.9), cz = Math.floor(p.z);
    for (let dx = -4; dx <= 4; dx++) for (let dy = -4; dy <= 4; dy++) for (let dz = -4; dz <= 4; dz++) {
      if (w.getBlock(cx + dx, cy + dy, cz + dz) === this.TABLE) {
        const ex = cx + dx + 0.5 - p.x, ey = cy + dy + 0.5 - (p.y + 0.9), ez = cz + dz + 0.5 - p.z;
        if (ex * ex + ey * ey + ez * ez <= 16) return true;
      }
    }
    return false;
  }

  useBed(hit) {
    this.state.spawn = { x: hit.x, y: hit.y, z: hit.z };
    if (!this.isNight() && this.state.time < 350) { this.ui.message('You can only sleep at night — spawn point set'); this.sound.play('click'); return; }
    if (this.state.time >= 555) { this.ui.message('Spawn point set'); return; }
    for (const m of this.mobs.list) if (m.kind === 'zombie' && !m.dead && m.dist2(hit.x + 0.5, hit.y, hit.z + 0.5) < 64) { this.ui.message('You cannot sleep with monsters nearby'); return; }
    this.sleeping = 2.6;
    this.sound.play('sleep');
    this.ui.sleepFade(() => { this.state.time = 5; this.player.health = Math.min(20, this.player.health + 0); this.events.emit('sleep'); this.ui.message('Good morning — spawn point set'); this.save(); });
  }

  /** Place a block item against the targeted face. */
  placeBlock(hit, def) {
    const w = this.world, p = this.player;
    const bkey = def.places; const bdef = BLOCK_BY_KEY[bkey]; if (!bdef) return false;
    const n = hit.normal;
    const x = hit.x + n.x, y = hit.y + n.y, z = hit.z + n.z;
    const at = w.getBlock(x, y, z);
    if (at !== 0 && at !== this.WATER) return false;
    if (x === 0 && y === 0 && z === 0) return false;
    if (y < -32 || y > 95 || x < -64 || x > 63 || z < -64 || z > 63) return false;
    const hdef = BLOCKS[hit.id];
    if (bdef.solid && (overlapsCell(p, x, y, z) || this.mobs.overlapsCell(x, y, z))) return false;
    let place = bdef.id;
    if (bkey === 'wheat_0') { if (hit.id !== this.FARM || n.y !== 1 || at !== 0) return false; }
    else if (bdef.shape === 'cross') { // sapling
      if ((hit.id !== this.GRASS && hit.id !== this.DIRT && hit.id !== this.FARM) || n.y !== 1 || at !== 0) return false;
    } else if (bdef.shape === 'torch') {
      if (n.y < 0 || !hdef || !hdef.solid || hdef.shape === 'torch') return false;
    }
    if (!w.setBlock(x, y, z, place)) return false;
    if (bkey === 'chest') this.entities.set(keyOf(x, y, z), newChest());
    else if (bkey === 'furnace') this.entities.set(keyOf(x, y, z), newFurnace());
    this.sound.play('place', { vol: 0.9 });
    this.consumeHeld(1);
    return true;
  }

  // ------------------------------------------------------------------ world change hook (support rules, growth registry)
  onWorldChange(x, y, z, o, n) {
    this.growth.track(x, y, z, o, n);
    const nd = BLOCKS[n];
    if (n === 0 || (nd && !nd.solid)) {
      this.checkSupport(x, y + 1, z);
      this.checkSupport(x + 1, y, z); this.checkSupport(x - 1, y, z); this.checkSupport(x, y, z + 1); this.checkSupport(x, y, z - 1);
    }
    if (o === this.FARM && n === this.DIRT) this.checkSupport(x, y + 1, z);
  }

  checkSupport(x, y, z) {
    const w = this.world, id = w.getBlock(x, y, z);
    const def = BLOCKS[id]; if (!def || id === 0) return;
    let ok = true;
    if (def.shape === 'torch') ok = [[0, -1, 0], [1, 0, 0], [-1, 0, 0], [0, 0, 1], [0, 0, -1]].some(([a, b, c]) => w.isSolid(x + a, y + b, z + c));
    else if (def.shape === 'cross') {
      const below = w.getBlock(x, y - 1, z);
      ok = id === BLOCK_BY_KEY.oak_sapling.id ? (below === this.GRASS || below === this.DIRT || below === this.FARM) : below === this.FARM;
    }
    if (!ok) this.breakBlock(x, y, z, false);
  }

  // ------------------------------------------------------------------ player damage / death / respawn
  damagePlayer(amount, cause, mob) {
    this.player.hurt(amount, cause, { from: mob, inv: this.inv }, this.pev);
    this.ui.dirtyInv();
  }

  onDeath(cause) {
    const p = this.player;
    this.input.unlock();
    this.mining = null; this.renderer.setBreakProgress(null, 0); this.renderer.setHighlight(null);
    if (p.y > -40) {
      for (const s of this.inv.allStacks()) this.dropItem(s.key, s.n, p.x, p.y + 0.5, p.z, s.dur);
    }
    this.inv.clear();
    this.ui.dirtyInv();
    this.sound.play('hurt');
    this.ui.open('death', { cause });
    this.saveAfterDeath();
  }

  saveAfterDeath() {
    // save world state with an emptied inventory and a respawned player so reload does not resurrect the corpse
    const prevDead = this.player.dead;
    this.player.dead = false;
    const snap = this.snapshot();
    const sp = this.spawnPoint();
    snap.player = { x: sp.x, y: sp.y, z: sp.z, yaw: 0, pitch: 0, health: 20, hunger: 20, sat: 5 };
    try { writeSave(snap); } catch { /* ignore */ }
    this.player.dead = prevDead;
  }

  spawnPoint() {
    const s = this.state.spawn, w = this.world;
    if (s && w.getBlock(s.x, s.y, s.z) === this.BED) {
      let y = s.y + 0.5625 + 0.01;
      if (w.getCollisionBoxes(s.x + 0.2, y, s.z + 0.2, s.x + 0.8, y + 1.8, s.z + 0.8).length) y = s.y + 1.05;
      return { x: s.x + 0.5, y, z: s.z + 0.5 };
    }
    return { x: 0.5, y: 1, z: 0.5 };
  }

  respawn() {
    const sp = this.spawnPoint();
    this.player.reset(sp.x, sp.y, sp.z);
    if (this.world.getBlock(0, 0, 0) === 0 && !this.regen) this.placeOneBlock(null);
    this.ui.close(true);
    this.input.lock();
    this.ui.dirtyInv();
  }
}

