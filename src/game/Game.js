// Game orchestrator: shared world, seats (1..4 players), One Block, time, save/load. (SPEC §5-§13, SPEC-PLATFORMS §4)
import { World } from '../world/World.js';
import { Renderer } from '../render/Renderer.js';
import { InputHub } from '../input/InputHub.js';
import { Sound } from '../audio/Sound.js';
import { BLOCKS, BLOCK_BY_KEY } from '../data/blocks.js';
import { ITEMS } from '../data/items.js';
import { phaseIndexFor, phaseInfo, makeForcedPlan, rollNext, rollLoot } from '../data/phases.js';
import { Events } from './Events.js';
import { Drops } from './Drops.js';
import { Growth } from './Growth.js';
import { Goals } from './Goals.js';
import { Seat } from './Seat.js';
import { MobManager } from './mobs/MobManager.js';
import { rollDrops, breakInfo, materialOf } from './rules.js';
import { overlapsCell } from './physics.js';
import { countSurface, planPhaseSpawn } from './spawning.js';
import { nearestSeat, sleepStatus, livingSeats, seatSaveData, joinOptions } from './team.js';
import { readUi } from '../ui/focus.js';
import { keyOf, newChest, tickFurnace, entityContents, serializeEntities, deserializeEntities } from './BlockEntities.js';
import { loadSettings, saveSettings, readSave, writeSave, clearSave } from './Save.js';
import { currentPlatform, SEATS } from '../platform.js';
import { UI } from '../ui/UI.js';

const ID = (k) => BLOCK_BY_KEY[k].id;
const DAY_LEN = 600;
const SPAWN_OFFS = [[0.5, 0.5], [0.3, 0.5], [0.7, 0.5], [0.5, 0.3]];

/** Adapter so a renderer without multi-view support still serves seat 0 (back-compat). */
class LegacyView {
  constructor(r) { this.r = r; this.camera = r.camera; this.seatIndex = 0; }
  setHighlight(p) { this.r.setHighlight(p); }
  setBreakProgress(p, v) { this.r.setBreakProgress(p, v); }
  setHeldItem(k) { this.r.setHeldItem(k); }
  swingHand() { this.r.swingHand(); }
  setViewmodelVisible(v) { if (this.r.setViewmodelVisible) this.r.setViewmodelVisible(v); }
  setUnderwater(b) { this.r.setUnderwater(b); }
  setDamageFlash() { this.r.setDamageFlash(); }
  setFov(d) { this.camera.fov = d; this.camera.updateProjectionMatrix(); }
}

