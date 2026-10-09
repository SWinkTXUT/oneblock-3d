// iPad touch controls: dynamic joystick (left third), drag-to-look, action buttons. Pointer Events only
// (pointerType === 'touch', so synthetic events work in tests). The overlay hides in menu mode.
import { InputSource } from './InputSource.js';

const STYLE_ID = 'ob3d-touch-style';
const CSS = `
.ob3d-touch{position:absolute;inset:0;z-index:15;touch-action:none;user-select:none;-webkit-user-select:none;-webkit-touch-callout:none;pointer-events:none;-webkit-tap-highlight-color:transparent;}
.ob3d-touch.hidden{display:none}
.ob3d-touch .tbtn{position:absolute;display:flex;align-items:center;justify-content:center;border-radius:50%;
  background:rgba(20,26,44,.5);border:2px solid rgba(255,255,255,.4);color:#fff;font:700 13px/1.1 system-ui,-apple-system,sans-serif;
  text-align:center;box-shadow:0 2px 10px rgba(0,0,0,.35);touch-action:none;pointer-events:auto;backdrop-filter:blur(2px);}
.ob3d-touch .tbtn.on,.ob3d-touch .tbtn.lit{background:rgba(255,255,255,.4);border-color:#fff}
.ob3d-touch .tbtn small{display:block;font-weight:500;font-size:10px;opacity:.8}
.ob3d-touch .joy{position:absolute;width:140px;height:140px;margin:-70px 0 0 -70px;border-radius:50%;
  background:rgba(255,255,255,.12);border:2px solid rgba(255,255,255,.35);pointer-events:none;display:none}
.ob3d-touch .joy i{position:absolute;left:50%;top:50%;width:64px;height:64px;margin:-32px 0 0 -32px;border-radius:50%;background:rgba(255,255,255,.45);border:2px solid #fff}
.ob3d-touch .joy.sprint i{background:rgba(255,220,90,.75)}
`;

export class TouchSource extends InputSource {
  constructor(hub, container, canvas) {
    super('touch', 'touch');
    this.hub = hub;
    this.canvas = canvas;
    this.container = container;
    this.joyId = null; this.joyOrigin = null; this.joyVec = { x: 0, y: 0 };
    this.sprinting = false; this.sneakOn = false;
    this.lookId = null; this.lookLast = null;
    this.dyaw = 0; this.dpitch = 0;
    this.btnIds = new Map(); // pointerId -> action
    this.visible = true;
    this._build();
  }

  _build() {
    if (!document.getElementById(STYLE_ID)) {
      const st = document.createElement('style'); st.id = STYLE_ID; st.textContent = CSS; document.head.appendChild(st);
    }
    const root = document.createElement('div');
    root.className = 'ob3d-touch';
    root.dataset.touchOverlay = '1';
    root.style.touchAction = 'none';
    const joy = document.createElement('div'); joy.className = 'joy'; joy.innerHTML = '<i></i>';
    root.appendChild(joy);
    this.root = root; this.joyEl = joy; this.knob = joy.firstChild;
    const inset = 'max(env(safe-area-inset-right),22px)', insetB = 'max(env(safe-area-inset-bottom),22px)';
    const mk = (action, label, sub, css, size = 76) => {
      const b = document.createElement('div');
      b.className = 'tbtn'; b.dataset.action = action;
      b.style.cssText = `width:${size}px;height:${size}px;${css}`;
      b.innerHTML = `<span>${label}${sub ? `<small>${sub}</small>` : ''}</span>`;
      root.appendChild(b); return b;
    };
    this.buttons = {
      primary: mk('primary', '⛏', 'Mine', `right:calc(${inset} + 96px);bottom:calc(${insetB} + 70px)`, 92),
      secondary: mk('secondary', '✋', 'Use', `right:calc(${inset} + 4px);bottom:calc(${insetB} + 150px)`, 80),
      jump: mk('jump', '⤒', 'Jump', `right:calc(${inset} + 4px);bottom:calc(${insetB} + 40px)`, 76),
      sneak: mk('sneak', '⇩', 'Sneak', `right:calc(${inset} + 190px);bottom:calc(${insetB} + 4px)`, 68),
      inventory: mk('inventory', '🎒', '', `right:calc(${inset} + 84px);top:max(env(safe-area-inset-top),16px)`, 64),
      pause: mk('pause', '❚❚', '', `right:calc(${inset} + 4px);top:max(env(safe-area-inset-top),16px)`, 64),
    };
    // The overlay itself is click-through; gestures are read from the container so HUD elements (hotbar etc.) keep their own taps.
    const c = this.container;
    c.style.touchAction = 'none';
    const up = (e) => this._up(e);
    this._off = [
      ['pointerdown', (e) => this._down(e)], ['pointermove', (e) => this._move(e)], ['pointerup', up], ['pointercancel', up],
      ['contextmenu', (e) => { if (this.mode === 'play') e.preventDefault(); }],
    ];
    for (const [ev, fn] of this._off) c.addEventListener(ev, fn);
    this._tm = (e) => { if (this.mode === 'play' && (e.target === this.canvas || this.root.contains(e.target))) e.preventDefault(); };
    c.addEventListener('touchstart', this._tm, { passive: false });
    c.addEventListener('touchmove', this._tm, { passive: false });
    c.appendChild(root);
  }

