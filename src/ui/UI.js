// Global UI: title / lobby, pause + settings + confirm, shared phase panel, toasts, banner, tooltip. Per-seat HUD/windows live in SeatUI.
import { ITEMS } from '../data/items.js';
import { phaseInfo, PHASES } from '../data/phases.js';
import { maxDurability } from '../game/Inventory.js';
import { GOALS } from '../game/Goals.js';
import { saveSettings } from '../game/Save.js';
import { sunIcon, moonIcon, trophyIcon } from './pixelicons.js';
import { SeatUI } from './SeatUI.js';
import { MenuNav, readUi } from './focus.js';
import { SEATS } from '../platform.js';
import { padGlyphHtml } from '../input/glyphs.js';
import { slotSummary } from '../game/team.js';

const el = (tag, cls, parent) => { const e = document.createElement(tag); if (cls) e.className = cls; if (parent) parent.appendChild(e); return e; };
const PAUSING = new Set(['pause', 'settings', 'confirm']);

export class UI {
  constructor(game) {
    this.game = game;
    this.current = null;       // global menu: 'pause' | 'settings' | 'confirm' | null
    this.returnTo = null; this.pauseOwner = null;
    this.root = document.getElementById('ui');
    this.seatUIs = [];
    this.cache = {};
    this.buildGlobalHud();
    this.screen = el('div', 'screen hidden', this.root);
    this.overlay = el('div', 'overlaylayer', this.root);
    this.tip = el('div', 'tooltip hidden', this.root);
    this.title = el('div', 'title hidden', this.root);
    this.fade = el('div', 'fade', this.root);
    this.padHelp = el('div', 'padhelp hidden', this.root);
    this.padHelp.innerHTML = '<strong>On Xbox</strong><span>Hold the ' + padGlyphHtml('Menu') + ' (\u2261) button \u2192 choose \u201CUse game controls\u201D</span>';
    this.fsHint = el('div', 'fshint hidden', this.root);
    this.fsHint.innerHTML = padGlyphHtml('Press A') + ', or click to go fullscreen';
    this.pickEl = el('div', 'pickers hidden', this.root);
    this.menuNav = new MenuNav(() => (this.title.classList.contains('hidden') ? this.screen.firstChild : this.title), { onBack: () => this.navBack() });
    // computer: hover a slot and press 1-9 to swap it with that hotbar slot (kept from the original UI)
    document.addEventListener('keydown', (e) => {
      const m = /^Digit([1-9])$/.exec(e.code); const su = this.seatUIs[0];
      if (!m || !su || !su.win || !su.hoverSlot || su.cursor || game.platform.key === 'xbox') return;
      const hs = su.hoverSlot, hb = su.win.slots.find((s) => s.hotbarIdx === +m[1] - 1);
      if (!hb || hs === hb || hs.kind === 'output') return;
      const a = hs.get(), b = hb.get();
      if ((!b || hs.accepts(b)) && (!a || hb.accepts(a))) { hs.set(b); hb.set(a); su.win.after(); }
    });
    document.addEventListener('mousemove', (e) => { this.mx = e.clientX; this.my = e.clientY; });
    document.addEventListener('pointerdown', (e) => { this.mx = e.clientX; this.my = e.clientY; });
  }

  get pausesGame() { return PAUSING.has(this.current); }
  icon(key) { return this.game.renderer.getItemIcon(key); }
  sfx(n) { this.game.sound.play(n); }
  seatUI(seat) { const u = new SeatUI(seat, this); this.seatUIs[seat.index] = u; return u; }
  dirtyInv() { for (const u of this.seatUIs) if (u) u.dirty = true; }
  message(text) { for (const u of this.seatUIs) if (u && u.seat.active) u.message(text); }
  damage() { /* per-seat now */ }