export class Game {
  constructor(container) {
    this.container = container;
    this.platform = currentPlatform();
    this.WATER = ID('water'); this.GRASS = ID('grass'); this.DIRT = ID('dirt'); this.FARM = ID('farmland');
    this.FURNACE = ID('furnace'); this.LIT = ID('lit_furnace'); this.CHEST = ID('chest'); this.BED = ID('bed');
    this.TABLE = ID('crafting_table'); this.TORCH = ID('torch');

    this.settings = loadSettings(this.platform.settingsKey);
    this.world = new World();
    this.renderer = new Renderer(container, this.world);
    if (this.renderer.setPlatform) this.renderer.setPlatform(this.platform.key);
    if (this.renderer.setSafeArea) this.renderer.setSafeArea(this.platform.safeArea);
    this.renderer.setQuality(this.settings.quality);
    this.sound = new Sound(); this.sound.setVolume(this.settings.volume);
    this.events = new Events();
    this.entities = new Map();
    this.state = { blocksBroken: 0, forced: makeForcedPlan(), time: 60 };
    this.mode = 'title'; // 'title' | 'play'
    this.drops = new Drops(this);
    this.mobs = new MobManager(this);
    this.growth = new Growth(this);
    this.ui = new UI(this);
    this.goals = new Goals(this);

    this.slots = [];
    for (let i = 0; i < this.platform.maxSeats; i++) { const s = new Seat(this, i); s.ui = this.ui.seatUI(s); this.slots.push(s); }
    this.seats = [];

    const canvas = container.querySelector('canvas') || container;
    this.canvas = canvas;
    this.hub = new InputHub({
      platform: this.platform, canvas, container, settings: this.settings,
      onPointerLockChange: (l) => this.onLockChange(l), onPointerLockError: () => this.onLockError(),
    });
    this.hub.onDisconnect((src) => this.onPadDisconnect(src));
    this.hub.onUserGesture = () => this.sound.resume();
    this.pickers = [];
    window.addEventListener('pointerup', () => this.sound.resume(), true);
    if (this.platform.fullscreenOnPlay) { // fullscreen needs a REAL user gesture (click/tap/key, incl. an Edge cursor-mode click): try on every one until it works
      const tryFs = () => { if (!document.fullscreenElement) this.goFullscreen(); };
      for (const ev of ['pointerdown', 'click', 'keydown', 'touchend']) window.addEventListener(ev, tryFs, true);
    }
    if (this.platform.key === 'ipad') window.addEventListener('resize', () => { // portrait hides the game behind the rotate hint: pause so nothing kills an unseen player
      if (this.mode === 'play' && innerHeight > innerWidth && !this.ui.current && !this.anySeatUi()) this.openPause(this.seats[0]);
    });
    canvas.addEventListener('mousedown', () => {
      this.sound.resume();
      if (this.platform.pointerLock && this.mode === 'play' && !this.hub.pointerLocked && !this.ui.current && !this.slots[0].ui.current && !this.slots[0].player.dead) { this.noLock = false; this.hub.requestPointerLock(); }
    });

    this.regen = null; this.sleepT = 0; this.autosaveT = 0; this.goalHintT = 0;
    this.titleT = 0; this.running = false; this.phaseIdx = 0; this.cycle = 1; this.hasWorld = false;
    this.furnaceSnd = 0; this.noLock = false; this.padClick = false; this.titleClock = 60;
    this._sleepMsgT = 0;

    this.world.onChange((x, y, z, o, n) => this.onWorldChange(x, y, z, o, n));
    window.addEventListener('pagehide', () => this.save());
    document.addEventListener('visibilitychange', () => { if (document.hidden) this.save(); });
  }

  // seat-0 compatibility getters (existing tests / debugging)
  get player() { return this.slots[0].player; }
  get inv() { return this.slots[0].inv; }
  get sel() { return this.slots[0].sel; }
  set sel(v) { this.slots[0].sel = v; }
  get input() { return this.slots[0].input; }
  get held() { return this.slots[0].held; }
  selectSlot(a, b) { const seat = typeof a === 'number' ? (b === undefined ? this.slots[0] : this.slots[a]) : a; seat.selectSlot(b === undefined ? a : b); }

  // ------------------------------------------------------------------ seats
  makeView(i) {
    const r = this.renderer;
    if (r.createView) return r.createView(i);
    return new LegacyView(r);
  }

  /** Activate seat i with an input source. */
  addSeat(i, source) {
    const seat = this.slots[i];
    seat.input = source; seat.disconnected = false; seat.active = true;
    if (source && source.kind === 'gamepad') {
      seat.padId = { id: source.padId || source.id, index: source.index };
      this.hub.assign(source, i);
      if (this.mode === 'title') for (const a of ['ui_accept', 'ui_back', 'ui_alt', 'ui_split']) source.pressed(a); // the join press must not also start the game
    }
    if (!seat.view) seat.view = this.makeView(i);
    if (this.platform.maxSeats > 1 && !seat.avatar && this.renderer.createPlayerAvatar) {
      seat.avatar = this.renderer.createPlayerAvatar(i);
      if (seat.avatar.object3d && !seat.avatar.object3d.parent) this.renderer.scene.add(seat.avatar.object3d);
    }
    if (seat.avatar) seat.avatar.setVisible(this.mode === 'play');
    if (!seat.hasData || this.mode === 'play') {
      const keep = seat.hasData ? { hp: seat.player.health, hu: seat.player.hunger, sat: seat.player.saturation } : null;
      const sp = seat.spawnPoint(); seat.player.reset(sp.x, sp.y, sp.z); if (!seat.hasData) seat.player.pitch = -1.30;
      if (keep && keep.hp > 0) { seat.player.health = keep.hp; seat.player.hunger = keep.hu; seat.player.saturation = keep.sat; } // leaving and rejoining does not heal
    }
    seat.hasData = true;
    if (source && source.pressed) seat.drain(); // the join press (Menu) must not also act as pause / accept
    this.seats = this.slots.filter((s) => s.active);
    seat.mode = null; seat.lastHeld = undefined;
    if (this.mode === 'play') { seat.ui.setVisible(true); seat.ui.dirty = true; seat.ui.hudCache = {}; }
    this.relayout();
    this.ui.updateLobby();
    return seat;
  }

