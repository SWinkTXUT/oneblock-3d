// Keyboard + mouse (pointer lock). Faithful port of src/game/Input.js behaviour:
// double-tap W sprint latch, Ctrl sprint, wheel hotbar, digit keys, E/J/Q (Ctrl+Q = whole stack), click-to-lock.
import { InputSource } from './InputSource.js';
import { keyGlyphHtml } from './glyphs.js';

const MENU_KEYS = {
  ArrowUp: 'ui_up', ArrowDown: 'ui_down', ArrowLeft: 'ui_left', ArrowRight: 'ui_right',
  Enter: 'ui_accept', Escape: 'ui_back', Tab: 'ui_tabNext',
};

export class KbmSource extends InputSource {
  constructor(hub, canvas) {
    super('kbm', 'kbm');
    this.hub = hub;
    this.canvas = canvas;
    this.keys = {};
    this.wTap = 0;
    this.sprintLatch = false;
    this.dx = 0; this.dy = 0;
    this._bind();
  }

  /** Play-mode input is only live while the pointer is locked (like the original), menus always. */
  get live() { return this.mode === 'play' && (this.hub.pointerLocked || !this.hub.platform.pointerLock); }

  _bind() {
    const on = (t, ev, fn, opt) => { t.addEventListener(ev, fn, opt); (this._off ||= []).push(() => t.removeEventListener(ev, fn, opt)); };
    on(window, 'keydown', (e) => this._key(e, true));
    on(window, 'keyup', (e) => this._key(e, false));
    on(window, 'blur', () => this.releaseAll());
    on(document, 'mousemove', (e) => {
      if (!this.hub.pointerLocked || this.mode !== 'play') return;
      this.dx += e.movementX || 0; this.dy += e.movementY || 0;
      this.touchActive();
    });
    on(this.canvas, 'mousedown', (e) => {
      this.hub.onUserGesture?.();
      if (this.mode !== 'play') return;
      if (!this.hub.pointerLocked) { if (this.hub.lockOnClick && this.hub.platform.pointerLock) this.hub.requestPointerLock(); return; }
      if (e.button === 0) { this.held.add('primary'); this.edges.add('primary'); }
      if (e.button === 2) { this.held.add('secondary'); this.edges.add('secondary'); }
      this.touchActive();
    });
    on(window, 'mouseup', (e) => {
      if (e.button === 0) this.held.delete('primary');
      if (e.button === 2) this.held.delete('secondary');
    });
    on(window, 'contextmenu', (e) => e.preventDefault());
    on(window, 'wheel', (e) => {
      if (!this.hub.pointerLocked || this.mode !== 'play') return;
      this.edges.add(e.deltaY > 0 ? 'hotbarNext' : 'hotbarPrev');
      this.touchActive();
    }, { passive: true });
  }

  dispose() { for (const f of this._off || []) f(); }

  releaseAll() { this.keys = {}; this.held.clear(); this.sprintLatch = false; this.dx = this.dy = 0; }
  onMode(mode) { if (mode !== 'play') { this.held.delete('primary'); this.held.delete('secondary'); this.dx = this.dy = 0; } }

  _key(e, down) {
    const code = e.code;
    if (code === 'Tab' || (code.startsWith('F') && code.length <= 3 && code !== 'F11' && code !== 'F5' && code !== 'F12')) e.preventDefault();
    if (down && e.ctrlKey && (code === 'KeyW' || code === 'KeyS')) e.preventDefault();
    if (this.mode === 'play' && (code === 'Space' || code.startsWith('Arrow')) && !(e.target && e.target.tagName === 'INPUT')) {
      e.preventDefault(); // keep Space from clicking a focused button
      if (document.activeElement && document.activeElement.blur) document.activeElement.blur();
    }
    if (!down) {
      this.keys[code] = false;
      if (code === 'KeyW') this.sprintLatch = false;
      return;
    }
    if (e.repeat) return;
    this.hub.onUserGesture?.();
    this.keys[code] = true;
    this.touchActive();
    if (this.mode === 'menu') {
      const a = MENU_KEYS[code];
      if (a) this.edges.add(a === 'ui_tabNext' && e.shiftKey ? 'ui_tabPrev' : a);
      if (code === 'KeyE' || code === 'KeyJ') this.edges.add('ui_back');
      return;
    }
    if (!this.live) return;
    switch (code) {
      case 'KeyE': this.edges.add('inventory'); break;
      case 'KeyJ': this.edges.add('goals'); break;
      case 'KeyQ': this.edges.add(e.ctrlKey ? 'dropStack' : 'drop'); break;
      case 'Space': this.edges.add('jump'); break;
      case 'KeyW': {
        const now = performance.now();
        if (now - this.wTap < 280) this.sprintLatch = true;
        this.wTap = now; break;
      }
      default:
        if (/^Digit[1-9]$/.test(code)) this.edges.add('hotbar' + code.slice(5));
    }
  }

  move() {
    if (!this.live) return { f: 0, r: 0, jump: false, sneak: false, sprint: false };
    const k = this.keys;
    return {
      f: (k.KeyW ? 1 : 0) - (k.KeyS ? 1 : 0), r: (k.KeyD ? 1 : 0) - (k.KeyA ? 1 : 0),
      jump: !!k.Space, sneak: !!(k.ShiftLeft || k.ShiftRight),
      sprint: !!(k.ControlLeft || k.ControlRight || this.sprintLatch),
    };
  }

  look() {
    const s = 0.0022 * (this.settings.sens ?? 1);
    const inv = this.settings.invertY ? -1 : 1;
    const r = { dyaw: -this.dx * s, dpitch: -this.dy * s * inv };
    this.dx = this.dy = 0;
    return r;
  }

  down(action) { return this.mode === 'play' && this.held.has(action); }

  glyphHtml(a) { return keyGlyphHtml(this.glyph(a)); }

  glyph(a) {
    return ({
      primary: 'LMB', secondary: 'RMB', jump: 'Space', inventory: 'E', goals: 'J', drop: 'Q', dropStack: 'Ctrl+Q', pause: 'Esc',
      hotbarNext: 'Wheel', hotbarPrev: 'Wheel', ui_accept: 'Click', ui_back: 'Esc', ui_alt: 'Shift+Click', ui_split: 'Right-click',
      ui_tabNext: 'Tab', ui_tabPrev: 'Shift+Tab', ui_up: '↑', ui_down: '↓', ui_left: '←', ui_right: '→',
    })[a] || a;
  }
}