  // ------------------------------------------------------------------ shared HUD (phase panel, toasts, banner)
  buildGlobalHud() {
    const h = this.ghud = el('div', 'ghud hidden', this.root);
    const ph = this.phasePanel = el('div', 'panel phase', h);
    this.phName = el('div', 'phname', ph); this.phSub = el('div', 'phsub', ph);
    const bar = el('div', 'bar', ph); this.phFill = el('i', '', bar);
    this.phInfo = el('div', 'phinfo', ph);
    this.tracker = el('div', 'tracker', ph);
    const ck = this.clock = el('div', 'panel clock', h);
    this.clockIcon = el('img', '', ck); this.clockLbl = el('span', '', ck);
    this.toasts = el('div', 'toasts', h);
    this.banner_ = el('div', 'banner', h); this.bannerT = el('h1', '', this.banner_); this.bannerS = el('p', '', this.banner_);
    this.sleepMsg = el('div', 'sleepmsg', h);
  }

  updateGlobalHud() {
    const g = this.game, c = this.cache;
    const info = phaseInfo(g.state.blocksBroken);
    const psig = `${g.state.blocksBroken}|${g.seats.length}`;
    if (psig !== c.p) {
      c.p = psig;
      this.phName.textContent = info.phase.name;
      this.phSub.textContent = `Phase ${info.index + 1}/${PHASES.length}  ·  Cycle ${info.cycle}`;
      this.phFill.style.width = Math.max(2, info.frac * 100) + '%';
      this.phInfo.innerHTML = `Blocks broken: <b>${g.state.blocksBroken}</b><br>${info.toNext} more to ${info.nextName}`;
      this.phasePanel.dataset.phase = info.phase.key;
    }
    const ng = g.goals.next(), tsig = ng ? ng.id : 'done';
    if (tsig !== c.goal) { c.goal = tsig; this.tracker.innerHTML = ng ? `<i>▸</i> <b>${ng.name}</b><span>${ng.desc}</span>` : '<i>★</i> <b>All goals complete!</b>'; }
    const t = g.state.time, label = t < 300 ? 'Day' : t < 345 ? 'Dusk' : t < 555 ? 'Night' : t < 575 ? 'Dawn' : 'Day';
    const night = label === 'Night' || label === 'Dusk';
    if (label !== c.clock) { c.clock = label; this.clockLbl.textContent = label; this.clockIcon.src = night ? moonIcon() : sunIcon(); }
    this.root.classList.toggle('multi', g.seats.length > 1);
    this.root.dataset.seats = String(g.seats.length);
  }

  toast(title, desc, kicker = 'Goal reached!') {
    const t = el('div', 'toast', this.toasts);
    const ic = el('img', '', t); ic.src = trophyIcon();
    const b = el('div', '', t);
    el('small', '', b).textContent = kicker;
    el('strong', '', b).textContent = title;
    el('span', '', b).textContent = desc;
    setTimeout(() => t.classList.add('out'), 4200);
    setTimeout(() => t.remove(), 4900);
  }

  banner(title, sub) {
    const b = this.banner_;
    this.bannerT.textContent = title; this.bannerS.textContent = sub;
    b.classList.remove('show'); void b.offsetWidth; b.classList.add('show');
    clearTimeout(this.banT); this.banT = setTimeout(() => b.classList.remove('show'), 4200);
  }

  sleepFade(mid) {
    const f = this.fade; f.classList.add('black');
    setTimeout(() => { mid && mid(); }, 1300);
    setTimeout(() => f.classList.remove('black'), 1900);
  }

  setSleepMessage(text) { this.sleepMsg.textContent = text || ''; this.sleepMsg.classList.toggle('show', !!text); }

  // ------------------------------------------------------------------ tooltip
  showTip(stack, anchor) {
    if (!stack) { this.tip.classList.add('hidden'); return; }
    const d = ITEMS[stack.key]; const md = maxDurability(stack.key);
    this.tip.innerHTML = '';
    el('div', 'tn', this.tip).textContent = d.name;
    if (md && stack.dur !== undefined) el('div', 'td', this.tip).textContent = `Durability: ${stack.dur} / ${md}`;
    if (d.food) el('div', 'td', this.tip).textContent = `Restores ${d.food.hunger / 2} hunger`;
    if (d.fuel) el('div', 'td', this.tip).textContent = `Fuel: ${d.fuel / 10} smelts`;
    this.tip.classList.remove('hidden');
    const w = this.tip.offsetWidth, h = this.tip.offsetHeight;
    let x = (this.mx || 0) + 16, y = (this.my || 0) - 8;
    if (anchor) { const r = anchor.getBoundingClientRect(); x = r.right + 6; y = r.top; if (x + w > innerWidth - 6) x = r.left - w - 6; }
    x = Math.max(4, Math.min(x, innerWidth - w - 6)); y = Math.max(4, Math.min(y, innerHeight - h - 6));
    this.tip.style.transform = `translate(${x}px, ${y}px)`;
  }

