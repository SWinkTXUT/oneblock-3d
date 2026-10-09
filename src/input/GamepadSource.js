// One physical controller, standard mapping. Bedrock-like layout per SPEC-PLATFORMS §3b.
import { InputSource } from './InputSource.js';
import { padGlyphHtml } from './glyphs.js';
import { applyDeadzone, lookCurve, lookAccel, LOOK_BASE_RATE, MenuRepeater, stickToDirs } from './pure.js';

export const BTN = { A: 0, B: 1, X: 2, Y: 3, LB: 4, RB: 5, LT: 6, RT: 7, VIEW: 8, MENU: 9, LS: 10, RS: 11, UP: 12, DOWN: 13, LEFT: 14, RIGHT: 15, GUIDE: 16 };
const TRIGGER_ON = 0.5, TRIGGER_OFF = 0.35;
const DROP_STACK_HOLD = 0.6;

// Plain-text tokens (no circled Unicode letters: they may be missing from the console font). See glyphs.js for badges.
const GLYPHS = {
  primary: 'RT', secondary: 'LT', jump: 'A', inventory: 'Y', goals: 'X', drop: 'B', dropStack: 'Hold B', pause: 'Menu',
  hotbarNext: 'RB', hotbarPrev: 'LB', ui_accept: 'A', ui_back: 'B', ui_alt: 'X', ui_split: 'Y', ui_tabNext: 'RB', ui_tabPrev: 'LB',
  ui_up: 'Up', ui_down: 'Down', ui_left: 'Left', ui_right: 'Right', sprint: 'L3', sneak: 'R3', join: 'A', goalsAlt: 'View',
};

export class GamepadSource extends InputSource {
  constructor(index, id = 'gamepad') {
    super('gamepad', `pad${index}`);
    this.index = index;
    this.padId = id;
    this.pad = null;
    this.prev = new Array(17).fill(false); // button states last frame
    this.rt = false; this.lt = false;
    this.repeater = new MenuRepeater(0.35, 0.11);
    this.sneakOn = false; this.sprintLatch = false;
    this.bHold = -1; this.bStackFired = false;
    this.lookHeld = 0;
    this.joinPressed = false;
    this.lx = 0; this.ly = 0; this.rx = 0; this.ry = 0;
    this._lookAcc = { dyaw: 0, dpitch: 0 };
    this.deadzone = 0.16; this.lookDeadzone = 0.12;
    this.joinOnA = false;
    this.lastAxesMag = 0;
  }

  onMode() { this.repeater.reset(); this.bHold = -1; this.rt = this.lt = false; this.held.delete('primary'); this.held.delete('secondary'); }

