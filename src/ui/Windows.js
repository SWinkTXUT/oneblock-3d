// Inventory / furnace / chest windows: slot interaction logic + recipe book. (SPEC §8, §11)
import { ITEMS } from '../data/items.js';
import { RECIPES, SMELTING, SMELT_TIME, missingFor, craftOnce, craftMax, ingredientIcon, ingredientName, countIngredient, maxCrafts } from '../data/recipes.js';
import { ARMOR_SLOTS, maxStack, maxDurability } from '../game/Inventory.js';
import { flameIcon, arrowIcon } from './pixelicons.js';
import { spatialNext, setFocusClass } from './focus.js';

const ING = [...new Set(RECIPES.flatMap((r) => Object.keys(r.in)))];
const el = (tag, cls, parent) => { const e = document.createElement(tag); if (cls) e.className = cls; if (parent) parent.appendChild(e); return e; };

/**
 * Unified press handling. Mouse: button/shift as usual. Touch: tap = left, long-press (450 ms) = right (split / craft max),
 * double-tap = shift (quick move). fn(button, shift).
 */
function pressable(node, fn, { touchMax = false } = {}) {
  let timer = null, fired = false, lastTap = 0, downEv = null;
  node.addEventListener('pointerdown', (e) => {
    e.preventDefault();
    downEv = e;
    if (e.pointerType === 'touch') {
      fired = false;
      timer = setTimeout(() => { fired = true; fn(touchMax ? 0 : 2, touchMax, downEv); }, 450);
    } else fn(e.button, e.shiftKey, e);
  });
  const up = (e) => {
    if (e.pointerType !== 'touch') return;
    clearTimeout(timer);
    if (fired) return;
    const now = performance.now();
    const dbl = now - lastTap < 320; lastTap = dbl ? 0 : now;
    fn(0, dbl, e);
  };
  node.addEventListener('pointerup', up);
  node.addEventListener('pointercancel', () => clearTimeout(timer));
  node.addEventListener('pointerleave', () => clearTimeout(timer));
}

class Slot {
  constructor(win, parent, { get, set, kind = 'normal', accepts = null, group, label = '', hotbarIdx = -1 }) {
    this.win = win; this.get = get; this.set = set; this.kind = kind; this.accepts = accepts || (() => true); this.group = group; this.hotbarIdx = hotbarIdx;
    this.el = el('div', 'slot ' + kind, parent);
    if (label) { this.el.dataset.label = label; }
    this.img = el('img', 'sicon', this.el); this.img.draggable = false;
    this.cnt = el('span', 'scount', this.el);
    this.bar = el('div', 'sbar', this.el); this.barFill = el('i', '', this.bar);
    this.cache = '';
    pressable(this.el, (button, shift) => { win.setFocus(this.el, true); win.slotClick(this, button, shift); }, { touchMax: false });
    this.el._slot = this;
    this.el.addEventListener('mouseenter', () => { win.ui.hoverSlot = this; win.ui.showTip(this.get(), this.el); });
    this.el.addEventListener('mouseleave', () => { if (win.ui.hoverSlot === this) win.ui.hoverSlot = null; win.ui.showTip(null); });
    this.render(true);
  }
  render(force) {
    const s = this.get();
    const sig = s ? `${s.key}|${s.n}|${s.dur ?? ''}` : '';
    if (!force && sig === this.cache) return;
    this.cache = sig;
    if (!s) { this.img.style.visibility = 'hidden'; this.cnt.textContent = ''; this.bar.style.display = 'none'; return; }
    this.img.style.visibility = 'visible';
    this.img.src = this.win.ui.icon(s.key);
    this.cnt.textContent = s.n > 1 ? s.n : '';
    const md = maxDurability(s.key);
    if (md && s.dur !== undefined && s.dur < md) {
      const f = Math.max(0, s.dur / md);
      this.bar.style.display = 'block';
      this.barFill.style.width = f * 100 + '%';
      this.barFill.style.background = `hsl(${Math.round(f * 120)},85%,50%)`;
    } else this.bar.style.display = 'none';
  }
}