  // ------------------------------------------------------------------ per-frame
  update(dt) {
    this.updateGlobalHud();
    this.updateHelp();
    const anyWin = this.seatUIs.some((u) => u && u.seat.active && u.win);
    this.root.classList.toggle('winopen', anyWin || !!this.current);
    this.root.classList.toggle('paused', !!this.current);
    for (const u of this.seatUIs) if (u && u.seat.active) u.update(dt);
  }

  /** Controller-help panel (Edge cursor mode) and fullscreen hint, Xbox only. */
  updateHelp() {
    const g = this.game, xbox = g.platform.key === 'xbox';
    this.padHelp.classList.toggle('hidden', !(xbox && g.hub.controllerHint));
    this.fsHint.classList.toggle('hidden', !(xbox && !document.fullscreenElement));
  }

  /** "Choose your player" cards for pads that are joining while saved slots exist. */
  renderPickers(pickers) {
    const g = this.game;
    const sig = pickers.map((p) => p.sel + ':' + p.src.index).join('|') + '#' + g.slots.map((s) => (s.active ? 1 : 0) + (s.hasData ? 'd' : '')).join('');
    if (sig === this._pickSig) return;
    this._pickSig = sig;
    this.pickEl.innerHTML = '';
    this.pickEl.classList.toggle('hidden', !pickers.length);
    for (const p of pickers) {
      const box = el('div', 'panel picker', this.pickEl);
      el('h3', '', box).textContent = 'Controller ' + (p.src.index + 1) + ': choose your player';
      const row = el('div', 'pickrow', box);
      for (const s of g.slots) {
        if (s.active) continue;
        const c = el('div', 'pickcard' + (s.index === p.sel ? ' sel' : ''), row); c.style.setProperty('--seat', SEATS[s.index].color);
        el('b', '', c).textContent = SEATS[s.index].name;
        el('span', '', c).textContent = s.hasData ? slotSummary(s) : 'New player';
      }
      el('p', '', box).innerHTML = padGlyphHtml('Left') + padGlyphHtml('Right') + ' choose \u00B7 ' + padGlyphHtml('A') + ' confirm \u00B7 ' + padGlyphHtml('B') + ' cancel';
    }
  }

  /** Controller navigation of title / pause / settings / confirm. sources: input sources allowed to drive it. */
  navMenus(sources) {
    const pr = {};
    let pad = false;
    for (const s of sources) {
      const r = readUi(s); for (const k in r) pr[k] = true;
      if ((r.accept || r.back) && (s.kind === 'gamepad' || (s.kind === 'combined' && s.parts[1].lastActive > s.parts[0].lastActive))) pad = true;
    }
    this.game.padClick = pad;
    if (Object.keys(pr).length) this.menuNav.apply(pr);
    this.game.padClick = false;
  }

  navBack() {
    if (this.current === 'settings' || this.current === 'confirm') this.back();
    else if (this.current === 'pause' && (this.game.padClick || !this.game.platform.pointerLock)) this.close(); // Esc cannot re-lock the pointer without a click
  }

  // ------------------------------------------------------------------ global menus
  setScreen(node, cls = '') {
    this.screen.innerHTML = ''; this.screen.className = 'screen ' + cls;
    this.screen.appendChild(node);
    this.menuNav.reset();
  }

  open(type, owner) {
    const g = this.game;
    if (type === 'pause' && owner) this.pauseOwner = owner;
    this.current = type;
    if (type !== 'settings' && type !== 'confirm') g.onGlobalMenuOpen(this.pauseOwner);
    this.showTip(null);
    if (type === 'pause') this.buildPause();
    else if (type === 'settings') this.buildSettings();
  }

