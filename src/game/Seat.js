// One player's slot: body, inventory, input source, view, HUD/windows, interaction state, tutorial.
// Everything per-player lives here; the Game owns the shared world. (SPEC-PLATFORMS §4)
import { BLOCKS, BLOCK_BY_KEY } from '../data/blocks.js';
import { ITEMS } from '../data/items.js';
import { Inventory, makeStack } from './Inventory.js';
import { Player } from './Player.js';
import { breakInfo, materialOf } from './rules.js';
import { overlapsCell } from './physics.js';
import { keyOf, newChest, newFurnace } from './BlockEntities.js';
import { SEATS } from '../platform.js';

const REACH = 5;
const ZERO = { f: 0, r: 0, jump: false, sneak: false, sprint: false };
const PLAY_ACTIONS = ['primary', 'secondary', 'jump', 'inventory', 'pause', 'drop', 'dropStack', 'hotbarNext', 'hotbarPrev', 'goals',
  'hotbar1', 'hotbar2', 'hotbar3', 'hotbar4', 'hotbar5', 'hotbar6', 'hotbar7', 'hotbar8', 'hotbar9'];

export class Seat {
  constructor(game, index) {
    this.game = game; this.index = index; this.info = SEATS[index]; this.name = SEATS[index].name;
    this.player = new Player(); this.inv = new Inventory(); this.sel = 0;
    this.active = false; this.disconnected = false;
    this.input = null; this.view = null; this.avatar = null; this.ui = null;
    this.spawn = null;      // bed position {x,y,z} or null
    this.inBed = null;      // {x,y,z} while sleeping
    this.lastGood = null;   // last good serialized state (void-fall protection for saves)
    this.mining = null; this.mineCd = 0; this.swingT = 0; this.digT = 0; this.placeCd = 0; this.eatT = 0; this.eatSndT = 0;
    this.lastHeld = undefined; this.fovCur = game.settings.fov; this.swinging = 0; this.hurtT = 0;
    this.targetBlock = null; this.targetMob = null;
    this.tut = { sneakShown: false, sneakT: 0, t: 0 };
    this.mode = null; this.guard = 0; this.hasData = false; this.padId = null;

    this.pev = {
      land: (fd) => game.sound.play('land', { vol: Math.min(1.3, 0.4 + fd * 0.12) }),
      splash: () => { game.sound.play('splash'); const p = this.player; game.renderer.spawnParticles('poof', p.x, p.y + 0.2, p.z); },
      step: () => {
        const p = this.player;
        const id = game.world.getBlock(p.x, p.y - 0.2, p.z);
        game.sound.play('step_' + materialOf(BLOCKS[id] ? BLOCKS[id].key : 'stone'), { vol: p.sneaking ? 0.4 : 1 });
      },
      hurt: () => { game.sound.play('hurt'); this.hurtT = 0.4; if (this.view && this.view.setDamageFlash) this.view.setDamageFlash(); this.ui.damage(); if (this.input && this.input.rumble) this.input.rumble(0.6, 200); },
      die: (cause) => this.onDeath(cause),
      breakItem: (key) => { game.sound.play('tool_break'); this.ui.message(`${ITEMS[key].name} broke!`); },
    };
  }

  get held() { return this.inv.slots[this.sel]; }
  get glyph() { return (a) => (this.input && this.input.glyph ? this.input.glyph(a) : a); }

  // ------------------------------------------------------------------ per-frame
  setMode(mode) { if (this.mode !== mode && this.input) { this.mode = mode; this.input.setMode(mode); } }