  /** Feed a Gamepad (or any {buttons, axes}) snapshot. Called by the hub once per frame, before game logic. */
  update(dt, pad) {
    this.edges.age(dt);
    if (!pad) return;
    this.pad = pad;
    const b = (i) => !!(pad.buttons[i] && pad.buttons[i].pressed);
    const v = (i) => (pad.buttons[i] ? pad.buttons[i].value : 0);
    const now = this.prev;
    const edge = (i) => b(i) && !now[i];
    const play = this.mode === 'play';

    // sticks
    const L = applyDeadzone(pad.axes[0] || 0, pad.axes[1] || 0, this.deadzone);
    const R = applyDeadzone(pad.axes[2] || 0, pad.axes[3] || 0, this.lookDeadzone);
    this.lx = L.x; this.ly = L.y; this.rx = R.x; this.ry = R.y;
    if (L.mag > 0 || R.mag > 0 || [...Array(17).keys()].some((i) => b(i))) this.touchActive();

    // triggers with hysteresis
    const rtv = v(BTN.RT), ltv = v(BTN.LT);
    this.rt = this.rt ? rtv > TRIGGER_OFF : rtv > TRIGGER_ON;
    this.lt = this.lt ? ltv > TRIGGER_OFF : ltv > TRIGGER_ON;
    const rtEdge = this.rt && !this._rtPrev, ltEdge = this.lt && !this._ltPrev;
    this._rtPrev = this.rt; this._ltPrev = this.lt;

    // join presses are recorded in any mode
    // Menu is also Edge's own controller menu (hold), so View and (on lobby screens / Xbox) A join as well
    if (edge(BTN.MENU) || edge(BTN.VIEW) || (this.joinOnA && edge(BTN.A))) this.joinPressed = true;

    if (play) {
      this._setHeld('primary', this.rt); this._setHeld('secondary', this.lt);
      if (rtEdge) this.edges.add('primary');
      if (ltEdge) this.edges.add('secondary');
      if (edge(BTN.A)) this.edges.add('jump');
      if (edge(BTN.Y)) this.edges.add('inventory');
      if (edge(BTN.X) || edge(BTN.VIEW)) this.edges.add('goals');
      if (edge(BTN.MENU)) this.edges.add('pause');
      if (edge(BTN.RB) || edge(BTN.RIGHT)) this.edges.add('hotbarNext');
      if (edge(BTN.LB) || edge(BTN.LEFT)) this.edges.add('hotbarPrev');
      // B: tap = drop one, hold 0.6 s = drop the stack (fires once at the threshold, not again on release)
      if (edge(BTN.B)) { this.bHold = 0; this.bStackFired = false; }
      if (this.bHold >= 0) {
        if (b(BTN.B)) {
          this.bHold += dt;
          if (!this.bStackFired && this.bHold >= DROP_STACK_HOLD) { this.bStackFired = true; this.edges.add('dropStack'); }
        } else { if (!this.bStackFired) this.edges.add('drop'); this.bHold = -1; }
      }
      // stick clicks: L3 = sprint (until you stop), R3 = sneak toggle
      if (edge(BTN.LS) && L.mag > 0) this.sprintLatch = true;
      if (edge(BTN.RS)) this.sneakOn = !this.sneakOn;
      if (L.mag === 0) this.sprintLatch = false;
    } else {
      this.held.delete('primary'); this.held.delete('secondary');
      if (edge(BTN.MENU)) this.edges.add('pause');
      if (edge(BTN.A)) this.edges.add('ui_accept');
      if (edge(BTN.B)) this.edges.add('ui_back');
      if (edge(BTN.X)) this.edges.add('ui_alt');
      if (edge(BTN.Y)) this.edges.add('ui_split');
      if (edge(BTN.RB)) this.edges.add('ui_tabNext');
      if (edge(BTN.LB)) this.edges.add('ui_tabPrev');
      const dirs = stickToDirs(L.x, L.y);
      dirs.ui_up = dirs.ui_up || b(BTN.UP); dirs.ui_down = dirs.ui_down || b(BTN.DOWN);
      dirs.ui_left = dirs.ui_left || b(BTN.LEFT); dirs.ui_right = dirs.ui_right || b(BTN.RIGHT);
      for (const a of this.repeater.update(dt, dirs)) this.edges.add(a);
    }

    // look: accumulate rotation for this frame (poll-rate independent: rate * dt)
    if (play) {
      if (R.mag > 0.92) this.lookHeld += dt; else this.lookHeld = Math.max(0, this.lookHeld - dt * 3);
      const sens = (this.settings.padSens ?? this.settings.sens ?? 1);
      const rate = LOOK_BASE_RATE * sens * lookCurve(R.mag) * lookAccel(this.lookHeld);
      const m = R.mag || 1;
      const inv = this.settings.invertY ? -1 : 1;
      this._lookAcc.dyaw += -(R.x / m) * rate * dt;
      this._lookAcc.dpitch += -(R.y / m) * rate * dt * 0.8 * inv;
    }

    for (let i = 0; i < 17; i++) now[i] = b(i);
  }

  _setHeld(a, on) { if (on) this.held.add(a); else this.held.delete(a); }

  move() {
    if (this.mode !== 'play') return { f: 0, r: 0, jump: false, sneak: false, sprint: false };
    const mag = Math.hypot(this.lx, this.ly);
    return {
      f: this.ly ? -this.ly : 0, r: this.lx,
      jump: !!(this.pad && this.pad.buttons[BTN.A] && this.pad.buttons[BTN.A].pressed),
      sneak: this.sneakOn, sprint: this.sprintLatch && mag > 0,
    };
  }

  look() {
    const r = { dyaw: this._lookAcc.dyaw + 0, dpitch: this._lookAcc.dpitch + 0 };
    this._lookAcc.dyaw = 0; this._lookAcc.dpitch = 0;
    return r;
  }

  down(a) { return this.mode === 'play' && this.held.has(a); }
  glyph(a) { return GLYPHS[a] || a; }
  glyphHtml(a) { return padGlyphHtml(this.glyph(a)); }

  consumeJoinPress() { const j = this.joinPressed; this.joinPressed = false; return j; }

  rumble(intensity = 0.5, ms = 120) {
    const pad = this.pad;
    const act = pad && (pad.vibrationActuator || (pad.hapticActuators && pad.hapticActuators[0]));
    if (!act) return;
    try {
      if (act.playEffect) act.playEffect('dual-rumble', { startDelay: 0, duration: ms, weakMagnitude: Math.min(1, intensity), strongMagnitude: Math.min(1, intensity * 0.8) });
      else if (act.pulse) act.pulse(Math.min(1, intensity), ms);
    } catch { /* unsupported */ }
  }
}