  /** Close the pause menu. skipRelock: caller manages pointer lock. */
  close(skipRelock) {
    this.current = null;
    this.screen.className = 'screen hidden'; this.screen.innerHTML = '';
    this.game.onGlobalMenuClose(this.pauseOwner, skipRelock);
    this.pauseOwner = null;
  }

  back() {
    if (this.returnTo === 'title') { this.current = null; this.screen.className = 'screen hidden'; this.screen.innerHTML = ''; this.returnTo = null; this.title.classList.remove('hidden'); this.menuNav.reset(); return; }
    this.current = null; this.open('pause');
  }

  btn(parent, text, fn, cls = '') {
    const b = el('button', 'btn ' + cls, parent); b.textContent = text;
    b.onclick = () => { this.sfx('click'); this.game.sound.resume(); fn(); };
    return b;
  }

  panelBox(titleText) {
    const p = el('div', 'panel menu');
    el('h2', '', p).textContent = titleText;
    return p;
  }

  buildPause() {
    const g = this.game;
    const p = this.panelBox('Game Paused');
    this.btn(p, 'Resume', () => this.close(), 'primary');
    this.btn(p, `Goals  (${g.goals.count}/${GOALS.length})`, () => { const o = this.pauseOwner; this.close(true); if (o) { o.ui.open('goals'); } });
    this.btn(p, 'Settings', () => { this.returnTo = null; this.open('settings'); });
    if (g.seats.length > 1 && this.pauseOwner) this.btn(p, `Leave game (${this.pauseOwner.name})`, () => { const o = this.pauseOwner; this.close(true); g.leaveSeat(o); });
    this.btn(p, 'Save & Quit to Title', () => { this.close(true); g.toTitle(); });
    this.btn(p, 'New World…', () => this.confirm('Start a new world? Your current world will be lost.', () => { g.newWorld(); g.startPlaying(); }), 'danger');
    el('p', 'hint', p).textContent = 'Autosaves every 30 seconds.';
    this.setScreen(p, 'dim center');
  }

  confirm(text, yes) {
    this.current = 'confirm';
    const p = this.panelBox('Are you sure?');
    el('p', 'hint big', p).textContent = text;
    const row = el('div', 'btnrow', p);
    this.btn(row, 'Yes, new world', () => { this.current = null; yes(); }, 'danger');
    this.btn(row, 'Cancel', () => { this.current = null; if (this.game.mode === 'title') { this.screen.className = 'screen hidden'; this.screen.innerHTML = ''; this.title.classList.remove('hidden'); this.menuNav.reset(); } else this.open('pause'); }, 'primary');
    this.setScreen(p, 'dim center');
  }

  buildSettings() {
    const g = this.game, s = g.settings;
    const p = this.panelBox('Settings');
    const row = (label, ctl) => { const r = el('div', 'setrow', p); el('span', '', r).textContent = label; r.appendChild(ctl); return r; };
    const slider = (min, max, step, val, fmt, on) => {
      const w = el('div', 'slwrap'); const i = el('input', '', w); i.type = 'range'; i.min = min; i.max = max; i.step = step; i.value = val;
      const o = el('b', '', w); o.textContent = fmt(val);
      i.oninput = () => { o.textContent = fmt(+i.value); on(+i.value); g.applySettings(); };
      return w;
    };
    row('Mouse / stick sensitivity', slider(0.2, 3, 0.05, s.sens, (v) => v.toFixed(2) + 'x', (v) => { s.sens = v; }));
    row('Field of view', slider(60, 110, 1, s.fov, (v) => v + '°', (v) => { s.fov = v; }));
    row('Volume', slider(0, 1, 0.02, s.volume, (v) => Math.round(v * 100) + '%', (v) => { s.volume = v; }));
    const q = el('button', 'btn small', null); q.textContent = s.quality === 'high' ? 'High' : 'Low';
    q.onclick = () => { s.quality = s.quality === 'high' ? 'low' : 'high'; q.textContent = s.quality === 'high' ? 'High' : 'Low'; g.applySettings(); this.sfx('click'); };
    row('Graphics quality', q);
    const iy = el('button', 'btn small', null); iy.textContent = s.invertY ? 'On' : 'Off';
    iy.onclick = () => { s.invertY = !s.invertY; iy.textContent = s.invertY ? 'On' : 'Off'; g.applySettings(); this.sfx('click'); };
    row('Invert Y axis', iy);
    this.btn(p, 'Done', () => this.back(), 'primary');
    this.setScreen(p, 'dim center');
  }