  update(dt) {
    const g = this.game, p = this.player, src = this.input, ui = this.ui;
    if (!src) return;
    if (g.ui.pausesGame) { this.setMode('menu'); return; } // another seat just opened the global pause menu this frame
    const menu = !!ui.current;
    this.setMode(menu ? 'menu' : 'play');
    this.mineCd = Math.max(0, this.mineCd - dt); this.placeCd = Math.max(0, this.placeCd - dt);
    this.hurtT = Math.max(0, this.hurtT - dt); this.swinging = Math.max(0, this.swinging - dt);

    if (this.disconnected || p.dead) {
      if (menu) ui.nav(src);
      p.update(dt, ZERO, g.world, this.pev);
      this.clearTarget();
      return;
    }
    // edges are consumed on read: always read them so stale presses never fire later
    const pr = {};
    if (!menu) for (const a of PLAY_ACTIONS) pr[a] = src.pressed(a);
    else ui.nav(src);
    if (this.guard > 0) { this.guard--; for (const k in pr) pr[k] = false; } // swallow the keypress that just closed a window
    const canPlay = g.canPlay(this);
    const play = canPlay && !menu && g.sleepT <= 0;

    if (play) {
      if (this.inBed && (pr.jump || pr.primary || pr.secondary)) this.inBed = null;
      if (pr.pause) { g.openPause(this); }
      else if (pr.inventory) { ui.open('inventory', { table: false }); }
      else if (pr.goals) ui.open('goals');
      if (pr.drop) this.dropHeld(false);
      if (pr.dropStack) this.dropHeld(true);
      if (pr.hotbarNext) this.selectSlot((this.sel + 1) % 9);
      if (pr.hotbarPrev) this.selectSlot((this.sel + 8) % 9);
      for (let i = 1; i <= 9; i++) if (pr['hotbar' + i]) this.selectSlot(i - 1);
    }
    const look = src.look();
    if (play && !this.inBed) {
      p.yaw += look.dyaw;
      p.pitch = Math.max(-Math.PI / 2 + 0.01, Math.min(Math.PI / 2 - 0.01, p.pitch + look.dpitch));
    }
    const mv = play && !this.inBed ? src.move() : ZERO;
    p.update(dt, mv, g.world, this.pev);
    if (play && !this.inBed) this.updateInteraction(dt, pr);
    else { this.clearTarget(); this.eatT = 0; }
  }

  /** Consume every pending edge (used while another seat's pause menu owns the screen). */
  drain() {
    const src = this.input; if (!src) return;
    for (const a of PLAY_ACTIONS) src.pressed(a);
    for (const a of ['ui_up', 'ui_down', 'ui_left', 'ui_right', 'ui_accept', 'ui_back', 'ui_alt', 'ui_split', 'ui_tabNext', 'ui_tabPrev']) src.pressed(a);
    src.look();
  }

  clearTarget() {
    if (this.view) { this.view.setHighlight(null); this.view.setBreakProgress(null, 0); }
    this.mining = null; this.targetBlock = null; this.targetMob = null;
  }

  selectSlot(i) { this.sel = i; this.eatT = 0; this.ui.dirtyInv(); }

  // ------------------------------------------------------------------ interaction
  updateInteraction(dt, pr) {
    const g = this.game, p = this.player, src = this.input, w = g.world, v = this.view;
    const origin = p.eye, dir = p.forward;
    const hit = w.raycast(origin, dir, REACH);
    const mh = g.mobs.raycast(origin, dir, Math.min(hit ? hit.dist : REACH, 4));
    this.targetBlock = hit; this.targetMob = mh ? mh.mob : null;
    v.setHighlight(hit && !mh ? hit : null);
    const held = this.held, heldKey = held ? held.key : null, heldDef = heldKey ? ITEMS[heldKey] : null;
    const primary = src.down('primary'), secondary = src.down('secondary');

    // ---- primary: attack / mine
    if (primary && mh) {
      this.mining = null; v.setBreakProgress(null, 0);
      if (p.attackCd <= 0) this.attack(mh.mob, heldDef);
    } else if (primary && hit) {
      this.mineBlock(dt, hit, heldKey);
    } else {
      if (this.mining) { this.mining = null; v.setBreakProgress(null, 0); }
      if (pr.primary) { this.swing(); g.sound.play('whoosh', { vol: 0.5 }); p.attackCd = Math.max(p.attackCd, 0.25); }
    }

    // ---- secondary: use / place / eat
    const edge = !!pr.secondary;
    let ate = false;
    if (secondary && heldDef && heldDef.food && !(hit && this.isUsable(hit.id) && !p.sneaking)) {
      if (p.hunger < 20 || heldDef.food.poisonChance) {
        ate = true;
        this.eatT += dt; this.eatSndT -= dt;
        if (this.eatSndT <= 0) { this.eatSndT = 0.3; g.sound.play('eat', { vol: 0.5, minGap: 200 }); }
        if (this.eatT >= 1.6) {
          this.eatT = 0;
          p.eat(heldDef.food);
          this.consumeHeld(1);
          g.events.emit('eat', heldKey);
        }
      }
    }
    if (!ate) this.eatT = 0;
    if (!ate && secondary && (edge || this.placeCd <= 0)) {
      if (this.useItem(hit, mh ? mh.mob : null, heldKey, edge)) { this.placeCd = 0.22; this.swing(); }
    }
  }

