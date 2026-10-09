// Per-seat UI: HUD, windows, death/goals panels, all inside the seat's view rect. (SPEC-PLATFORMS §4)
import { ITEMS } from '../data/items.js';
import { maxDurability } from '../game/Inventory.js';
import { GOALS } from '../game/Goals.js';
import { heartIcon, foodIcon, armorIcon } from './pixelicons.js';
import { Window } from './Windows.js';
import { MenuNav, readUi } from './focus.js';

const el = (tag, cls, parent) => { const e = document.createElement(tag); if (cls) e.className = cls; if (parent) parent.appendChild(e); return e; };
const WINDOWS = new Set(['inventory', 'furnace', 'chest']);

export class SeatUI {
  constructor(seat, ui) {
    this.seat = seat; this.ui = ui; this.game = seat.game;
    this.current = null; this.win = null; this.cursor = null; this.hoverSlot = null; this.entityKey = null;
    this.bookFilter = 'all'; this.dirty = true; this.padMode = false; this.hudCache = {}; this.rectSig = '';
    this.scale = 1;

    const root = this.root = el('div', 'seathud hidden', ui.root);
    root.dataset.seat = seat.index;
    root.style.setProperty('--seat', seat.info.color);
    this.inner = el('div', 'hudinner', root);
    this.buildHud(this.inner);
    this.nameChip = el('div', 'namechip', root); this.nameChip.textContent = seat.name;
    this.overlay = el('div', 'seatoverlay hidden', root);
    this.overlay.innerHTML = '<strong>Controller disconnected</strong><span>Turn it on again to keep playing</span>';
    this.screen = el('div', 'screen hidden', root);
    this.cursorEl = el('div', 'cursoritem hidden', ui.overlay);
    this.cursorImg = el('img', '', this.cursorEl); this.cursorCnt = el('span', 'scount', this.cursorEl);
    this.menuNav = new MenuNav(() => this.panelNode, { onBack: () => { if (this.current === 'goals') this.close(); } });
    this.panelNode = null;
  }

  icon(key) { return this.game.renderer.getItemIcon(key); }
  sfx(n) { this.game.sound.play(n); }
  dirtyInv() { this.dirty = true; }
  setVisible(v) { this.root.classList.toggle('hidden', !v); }

  message(text) {
    const m = this.msg; m.textContent = text; m.classList.remove('show'); void m.offsetWidth; m.classList.add('show');
    clearTimeout(this.msgT); this.msgT = setTimeout(() => m.classList.remove('show'), 2600);
  }
  damage() { const v = this.vignette; v.classList.remove('hit'); void v.offsetWidth; v.classList.add('hit'); }
  setHint(text) {
    if (text === this.hintText) return;
    this.hintText = text;
    const e = this.hintEl;
    e.classList.remove('show');
    clearTimeout(this.hintT);
    if (!text) return;
    this.hintT = setTimeout(() => { e.textContent = text; e.classList.add('show'); }, 250);
  }

  // ------------------------------------------------------------------ HUD
  buildHud(h) {
    el('div', 'crosshair', h);
    const bottom = this.bottom = el('div', 'bottom', h);
    const stats = el('div', 'stats', bottom);
    this.hearts = el('div', 'row hearts', stats); this.hunger = el('div', 'row food', stats); this.armorRow = el('div', 'row armor', bottom);
    this.heartEls = []; this.foodEls = []; this.armorEls = [];
    for (let i = 0; i < 10; i++) { this.heartEls.push(el('img', '', this.hearts)); this.foodEls.push(el('img', '', this.hunger)); this.armorEls.push(el('img', '', this.armorRow)); }
    this.heldName = el('div', 'heldname', bottom);
    const hb = this.hotbar = el('div', 'hotbar', bottom);
    hb.dataset.obHotbar = '1'; // agreed selector with the touch overlay: [data-ob-hotbar]
    this.hbSlots = [];
    for (let i = 0; i < 9; i++) {
      const s = el('div', 'slot hb', hb); const img = el('img', 'sicon', s); const cnt = el('span', 'scount', s); const bar = el('div', 'sbar', s); const fill = el('i', '', bar);
      el('em', 'hbnum', s).textContent = i + 1;
      s.addEventListener('pointerdown', (e) => { if (e.pointerType === 'touch') { e.preventDefault(); this.seat.selectSlot(i); } });
      this.hbSlots.push({ s, img, cnt, bar, fill, sig: '' });
    }
    this.msg = el('div', 'actionmsg', h);
    this.hintEl = el('div', 'hintbar', h);
    this.vignette = el('div', 'vignette', h);
  }