function insertInto(slots, stack) {
  const max = maxStack(stack.key);
  if (max > 1 && !stack.dur) {
    for (const sl of slots) {
      const s = sl.get();
      if (s && s.key === stack.key && s.n < max && sl.accepts(stack)) { const t = Math.min(max - s.n, stack.n); s.n += t; stack.n -= t; sl.set(s); if (stack.n <= 0) return 0; }
    }
  }
  for (const sl of slots) {
    if (!sl.get() && sl.accepts(stack)) { const t = Math.min(max, stack.n); sl.set({ ...stack, n: t }); stack.n -= t; if (stack.n <= 0) return 0; }
  }
  return stack.n;
}

export class Window {
  /** type: 'inventory' | 'furnace' | 'chest'; opts: { table, key } */
  constructor(ui, type, opts) {
    this.ui = ui; this.game = ui.game; this.seat = ui.seat; this.type = type; this.opts = opts;
    this.inv = this.seat.inv;
    this.tabbed = false; this.tab = 'inv'; this.focusEl = null; this.focusRecipe = null;
    this.slots = [];
    this.root = el('div', 'window ' + type);
    const x = el('button', 'winclose', this.root); x.textContent = '\u2715'; x.setAttribute('aria-label', 'Close');
    x.addEventListener('pointerdown', (e) => { e.preventDefault(); e.stopPropagation(); ui.sfx('click'); ui.close(); });
    this.entity = opts.key ? this.game.entities.get(opts.key) : null;
    this.build();
  }

  mk(parent, def) { const s = new Slot(this, parent, def); this.slots.push(s); return s; }

  invSlot(parent, i) {
    return this.mk(parent, { get: () => this.inv.slots[i], set: (v) => { this.inv.slots[i] = v; }, group: i < 9 ? 'hotbar' : 'main', hotbarIdx: i < 9 ? i : -1 });
  }

  build() {
    const left = this.leftPanel = el('div', 'panel left', this.root);
    const title = el('h2', '', left);
    const t = this.type;
    if (t === 'inventory') {
      title.textContent = this.opts.table ? 'Crafting Table' : 'Inventory';
      const top = el('div', 'invtop', left);
      const arm = el('div', 'armorcol', top);
      ARMOR_SLOTS.forEach((nm, i) => this.mk(arm, {
        get: () => this.inv.armor[i], set: (v) => { this.inv.armor[i] = v; this.ui.dirtyInv(); }, kind: 'armor', group: 'armor', label: nm,
        accepts: (s) => !!(ITEMS[s.key].armor && ITEMS[s.key].armor.slot === nm),
      }));
      const hero = el('div', 'hero', top);
      this.defense = el('div', 'defense', hero);
      el('div', 'herotxt', hero).textContent = this.opts.table ? 'Table recipes unlocked' : 'Tip: stand near a Crafting Table for more recipes';
    } else if (t === 'furnace') {
      title.textContent = 'Furnace';
      const row = el('div', 'furnrow', left);
      const col = el('div', 'furncol', row);
      this.fIn = this.mk(col, { get: () => this.entity.input, set: (v) => { this.entity.input = v; }, group: 'fin', accepts: () => true });
      this.flame = el('img', 'flame', col);
      this.fFuel = this.mk(col, { get: () => this.entity.fuel, set: (v) => { this.entity.fuel = v; }, group: 'ffuel', accepts: (s) => !!ITEMS[s.key].fuel });
      const mid = el('div', 'furnmid', row);
      this.arrow = el('div', 'arrowbox', mid);
      this.arrowBg = el('img', '', this.arrow); this.arrowBg.src = arrowIcon(false);
      this.arrowFg = el('div', 'arrowfg', this.arrow); const fi = el('img', '', this.arrowFg); fi.src = arrowIcon(true);
      this.fOut = this.mk(row, { get: () => this.entity.output, set: (v) => { this.entity.output = v; }, kind: 'output', group: 'fout' });
    } else if (t === 'chest') {
      title.textContent = 'Chest';
      const grid = el('div', 'grid9', left);
      for (let i = 0; i < 27; i++) this.mk(grid, { get: () => this.entity.slots[i], set: (v) => { this.entity.slots[i] = v; }, group: 'chest' });
    }
    el('h3', '', left).textContent = 'Backpack';
    const grid = el('div', 'grid9', left);
    for (let i = 9; i < 36; i++) this.invSlot(grid, i);
    const hb = el('div', 'grid9 hotrow', left);
    for (let i = 0; i < 9; i++) this.invSlot(hb, i);

    if (t === 'inventory') {
      this.buildBook();
      this.tabBar = el('div', 'wintabs', this.root);
      this.tabBtns = {};
      for (const [k, label] of [['inv', '\u25C0 LB  Inventory'], ['book', 'Recipes  RB \u25B6']]) {
        const b = el('button', 'chip tab', this.tabBar); b.textContent = label; b._tab = k;
        b.onpointerdown = (e) => { e.preventDefault(); this.setTab(k); };
      }
    }
    this.refresh();
  }