  swing() { this.swinging = 0.3; if (this.view) this.view.swingHand(); }

  isUsable(id) { const g = this.game; return id === g.TABLE || id === g.FURNACE || id === g.LIT || id === g.CHEST || id === g.BED; }

  mineBlock(dt, hit, heldKey) {
    const g = this.game, v = this.view;
    const info = breakInfo(hit.id, heldKey);
    if (info.time === Infinity) { this.mining = null; v.setBreakProgress(null, 0); return; }
    if (!this.mining || this.mining.x !== hit.x || this.mining.y !== hit.y || this.mining.z !== hit.z || this.mining.id !== hit.id) {
      this.mining = { x: hit.x, y: hit.y, z: hit.z, id: hit.id, p: 0 };
    }
    if (this.mineCd > 0) return;
    const m = this.mining;
    this.swingT -= dt; this.digT -= dt;
    if (this.swingT <= 0) { this.swingT = 0.28; this.swing(); }
    if (this.digT <= 0 && info.time > 0) {
      this.digT = 0.2;
      g.sound.play('dig_' + materialOf(BLOCKS[hit.id].key), { vol: 0.8 });
      if (Math.random() < 0.6) g.renderer.spawnParticles('poof', hit.x + 0.5 + hit.normal.x * 0.5, hit.y + 0.5 + hit.normal.y * 0.5, hit.z + 0.5 + hit.normal.z * 0.5);
      if (this.input.rumble) this.input.rumble(0.15, 60);
    }
    m.p += info.time <= 0 ? 1 : dt / info.time;
    v.setBreakProgress({ x: m.x, y: m.y, z: m.z }, Math.min(1, m.p));
    if (m.p >= 1) {
      g.breakBlock(m.x, m.y, m.z, this);
      this.mining = null; v.setBreakProgress(null, 0);
      this.mineCd = 0.18;
    }
  }

  damageHeld(n) {
    const s = this.held; if (!s || s.dur === undefined) return;
    s.dur -= n;
    if (s.dur <= 0) {
      const key = s.key;
      this.inv.slots[this.sel] = null;
      this.pev.breakItem(key);
      const p = this.player; this.game.renderer.spawnParticles('poof', p.x, p.y + 1.2, p.z);
    }
    this.ui.dirtyInv();
  }

  consumeHeld(n = 1) {
    const s = this.held; if (!s) return;
    s.n -= n; if (s.n <= 0) this.inv.slots[this.sel] = null;
    this.ui.dirtyInv();
  }

  dropHeld(all) {
    const s = this.held; if (!s) return;
    const p = this.player, f = p.forward, e = p.eye;
    const n = all ? s.n : 1;
    const d = this.game.dropItem(s.key, n, e.x + f.x * 0.4, e.y - 0.3, e.z + f.z * 0.4, s.dur, { x: f.x * 4.5, y: 2 + f.y * 3, z: f.z * 4.5 });
    d.delay = 1.6;
    this.consumeHeld(n);
    this.game.sound.play('whoosh');
  }

  attack(mob, heldDef) {
    const p = this.player;
    let dmg = heldDef && heldDef.tool ? heldDef.tool.damage : 1;
    const crit = !p.onGround && p.vy < 0 && !p.inWater;
    if (crit) { dmg *= 1.5; this.game.renderer.spawnParticles('crit', mob.x, mob.y + mob.h * 0.7, mob.z); }
    p.attackCd = 0.5;
    p.addExhaustion(0.1);
    this.swing();
    mob.hit(dmg, p);
    if (this.input.rumble) this.input.rumble(0.3, 80);
    if (heldDef && heldDef.tool) this.damageHeld(1);
  }

