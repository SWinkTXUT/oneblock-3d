import { EdgeSet } from './pure.js';

const NEUTRAL_MOVE = () => ({ f: 0, r: 0, jump: false, sneak: false, sprint: false });

/** Base class. See SPEC-PLATFORMS §3b. Subclasses fill `edges` / `held` and implement move()/look(). */
export class InputSource {
  constructor(kind, id) {
    this.kind = kind; this.id = id;
    this.connected = true;
    this.seatIndex = -1;
    this.mode = 'play';
    this.edges = new EdgeSet();
    this.held = new Set();
    this.settings = {};
    this.lastActive = 0; // performance.now() of the last meaningful activity (used by combined glyphs)
  }
  setSettings(s) { this.settings = s || {}; }
  setMode(mode) {
    if (mode === this.mode) return;
    this.mode = mode;
    this.edges.clear();
    this.onMode(mode);
  }
  onMode() {}
  poll(dt) { this.edges.age(dt); }
  move() { return NEUTRAL_MOVE(); }
  look() { return { dyaw: 0, dpitch: 0 }; }
  down(action) { return this.mode === 'play' && this.held.has(action); }
  pressed(action) { return this.edges.take(action); }
  glyph(action) { return action; }
  rumble() {}
  touchActive() { this.lastActive = performance.now(); }
}

/** Merges two sources (computer: keyboardMouse + a gamepad). */
export class CombinedSource extends InputSource {
  constructor(a, b) {
    super('combined', `${a.id}+${b.id}`);
    this.parts = [a, b];
  }
  get connected() { return this.parts.some((p) => p.connected); }
  set connected(v) { /* derived */ }
  setSettings(s) { super.setSettings(s); for (const p of this.parts) p.setSettings(s); }
  setMode(m) { this.mode = m; for (const p of this.parts) p.setMode(m); }
  poll() { /* parts are polled by the hub */ }
  move() {
    const [a, b] = this.parts.map((p) => p.move());
    const clamp = (v) => Math.max(-1, Math.min(1, v));
    return { f: clamp(a.f + b.f), r: clamp(a.r + b.r), jump: a.jump || b.jump, sneak: a.sneak || b.sneak, sprint: a.sprint || b.sprint };
  }
  look() {
    const [a, b] = this.parts.map((p) => p.look());
    return { dyaw: a.dyaw + b.dyaw, dpitch: a.dpitch + b.dpitch };
  }
  down(action) { return this.parts.some((p) => p.down(action)); }
  pressed(action) { let r = false; for (const p of this.parts) if (p.pressed(action)) r = true; return r; }
  glyph(action) { return (this.parts[1].lastActive > this.parts[0].lastActive ? this.parts[1] : this.parts[0]).glyph(action); }
  rumble(i, ms) { for (const p of this.parts) p.rumble(i, ms); }
}