  // ------------------------------------------------------------------ recipe book
  buildBook() {
    const p = el('div', 'panel book', this.root);
    const head = el('div', 'bookhead', p);
    el('h2', '', head).textContent = 'Recipe Book';
    const chips = el('div', 'chips', head);
    this.filter = this.ui.bookFilter || 'all';
    this.chipEls = {};
    for (const [k, label] of [['all', 'All'], ['can', 'Craftable']]) {
      const c = el('button', 'chip', chips); c.textContent = label;
      c.onclick = () => { this.filter = k; this.ui.bookFilter = k; this.ui.sfx('click'); this.renderBook(); };
      this.chipEls[k] = c; c._chip = k;
    }
    this.bookList = el('div', 'booklist', p);
    this.bookPanel = p;
    pressable(this.bookList, (button, shift, ev) => { const row = ev.target.closest && ev.target.closest('.recipe'); if (row) { this.setFocus(row, true); this.craft(RECIPES[+row.dataset.id], shift); } }, { touchMax: true });
  }

  tableOk() {
    if (this.opts.table) return true;
    const now = performance.now();
    if (now - (this.tblT || 0) > 250) { this.tblT = now; this.tblV = this.seat.nearTable(); }
    return !!this.tblV;
  }

  craft(r, shift) {
    const g = this.game;
    if (r.table && !this.tableOk()) { this.ui.message('Requires a nearby Crafting Table'); this.ui.sfx('click'); return; }
    const n = shift ? craftMax(r, this.inv) : (craftOnce(r, this.inv) ? 1 : 0);
    if (n > 0) {
      g.sound.play('craft');
      for (let i = 0; i < n; i++) g.events.emit('craft', r.out);
      this.ui.dirtyInv();
    } else {
      const miss = missingFor(r, this.inv);
      this.ui.message(Object.keys(miss).length ? 'Missing ingredients' : 'Inventory full');
      this.ui.sfx('click');
    }
  }

  renderBook() {
    if (!this.bookList) return;
    const list = this.bookList, scroll = list.scrollTop;
    for (const k in this.chipEls) this.chipEls[k].classList.toggle('on', this.filter === k);
    list.innerHTML = '';
    const ok = this.tableOk();
    const items = RECIPES.map((r) => ({ r, miss: missingFor(r, this.inv) }));
    // stable order (fixed recipe order): only the bright/dim styling changes, never row positions
    for (const { r, miss } of items) {
      const craftable = Object.keys(miss).length === 0 && (!r.table || ok);
      if (this.filter === 'can' && !craftable) continue;
      const row = el('div', 'recipe' + (craftable ? ' can' : ' no') + (r.table && !ok ? ' locked' : ''), list);
      row.dataset.id = r.id;
      const ic = el('div', 'rout', row);
      const img = el('img', '', ic); img.src = this.ui.icon(r.out);
      if (r.count > 1) el('span', 'scount', ic).textContent = r.count;
      const info = el('div', 'rinfo', row);
      const nm = el('div', 'rname', info); nm.textContent = ITEMS[r.out].name;
      if (r.table) { const tb = el('img', 'rtable', nm); tb.src = this.ui.icon('crafting_table'); tb.title = 'Needs a Crafting Table'; }
      const ing = el('div', 'ings', info);
      for (const [k, n] of Object.entries(r.in)) {
        const have = countIngredient(this.inv, k);
        const c = el('span', 'ing' + (have < n ? ' miss' : ''), ing);
        const im = el('img', '', c); im.src = this.ui.icon(ingredientIcon(k));
        const tx = el('b', '', c); tx.textContent = have < n ? `${have}/${n}` : `${n}`;
        c.title = ingredientName(k);
      }
    }
    if (!list.children.length) { const e = el('div', 'empty', list); e.textContent = 'Nothing craftable yet. Gather materials!'; }
    list.scrollTop = scroll;
    if (this.focusRecipe !== null) {
      const row = [...list.children].find((r) => r.dataset && +r.dataset.id === this.focusRecipe);
      if (row) { setFocusClass(row, true); this.focusEl = row; } else this.focusRecipe = null;
    }
  }