  /** Returns true if something happened. */
  useItem(hit, mob, heldKey, edge) {
    const g = this.game, p = this.player, w = g.world;
    const def = heldKey ? ITEMS[heldKey] : null;
    if (mob && mob.kind === 'sheep' && heldKey === 'shears' && edge) {
      if (mob.shear()) {
        g.dropItem('white_wool', 1 + Math.floor(Math.random() * 3), mob.x, mob.y + 0.8, mob.z);
        g.sound.play('dig_wool'); this.damageHeld(1); g.events.emit('shear', 'sheep');
        return true;
      }
    }
    if (heldKey === 'bucket' && edge) {
      const wh = this.raycastWater(REACH);
      if (wh) {
        w.setBlock(wh.x, wh.y, wh.z, 0);
        g.sound.play('splash', { vol: 0.6 });
        this.consumeHeld(1);
        const left = this.inv.add('water_bucket', 1); if (left) g.dropItem('water_bucket', 1, p.x, p.y + 1, p.z);
        this.ui.dirtyInv();
        return true;
      }
    }
    if (hit) {
      if (this.isUsable(hit.id) && !(p.sneaking && def) && edge) return this.useBlock(hit);
      if (!def) return false;
      if (def.tool && def.tool.type === 'hoe' && edge) {
        if ((hit.id === g.GRASS || hit.id === g.DIRT) && hit.normal.y !== -1 && w.getBlock(hit.x, hit.y + 1, hit.z) === 0) {
          w.setBlock(hit.x, hit.y, hit.z, g.FARM);
          g.sound.play('dig_dirt'); this.damageHeld(1);
          return true;
        }
        return false;
      }
      if (heldKey === 'water_bucket' && edge) {
        const c = { x: hit.x + hit.normal.x, y: hit.y + hit.normal.y, z: hit.z + hit.normal.z };
        const at = w.getBlock(c.x, c.y, c.z);
        if ((at === 0 || at === g.WATER) && !(c.x === 0 && c.y === 0 && c.z === 0)) {
          w.setBlock(c.x, c.y, c.z, g.WATER);
          g.sound.play('splash', { vol: 0.7 });
          this.inv.slots[this.sel] = makeStack('bucket', 1);
          this.ui.dirtyInv();
          return true;
        }
        return false;
      }
      if (def.places) return this.placeBlock(hit, def);
    } else if (def && def.kind === 'block' && edge && p.onGround && p.pitch < 0.25) {
      // shallow pitch / nothing targeted: bridge from the block under our feet (smart placement picks the facing side)
      const bx = Math.floor(p.x), by = Math.floor(p.y - 0.1), bz = Math.floor(p.z);
      if (w.isSolid(bx, by, bz)) return this.placeBlock({ x: bx, y: by, z: bz, id: w.getBlock(bx, by, bz), normal: { x: 0, y: 1, z: 0 } }, def);
    }
    return false;
  }

  raycastWater(maxDist) {
    const g = this.game, p = this.player, w = g.world, o = p.eye, d = p.forward;
    for (let t = 0; t < maxDist; t += 0.05) {
      const x = Math.floor(o.x + d.x * t), y = Math.floor(o.y + d.y * t), z = Math.floor(o.z + d.z * t);
      const id = w.getBlock(x, y, z);
      if (id === g.WATER) return { x, y, z };
      if (id !== 0 && BLOCKS[id] && BLOCKS[id].solid) return null;
    }
    return null;
  }

  useBlock(hit) {
    const g = this.game, key = keyOf(hit.x, hit.y, hit.z);
    if (hit.id === g.TABLE) { this.ui.open('inventory', { table: true }); return true; }
    if (hit.id === g.FURNACE || hit.id === g.LIT) {
      if (!g.entities.has(key)) g.entities.set(key, newFurnace());
      this.ui.open('furnace', { key }); return true;
    }
    if (hit.id === g.CHEST) {
      if (!g.entities.has(key)) g.entities.set(key, newChest());
      this.ui.open('chest', { key }); return true;
    }
    if (hit.id === g.BED) { this.useBed(hit); return true; }
    return false;
  }

  nearTable() {
    const g = this.game, p = this.player, w = g.world;
    const cx = Math.floor(p.x), cy = Math.floor(p.y + 0.9), cz = Math.floor(p.z);
    for (let dx = -4; dx <= 4; dx++) for (let dy = -4; dy <= 4; dy++) for (let dz = -4; dz <= 4; dz++) {
      if (w.getBlock(cx + dx, cy + dy, cz + dz) === g.TABLE) {
        const ex = cx + dx + 0.5 - p.x, ey = cy + dy + 0.5 - (p.y + 0.9), ez = cz + dz + 0.5 - p.z;
        if (ex * ex + ey * ey + ez * ez <= 16) return true;
      }
    }
    return false;
  }

