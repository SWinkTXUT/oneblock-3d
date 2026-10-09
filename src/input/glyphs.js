// Button glyph helpers. glyph(action) returns plain-text tokens ('A', 'RT', 'Menu', 'Hold B'); glyphHtml() turns them into
// styled badges so nothing depends on circled Unicode letters existing in the TV's font.
const STYLE_ID = 'ob3d-glyph-style';
const CSS = `
.btn-glyph{display:inline-flex;align-items:center;justify-content:center;box-sizing:border-box;min-width:1.45em;height:1.45em;padding:0 .3em;margin:0 .12em;
  border-radius:50%;font:700 .82em/1 system-ui,-apple-system,"Segoe UI",sans-serif;color:#fff;vertical-align:middle;text-shadow:0 1px 1px rgba(0,0,0,.45);
  box-shadow:inset 0 -2px 0 rgba(0,0,0,.3),0 1px 3px rgba(0,0,0,.5);letter-spacing:0}
.btn-glyph.btn-a{background:#3fae1d}.btn-glyph.btn-b{background:#d8342f}.btn-glyph.btn-x{background:#2b72dd}.btn-glyph.btn-y{background:#e5b800;color:#2a2200;text-shadow:none}
.btn-glyph.btn-bumper,.btn-glyph.btn-trigger{border-radius:.45em;background:#4a4f5c;min-width:2em;padding:0 .35em}
.btn-glyph.btn-trigger{background:#3a3e4a;border-bottom:.2em solid #7b8191;height:1.35em}
.btn-glyph.btn-stick{background:#2a2d36;border:2px solid #8b91a1}
.btn-glyph.btn-menu{background:#2a2d36;border:2px solid #aab0c0;font-size:.62em;min-width:2.6em;border-radius:.9em}
.btn-glyph.btn-dpad{background:#2a2d36;border:2px solid #aab0c0;border-radius:.4em;font-size:.62em;min-width:2.8em}
.btn-glyph.btn-key{background:#e9edf5;color:#1a1d26;border-radius:.3em;text-shadow:none;box-shadow:inset 0 -2px 0 #9aa1b3,0 1px 3px rgba(0,0,0,.5)}
`;
export function injectGlyphStyles() {
  if (typeof document === 'undefined' || document.getElementById(STYLE_ID)) return;
  const s = document.createElement('style'); s.id = STYLE_ID; s.textContent = CSS; document.head.appendChild(s);
}
const esc = (t) => String(t).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const CLASS = { A: 'btn-a', B: 'btn-b', X: 'btn-x', Y: 'btn-y', LB: 'btn-bumper', RB: 'btn-bumper', LT: 'btn-trigger', RT: 'btn-trigger', L3: 'btn-stick', R3: 'btn-stick', Menu: 'btn-menu', View: 'btn-menu', Up: 'btn-dpad', Down: 'btn-dpad', Left: 'btn-dpad', Right: 'btn-dpad' };
const TOKEN = /\b(A|B|X|Y|LB|RB|LT|RT|L3|R3|Menu|View|Up|Down|Left|Right)\b/g;

/** 'Hold B' -> 'Hold <span class="btn-glyph btn-b">B</span>'. Gamepad tokens only; other text is escaped. */
export function padGlyphHtml(text) {
  let out = '', last = 0, m;
  TOKEN.lastIndex = 0;
  while ((m = TOKEN.exec(text))) {
    out += esc(text.slice(last, m.index));
    out += `<span class="btn-glyph ${CLASS[m[1]]}">${m[1]}</span>`;
    last = m.index + m[0].length;
  }
  return out + esc(text.slice(last));
}
export const keyGlyphHtml = (text) => `<span class="btn-glyph btn-key">${esc(text)}</span>`;