  leaveSeat(seat) {
    if (this.seats.length <= 1 && this.mode === 'play') { this.toTitle(); return; }
    this.dropSeat(seat);
    this.checkSleep(null);
    this.save();
  }

  /** Remove a seat from play (keeps its slot data). Used by Leave, lobby ghost cleanup and unplugged pads at start. */
  dropSeat(seat) {
    if (seat.ui.current) seat.ui.close(true, true);
    if (this.ui.pauseOwner === seat) this.ui.pauseOwner = this.seats.find((s) => s !== seat && !s.disconnected) || null;
    if (seat.input && seat.input.kind === 'gamepad') this.hub.unassign(seat.input);
    seat.input = null; seat.active = false; seat.disconnected = false; seat.inBed = null;
    seat.clearTarget();
    if (seat.avatar) seat.avatar.setVisible(false);
    seat.ui.setVisible(false);
    this.seats = this.slots.filter((s) => s.active);
    this.relayout();
    this.ui.updateLobby();
  }

  relayout() {
    const views = this.mode === 'play' ? this.seats.map((s) => s.view) : [];
    if (this.renderer.setViews) this.renderer.setViews(views);
    for (const s of this.slots) s.ui.layout(true);
  }

  onPadDisconnect(src) {
    for (const s of this.slots) {
      if (s.active && s.input && (s.input === src || (s.input.parts && s.input.parts.includes(src)))) {
        if (this.platform.key !== 'xbox') continue;
        if (this.mode === 'title') { this.dropSeat(s); continue; } // lobby: a vanished pad leaves no ghost seat
        s.disconnected = true; s.clearTarget();
        if (this.ui.pauseOwner === s) this.ui.pauseOwner = this.seats.find((x) => x !== s && !x.disconnected) || null; // pause ownership moves to a connected pad
      }
    }
    this.pickers = this.pickers.filter((p) => p.src !== src);
  }

  /** New controllers pressing Menu/Start: reconnect a frozen seat first, else drop in as a new seat (multi-seat platforms). */
  handleJoins() {
    for (const s of this.slots) if (s.active && s.disconnected && s.input && s.input.connected) { s.disconnected = false; s.mode = null; } // same controller came back
    const joins = this.hub.unassignedJoinPresses ? this.hub.unassignedJoinPresses() : [];
    if (!joins.length || this.platform.maxSeats <= 1) return;
    for (const src of joins) {
      const dis = this.slots.find((s) => s.active && s.disconnected);
      if (dis) { dis.input = src; this.hub.assign(src, dis.index); dis.disconnected = false; dis.mode = null; continue; }
      if (this.pickers.some((p) => p.src === src)) continue;
      const opts = joinOptions(this.slots, { id: src.padId || src.id, index: src.index });
      if (opts.preferred < 0) continue;
      if (opts.needsPick) { this.pickers.push({ src, sel: opts.preferred }); src.seatIndex = 99; src.setMode('menu'); }
      else this.joinAs(opts.preferred, src);
    }
  }

  joinAs(index, src) {
    const seat = this.addSeat(index, src);
    this.sound.play('pop');
    if (this.mode === 'play') seat.ui.message(`You are ${seat.name}`);
    return seat;
  }

