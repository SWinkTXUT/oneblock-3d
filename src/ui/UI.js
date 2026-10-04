// UI facade: HUD, title, menus, toasts, windows. All DOM over the canvas. (SPEC §11)
import { ITEMS } from '../data/items.js';
import { phaseInfo, PHASES } from '../data/phases.js';
import { maxDurability, maxStack } from '../game/Inventory.js';
import { GOALS } from '../game/Goals.js';
import { saveSettings } from '../game/Save.js';
import { heartIcon, foodIcon, armorIcon, sunIcon, moonIcon, trophyIcon } from './pixelicons.js';
import { Window } from './Windows.js';

const el = (tag, cls, parent) => { const e = document.createElement(tag); if (cls) e.className = cls; if (parent) parent.appendChild(e); return e; };
const PAUSING = new Set(['pause', 'settings', 'confirm']);

export class UI {
  constructor(game) {
    this.game = game;
    this.current = null; this.win = null; this.cursor = null; this.hoverSlot = null;
    this.entityKey = null; this.dirty = true; this.bookFilter = 'all';
    this.returnTo = null;
    this.root = document.getElementById('ui');
    this.buildHud();
    this.screen = el('div', 'screen hidden', this.root);
    this.tip = el('div', 'tooltip hidden', this.root);
    this.cursorEl = el('div', 'cursoritem hidden', this.root);
    this.cursorImg = el('img', '', this.cursorEl); this.cursorCnt = el('span', 'scount', this.cursorEl);
    this.title = el('div', 'title hidden', this.root);
    this.fade = el('div', 'fade', this.root);
    this.hudCache = {};
    document.addEventListener('mousemove', (e) => {
      this.mx = e.clientX; this.my = e.clientY;
      if (this.cursor) this.placeCursor();
      if (!this.tip.classList.contains('hidden')) this.placeTip();
    });
  }

  get pausesGame() { return PAUSING.has(this.current); }
  icon(key) { return this.game.renderer.getItemIcon(key); }
  sfx(n) { this.game.sound.play(n); }
  dirtyInv() { this.dirty = true; }
  message(text) {
    const m = this.msg; m.textContent = text; m.classList.remove('show'); void m.offsetWidth; m.classList.add('show');
    clearTimeout(this.msgT); this.msgT = setTimeout(() => m.classList.remove('show'), 2600);
  }

  // ------------------------------------------------------------------ HUD
  buildHud() {
    const h = this.hud = el('div', 'hud hidden', this.root);
    el('div', 'crosshair', h);
    // phase panel
    const ph = this.phasePanel = el('div', 'panel phase', h);
    this.phName = el('div', 'phname', ph); this.phSub = el('div', 'phsub', ph);
    const bar = el('div', 'bar', ph); this.phFill = el('i', '', bar);
    this.phInfo = el('div', 'phinfo', ph);
    // clock
    const ck = this.clock = el('div', 'panel clock', h);
    this.clockIcon = el('img', '', ck); this.clockLbl = el('span', '', ck);
    this.toasts = el('div', 'toasts', h);
    this.banner_ = el('div', 'banner', h); this.bannerT = el('h1', '', this.banner_); this.bannerS = el('p', '', this.banner_);
    this.msg = el('div', 'actionmsg', h);
    this.vignette = el('div', 'vignette', h);
    this.water = null;
    // stats + hotbar
    const bottom = el('div', 'bottom', h);
    const stats = el('div', 'stats', bottom);
    this.hearts = el('div', 'row hearts', stats); this.hunger = el('div', 'row food', stats); this.armorRow = el('div', 'row armor', bottom);
    this.heartEls = []; this.foodEls = []; this.armorEls = [];
    for (let i = 0; i < 10; i++) { this.heartEls.push(el('img', '', this.hearts)); this.foodEls.push(el('img', '', this.hunger)); this.armorEls.push(el('img', '', this.armorRow)); }
    this.heldName = el('div', 'heldname', bottom);
    const hb = this.hotbar = el('div', 'hotbar', bottom);
    this.hbSlots = [];
    for (let i = 0; i < 9; i++) {
      const s = el('div', 'slot hb', hb); const img = el('img', 'sicon', s); const cnt = el('span', 'scount', s); const bar2 = el('div', 'sbar', s); const fill = el('i', '', bar2);
      el('em', 'hbnum', s).textContent = i + 1;
      this.hbSlots.push({ s, img, cnt, bar: bar2, fill, sig: '' });
    }
  }

