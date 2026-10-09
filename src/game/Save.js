// Persistence. v2 format: { v:2, world, state, entities, drops, goals, seats:[{player,inv,sel,spawn}|null] x maxSeats }.
// v1 saves (single player, computer key) are migrated in memory by decode(); the next write is v2.
export const SAVE_KEY = 'oneblock3d.save.v1'; // computer default (platform.saveKey overrides)
export const SETTINGS_KEY = 'oneblock3d.settings';
export const SAVE_VERSION = 2;

export const DEFAULT_SETTINGS = { sens: 1, fov: 75, volume: 0.6, quality: 'high', invertY: false };

export function encode(data) { return JSON.stringify({ ...data, v: SAVE_VERSION, t: Date.now() }); }

/** v1 -> v2 (in memory). Returns a v2-shaped object. */
export function migrate(d) {
  if (d.v === 2) return d;
  const state = { ...(d.state || {}) };
  const spawn = state.spawn || null;
  delete state.spawn;
  return { ...d, v: 2, state, seats: [{ player: d.player, inv: d.inv, sel: d.sel || 0, spawn }, null, null, null] };
}

export function decode(str) {
  if (!str) return null;
  try {
    const d = JSON.parse(str);
    if (!d || !d.world || (d.v !== 1 && d.v !== 2)) return null;
    return migrate(d);
  } catch { return null; }
}

const ls = () => { try { return globalThis.localStorage || null; } catch { return null; } };

export function writeSave(data, key = SAVE_KEY) {
  const s = ls(); if (!s) return false;
  try { s.setItem(key, encode(data)); return true; } catch (e) { console.warn('save failed', e); return false; }
}
export function readSave(key = SAVE_KEY) { const s = ls(); if (!s) return null; try { return decode(s.getItem(key)); } catch { return null; } }
export function clearSave(key = SAVE_KEY) { const s = ls(); if (s) try { s.removeItem(key); } catch { /* ignore */ } }

export function loadSettings(key = SETTINGS_KEY) {
  const s = ls();
  try { return { ...DEFAULT_SETTINGS, ...(s ? JSON.parse(s.getItem(key) || '{}') : {}) }; } catch { return { ...DEFAULT_SETTINGS }; }
}
export function saveSettings(settings, key = SETTINGS_KEY) { const s = ls(); if (s) try { s.setItem(key, JSON.stringify(settings)); } catch { /* ignore */ } }