  updateHud() {
    const seat = this.seat, p = seat.player, c = this.hudCache, inv = seat.inv;
    this.hbSlots.forEach((o, i) => {
      const st = inv.slots[i];
      const sig = (st ? `${st.key}|${st.n}|${st.dur ?? ''}` : '') + (seat.sel === i ? '*' : '');
      if (sig === o.sig) return; o.sig = sig;
      o.s.classList.toggle('sel', seat.sel === i);
      if (!st) { o.img.style.visibility = 'hidden'; o.cnt.textContent = ''; o.bar.style.display = 'none'; return; }
      o.img.style.visibility = 'visible'; o.img.src = this.icon(st.key); o.cnt.textContent = st.n > 1 ? st.n : '';
      const md = maxDurability(st.key);
      if (md && st.dur !== undefined && st.dur < md) { const f = Math.max(0, st.dur / md); o.bar.style.display = 'block'; o.fill.style.width = f * 100 + '%'; o.fill.style.background = `hsl(${Math.round(f * 120)},85%,50%)`; } else o.bar.style.display = 'none';
    });
    const held = inv.slots[seat.sel];
    const hn = held ? ITEMS[held.key].name : '';
    if (hn !== c.held) { c.held = hn; this.heldName.textContent = hn; this.heldName.classList.remove('flash'); void this.heldName.offsetWidth; if (hn) this.heldName.classList.add('flash'); }
    const hp = Math.ceil(p.health), hu = p.hunger, ar = inv.armorPoints();
    const low = hp <= 6;
    const blink = low ? Math.floor(performance.now() / 120) % 2 : 0;
    const hsig = `${hp}|${hu}|${ar}|${blink}|${p.poison > 0}`;
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
    this.overlay.classList.toggle('hidden', !seat.disconnected);
    this.root.classList.toggle('disc', !!seat.disconnected);
    this.root.classList.toggle('windowopen', WINDOWS.has(this.current));
  }

  // ------------------------------------------------------------------ layout
  rect() {
    const g = this.game, seat = this.seat;
    if (seat.view && g.renderer.getViewRect) { try { return g.renderer.getViewRect(seat.view); } catch { /* fall through */ } }
    return { x: 0, y: 0, w: innerWidth, h: innerHeight };
  }

  layout(force) {
    const r = this.rect(), g = this.game, multi = g.seats.length > 1;
    const sig = `${r.x | 0},${r.y | 0},${r.w | 0},${r.h | 0},${multi}`;
    if (!force && sig === this.rectSig) return;
    this.rectSig = sig;
    const st = this.root.style;
    st.left = r.x + 'px'; st.top = r.y + 'px'; st.width = r.w + 'px'; st.height = r.h + 'px';
    this.root.classList.toggle('multi', multi);
    const cap = Math.max(1, g.platform.uiScale);
    let s = Math.max(0.55, Math.min(cap, r.w / 520, r.h / (multi ? 380 : 400)));
    if (g.platform.key === 'ipad') s = Math.min(s, Math.max(0.6, (r.w - 560) / 450)); // keep the hotbar clear of the touch buttons on both sides
    this.scale = s;
    this.inner.style.width = r.w / s + 'px'; this.inner.style.height = r.h / s + 'px';
    this.inner.style.transform = `scale(${s})`;
    this.fitPanel();
  }

  /** Scale the open window/panel to fit this rect; switch the inventory to tabs when it would be too small. */
  fitPanel() {
    const node = this.panelNode; if (!node) return;
    const r = this.rect(), g = this.game, multi = g.seats.length > 1;
    const cap = Math.max(1, g.platform.uiScale);
    const measure = () => { node.style.transform = 'none'; return { w: node.offsetWidth, h: node.offsetHeight }; };
    let d = measure();
    const fitOf = () => Math.min((r.w * 0.96) / d.w, (r.h * 0.92) / d.h);
    let fit = fitOf();
    if (this.win && this.win.type === 'inventory') {
      this.win.setTabbed(false); d = measure(); fit = fitOf();
      if (fit < (multi ? 0.9 : 0.7)) { this.win.setTabbed(true); d = measure(); fit = fitOf(); }
    }
    const s = Math.min(fit, multi ? 1.15 : cap);
    node.style.transform = `scale(${s})`;
    this.panelScale = s;
  }

  // ------------------------------------------------------------------ per-frame
  update() {
    this.layout();
    if (this.dirty) { this.dirty = false; if (this.win) this.win.refresh(); }
    this.updateHud();
    if (this.win) this.win.tick();
    if (this.cursor) this.placeCursor();
  }