  updateHud(dt) {
    const g = this.game, p = g.player, c = this.hudCache;
    // hotbar
    this.hbSlots.forEach((o, i) => {
      const st = g.inv.slots[i];
      const sig = (st ? `${st.key}|${st.n}|${st.dur ?? ''}` : '') + (g.sel === i ? '*' : '');
      if (sig === o.sig) return; o.sig = sig;
      o.s.classList.toggle('sel', g.sel === i);
      if (!st) { o.img.style.visibility = 'hidden'; o.cnt.textContent = ''; o.bar.style.display = 'none'; return; }
      o.img.style.visibility = 'visible'; o.img.src = this.icon(st.key); o.cnt.textContent = st.n > 1 ? st.n : '';
      const md = maxDurability(st.key);
      if (md && st.dur !== undefined && st.dur < md) { const f = Math.max(0, st.dur / md); o.bar.style.display = 'block'; o.fill.style.width = f * 100 + '%'; o.fill.style.background = `hsl(${Math.round(f * 120)},85%,50%)`; } else o.bar.style.display = 'none';
    });
    const held = g.inv.slots[g.sel];
    const hn = held ? ITEMS[held.key].name : '';
    if (hn !== c.held) { c.held = hn; this.heldName.textContent = hn; this.heldName.classList.remove('flash'); void this.heldName.offsetWidth; if (hn) this.heldName.classList.add('flash'); }
    // hearts / hunger / armor
    const hp = Math.ceil(p.health), hu = p.hunger, ar = g.inv.armorPoints();
    const low = hp <= 6;
    const hsig = `${hp}|${hu}|${ar}|${low ? Math.floor(performance.now() / 120) % 2 : 0}|${p.poison > 0}`;
    if (hsig !== c.h) {
      c.h = hsig;
      for (let i = 0; i < 10; i++) {
        const v = hp - i * 2;
        this.heartEls[i].src = heartIcon(v >= 2 ? 'full' : v === 1 ? 'half' : 'empty');
        this.heartEls[i].style.transform = low && (Math.floor(performance.now() / 120) + i) % 2 ? 'translateY(-2px)' : '';
        const f = hu - i * 2;
        this.foodEls[9 - i].src = foodIcon(f >= 2 ? 'full' : f === 1 ? 'half' : 'empty');
        const a = ar - i * 2;
        this.armorEls[i].src = armorIcon(a >= 2 ? 'full' : a === 1 ? 'half' : 'empty');
        this.armorEls[i].style.visibility = ar > 0 ? 'visible' : 'hidden';
      }
      this.armorRow.style.display = ar > 0 ? 'flex' : 'none';
      this.foodEls.forEach((e) => e.classList.toggle('poison', p.poison > 0));
    }
    // phase panel
    const info = phaseInfo(g.state.blocksBroken);
    const psig = `${g.state.blocksBroken}`;
    if (psig !== c.p) {
      c.p = psig;
      this.phName.textContent = info.phase.name;
      this.phSub.textContent = `Phase ${info.index + 1}/${PHASES.length}  ·  Cycle ${info.cycle}`;
      this.phFill.style.width = Math.max(2, info.frac * 100) + '%';
      this.phInfo.innerHTML = `Blocks broken: <b>${g.state.blocksBroken}</b><br>${info.toNext} more to ${info.nextName}`;
      this.phasePanel.dataset.phase = info.phase.key;
    }
    // clock
    const t = g.state.time, label = t < 300 ? 'Day' : t < 345 ? 'Dusk' : t < 555 ? 'Night' : t < 575 ? 'Dawn' : 'Day';
    const night = label === 'Night' || label === 'Dusk';
    if (label !== c.clock) { c.clock = label; this.clockLbl.textContent = label; this.clockIcon.src = night ? moonIcon() : sunIcon(); }
    this.clockLbl.dataset.t = Math.floor(t / 60);
  }