  /** "Choose your player": a joining pad picks which saved P1..P4 slot it takes (left/right, A confirm, B cancel). */
  runPickers() {
    for (const p of [...this.pickers]) {
      const free = this.slots.filter((s) => !s.active).map((s) => s.index);
      if (!p.src.connected || !free.length) { this.pickers = this.pickers.filter((q) => q !== p); this.hub.unassign(p.src); continue; }
      p.src.setMode('menu');
      const pr = readUi(p.src);
      if (!free.includes(p.sel)) p.sel = free[0];
      const at = free.indexOf(p.sel);
      if (pr.left) p.sel = free[(at + free.length - 1) % free.length];
      if (pr.right || pr.down) p.sel = free[(at + 1) % free.length];
      if (pr.accept) { this.pickers = this.pickers.filter((q) => q !== p); this.joinAs(p.sel, p.src); }
      else if (pr.back) { this.pickers = this.pickers.filter((q) => q !== p); this.hub.unassign(p.src); }
    }
    this.ui.renderPickers(this.pickers);
  }

  /** Computer: keyboard+mouse, plus the first controller if one is connected. */
  refreshCombined() {
    const seat = this.slots[0], hub = this.hub;
    if (this.platform.key !== 'computer' || !seat.active) return;
    const pad = hub.gamepads && hub.gamepads[0];
    if (pad && seat.input.kind !== 'combined') { seat.input = hub.combine(hub.keyboardMouse, pad); seat.mode = null; }
    else if (!pad && seat.input.kind === 'combined') { seat.input = hub.keyboardMouse; seat.mode = null; }
  }

  /** Pad(s) allowed to drive the title / pause menus: every connected assigned source (no soft-lock if one pad dies). */
  menuSources() {
    return this.seats.filter((s) => s.input && !s.disconnected && s.input.connected !== false).map((s) => s.input);
  }

  nearestSeat(x, y, z, maxDist) { return nearestSeat(this.seats, x, y, z, maxDist); }
  anySeatOverlaps(x, y, z) { return this.seats.some((s) => !s.player.dead && overlapsCell(s.player, x, y, z)); }
  worldSpawn(i) {
    const o = SPAWN_OFFS[i] || SPAWN_OFFS[0];
    const top = this.world.topSolidY(0, 0);
    return { x: o[0], y: (top === null || top === undefined ? 0 : top) + 1, z: o[1] };
  }

  // ------------------------------------------------------------------ boot / worlds
  boot() {
    const d = readSave(this.platform.saveKey);
    if (d) { this.applySave(d); this.hasWorld = true; } else this.resetWorld(false);
    if (this.platform.maxSeats === 1) {
      const hub = this.hub;
      const src = this.platform.key === 'ipad' ? hub.touch : hub.keyboardMouse;
      this.addSeat(0, src);
      this.slots[0].ui.setVisible(false);
    }
    this.applySettings();
    this.setHandVisible(false);
    this.ui.showTitle();
    this.running = true;
    this.last = performance.now();
    requestAnimationFrame((t) => this.frame(t));
  }

  hasSave() { return !!readSave(this.platform.saveKey); }

  setHandVisible(v) { for (const s of this.slots) if (s.view && s.view.setViewmodelVisible) s.view.setViewmodelVisible(v); if (this.renderer.setViewmodelVisible) this.renderer.setViewmodelVisible(v); }

  applySettings() {
    saveSettings(this.settings, this.platform.settingsKey);
    this.sound.setVolume(this.settings.volume);
    this.renderer.setQuality(this.settings.quality);
    if (this.hub.setSettings) this.hub.setSettings(this.settings);
  }

  resetWorld(startLog) {
    const all = [];
    this.world.forEachBlock((x, y, z) => all.push([x, y, z]));
    for (const [x, y, z] of all) this.world.setBlock(x, y, z, 0);
    this.world.setBlock(0, 0, 0, startLog ? ID('oak_log') : this.GRASS);
    this.mobs.clear(); this.drops.clear(); this.entities.clear();
    this.state = { blocksBroken: 0, forced: makeForcedPlan(), time: 60 };
    for (const s of this.slots) {
      s.inv.clear(); s.spawn = null; s.inBed = null; s.sel = 0; s.lastGood = null; s.mining = null;
      const sp = this.worldSpawn(s.index);
      s.player.reset(sp.x, sp.y, sp.z); s.player.pitch = -1.30; // looking down at the One Block (about -74 deg reaches it)
      s.hasData = s.active;
      s.tut = { sneakShown: false, sneakT: 0, t: 0 };
    }
    this.goals.deserialize({});
    this.regen = null;
    this.growth.scan();
    this.syncPhase(false);
    this.ui.dirtyInv();
  }