  // ------------------------------------------------------------------ title / lobby
  showTitle() {
    const g = this.game, t = this.title, multi = g.platform.maxSeats > 1;
    this.ghud.classList.add('hidden');
    for (const u of this.seatUIs) if (u) u.setVisible(false);
    t.innerHTML = ''; t.classList.remove('hidden');
    t.classList.toggle('lobby', multi);
    const logo = el('div', 'logo', t);
    el('h1', '', logo).innerHTML = '<span>ONE</span><span>BLOCK</span>';
    el('p', 'tag', logo).textContent = multi ? 'Couch co-op skyblock — up to 4 players' : 'A skyblock survival in 3D';
    if (multi) {
      this.cards = el('div', 'seatcards', t);
      SEATS.forEach((si) => {
        const c = el('div', 'seatcard', this.cards); c.style.setProperty('--seat', si.color); c.dataset.seat = si.index;
        el('b', '', c).textContent = si.name; el('span', '', c).innerHTML = padGlyphHtml('Press A') + ' to join';
      });
    }
    const m = this.titleMenu = el('div', 'titlemenu', t);
    const has = g.hasSave();
    this.btn(m, has ? 'Continue' : (multi ? 'Start game' : 'Play'), () => { t.classList.add('hidden'); g.startPlaying(); }, 'primary');
    if (has) this.btn(m, 'New World', () => {
      const go = () => { t.classList.add('hidden'); g.newWorld(); g.startPlaying(); };
      t.classList.add('hidden'); this.confirm('Start a new world? Your saved world will be erased.', go);
    });
    this.btn(m, 'Settings', () => { this.returnTo = 'title'; t.classList.add('hidden'); this.current = null; this.open('settings'); });
    const hint = el('div', 'controls', t);
    const P = padGlyphHtml;
    hint.innerHTML = g.platform.key === 'xbox'
      ? `<b>Left stick</b> move \u00B7 <b>Right stick</b> look \u00B7 ${P('RT')} break \u00B7 ${P('LT')} place/use \u00B7 ${P('A')} jump \u00B7 ${P('Y')} inventory \u00B7 ${P('X')} goals \u00B7 ${P('B')} drop \u00B7 ${P('Menu')} pause`
      : g.platform.key === 'ipad'
        ? '<b>Left side</b> joystick \u00B7 <b>Drag</b> look \u00B7 <b>\u26CF Mine</b> hold to break \u00B7 <b>\u270B Use</b> place / use \u00B7 <b>\uD83C\uDF92</b> inventory'
        : '<b>WASD</b> move \u00B7 <b>Mouse</b> look \u00B7 <b>LMB</b> break \u00B7 <b>RMB</b> place/use \u00B7 <b>Shift</b> sneak \u00B7 <b>Ctrl</b> sprint \u00B7 <b>E</b> inventory \u00B7 <b>J</b> goals \u00B7 <b>Q</b> drop \u00B7 <b>1-9</b> hotbar \u00B7 or an Xbox controller';
    const sw = el('a', 'switchdev', t); sw.href = './index.html'; sw.textContent = 'Switch device';
    this.updateLobby();
    this.menuNav.reset();
  }

  updateLobby() {
    if (!this.cards) return;
    const g = this.game;
    for (const c of this.cards.children) {
      const seat = g.slots[+c.dataset.seat], on = !!(seat && seat.active);
      c.classList.toggle('on', on);
      c.lastChild.innerHTML = on ? 'Ready!' : padGlyphHtml('Press A') + ' to join';
    }
  }

  hideTitle() {
    this.title.classList.add('hidden');
    this.ghud.classList.remove('hidden');
    for (const u of this.seatUIs) if (u) { u.dirty = true; u.hudCache = {}; u.hbSlots.forEach((o) => { o.sig = ''; }); }
    this.cache = {};
  }
}
