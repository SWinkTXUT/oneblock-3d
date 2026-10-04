// Block entities: furnaces & chests. Keyed "x,y,z". Furnaces tick every frame even when their UI is closed.
import { ITEMS } from '../data/items.js';
import { SMELTING, SMELT_TIME } from '../data/recipes.js';
import { makeStack, cloneStack, maxStack } from './Inventory.js';

export const keyOf = (x, y, z) => `${x},${y},${z}`;

export function newChest(contents) {
  const slots = new Array(27).fill(null);
  (contents || []).forEach((c, i) => { slots[i] = makeStack(c.key, c.n, c.dur); });
  return { type: 'chest', slots };
}
export function newFurnace() {
  return { type: 'furnace', input: null, fuel: null, output: null, burn: 0, burnMax: 0, cook: 0 };
}

/** Advance a furnace. Returns true if lit state changed. */
export function tickFurnace(f, dt) {
  const wasLit = f.burn > 0;
  const result = f.input ? SMELTING[f.input.key] : null;
  const canSmelt = () => {
    if (!f.input) return false;
    const r = SMELTING[f.input.key]; if (!r) return false;
    return !f.output || (f.output.key === r && f.output.n < maxStack(r));
  };
  if (f.burn <= 0 && canSmelt() && f.fuel && ITEMS[f.fuel.key] && ITEMS[f.fuel.key].fuel) {
    f.burn = f.burnMax = ITEMS[f.fuel.key].fuel;
    f.fuel.n--; if (f.fuel.n <= 0) f.fuel = null;
  }
  if (f.burn > 0) {
    f.burn -= dt;
    if (canSmelt()) {
      f.cook += dt;
      if (f.cook >= SMELT_TIME) {
        f.cook = 0;
        if (f.output) f.output.n++; else f.output = makeStack(result, 1);
        f.input.n--; if (f.input.n <= 0) f.input = null;
        // chain: use leftover burn time
      }
    } else f.cook = Math.max(0, f.cook - dt * 2);
    if (f.burn < 0) f.burn = 0;
  } else f.cook = Math.max(0, f.cook - dt * 2);
  return wasLit !== f.burn > 0;
}

export function entityContents(e) {
  if (!e) return [];
  const arr = e.type === 'chest' ? e.slots : [e.input, e.fuel, e.output];
  return arr.filter(Boolean).map(cloneStack);
}
export function serializeEntities(map) {
  const out = {};
  for (const [k, e] of map) {
    out[k] = e.type === 'chest' ? { t: 'c', s: e.slots.map((s) => (s ? [s.key, s.n, s.dur ?? -1] : 0)) }
      : { t: 'f', i: enc(e.input), f: enc(e.fuel), o: enc(e.output), b: e.burn, bm: e.burnMax, c: e.cook };
  }
  return out;
}
const enc = (s) => (s ? [s.key, s.n, s.dur ?? -1] : 0);
const dec = (a) => (a && ITEMS[a[0]] ? { key: a[0], n: a[1], ...(a[2] >= 0 ? { dur: a[2] } : {}) } : null);
export function deserializeEntities(obj) {
  const map = new Map();
  for (const [k, e] of Object.entries(obj || {})) {
    if (e.t === 'c') { const c = newChest(); e.s.slice(0, 27).forEach((a, i) => { c.slots[i] = dec(a); }); map.set(k, c); }
    else { const f = newFurnace(); f.input = dec(e.i); f.fuel = dec(e.f); f.output = dec(e.o); f.burn = e.b || 0; f.burnMax = e.bm || 0; f.cook = e.c || 0; map.set(k, f); }
  }
  return map;
}
