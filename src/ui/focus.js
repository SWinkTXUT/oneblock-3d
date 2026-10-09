// Controller / keyboard focus navigation for menus and windows (spatial, based on on-screen rects).
export const UI_ACTIONS = ['ui_up', 'ui_down', 'ui_left', 'ui_right', 'ui_accept', 'ui_back', 'ui_alt', 'ui_split', 'ui_tabNext', 'ui_tabPrev'];

/** Read (and consume) every ui_* edge from an InputSource. Returns { up, down, left, right, accept, back, alt, split, tabNext, tabPrev }. */
export function readUi(src) {
  const r = {};
  if (!src) return r;
  for (const a of UI_ACTIONS) if (src.pressed(a)) r[a.slice(3).replace(/^./, (c) => c.toLowerCase())] = true;
  return r;
}

const center = (r) => ({ x: r.left + r.width / 2, y: r.top + r.height / 2 });

/** Nearest item in a direction ('up'|'down'|'left'|'right'). `allow(el)` may veto candidates. */
export function spatialNext(items, current, dir, allow) {
  if (!items.length) return null;
  if (!current || !items.includes(current)) return items[0];
  const cr = current.getBoundingClientRect(), c = center(cr);
  let best = null, bs = Infinity;
  for (const it of items) {
    if (it === current || (allow && !allow(it))) continue;
    const r = it.getBoundingClientRect(); if (!r.width && !r.height) continue;
    const p = center(r), dx = p.x - c.x, dy = p.y - c.y;
    const primary = dir === 'up' ? -dy : dir === 'down' ? dy : dir === 'left' ? -dx : dx;
    if (primary < 4) continue;
    const perp = dir === 'up' || dir === 'down' ? Math.abs(dx) : Math.abs(dy);
    const s = primary + perp * 2.2;
    if (s < bs) { bs = s; best = it; }
  }
  return best;
}

export function setFocusClass(el, on) { if (el) el.classList.toggle('focus', !!on); }

/** Focus handling for plain button menus (title, pause, settings, death, goals). */
export class MenuNav {
  constructor(getRoot, { onBack } = {}) { this.getRoot = getRoot; this.onBack = onBack; this.focus = null; }

  items() {
    const root = this.getRoot(); if (!root) return [];
    return [...root.querySelectorAll('.btn, input[type=range], .navitem')].filter((e) => e.offsetParent !== null && !e.disabled);
  }

  reset() { this.setFocus(null); const it = this.items(); this.setFocus(it.find((e) => e.classList.contains('primary')) || it[0] || null); }

  setFocus(el) {
    if (this.focus && this.focus !== el) setFocusClass(this.focus, false);
    this.focus = el; setFocusClass(el, true);
    if (el && el.scrollIntoView) el.scrollIntoView({ block: 'nearest' });
  }

  /** pr from readUi(). Returns true if it consumed an accept (so callers can flag "via pad"). */
  apply(pr, onAccept) {
    const it = this.items();
    if (!it.length) return;
    if (!this.focus || !it.includes(this.focus)) this.setFocus(it.find((e) => e.classList.contains('primary')) || it[0]);
    const f = this.focus;
    const slider = f && f.tagName === 'INPUT';
    for (const d of ['up', 'down']) if (pr[d]) { const n = spatialNext(it, f, d); if (n) this.setFocus(n); }
    for (const d of ['left', 'right']) {
      if (!pr[d]) continue;
      if (slider) {
        const step = (+f.max - +f.min) / 20, v = +f.value + (d === 'right' ? step : -step);
        f.value = Math.max(+f.min, Math.min(+f.max, v)); f.dispatchEvent(new Event('input', { bubbles: true }));
      } else { const n = spatialNext(it, f, d); if (n) this.setFocus(n); }
    }
    if (pr.accept && f && !slider) { if (onAccept) onAccept(); f.click(); }
    if (pr.back && this.onBack) this.onBack();
  }
}