  // ------------------------------------------------------------------ cursor stack / tooltip
  placeCursor() {
    let x = this.ui.mx || 0, y = this.ui.my || 0;
    if (this.padMode && this.win && this.win.focusEl) { const r = this.win.focusEl.getBoundingClientRect(); x = r.left + r.width * 0.7; y = r.top + r.height * 0.7; }
    this.cursorEl.style.transform = `translate(${x - 20}px, ${y - 20}px)`;
  }
  updateCursor() {
    const s = this.cursor;
    if (!s) { this.cursorEl.classList.add('hidden'); return; }
    this.cursorEl.classList.remove('hidden');
    this.cursorImg.src = this.icon(s.key); this.cursorCnt.textContent = s.n > 1 ? s.n : '';
    this.placeCursor();
  }
  showTip(stack, anchor) { this.ui.showTip(this.cursor ? null : stack, this.padMode ? anchor : null); }
  focusChanged(win, elm, fromPad) {
    if (fromPad) this.padMode = true;
    this.root.classList.toggle('padnav', this.padMode);
    const slot = elm && elm._slot;
    this.showTip(slot ? slot.get() : null, elm);
    if (this.cursor) this.placeCursor();
  }
  returnCursor() {
    const g = this.game, s = this.cursor; this.cursor = null;
    if (!s) return;
    const left = this.seat.inv.add(s.key, s.n, s.dur);
    if (left > 0) { const p = this.seat.player; g.dropItem(s.key, left, p.x, p.y + 1, p.z, s.dur); }
    this.dirty = true;
  }

  // ------------------------------------------------------------------ screens
  setPanel(node, cls = '') {
    this.screen.innerHTML = ''; this.screen.className = 'screen ' + cls;
    this.screen.appendChild(node);
    this.panelNode = node;
  }

  open(type, data = {}) {
    const g = this.game;
    if (this.current) this.close(true, true);
    this.current = type;
    this.entityKey = data.key || null;
    this.hoverSlot = null; this.showTip(null);
    this.seat.setMode('menu');
    g.onSeatUiOpen(this.seat, type);
    this.padMode = !!(this.seat.input && this.seat.input.kind === 'gamepad');
    if (this.padMode && !this._padFilter) { this._padFilter = true; this.bookFilter = 'can'; } // controllers start on the short Craftable list
    if (WINDOWS.has(type)) {
      this.win = new Window(this, type, { table: !!data.table, key: data.key });
      this.setPanel(this.win.root, 'dim windowscreen');
      this.sfx('click');
      this.fitPanel();
      this.win.focusFirst();
    } else if (type === 'goals') this.buildGoals();
    else if (type === 'death') this.buildDeath(data.cause);
    this.root.classList.toggle('padnav', this.padMode);
    this.layout(true);
    if (!WINDOWS.has(type)) { this.menuNav.reset(); }
  }

  close(skipRelock, quiet) {
    if (this.cursor) this.returnCursor();
    this.win = null; this.panelNode = null;
    this.current = null; this.entityKey = null;
    this.screen.className = 'screen hidden'; this.screen.innerHTML = '';
    this.showTip(null);
    this.cursorEl.classList.add('hidden');
    this.seat.guard = 2;
    if (!quiet) { this.seat.setMode('play'); this.game.afterSeatUiClose(this.seat, skipRelock); }
  }

  /** Controller/keyboard menu input while a seat screen is open. */
  nav(src) {
    const pr = readUi(src);
    const any = Object.keys(pr).length > 0;
    if (any && src.kind === 'gamepad') { this.padMode = true; this.root.classList.add('padnav'); }
    if (!any) return;
    if (this.win) this.win.nav(pr);
    else if (this.current === 'goals' || this.current === 'death') this.menuNav.apply(pr, () => { this.game.padClick = true; });
    this.game.padClick = false;
  }

  buildGoals() {
    const g = this.game;
    const p = el('div', 'panel menu goals');
    el('h2', '', p).textContent = `Goals  ${g.goals.count}/${GOALS.length}`;
    const list = el('div', 'goallist', p);
    for (const goal of GOALS) {
      const done = !!g.goals.done[goal.id];
      const r = el('div', 'goal' + (done ? ' done' : ''), list);
      el('i', '', r).textContent = done ? '✔' : '';
      const b = el('div', '', r); el('strong', '', b).textContent = goal.name; el('span', '', b).textContent = goal.desc;
    }
    this.ui.btn(p, 'Close', () => this.close());
    this.setPanel(p, 'dim center');
    this.fitPanel();
  }

  buildDeath(cause) {
    const g = this.game, p = el('div', 'panel menu death');
    el('h1', '', p).textContent = 'You died!';
    el('p', 'cause', p).textContent = cause || 'You died';
    this.ui.btn(p, 'Respawn', () => this.seat.respawn(), 'primary');
    if (g.seats.length > 1) this.ui.btn(p, `Leave game (${this.seat.name})`, () => g.leaveSeat(this.seat));
    else this.ui.btn(p, 'Save & Quit to Title', () => g.toTitle());
    this.setPanel(p, 'dim center deathscreen');
    this.fitPanel();
  }
}