  useBed(hit) {
    const g = this.game, t = g.state.time;
    this.spawn = { x: hit.x, y: hit.y, z: hit.z };
    if (!g.isNight() && t < 350) { this.ui.message('You can only sleep at night — spawn point set'); g.sound.play('click'); return; }
    if (t >= 555) { this.ui.message('Spawn point set'); return; }
    for (const m of g.mobs.list) if (m.kind === 'zombie' && !m.dead && m.dist2(hit.x + 0.5, hit.y, hit.z + 0.5) < 64) { this.ui.message('You cannot sleep with monsters nearby'); return; }
    this.inBed = { x: hit.x, y: hit.y, z: hit.z };
    g.checkSleep(this);
  }

  /** Place a block item against the targeted face (with smart placement on tiny islands). */
  placeBlock(hit, def) {
    const g = this.game, w = g.world, p = this.player;
    const bkey = def.places; const bdef = BLOCK_BY_KEY[bkey]; if (!bdef) return false;
    const n = hit.normal;
    let x = hit.x + n.x, y = hit.y + n.y, z = hit.z + n.z;
    let at = w.getBlock(x, y, z);
    const blocked = (cx, cy, cz) => g.anySeatOverlaps(cx, cy, cz) || g.mobs.overlapsCell(cx, cy, cz);
    if (bdef.solid && n.y === 1 && blocked(x, y, z)) {
      const f = p.forward, ax = Math.abs(f.x) >= Math.abs(f.z);
      const sx = ax ? (Math.sign(f.x) || 1) : 0, sz = ax ? 0 : (Math.sign(f.z) || -1);
      const nx = hit.x + sx, nz = hit.z + sz, ny = hit.y, nat = w.getBlock(nx, ny, nz);
      if ((nat === 0 || nat === g.WATER) && !(nx === 0 && ny === 0 && nz === 0) && !blocked(nx, ny, nz)) { x = nx; y = ny; z = nz; at = nat; }
    }
    if (at !== 0 && at !== g.WATER) return false;
    if (x === 0 && y === 0 && z === 0) return false;
    if (y < -32 || y > 95 || x < -64 || x > 63 || z < -64 || z > 63) return false;
    const hdef = BLOCKS[hit.id];
    if (bdef.solid && blocked(x, y, z)) return false;
    if (bkey === 'wheat_0') { if (hit.id !== g.FARM || n.y !== 1 || at !== 0) return false; }
    else if (bdef.shape === 'cross') {
      if ((hit.id !== g.GRASS && hit.id !== g.DIRT && hit.id !== g.FARM) || n.y !== 1 || at !== 0) return false;
    } else if (bdef.shape === 'torch') {
      if (n.y < 0 || !hdef || !hdef.solid || hdef.shape === 'torch') return false;
    }
    if (!w.setBlock(x, y, z, bdef.id)) return false;
    if (bkey === 'chest') g.entities.set(keyOf(x, y, z), newChest());
    else if (bkey === 'furnace') g.entities.set(keyOf(x, y, z), newFurnace());
    g.sound.play('place', { vol: 0.9 });
    this.consumeHeld(1);
    return true;
  }

  // ------------------------------------------------------------------ damage / death / respawn
  damage(amount, cause, mob) {
    if (this.inBed) this.inBed = null;
    this.player.hurt(amount, cause, { from: mob, inv: this.inv }, this.pev);
    this.ui.dirtyInv();
  }

  spawnPoint() {
    const g = this.game, s = this.spawn, w = g.world;
    if (s && w.getBlock(s.x, s.y, s.z) === g.BED) {
      let y = s.y + 0.5625 + 0.01;
      if (w.getCollisionBoxes(s.x + 0.2, y, s.z + 0.2, s.x + 0.8, y + 1.8, s.z + 0.8).length) y = s.y + 1.05;
      return { x: s.x + 0.5, y, z: s.z + 0.5 };
    }
    return g.worldSpawn(this.index);
  }

  onDeath(cause) {
    const g = this.game, p = this.player;
    this.inBed = null;
    this.clearTarget();
    if (p.y > -40) for (const s of this.inv.allStacks()) g.dropItem(s.key, s.n, p.x, p.y + 0.5, p.z, s.dur);
    this.inv.clear();
    this.ui.dirtyInv();
    g.sound.play('hurt');
    if (this.input && this.input.rumble) this.input.rumble(1, 400);
    this.ui.open('death', { cause });
    g.events.emit('death', this.index);
    g.saveAfterDeath();
    g.checkSleep(null);
  }

