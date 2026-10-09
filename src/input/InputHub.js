// InputHub: owns every input device. See SPEC-PLATFORMS §3b.
import { KbmSource } from './KbmSource.js';
import { GamepadSource } from './GamepadSource.js';
import { TouchSource } from './TouchSource.js';
import { CombinedSource } from './InputSource.js';

const isStandard = (p) => p && (p.mapping === 'standard' || (p.buttons && p.buttons.length >= 16 && p.axes && p.axes.length >= 4));

export class InputHub {
  constructor({ platform, canvas, container, settings = {}, onPointerLockChange, onPointerLockError } = {}) {
    this.platform = platform || { key: 'computer', inputs: ['kbm', 'gamepad'], pointerLock: true };
    this.canvas = canvas;
    this.container = container || (canvas && canvas.parentElement) || document.body;
    this.settings = settings;
    this.onPointerLockChange = onPointerLockChange;
    this.onPointerLockError = onPointerLockError;
    this.pointerLocked = false;
    this.lockOnClick = true;   // KbmSource click-to-lock; the game may switch this off while a menu is open
    this.joinOnA = false;      // lobby screens: let A (not just Menu) count as a join press
    this.padSources = new Map(); // gamepad index -> GamepadSource (kept after disconnect so a seat can get its pad back)
    this.disconnectCbs = []; this.connectCbs = [];
    this.keyboardMouse = null; this.touch = null;
    this.xbox = this.platform.key === 'xbox' || (typeof navigator !== 'undefined' && /Xbox/i.test(navigator.userAgent || ''));

    const wants = (k) => (this.platform.inputs || []).includes(k);
    if (wants('kbm') && typeof window !== 'undefined') this.keyboardMouse = new KbmSource(this, canvas);
    if (wants('touch') && typeof document !== 'undefined') this.touch = new TouchSource(this, this.container, canvas);
    for (const s of [this.keyboardMouse, this.touch]) if (s) s.setSettings(settings);

    if (typeof window !== 'undefined') {
      window.addEventListener('gamepadconnected', (e) => this._scan(e.gamepad));
      window.addEventListener('gamepaddisconnected', (e) => this._lost(e.gamepad.index));
      if (this.platform.pointerLock) {
        document.addEventListener('pointerlockchange', () => {
          this.pointerLocked = !!canvas && document.pointerLockElement === canvas;
          if (!this.pointerLocked) this.keyboardMouse?.releaseAll();
          this.onPointerLockChange?.(this.pointerLocked);
        });
        document.addEventListener('pointerlockerror', () => this.onPointerLockError?.());
      }
      if (this.xbox) this._xboxGuards();
    }
  }

  // ---- Xbox Edge quirks (see HANDOFF): Edge has no page-level switch for its cursor mode, so we (1) try the legacy
  // opt-in, (2) trap history so B/Back never leaves the page, (3) expose `controllerHint` so the UI can tell players to
  // hold Menu -> "Use game controls" when no pad shows up.
  _xboxGuards() {
    try { if ('gamepadInputEmulation' in navigator) navigator.gamepadInputEmulation = 'gamepad'; } catch { /* legacy Edge only */ }
    try {
      history.pushState({ ob3d: 1 }, '');
      window.addEventListener('popstate', () => { try { history.pushState({ ob3d: 1 }, ''); } catch { /* ignore */ } });
    } catch { /* ignore */ }
  }
  /** true on Xbox while no controller is visible to the page (UI shows "hold Menu -> Use game controls"). */
  get controllerHint() { return this.xbox && this.gamepads.length === 0; }

  get gamepads() { return [...this.padSources.values()].filter((s) => s.connected); }

  _scan(pad) {
    if (!pad || !isStandard(pad)) return null;
    let s = this.padSources.get(pad.index);
    if (!s) {
      s = new GamepadSource(pad.index, pad.id);
      s.setSettings(this.settings);
      this.padSources.set(pad.index, s);
      s.connected = true;
      for (const cb of this.connectCbs) cb(s);
    } else if (!s.connected) {
      s.connected = true; s.padId = pad.id;
      for (const cb of this.connectCbs) cb(s);
    }
    return s;
  }
  _lost(index) {
    const s = this.padSources.get(index);
    if (!s || !s.connected) return;
    s.connected = false;
    s.held.clear();
    for (const cb of this.disconnectCbs) cb(s);
    if (s.seatIndex < 0) this.padSources.delete(index); // unassigned pads vanish; assigned ones are kept for reconnection
  }

  /** Once per frame, before game logic. */
  poll(dt = 1 / 60) {
    const pads = (typeof navigator !== 'undefined' && navigator.getGamepads) ? navigator.getGamepads() : [];
    const seen = new Set();
    for (const p of pads) {
      if (!p || !p.connected) continue;
      const s = this._scan(p);
      if (!s) continue;
      seen.add(p.index);
      s.joinOnA = this.joinOnA;
      s.update(dt, p);
    }
    for (const [i, s] of [...this.padSources]) if (s.connected && !seen.has(i)) this._lost(i);
    this.keyboardMouse?.poll(dt);
    this.touch?.poll(dt);
  }

  unassignedJoinPresses() {
    const out = [];
    for (const s of this.gamepads) if (s.consumeJoinPress() && s.seatIndex < 0) out.push(s);
    return out;
  }
  assign(source, seatIndex) { source.seatIndex = seatIndex; }
  unassign(source) { source.seatIndex = -1; if (!source.connected && source.kind === 'gamepad') this.padSources.delete(source.index); }
  onDisconnect(cb) { this.disconnectCbs.push(cb); return () => { this.disconnectCbs = this.disconnectCbs.filter((f) => f !== cb); }; }
  onConnect(cb) { this.connectCbs.push(cb); return () => { this.connectCbs = this.connectCbs.filter((f) => f !== cb); }; }
  combine(a, b) { return new CombinedSource(a, b); }

  setSettings(s) {
    this.settings = s;
    this.keyboardMouse?.setSettings(s); this.touch?.setSettings(s);
    for (const p of this.padSources.values()) p.setSettings(s);
  }

  requestPointerLock() {
    if (!this.platform.pointerLock || !this.canvas) return;
    try { const p = this.canvas.requestPointerLock(); if (p && p.catch) p.catch(() => {}); } catch { /* ignore */ }
  }
  exitPointerLock() { if (typeof document !== 'undefined' && document.pointerLockElement) document.exitPointerLock(); }

  dispose() { this.keyboardMouse?.dispose(); this.touch?.dispose(); }
}