  newWorld() {
    clearSave(this.platform.saveKey);
    this.resetWorld(true);
    this.hasWorld = true;
    this.save();
  }

  startPlaying() {
    if (!this.hasWorld) this.newWorld();
    if (this.platform.maxSeats > 1) for (const s of [...this.seats]) if (!s.input || s.input.connected === false) this.dropSeat(s);
    if (!this.seats.length) { this.ui.showTitle(); return; }
    this.mode = 'play';
    this.hub.joinOnA = false;
    this.ui.hideTitle();
    this.sound.resume();
    for (const s of this.slots) { s.ui.setVisible(s.active); s.lastHeld = undefined; s.mode = null; s.disconnected = s.active && !!s.input && s.input.connected === false; if (s.avatar) s.avatar.setVisible(s.active); }
    this.setHandVisible(true);
    this.relayout();
    for (const s of this.seats) s.ui.close(true, true);
    if (this.platform.pointerLock) { this.noLock = !!this.padClick; if (!this.noLock) this.hub.requestPointerLock(); }
    if (this.platform.fullscreenOnPlay) this.goFullscreen();
    this.autosaveT = 0;
    this.slots[0].guard = 3;
  }

  goFullscreen() {
    try {
      const e = document.documentElement;
      if (!document.fullscreenElement && e.requestFullscreen) { const p = e.requestFullscreen(); if (p && p.catch) p.catch(() => {}); }
    } catch { /* ignore */ }
  }

  toTitle() {
    const anyDead = this.seats.some((s) => s.player.dead);
    this.save();
    if (anyDead) { const d = readSave(this.platform.saveKey); if (d) this.applySave(d); }
    this.mode = 'title';
    this.hub.joinOnA = this.platform.maxSeats > 1;
    this.ui.current = null; this.ui.pauseOwner = null;
    this.ui.screen.className = 'screen hidden'; this.ui.screen.innerHTML = '';
    if (this.platform.pointerLock) this.hub.exitPointerLock();
    for (const s of this.slots) { if (s.ui.current) s.ui.close(true, true); s.clearTarget(); s.ui.setVisible(false); s.setMode('menu'); }
    this.relayout();
    this.setHandVisible(false);
    for (const s of this.slots) if (s.avatar) s.avatar.setVisible(false);
    this.ui.showTitle();
  }

  snapshot() {
    return {
      world: this.world.serialize(),
      state: { ...this.state },
      entities: serializeEntities(this.entities),
      goals: this.goals.serialize(),
      drops: this.drops.serialize(),
      seats: this.slots.map((s) => (s.active || s.hasData ? seatSaveData(s, s.spawnPoint(), (x) => x.serialize()) : null)),
    };
  }

  save() {
    if (!this.hasWorld || !this.seats.length) return false;
    try { return writeSave(this.snapshot(), this.platform.saveKey); } catch (e) { console.warn('save failed', e); return false; }
  }

  /** Snapshot taken at the moment of death: dead seats are written respawned + with drops in the world. */
  saveAfterDeath() { this.save(); }

