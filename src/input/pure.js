// Pure input math (no DOM): deadzones, look curve, menu auto-repeat. Unit-tested from node.

/** Radial deadzone with rescale: |v| < dz -> 0, then 0..1 over the remaining range. Returns {x, y, mag}. */
export function applyDeadzone(x, y, dz = 0.16) {
  const m = Math.hypot(x, y);
  if (m <= dz) return { x: 0, y: 0, mag: 0 };
  const k = Math.min(1, (m - dz) / (1 - dz)) / m;
  return { x: x * k, y: y * k, mag: Math.min(1, (m - dz) / (1 - dz)) };
}

/** Stick -> look speed multiplier 0..1 (small deflections are slow and precise, full deflection is fast). */
export function lookCurve(mag) {
  const m = Math.min(1, Math.max(0, mag));
  return m * m * (0.55 + 0.45 * m);
}

/** Extra gain while the stick is held at (near) full deflection: 1 .. 1+boost over `ramp` seconds. */
export function lookAccel(heldSeconds, boost = 0.55, ramp = 0.45) {
  return 1 + boost * Math.min(1, Math.max(0, heldSeconds) / ramp);
}

/** Radians/second of turning at full deflection, scaled by the user's sensitivity setting (1 = default). */
export const LOOK_BASE_RATE = 3.1;

/**
 * Menu auto-repeat: a direction fires once on press, again after `initial` seconds, then every `repeat` seconds.
 * update(dt, {ui_up:bool,...}) -> array of actions to fire this frame.
 */
export class MenuRepeater {
  constructor(initial = 0.35, repeat = 0.11) { this.initial = initial; this.repeat = repeat; this.t = {}; }
  reset() { this.t = {}; }
  update(dt, dirs) {
    const out = [];
    for (const k of Object.keys(dirs)) {
      if (!dirs[k]) { delete this.t[k]; continue; }
      if (this.t[k] === undefined) { this.t[k] = this.initial; out.push(k); continue; }
      this.t[k] -= dt;
      while (this.t[k] <= 1e-9) { out.push(k); this.t[k] += this.repeat; }
    }
    return out;
  }
}

/** Stick vector -> four booleans with hysteresis-free threshold (menu navigation). */
export function stickToDirs(x, y, th = 0.55) {
  return { ui_left: x < -th, ui_right: x > th, ui_up: y < -th, ui_down: y > th };
}

/** Time-limited edge store: an edge is readable once, and silently expires if the game never reads it. */
export class EdgeSet {
  constructor(ttl = 0.25) { this.ttl = ttl; this.m = new Map(); }
  add(a) { this.m.set(a, this.ttl); }
  take(a) { if (this.m.has(a)) { this.m.delete(a); return true; } return false; }
  has(a) { return this.m.has(a); }
  clear() { this.m.clear(); }
  age(dt) { for (const [k, v] of this.m) { if (v - dt <= 0) this.m.delete(k); else this.m.set(k, v - dt); } }
}

/** Joystick sprint: engages only after the push stays >= `enter` (0.95) for `hold` seconds; releases below `exit`. */
export class SprintLatch {
  constructor(enter = 0.95, hold = 0.25, exit = 0.5) { this.enter = enter; this.hold = hold; this.exit = exit; this.t = 0; this.on = false; }
  update(dt, mag) {
    if (mag >= this.enter) { this.t += dt; if (this.t >= this.hold) this.on = true; }
    else { this.t = 0; if (mag < this.exit) this.on = false; }
    return this.on;
  }
  reset() { this.t = 0; this.on = false; }
}