  damage() {
    const v = this.vignette; v.classList.remove('hit'); void v.offsetWidth; v.classList.add('hit');
  }

  toast(title, desc) {
    const t = el('div', 'toast', this.toasts);
    const ic = el('img', '', t); ic.src = trophyIcon();
    const b = el('div', '', t);
    el('small', '', b).textContent = 'Goal reached!';
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

  // ------------------------------------------------------------------ per-frame
  update(dt) {
    if (this.dirty) { this.dirty = false; if (this.win) this.win.refresh(); }
    this.updateHud(dt);
    if (this.win) { this.win.tick(dt); }
  }

  // ------------------------------------------------------------------ cursor stack / tooltip
  placeCursor() { this.cursorEl.style.transform = `translate(${this.mx - 20}px, ${this.my - 20}px)`; }
  updateCursor() {
    const s = this.cursor;
    if (!s) { this.cursorEl.classList.add('hidden'); return; }
    this.cursorEl.classList.remove('hidden');
    this.cursorImg.src = this.icon(s.key); this.cursorCnt.textContent = s.n > 1 ? s.n : '';
    this.placeCursor();
  }
  showTip(stack) {
    if (!stack || this.cursor) { this.tip.classList.add('hidden'); return; }
    const d = ITEMS[stack.key]; const md = maxDurability(stack.key);
    this.tip.innerHTML = '';
    el('div', 'tn', this.tip).textContent = d.name;
    if (md && stack.dur !== undefined) el('div', 'td', this.tip).textContent = `Durability: ${stack.dur} / ${md}`;
    if (d.food) el('div', 'td', this.tip).textContent = `Restores ${d.food.hunger / 2} hunger`;
    if (d.fuel) el('div', 'td', this.tip).textContent = `Fuel: ${d.fuel / 10} smelts`;
    this.tip.classList.remove('hidden'); this.placeTip();
  }
  placeTip() {
    const w = this.tip.offsetWidth, h = this.tip.offsetHeight;
    let x = (this.mx || 0) + 16, y = (this.my || 0) - 8;
    if (x + w > innerWidth - 6) x = innerWidth - w - 6;
    if (y + h > innerHeight - 6) y = innerHeight - h - 6;
    this.tip.style.transform = `translate(${x}px, ${y}px)`;
  }

  // ------------------------------------------------------------------ screens
  setScreen(node, cls = '') {
    this.screen.innerHTML = ''; this.screen.className = 'screen ' + cls;
    this.screen.appendChild(node);
  }

  open(type, data = {}) {
    const g = this.game;
    if (this.current && type !== 'settings' && type !== 'confirm') this.close(true);
    this.prev = this.current;
    this.current = type;
    if (type !== 'settings' && type !== 'confirm') g.input.unlock();
    this.hoverSlot = null; this.showTip(null);
    g.input.releaseAll();
    this.entityKey = data.key || null;
    this.hud.classList.toggle('windowopen', type === 'inventory' || type === 'furnace' || type === 'chest');
    switch (type) {
      case 'inventory': case 'furnace': case 'chest': {
        this.win = new Window(this, type, { table: !!data.table, key: data.key });
        this.setScreen(this.win.root, 'dim windowscreen');
        this.sfx(type === 'chest' ? 'click' : 'click');
        break;
      }
      case 'pause': this.buildPause(); break;
      case 'goals': this.buildGoals(); break;
      case 'death': this.buildDeath(data.cause); break;
      case 'settings': this.buildSettings(); break;
      default: break;
    }
  }

  /** Close the current screen. skipRelock: caller will manage pointer lock. */
  close(skipRelock) {
    const g = this.game;
    if (this.cursor) { this.returnCursor(); }
    this.win = null;
    this.hud.classList.remove('windowopen');
    this.current = null; this.entityKey = null;
    this.screen.className = 'screen hidden'; this.screen.innerHTML = '';
    this.showTip(null);
    if (!skipRelock && g.mode === 'play' && !g.player.dead) {
      g.input.lock();
      // if the browser refuses (e.g. Esc cooldown) the pointerlockerror handler opens the pause menu
    }
    this.cursorEl.classList.add('hidden');
  }

  returnCursor() {
    const g = this.game, s = this.cursor; this.cursor = null;
    if (!s) return;
    const left = g.inv.add(s.key, s.n, s.dur);
    if (left > 0) { const p = g.player; g.dropItem(s.key, left, p.x, p.y + 1, p.z, s.dur); }
    this.dirty = true;
  }

  onKey(e) {
    const cur = this.current;
    if (e.code === 'Escape') {
      if (cur === 'settings' || cur === 'confirm') { this.back(); return; }
      if (cur === 'death' || cur === 'pause') return; // browsers refuse to re-lock the pointer after Esc; the Resume button is the gesture
      this.close(); return;
    }
    if (cur === 'inventory' || cur === 'furnace' || cur === 'chest') {
      if (e.code === 'KeyE') { this.close(); return; }
      const m = /^Digit([1-9])$/.exec(e.code);
      if (m && this.hoverSlot && this.win) {
        const hs = this.hoverSlot, hb = this.win.slots.find((s) => s.hotbarIdx === +m[1] - 1);
        if (hb && hs !== hb && hs.kind !== 'output' && !this.cursor) {
          const a = hs.get(), b = hb.get();
          if ((!b || hs.accepts(b)) && (!a || hb.accepts(a))) { hs.set(b); hb.set(a); this.win.after(); }
        }
      }
    } else if (cur === 'goals' && (e.code === 'KeyJ')) this.close();
  }

  back() {
    const g = this.game;
    if (this.returnTo === 'title') { this.current = null; this.screen.className = 'screen hidden'; this.screen.innerHTML = ''; this.returnTo = null; this.title.classList.remove('hidden'); return; }
    this.current = null; this.open('pause');
    void g;
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
    this.btn(p, 'Resume', () => this.close());
    this.btn(p, `Goals  (${g.goals.count}/${GOALS.length})`, () => { this.close(true); this.open('goals'); });
    this.btn(p, 'Settings', () => { this.returnTo = null; this.open('settings'); });
    this.btn(p, 'Save & Quit to Title', () => { g.toTitle(); });
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
    this.btn(row, 'Cancel', () => { this.current = null; if (this.game.mode === 'title') { this.screen.className = 'screen hidden'; this.screen.innerHTML = ''; this.title.classList.remove('hidden'); } else this.open('pause'); });
    this.setScreen(p, 'dim center');
  }

  buildGoals() {
    const g = this.game;
    const p = this.panelBox(`Goals  ${g.goals.count}/${GOALS.length}`);
    p.classList.add('goals');
    const list = el('div', 'goallist', p);
    for (const goal of GOALS) {
      const done = !!g.goals.done[goal.id];
      const r = el('div', 'goal' + (done ? ' done' : ''), list);
      el('i', '', r).textContent = done ? '✔' : '';
      const b = el('div', '', r); el('strong', '', b).textContent = goal.name; el('span', '', b).textContent = goal.desc;
    }
    this.btn(p, 'Close', () => this.close());
    this.setScreen(p, 'dim center');
  }

  buildDeath(cause) {
    const p = el('div', 'panel menu death');
    el('h1', '', p).textContent = 'You died!';
    el('p', 'cause', p).textContent = cause || 'You died';
    this.btn(p, 'Respawn', () => this.game.respawn());
    this.btn(p, 'Save & Quit to Title', () => { this.game.player.dead = false; this.game.toTitle(); });
    this.setScreen(p, 'dim center deathscreen');
  }

  buildSettings() {
    const g = this.game, s = g.settings;
    const p = this.panelBox('Settings');
    const row = (label, ctl) => { const r = el('label', 'setrow', p); el('span', '', r).textContent = label; r.appendChild(ctl); return r; };
    const slider = (min, max, step, val, fmt, on) => {
      const w = el('div', 'slwrap'); const i = el('input', '', w); i.type = 'range'; i.min = min; i.max = max; i.step = step; i.value = val;
      const o = el('b', '', w); o.textContent = fmt(val);
      i.oninput = () => { o.textContent = fmt(+i.value); on(+i.value); saveSettings(s); };
      return w;
    };
    row('Mouse sensitivity', slider(0.2, 3, 0.05, s.sens, (v) => v.toFixed(2) + 'x', (v) => { s.sens = v; }));
    row('Field of view', slider(60, 110, 1, s.fov, (v) => v + '°', (v) => { s.fov = v; }));
    row('Volume', slider(0, 1, 0.02, s.volume, (v) => Math.round(v * 100) + '%', (v) => { s.volume = v; g.sound.setVolume(v); }));
    const q = el('button', 'btn small', null); q.textContent = s.quality === 'high' ? 'High' : 'Low';
    q.onclick = () => { s.quality = s.quality === 'high' ? 'low' : 'high'; q.textContent = s.quality === 'high' ? 'High' : 'Low'; g.renderer.setQuality(s.quality); saveSettings(s); this.sfx('click'); };
    row('Graphics quality', q);
    const iy = el('button', 'btn small', null); iy.textContent = s.invertY ? 'On' : 'Off';
    iy.onclick = () => { s.invertY = !s.invertY; iy.textContent = s.invertY ? 'On' : 'Off'; saveSettings(s); this.sfx('click'); };
    row('Invert Y axis', iy);
    this.btn(p, 'Done', () => this.back());
    this.setScreen(p, 'dim center');
  }

  // ------------------------------------------------------------------ title
  showTitle() {
    const g = this.game, t = this.title;
    this.hud.classList.add('hidden');
    t.innerHTML = ''; t.classList.remove('hidden');
    const logo = el('div', 'logo', t);
    el('h1', '', logo).innerHTML = '<span>ONE</span><span>BLOCK</span>';
    el('p', 'tag', logo).textContent = 'A skyblock survival in 3D';
    const m = el('div', 'titlemenu', t);
    const has = g.hasSave();
    this.btn(m, has ? 'Continue' : 'Play', () => { t.classList.add('hidden'); g.startPlaying(); }, 'primary');
    this.btn(m, has ? 'New World' : 'Play (new world)', () => {
      const go = () => { t.classList.add('hidden'); g.newWorld(); g.startPlaying(); };
      if (has) { t.classList.add('hidden'); this.confirm('Start a new world? Your saved world will be erased.', go); }
      else go();
    });
    this.btn(m, 'Settings', () => { this.returnTo = 'title'; t.classList.add('hidden'); this.current = null; this.open('settings'); });
    const hint = el('div', 'controls', t);
    hint.innerHTML = '<b>WASD</b> move · <b>Mouse</b> look · <b>LMB</b> break · <b>RMB</b> place/use · <b>Shift</b> sneak · <b>Ctrl</b> sprint · <b>E</b> inventory · <b>J</b> goals · <b>Q</b> drop · <b>1-9</b> hotbar';
  }

  hideTitle() { this.title.classList.add('hidden'); this.hud.classList.remove('hidden'); this.dirty = true; this.hudCache = {}; this.hbSlots.forEach((o) => { o.sig = ''; }); }
}