  applySave(d) {
    this.mobs.clear(); this.drops.clear();
    this.world.deserialize(d.world);
    this.entities = deserializeEntities(d.entities);
    this.state = { blocksBroken: 0, forced: makeForcedPlan(), time: 60, ...(d.state || {}) };
    delete this.state.spawn;
    this.goals.deserialize(d.goals);
    this.slots.forEach((s, i) => {
      const sd = (d.seats || [])[i];
      s.inv.clear(); s.spawn = null; s.inBed = null; s.lastGood = null; s.tut = { sneakShown: !!sd, sneakT: 0, t: 0 };
      if (sd) { s.deserialize(sd); s.hasData = true; } else { const sp = this.worldSpawn(i); s.player.reset(sp.x, sp.y, sp.z); s.hasData = s.active; }
      s.player.dead = false;
    });
    this.drops.restore(d.drops);
    this.regen = null;
    this.growth.scan();
    this.syncPhase(false);
    this.ui.dirtyInv();
  }

  // ------------------------------------------------------------------ pause / pointer lock plumbing
  anySeatUi() { return this.seats.some((s) => s.ui.current); }

  openPause(seat) { if (!this.ui.current) this.ui.open('pause', seat); }
  onGlobalMenuOpen(owner) {
    if (this.platform.pointerLock) this.hub.exitPointerLock();
    for (const s of this.seats) s.setMode('menu');
    if (owner) owner.input && owner.input.setMode && owner.input.setMode('menu');
  }
  onGlobalMenuClose(owner, skipRelock) {
    for (const s of this.seats) { s.mode = null; s.guard = 2; }
    if (!skipRelock && this.mode === 'play' && this.platform.pointerLock) {
      if (this.padClick) this.noLock = true; else { this.noLock = false; this.hub.requestPointerLock(); }
    }
  }
  onSeatUiOpen(seat) { if (this.platform.pointerLock && seat.input && seat.input.kind !== 'gamepad' && !this.noLock) this.hub.exitPointerLock(); }
  afterSeatUiClose(seat, skipRelock) {
    seat.guard = 2;
    if (!skipRelock && this.mode === 'play' && this.platform.pointerLock && !seat.player.dead && !this.noLock && !this.ui.current) this.hub.requestPointerLock();
  }
  onLockChange(locked) {
    if (this.mode !== 'play' || locked || this.noLock) return;
    if (!this.ui.current && !this.anySeatUi() && !this.slots[0].player.dead) this.openPause(this.slots[0]);
  }
  onLockError() { this.onLockChange(false); }

  canPlay() { return !this.platform.pointerLock || this.hub.pointerLocked || this.noLock; }

  // ------------------------------------------------------------------ time
  isNight() { const t = this.state.time; return t >= 345 && t < 555; }
  isDay() { const t = this.state.time; return t < 320 || t >= 560; }

  surfaceCount() {
    const now = performance.now();
    if (this._surfT === undefined || now - this._surfT > 3000) { this._surfT = now; this._surf = countSurface(this.world); }
    return this._surf;
  }

  inventoryFullHint(seat) {
    const now = performance.now();
    if (!seat || now - (seat._fullT || 0) < 3000) return;
    seat._fullT = now; seat.ui.message('Inventory full'); this.sound.play('click');
  }

  renderTime(sec) {
    const s = (sec === undefined ? this.state.time : sec) % DAY_LEN;
    let t;
    if (s < 300) t = 0.02 + (s / 300) * 0.40;
    else if (s < 360) t = 0.42 + ((s - 300) / 60) * 0.16;
    else if (s < 540) t = 0.58 + ((s - 360) / 180) * 0.34;
    else t = 0.92 + ((s - 540) / 60) * 0.10;
    return t % 1;
  }

