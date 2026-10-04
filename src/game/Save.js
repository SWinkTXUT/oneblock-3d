// Persistence (SPEC §13). encode/decode are pure; read/write wrap localStorage defensively.
export const SAVE_KEY = 'oneblock3d.save.v1';
export const SETTINGS_KEY = 'oneblock3d.settings';
export const SAVE_VERSION = 1;

export const DEFAULT_SETTINGS = { sens: 1, fov: 75, volume: 0.6, quality: 'high', invertY: false };

export function encode(data) { return JSON.stringify({ v: SAVE_VERSION, t: Date.now(), ...data }); }
export function decode(str) {
  if (!str) return null;
  try {
    const d = JSON.parse(str);
    if (!d || d.v !== SAVE_VERSION || !d.world) return null;
    return d;
  } catch { return null; }
}

const ls = () => { try { return globalThis.localStorage || null; } catch { return null; } };

export function writeSave(data) {
  const s = ls(); if (!s) return false;
  try { s.setItem(SAVE_KEY, encode(data)); return true; } catch (e) { console.warn('save failed', e); return false; }
}
export function readSave() { const s = ls(); if (!s) return null; try { return decode(s.getItem(SAVE_KEY)); } catch { return null; } }
export function hasSave() { return !!readSave(); }
export function clearSave() { const s = ls(); if (s) try { s.removeItem(SAVE_KEY); } catch { /* ignore */ } }

export function loadSettings() {
  const s = ls();
  try { return { ...DEFAULT_SETTINGS, ...(s ? JSON.parse(s.getItem(SETTINGS_KEY) || '{}') : {}) }; } catch { return { ...DEFAULT_SETTINGS }; }
}
export function saveSettings(settings) { const s = ls(); if (s) try { s.setItem(SETTINGS_KEY, JSON.stringify(settings)); } catch { /* ignore */ } }