  // ------------------------------------------------------------------ slot interaction
  slotClick(slot, button, shift) {
    const ui = this.ui;
    const cur = ui.cursor, s = slot.get();
    ui.sfx('click');
    if (slot.kind === 'output') {
      if (!s) return;
      if (shift) { this.quickMove(slot); }
      else if (!cur) { ui.cursor = s; slot.set(null); }
      else if (cur.key === s.key && cur.n + s.n <= maxStack(s.key) && !cur.dur) { cur.n += s.n; slot.set(null); }
      this.after(); return;
    }
    if (shift && s) { this.quickMove(slot); this.after(); return; }
    if (button === 0 || button === 1) {
      if (!cur) { if (s) { ui.cursor = s; slot.set(null); } }
      else if (!slot.accepts(cur)) return;
      else if (!s) { slot.set(cur); ui.cursor = null; }
      else if (s.key === cur.key && maxStack(s.key) > 1 && s.dur === undefined) {
        const t = Math.min(cur.n, maxStack(s.key) - s.n); s.n += t; cur.n -= t; if (cur.n <= 0) ui.cursor = null; slot.set(s);
      } else { slot.set(cur); ui.cursor = s; }
    } else if (button === 2) {
      if (!cur) { if (s) { const take = Math.ceil(s.n / 2); ui.cursor = { ...s, n: take }; s.n -= take; slot.set(s.n > 0 ? s : null); } }
      else if (!slot.accepts(cur)) return;
      else if (!s) { slot.set({ ...cur, n: 1 }); cur.n--; if (cur.n <= 0) ui.cursor = null; }
      else if (s.key === cur.key && maxStack(s.key) > 1 && s.dur === undefined) { if (s.n < maxStack(s.key)) { s.n++; cur.n--; if (cur.n <= 0) ui.cursor = null; slot.set(s); } }
      else { slot.set(cur); ui.cursor = s; }
    }
    this.after();
  }

  group(g) { return this.slots.filter((s) => s.group === g); }

  quickMove(slot) {
    const s = slot.get(); if (!s) return;
    const def = ITEMS[s.key];
    let targets;
    const g = slot.group;
    if (g === 'hotbar' || g === 'main') {
      if (def.armor && this.type === 'inventory') {
        const as = this.group('armor').filter((a) => a.accepts(s) && !a.get());
        if (as.length) { as[0].set({ ...s }); slot.set(null); return; }
      }
      if (this.type === 'chest') targets = this.group('chest');
      else if (this.type === 'furnace') {
        const fi = this.fIn.get();
        targets = SMELTING[s.key] && (!fi || fi.key === s.key) ? [this.fIn] : def.fuel ? [this.fFuel] : SMELTING[s.key] ? [this.fIn] : [];
      } else targets = [];
      if (!targets.length) targets = g === 'hotbar' ? this.group('main') : this.group('hotbar');
    } else targets = [...this.group('hotbar'), ...this.group('main')];
    const copy = { ...s };
    const left = insertInto(targets, copy);
    if (left <= 0) slot.set(null); else { s.n = left; slot.set(s); }
  }

  after() {
    this.ui.dirtyInv();
    this.refresh();
    this.ui.updateCursor();
  }

  refresh() {
    if (this.type !== 'inventory' && this.opts.key && !this.game.entities.get(this.opts.key)) { this.ui.close(); return; }
    if (this.opts.key) this.entity = this.game.entities.get(this.opts.key);
    for (const s of this.slots) s.render();
    if (this.defense) this.defense.textContent = `Defense ${this.inv.armorPoints()}`;
    const sig = this.bookSignature();
    if (sig !== this.bookSig) { this.bookSig = sig; this.renderBook(); }
    else this.refreshBookCounts();
  }
  refreshBookCounts() { /* signature unchanged => rows identical */ }
  bookSignature() { return ING.map((k) => countIngredient(this.inv, k)).join(',') + (this.tableOk() ? 'T' : 't') + this.filter; }