  // ------------------------------------------------------------------ sleep (night skips only when every living seat is in a bed)
  checkSleep(seat) {
    const st = sleepStatus(this.seats);
    if (st.total === 0) { this.ui.setSleepMessage(''); return; }
    if (st.all) {
      if (this.sleepT > 0 || this._sleepPending) return;
      this._sleepPending = true;
      this.sleepT = 2.6;
      this.sound.play('sleep');
      this.ui.setSleepMessage('');
      this.ui.sleepFade(() => {
        this._sleepPending = false;
        this.state.time = 5;
        for (const s of this.seats) s.inBed = null;
        this.events.emit('sleep');
        this.ui.message('Good morning — spawn point set');
        this.save();
      });
    } else if (seat && seat.inBed && this.seats.length > 1) {
      this.ui.setSleepMessage(`${seat.name} is sleeping (${st.sleeping}/${st.total})`);
    }
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

  holdAboveOneBlock() {
    const over = (e) => this.regen && Math.abs(e.x - 0.5) < 0.5 + e.hw && Math.abs(e.z - 0.5) < 0.5 + e.hw && e.y > 0.9 && e.y < 1.2;
    for (const s of this.slots) s.player.hover = s.active && !!over(s.player);
    for (const m of this.mobs.list) m.hover = !!over(m);
  }

  placeOneBlock(next) {
    const w = this.world;
    const lift = (e) => { if (overlapsCell(e, 0, 0, 0)) { e.y = 1.001; e.vy = 0; } };
    for (const s of this.seats) lift(s.player);
    for (const m of this.mobs.list) lift(m);
    const idx = phaseIndexFor(this.state.blocksBroken);
    if (!next) next = rollNext(this.state.blocksBroken, this.state.forced);
    const id = ID(next.block);
    this.entities.delete(keyOf(0, 0, 0));
    w.setBlock(0, 0, 0, id);
    if (next.chest) this.entities.set(keyOf(0, 0, 0), newChest(rollLoot(idx)));
    this.renderer.spawnParticles('sparkle', 0.5, 1.0, 0.5);
    if (next.mob) {
      // never in any seat's column; zombies only with room (>= 12 surface blocks); see spawning.js
      const plan = planPhaseSpawn(w, this.seats.filter((s) => !s.player.dead).map((s) => s.player), next.mob, this.WATER, Math.random);
      if (plan) this.mobs.spawn(plan.kind, plan.x, plan.y + 0.05, plan.z);
    }
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
      this.hub.poll(dt);
      if (this.mode === 'title') this.updateTitle(dt);
      else this.updatePlay(dt);
    } catch (e) { console.error(e); }
    this.renderer.render(dt);
  }

  updateTitle(dt) {
    this.titleT += dt;
    this.hub.joinOnA = this.platform.maxSeats > 1;
    this.handleJoins();
    this.runPickers();
    this.refreshCombined();
    this.ui.updateLobby();
    this.ui.updateHelp();
    // title navigation by controller; seats' inputs are in menu mode
    for (const s of this.seats) s.setMode('menu');
    this.ui.navMenus(this.menuSources());
    this.titleClock = (this.titleClock + dt * 1.5) % 250; // the title has its own clock: never touches the world clock
    this.renderer.setTimeOfDay(this.renderTime(this.titleClock));
    const a = this.titleT * 0.12;
    const cam = this.renderer.camera;
    cam.position.set(0.5 + Math.cos(a) * 7.5, 3.6 + Math.sin(this.titleT * 0.3) * 0.4, 0.5 + Math.sin(a) * 7.5);
    cam.lookAt(0.5, 0.7, 0.5);
    if (innerWidth >= 900) cam.translateX(-2.6); // island sits right of the title menu
    this.mobs.update(dt);
    this.drops.update(dt);
  }

  updatePlay(dt) {
    const ui = this.ui;
    this.handleJoins();
    this.runPickers();
    this.refreshCombined();
    const goalsFreeze = this.seats.length === 1 && this.seats[0].ui.current === 'goals';
    if (ui.pausesGame) {
      if (ui.pauseOwner && ui.pauseOwner.disconnected) ui.pauseOwner = this.seats.find((x) => !x.disconnected) || null;
      ui.navMenus(this.menuSources());
      for (const s of this.seats) if (s.disconnected && s.input) s.drain();
    } else if (goalsFreeze) {
      const s = this.seats[0]; s.setMode('menu'); s.ui.nav(s.input);
    } else {
      this.state.time = (this.state.time + dt) % DAY_LEN;
      if (this.sleepT > 0) this.sleepT = Math.max(0, this.sleepT - dt);
      for (const s of this.seats) s.update(dt);
      this.updateWorld(dt);
    }
    for (const s of this.seats) s.syncCamera(dt);
    ui.update(dt);
  }