  respawn() {
    const g = this.game;
    const sp = this.spawnPoint();
    this.player.reset(sp.x, sp.y, sp.z);
    if (g.world.getBlock(0, 0, 0) === 0 && !g.regen) g.placeOneBlock(null);
    this.ui.close(true);
    g.afterSeatUiClose(this);
    this.ui.dirtyInv();
  }

  // ------------------------------------------------------------------ camera / avatar
  syncCamera(dt) {
    const g = this.game, p = this.player, v = this.view; if (!v) return;
    const cam = v.camera, e = p.eye;
    cam.rotation.order = 'YXZ';
    cam.position.set(e.x, e.y, e.z);
    cam.rotation.set(p.pitch, p.yaw, 0);
    const target = g.settings.fov + (p.sprinting ? 9 : 0);
    this.fovCur += (target - this.fovCur) * Math.min(1, dt * 8);
    if (Math.abs(cam.fov - this.fovCur) > 0.05) { if (v.setFov) v.setFov(this.fovCur); else { cam.fov = this.fovCur; cam.updateProjectionMatrix(); } }
    const s = this.inv.slots[this.sel], key = s ? s.key : null;
    if (key !== this.lastHeld) { this.lastHeld = key; v.setHeldItem(key); }
    if (this.avatar) {
      const moving = Math.hypot(p.vx, p.vz) > 0.3 && p.onGround;
      this.avatar.update(dt, { x: p.x, y: p.y, z: p.z, yaw: p.yaw, pitch: p.pitch, moving, sneaking: p.sneaking,
        swinging: this.swinging > 0, heldItemKey: key, hurt: this.hurtT > 0, dead: p.dead });
    }
    v.setUnderwater(!!p.headUnder);
  }

  // ------------------------------------------------------------------ tutorial (per seat; goals are team-wide)
  sneakGlyph() {
    const k = this.input && this.input.kind;
    return k === 'gamepad' ? 'R-Stick click' : k === 'touch' ? 'the Sneak button' : 'Shift';
  }

  hintText() {
    const g = this.game, inv = this.inv, gd = g.goals.done, p = this.player;
    const touch = this.input && this.input.kind === 'touch';
    const press = touch ? 'Tap' : 'Press';
    const gl = (a) => String(this.glyph(a)).replace(/^Hold /, '').replace(/^Tap /, '').replace(/^LMB$/, 'Left-Click').replace(/^RMB$/, 'Right-Click');
    const hasTable = inv.count('crafting_table') > 0;
    const planks = inv.count('oak_planks') + inv.count('spruce_planks');
    const logs = inv.count('oak_log') + inv.count('spruce_log');
    if (hasTable) return `Place the crafting table (${gl('secondary')})`;
    if (!gd.table) {
      if (planks + logs === 0) return `Hold ${gl('primary')} to break the block`;
      if (planks >= 4) return `${press} ${gl('inventory')} and craft a Crafting Table from planks`;
      return `${press} ${gl('inventory')} to open your inventory and craft planks`;
    }
    if (!gd.wpick && !inv.count('wooden_pickaxe')) return `Stand near the table, ${press.toLowerCase()} ${gl('inventory')} and craft a Wooden Pickaxe`;
    if (!this.tut.sneakShown) {
      if (p.sneaking) this.tut.sneakShown = true;
      else { this.tut.sneakT += 0.3; if (this.tut.sneakT > 12) this.tut.sneakShown = true; return touch ? 'Tap Sneak to crouch – it stops you falling off!' : `Hold ${this.sneakGlyph()} to sneak – it stops you falling off!`; }
    }
    if (g.goalHintT > 0) { const goal = g.goals.next(); if (goal) return `Goal: ${goal.desc}`; }
    return '';
  }

  updateTutorial(dt) {
    this.tut.t -= dt; if (this.tut.t > 0) return; this.tut.t = 0.3;
    this.ui.setHint(this.ui.current || this.player.dead ? '' : this.hintText());
  }

  // ------------------------------------------------------------------ persistence
  serialize() {
    return { player: this.player.serialize(), inv: this.inv.serialize(), sel: this.sel, spawn: this.spawn, pad: this.padId || null };
  }
  deserialize(d) {
    if (!d) return;
    this.inv.deserialize(d.inv);
    this.player.deserialize(d.player);
    this.sel = d.sel || 0; this.spawn = d.spawn || null; this.inBed = null; this.padId = d.pad || null;
    this.lastGood = null;
  }
}
