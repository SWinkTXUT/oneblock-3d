// Keyboard / mouse / pointer-lock handling. Game logic reads the flags; edge events are consumed by the game.
export class Input {
  constructor(game, lockEl) {
    this.game = game; this.el = lockEl;
    this.keys = {};
    this.lmb = false; this.rmb = false; this.rmbEdge = false; this.lmbEdge = false;
    this.locked = false;
    this.wTap = 0; this.sprintLatch = false;
    this.bind();
  }

  bind() {
    const g = this.game;
    window.addEventListener('keydown', (e) => this.onKey(e, true));
    window.addEventListener('keyup', (e) => this.onKey(e, false));
    window.addEventListener('blur', () => this.releaseAll());
    document.addEventListener('pointerlockchange', () => {
      this.locked = document.pointerLockElement === this.el;
      if (!this.locked) this.releaseAll();
      g.onLockChange(this.locked);
    });
    document.addEventListener('pointerlockerror', () => g.onLockError());
    document.addEventListener('mousemove', (e) => {
      if (!this.locked || g.ui.current) return;
      const p = g.player, s = 0.0022 * g.settings.sens;
      p.yaw -= e.movementX * s;
      p.pitch -= e.movementY * s * (g.settings.invertY ? -1 : 1);
      p.pitch = Math.max(-Math.PI / 2 + 0.01, Math.min(Math.PI / 2 - 0.01, p.pitch));
    });
    this.el.addEventListener('mousedown', (e) => {
      g.sound.resume();
      if (g.mode !== 'play') return;
      if (!this.locked && !g.ui.current) { this.lock(); return; }
      if (!this.locked || g.ui.current) return;
      if (e.button === 0) { this.lmb = true; this.lmbEdge = true; }
      if (e.button === 2) { this.rmb = true; this.rmbEdge = true; }
    });
    window.addEventListener('mouseup', (e) => {
      if (e.button === 0) this.lmb = false;
      if (e.button === 2) this.rmb = false;
    });
    window.addEventListener('contextmenu', (e) => e.preventDefault());
    window.addEventListener('wheel', (e) => {
      if (!this.locked || g.ui.current || g.mode !== 'play') return;
      g.selectSlot((g.sel + (e.deltaY > 0 ? 1 : -1) + 9) % 9);
    }, { passive: true });
  }

  lock() { try { const p = this.el.requestPointerLock(); if (p && p.catch) p.catch(() => {}); } catch { /* ignore */ } }
  unlock() { if (document.pointerLockElement) document.exitPointerLock(); }
  releaseAll() { this.keys = {}; this.lmb = this.rmb = false; this.sprintLatch = false; }

  onKey(e, down) {
    const g = this.game;
    if (e.code === 'Tab' || (e.code.startsWith('F') && e.code.length <= 3 && e.code !== 'F11' && e.code !== 'F5' && e.code !== 'F12')) e.preventDefault();
    if (down && e.ctrlKey && (e.code === 'KeyW' || e.code === 'KeyS')) e.preventDefault();
    if (g.mode === 'play' && (e.code === 'Space' || e.code.startsWith('Arrow')) && !(e.target && e.target.tagName === 'INPUT')) {
      e.preventDefault(); // keep Space from clicking a focused button
      if (document.activeElement && document.activeElement.blur) document.activeElement.blur();
    }
    if (!down) { this.keys[e.code] = false; if (e.code === 'KeyW' || e.code === 'ControlLeft' || e.code === 'ControlRight') { if (e.code === 'KeyW') this.sprintLatch = false; } return; }
    if (e.repeat) { return; }
    g.sound.resume();
    this.keys[e.code] = true;
    if (g.mode !== 'play') return;
    const ui = g.ui;
    if (ui.current) { ui.onKey(e); return; }
    if (!this.locked) return;
    switch (e.code) {
      case 'KeyE': g.openInventory(false); break;
      case 'KeyJ': ui.open('goals'); break;
      case 'KeyQ': g.dropHeld(e.ctrlKey); break;
      case 'KeyW': {
        const now = performance.now();
        if (now - this.wTap < 280) this.sprintLatch = true;
        this.wTap = now; break;
      }
      default:
        if (/^Digit[1-9]$/.test(e.code)) g.selectSlot(parseInt(e.code.slice(5), 10) - 1);
    }
  }

  /** Movement vector for the player. */
  moveInput() {
    const k = this.keys;
    return {
      f: (k.KeyW ? 1 : 0) - (k.KeyS ? 1 : 0), r: (k.KeyD ? 1 : 0) - (k.KeyA ? 1 : 0),
      jump: !!k.Space, sneak: !!(k.ShiftLeft || k.ShiftRight),
      sprint: !!(k.ControlLeft || k.ControlRight || this.sprintLatch),
    };
  }
}