  // ------------------------------------------------------------------ tabs (small view rects)
  setTabbed(on) {
    if (this.type !== 'inventory') return;
    this.tabbed = on;
    this.root.classList.toggle('tabbed', on);
    this.setTab(this.tab, true);
  }
  setTab(k, quiet) {
    this.tab = k;
    this.root.dataset.tab = k;
    if (this.tabBtns) for (const t in this.tabBtns) this.tabBtns[t].classList.toggle('on', t === k);
    if (!quiet) { this.ui.sfx('click'); this.focusFirst(); }
  }

  // ------------------------------------------------------------------ controller focus
  focusables() {
    const out = [];
    for (const s of this.slots) if (s.el.offsetParent !== null) out.push(s.el);
    if (this.bookList && this.bookList.offsetParent !== null) {
      for (const c of Object.values(this.chipEls)) out.push(c);
      for (const r of this.bookList.children) if (r.dataset && r.dataset.id !== undefined) out.push(r);
    }
    return out;
  }

  setFocus(elm, fromPointer) {
    if (this.focusEl) setFocusClass(this.focusEl, false);
    for (const r of this.bookList ? this.bookList.querySelectorAll('.recipe.focus') : []) r.classList.remove('focus');
    this.focusEl = elm || null;
    this.focusRecipe = elm && elm.dataset && elm.dataset.id !== undefined ? +elm.dataset.id : null;
    setFocusClass(elm, true);
    if (elm && !fromPointer && elm.scrollIntoView) elm.scrollIntoView({ block: 'nearest' });
    this.ui.focusChanged(this, elm, !fromPointer);
  }

  focusFirst() {
    const els = this.focusables();
    let first = null;
    if (this.type === 'inventory') first = els.find((e) => e._slot && e._slot.hotbarIdx === this.seat.sel) || els[0];
    else if (this.type === 'furnace') first = this.fIn && this.fIn.el;
    else first = els[0];
    this.setFocus(first || els[0]);
  }

  /** pr from readUi(). */
  nav(pr) {
    let els = this.focusables();
    if (!this.focusEl || !els.includes(this.focusEl)) { this.focusFirst(); els = this.focusables(); }
    const cur = this.focusEl;
    const list = this.bookList, inBook = cur && list && list.contains(cur);
    const lr = list && list.getBoundingClientRect();
    const allow = (e) => {
      if (!list || !list.contains(e) || inBook) return true;
      const r = e.getBoundingClientRect(); return r.bottom > lr.top + 4 && r.top < lr.bottom - 4; // only visible rows when entering the list
    };
    for (const d of ['up', 'down', 'left', 'right']) {
      if (!pr[d]) continue;
      const n = spatialNext(els, this.focusEl, d, allow);
      if (n) { this.setFocus(n); this.ui.sfx('click'); }
    }
    if (pr.tabNext && this.tabbed) this.setTab('book');
    if (pr.tabPrev && this.tabbed) this.setTab('inv');
    const f = this.focusEl; if (!f) return;
    if (f._slot) {
      if (pr.accept) this.slotClick(f._slot, 0, false);
      if (pr.alt) this.slotClick(f._slot, 0, true);
      if (pr.split) this.slotClick(f._slot, 2, false);
    } else if (f._chip) {
      if (pr.accept) f.click();
    } else if (f.dataset && f.dataset.id !== undefined) {
      const r = RECIPES[+f.dataset.id];
      if (pr.accept || pr.split) this.craft(r, false);
      if (pr.alt) this.craft(r, true);
    }
    if (pr.back) this.ui.close();
  }

  tick() {
    // called every frame while open (furnace progress, table proximity)
    if (this.type === 'furnace' && this.entity) {
      const f = this.entity;
      this.flame.src = flameIcon(f.burn > 0);
      this.flame.style.clipPath = f.burn > 0 && f.burnMax ? `inset(${(1 - f.burn / f.burnMax) * 100}% 0 0 0)` : 'none';
      this.arrowFg.style.width = Math.min(100, (f.cook / SMELT_TIME) * 100) + '%';
    }
    for (const s of this.slots) s.render();
    if (this.type === 'inventory') {
      const sig = this.bookSignature();
      if (sig !== this.bookSig) { this.bookSig = sig; this.renderBook(); }
    }
  }
}