  setVisible(v) { this.visible = v; this.root.classList.toggle('hidden', !v); }
  onMode(mode) {
    this.setVisible(mode === 'play');
    if (mode !== 'play') this._releaseAll();
  }
  dispose() { for (const [ev, fn] of this._off) this.container.removeEventListener(ev, fn); this.container.removeEventListener('touchstart', this._tm); this.container.removeEventListener('touchmove', this._tm); this.root.remove(); }

  _releaseAll() {
    this.joyId = null; this.joyVec = { x: 0, y: 0 }; this.sprinting = false; this.joyEl.style.display = 'none';
    this.lookId = null; this.btnIds.clear();
    for (const a of ['primary', 'secondary', 'jump']) { this.held.delete(a); this.buttons[a].classList.remove('lit'); }
  }

  _btnAt(target) { return target && target.closest ? target.closest('.tbtn') : null; }

  _down(e) {
    if (e.pointerType !== 'touch' || this.mode !== 'play') return;
    this.hub.onUserGesture?.();
    this.touchActive();
    const btn = this._btnAt(e.target);
    if (!btn && e.target !== this.canvas && e.target !== this.root && e.target !== this.container) return; // some HUD element took this touch
    try { this.container.setPointerCapture(e.pointerId); } catch { /* synthetic ids can't be captured */ }
    if (btn) {
      const a = btn.dataset.action;
      this.btnIds.set(e.pointerId, a);
      if (a === 'sneak') { this.sneakOn = !this.sneakOn; btn.classList.toggle('on', this.sneakOn); this.edges.add('sneak'); return; }
      this.edges.add(a);
      if (a === 'primary' || a === 'secondary' || a === 'jump') { this.held.add(a); btn.classList.add('lit'); }
      return;
    }
    const r = this.root.getBoundingClientRect();
    const x = e.clientX - r.left, y = e.clientY - r.top;
    if (x < r.width * 0.38 && y > r.height * 0.22 && this.joyId === null) {
      this.joyId = e.pointerId; this.joyOrigin = { x, y };
      this.joyEl.style.display = 'block'; this.joyEl.style.left = x + 'px'; this.joyEl.style.top = y + 'px';
      this.knob.style.transform = 'translate(0,0)';
      this.joyVec = { x: 0, y: 0 };
      return;
    }
    if (this.lookId === null) { this.lookId = e.pointerId; this.lookLast = { x: e.clientX, y: e.clientY }; }
  }

  _move(e) {
    if (e.pointerType !== 'touch') return;
    if (e.pointerId === this.joyId) {
      const r = this.root.getBoundingClientRect();
      let dx = e.clientX - r.left - this.joyOrigin.x, dy = e.clientY - r.top - this.joyOrigin.y;
      const R = 60, m = Math.hypot(dx, dy);
      const k = m > R ? R / m : 1;
      this.joyVec = { x: (dx * k) / R, y: (dy * k) / R };
      this.knob.style.transform = `translate(${dx * k}px,${dy * k}px)`;
      const mag = Math.min(1, m / R);
      if (mag > 0.9) this.sprinting = true; else if (mag < 0.5) this.sprinting = false;
      this.joyEl.classList.toggle('sprint', this.sprinting);
      this.touchActive();
    } else if (e.pointerId === this.lookId) {
      const s = 0.0042 * (this.settings.sens ?? 1);
      const inv = this.settings.invertY ? -1 : 1;
      this.dyaw += -(e.clientX - this.lookLast.x) * s;
      this.dpitch += -(e.clientY - this.lookLast.y) * s * inv;
      this.lookLast = { x: e.clientX, y: e.clientY };
      this.touchActive();
    }
  }

  _up(e) {
    if (e.pointerType !== 'touch') return;
    if (e.pointerId === this.joyId) {
      this.joyId = null; this.joyVec = { x: 0, y: 0 }; this.sprinting = false; this.joyEl.style.display = 'none';
    } else if (e.pointerId === this.lookId) this.lookId = null;
    const a = this.btnIds.get(e.pointerId);
    if (a) {
      this.btnIds.delete(e.pointerId);
      if (a === 'primary' || a === 'secondary' || a === 'jump') { this.held.delete(a); this.buttons[a].classList.remove('lit'); }
    }
  }

  move() {
    if (this.mode !== 'play') return { f: 0, r: 0, jump: false, sneak: false, sprint: false };
    const dz = 0.12, v = this.joyVec, m = Math.hypot(v.x, v.y);
    let f = 0, r = 0;
    if (m > dz) { const k = (m - dz) / (1 - dz) / m; r = v.x * k; f = -v.y * k; }
    return { f, r, jump: this.held.has('jump'), sneak: this.sneakOn, sprint: this.sprinting && m > dz };
  }

  look() { const r = { dyaw: this.dyaw, dpitch: this.dpitch }; this.dyaw = this.dpitch = 0; return r; }

  setSneak(on) { this.sneakOn = !!on; this.buttons.sneak.classList.toggle('on', this.sneakOn); }

  glyph(a) {
    return ({ primary: 'Hold ⛏', secondary: 'Tap ✋', jump: 'Jump', inventory: '🎒', pause: '❚❚', drop: 'Drop', goals: 'Goals', ui_accept: 'Tap', ui_back: 'Back' })[a] || a;
  }
  rumble(i, ms) { try { navigator.vibrate && navigator.vibrate(Math.min(ms, 200)); } catch { /* unsupported (iOS) */ } }
}