  updateWorld(dt) {
    const w = this.world;
    if (this.goalHintT > 0) this.goalHintT -= dt;
    // One Block regen
    if (this.regen) { this.regen.t -= dt; if (this.regen.t <= 0) this.placeOneBlock(this.regen.next); }
    else if (w.getBlock(0, 0, 0) === 0) this.placeOneBlock(null);
    // dusk warning (team-wide)
    const t = this.state.time;
    if (t < 300) this.duskWarned = false;
    else if (t >= 330 && t < 350 && !this.duskWarned) {
      this.duskWarned = true;
      this.ui.toast('Night is falling', 'Light torches to keep zombies away', 'Warning');
      this.sound.play('phase', { pitch: 0.6, vol: 0.5 });
    }
    for (const s of this.seats) s.updateTutorial(dt);
    this.holdAboveOneBlock();
    this.mobs.update(dt);
    this.drops.update(dt);
    this.growth.update(dt);
    this.goals.poll(dt);
    // sleepers
    this._sleepMsgT -= dt;
    if (this._sleepMsgT <= 0) {
      this._sleepMsgT = 0.4;
      const st = sleepStatus(this.seats);
      if (this.seats.length > 1 && st.sleeping > 0 && !st.all) {
        const names = this.seats.filter((s) => s.inBed).map((s) => s.name).join(', ');
        this.ui.setSleepMessage(`${names} sleeping (${st.sleeping}/${st.total})`);
      } else this.ui.setSleepMessage('');
      if (st.all && this.sleepT <= 0) this.checkSleep(null);
    }
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
        const [x, y, z] = k.split(',').map(Number);
        const s = this.nearestSeat(x, y, z, 7);
        if (s) { const d = Math.hypot(x - s.player.x, y - s.player.y, z - s.player.z); this.sound.play('furnace', { vol: 1 - d / 7 }); this.renderer.spawnParticles('smoke', x + 0.5, y + 1.05, z + 0.5); break; }
      }
    }
    this.renderer.setTimeOfDay(this.renderTime());
    this.autosaveT += dt;
    if (this.autosaveT >= 30) { this.autosaveT = 0; this.save(); }
  }

  // ------------------------------------------------------------------ blocks
  /** Break a block (seat = the miner, or null for support loss). */
  breakBlock(x, y, z, seat) {
    const w = this.world, id = w.getBlock(x, y, z);
    const def = BLOCKS[id]; if (!def || id === 0 || def.hardness < 0) return;
    const held = seat ? seat.held : null;
    const info = seat ? breakInfo(id, held ? held.key : null) : { canHarvest: true };
    const isOne = x === 0 && y === 0 && z === 0;
    const drops = rollDrops(id, info.canHarvest);
    const ek = keyOf(x, y, z), ent = this.entities.get(ek);
    if (ent) {
      for (const s of entityContents(ent)) drops.push({ key: s.key, n: s.n, dur: s.dur });
      this.entities.delete(ek);
      for (const s of this.slots) if (s.ui.current && s.ui.entityKey === ek) s.ui.close();
    }
    const toWater = id === ID('ice') && !isOne;
    w.setBlock(x, y, z, toWater ? this.WATER : 0);
    this.renderer.spawnBlockParticles(x, y, z, id);
    this.sound.play('break_' + materialOf(def.key), { vol: 1 });
    for (const d of drops) this.dropItem(d.key, d.n, x + 0.5, y + 0.5, z + 0.5, d.dur);
    if (seat) {
      if (held && ITEMS[held.key].tool && def.hardness > 0) seat.damageHeld(1);
      seat.player.addExhaustion(0.04);
      this.events.emit('break', def.key);
    }
    if (toWater) this.sound.play('splash', { vol: 0.5 });
    if (isOne) this.onOneBroken();
  }

  dropItem(key, n, x, y, z, dur, vel) { return this.drops.spawn(key, n, x, y, z, vel, dur); }

  damageSeat(seat, amount, cause, mob) { seat.damage(amount, cause, mob); }

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
    if (!ok) this.breakBlock(x, y, z, null);
  }
}

export { SEATS, livingSeats };
