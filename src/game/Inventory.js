// Pure inventory logic (no DOM). Stack = { key, n, dur? }. Slots 0-8 hotbar, 9-35 main. armor = [head, chest, legs, feet].
import { ITEMS } from '../data/items.js';

export const ARMOR_SLOTS = ['head', 'chest', 'legs', 'feet'];
export const maxStack = (key) => (ITEMS[key] ? ITEMS[key].stack : 64);
export function maxDurability(key) {
  const it = ITEMS[key];
  if (!it) return 0;
  if (it.tool) return it.tool.durability;
  if (it.armor) return it.armor.durability;
  return 0;
}
export function makeStack(key, n = 1, dur) {
  const md = maxDurability(key);
  const s = { key, n };
  if (md) s.dur = dur === undefined ? md : dur;
  return s;
}
export const cloneStack = (s) => (s ? { ...s } : null);

export class Inventory {
  constructor() {
    this.slots = new Array(36).fill(null);
    this.armor = [null, null, null, null];
  }

  count(key) { let n = 0; for (const s of this.slots) if (s && s.key === key) n += s.n; return n; }

  /** Add items; returns the leftover that did not fit. */
  add(key, n = 1, dur) {
    if (!ITEMS[key] || n <= 0) return n;
    const max = maxStack(key);
    if (max > 1) {
      for (let i = 0; i < 36 && n > 0; i++) {
        const s = this.slots[i];
        if (s && s.key === key && s.n < max) { const t = Math.min(n, max - s.n); s.n += t; n -= t; }
      }
    }
    for (let i = 0; i < 36 && n > 0; i++) {
      if (!this.slots[i]) { const t = Math.min(n, max); this.slots[i] = makeStack(key, t, dur); n -= t; }
    }
    return n;
  }

  canAdd(key, n = 1) { return this.clone().add(key, n) === 0; }

  /** Remove up to n items of key; returns number removed. */
  remove(key, n = 1) {
    let removed = 0;
    // take from the back (main inventory) first so the hotbar stays stocked
    for (let i = 35; i >= 0 && removed < n; i--) {
      const s = this.slots[i];
      if (s && s.key === key) { const t = Math.min(n - removed, s.n); s.n -= t; removed += t; if (s.n <= 0) this.slots[i] = null; }
    }
    return removed;
  }

  clone() { const c = new Inventory(); c.copyFrom(this); return c; }
  copyFrom(o) {
    this.slots = o.slots.map(cloneStack);
    this.armor = o.armor.map(cloneStack);
  }
  clear() { this.slots.fill(null); this.armor = [null, null, null, null]; }

  armorPoints() { let p = 0; for (const a of this.armor) if (a && ITEMS[a.key] && ITEMS[a.key].armor) p += ITEMS[a.key].armor.points; return p; }

  /** All stacks (slots + armor) — used to spill on death. */
  allStacks() { return [...this.slots, ...this.armor].filter(Boolean); }

  serialize() {
    const enc = (s) => (s ? [s.key, s.n, s.dur === undefined ? -1 : s.dur] : 0);
    return { slots: this.slots.map(enc), armor: this.armor.map(enc) };
  }
  static dec(a) {
    if (!a || !ITEMS[a[0]]) return null;
    return { key: a[0], n: a[1], ...(a[2] >= 0 ? { dur: a[2] } : {}) };
  }
  deserialize(d) {
    this.slots = new Array(36).fill(null);
    this.armor = [null, null, null, null];
    if (!d) return this;
    (d.slots || []).slice(0, 36).forEach((a, i) => { this.slots[i] = Inventory.dec(a); });
    (d.armor || []).slice(0, 4).forEach((a, i) => { this.armor[i] = Inventory.dec(a); });
    return this;
  }
}
