// Procedural 16x16 item sprites + 32x32 HUD icons. Pure pixel buffers (no DOM).
import { Pix, P, hex, hash, vnoise, mixC, shadeC, outline, upscale, mulberry32, clamp01, lum } from './pixel.js';
import { drawTile } from './tiles.js';
import { BLOCK_BY_KEY } from '../data/blocks.js';
import { ITEMS } from '../data/items.js';

const TIER_PAL = {
  wooden: P('#5e4020', '#86602f', '#a8803f', '#c8a05c'),
  stone: P('#55555a', '#77777c', '#9a9a9f', '#bcbcc0'),
  iron: P('#82858c', '#b0b3b9', '#d6d8dc', '#f6f7f9'),
  diamond: P('#17908e', '#2fc4bc', '#5fe8de', '#c4fff9'),
};
const HANDLE = P('#4a3016', '#6a4821', '#8d6230');

// ---- tools: drawn in diagonal coordinates p = x+y (across the head), q = x-y (along the handle) ----
function toolBase(headFn, pal, opts = {}) {
  const t = new Pix(16, 16);
  // handle: diagonal line p = 15 (cells (2,13)...(13,2)), from the bottom-left corner up to the head
  const qTop = opts.handleTop ?? 6;
  for (let y = 0; y < 16; y++) for (let x = 0; x < 16; x++) {
    const p = x + y, q = x - y;
    if (p === 15 && q <= qTop && q >= -14) t.set(x, y, HANDLE[(x + (q < -8 ? 1 : 0)) % 2 === 0 ? 2 : 1]);
    if (p === 16 && q <= qTop - 1 && q >= -14) t.set(x, y, HANDLE[0]);
  }
  t.set(0, 15, HANDLE[0]); t.set(1, 14, HANDLE[1]);
  headFn(t, pal);
  return t;
}
const shadeIdx = (s) => (s > 0.5 ? 3 : s > 0.0 ? 2 : s > -0.55 ? 1 : 0);

function pickaxeHead(t, pal) {
  const qa = 5;
  for (let y = 0; y < 16; y++) for (let x = 0; x < 16; x++) {
    const dp = x + y - 15, q = x - y;
    if (Math.abs(dp) > 8) continue;
    const qc = qa - (dp * dp) / 15;
    const s = (q - qc) / 1.7;
    if (Math.abs(s) <= 1) {
      let k = shadeIdx(s);
      if (Math.abs(dp) > 6) k = Math.max(0, k - 1);
      t.set(x, y, pal[k]);
    }
  }
}
function axeHead(t, pal) {
  const qa = 5;
  for (let y = 0; y < 16; y++) for (let x = 0; x < 16; x++) {
    const dp = x + y - 15, q = x - y;
    if (dp < -2 || dp > 7) continue;
    const top = qa + 2.2 + 0.18 * dp, bot = qa - 2.6 - 0.5 * Math.max(dp, 0) - 0.3 * Math.max(-dp, 0);
    if (q <= top && q >= bot) {
      const s = (q - (top + bot) / 2) / ((top - bot) / 2);
      let k = shadeIdx(s * 0.9 + (dp > 5 ? 0.35 : 0));
      if (dp >= 7) k = 3;
      if (dp <= -1) k = 0;
      t.set(x, y, pal[k]);
    }
  }
}
function shovelHead(t, pal) {
  const cq = 5;
  for (let y = 0; y < 16; y++) for (let x = 0; x < 16; x++) {
    const dp = x + y - 15, q = x - y;
    const e = (dp / 3.4) ** 2 + ((q - cq) / 4.8) ** 2;
    if (e <= 1) {
      const s = (q - cq) / 4.8 * 0.7 - dp / 3.4 * 0.3;
      t.set(x, y, pal[e > 0.62 ? Math.max(0, shadeIdx(s) - 1) : shadeIdx(s + 0.2)]);
    }
  }
}
function hoeHead(t, pal) {
  const qa = 5;
  for (let y = 0; y < 16; y++) for (let x = 0; x < 16; x++) {
    const dp = x + y - 15, q = x - y;
    // top bar along p (toward +p), and a hook down at the far end
    const bar = dp >= -1 && dp <= 6 && q >= qa && q <= qa + 2.2;
    const hook = dp >= 4 && dp <= 6 && q >= qa - 4.5 && q < qa;
    if (bar || hook) t.set(x, y, pal[bar ? shadeIdx((q - qa - 1.1) / 1.1 + (dp > 4 ? 0.2 : 0)) : (dp === 4 ? 2 : 1)]);
  }
}
function swordDraw(pal) {
  const t = new Pix(16, 16);
  for (let y = 0; y < 16; y++) for (let x = 0; x < 16; x++) {
    const p = x + y, q = x - y;
    if (p >= 14 && p <= 16 && q >= -1 && q <= 12) {
      if (p === 14 && q > 10) continue;
      if (p === 16 && q > 10) continue;
      t.set(x, y, pal[p === 14 ? 3 : p === 15 ? 2 : 1]);
    }
    if (p === 15 && q >= 13 && q <= 14) t.set(x, y, pal[3]); // tip
    if (p === 14 && q === 11) t.set(x, y, pal[3]);
    if (p === 15 && q >= 1 && q <= 10) t.set(x, y, pal[q % 3 === 0 ? 3 : 2]); // fuller
  }
  // crossguard (perpendicular band)
  for (let dp = -4; dp <= 4; dp++) {
    for (const dq of [-3, -4]) {
      const p = 15 + dp, q = dq;
      if ((p + q) % 2 !== 0) continue;
      const x = (p + q) / 2, y = (p - q) / 2;
      t.set(x, y, Math.abs(dp) > 3 ? HANDLE[0] : HANDLE[2]);
    }
  }
  // grip + pommel
  for (let y = 0; y < 16; y++) for (let x = 0; x < 16; x++) {
    const p = x + y, q = x - y;
    if (p === 15 && q <= -5 && q >= -10) t.set(x, y, HANDLE[(x & 1) ? 1 : 2]);
  }
  t.set(2, 13, HANDLE[1]); t.set(1, 14, HANDLE[2]); t.set(0, 15, hex('#c8a24a'));
  t.set(1, 15, hex('#8a6a22'));
  return t;
}

// ---- helpers for ASCII art ----
function ascii(rows, map) {
  const t = new Pix(16, 16);
  rows.forEach((row, y) => {
    for (let x = 0; x < 16; x++) {
      const ch = row[x];
      if (!ch || ch === '.' || ch === ' ') continue;
      const c = map[ch];
      if (c) t.set(x, y, c);
    }
  });
  return t;
}
const MIRROR = { 4: '3', 3: '2', 2: '1', 1: '1' };
function mirrorArt(halfRows, pal) {
  const t = new Pix(16, 16);
  halfRows.forEach((row, y) => {
    for (let x = 0; x < 8; x++) {
      const ch = row[x] || '.';
      if (ch === '.') continue;
      t.set(x, y, pal[+ch - 1]);
      t.set(15 - x, y, pal[+(MIRROR[ch] || ch) - 1]);
    }
  });
  return t;
}
function disc(t, cx, cy, rx, ry, colorFn) {
  for (let y = 0; y < t.h; y++) for (let x = 0; x < t.w; x++) {
    const dx = (x + 0.5 - cx) / rx, dy = (y + 0.5 - cy) / ry;
    const d = dx * dx + dy * dy;
    if (d <= 1) t.set(x, y, colorFn(x, y, dx, dy, d));
  }
}
function line(t, x0, y0, x1, y1, c) {
  const n = Math.max(Math.abs(x1 - x0), Math.abs(y1 - y0));
  for (let i = 0; i <= n; i++) t.set(Math.round(x0 + ((x1 - x0) * i) / (n || 1)), Math.round(y0 + ((y1 - y0) * i) / (n || 1)), c);
}

// ---- armor ----
const ARMOR_PAL = {
  leather: P('#4e2c14', '#734421', '#9b5f2e', '#c68545'),
  iron: P('#767980', '#a4a7ad', '#cfd1d5', '#f4f5f7'),
  diamond: P('#12807e', '#26b5ae', '#55e0d6', '#c0fff8'),
};
const ARMOR_ART = {
  helmet: [
    '........', '........', '....4444', '..444333', '.4433333', '.4333333', '.4333222', '.432....', '.432....', '.411....',
  ].map((r, i) => r),
  chestplate: [
    '........', '.4444...', '.4433..2', '4443332.', '4433333.', '.433333.' , '..43333.', '..43333.', '..43333.', '..43333.', '..43332.', '..4333..', '..4222..', '........',
  ],
  leggings: [
    '........', '..444444', '..433333', '..433333', '..433322', '..43332.', '..4332..', '..4332..', '..4332..', '..4332..', '..4332..', '..4322..', '..4322..', '..111...',
  ],
  boots: [
    '........', '........', '...4433.', '...4333.', '...4333.', '...4332.', '...4332.', '..44332.', '.4433332', '.4333322', '.4333322', '.1111111',
  ],
};
function armorSprite(mat, piece) {
  const art = ARMOR_ART[piece].map((r) => r.padEnd(8, '.'));
  const t = mirrorArt(art.map((r, i) => r), ARMOR_PAL[mat]);
  // shift down a little for helmets/boots so they are centred
  const out = new Pix(16, 16);
  const dy = piece === 'helmet' ? 2 : piece === 'boots' ? 1 : piece === 'chestplate' ? 1 : 0;
  for (let y = 0; y < 16; y++) for (let x = 0; x < 16; x++) { const c = t.get(x, y); if (c[3]) out.set(x, y + dy, c); }
  const pal = ARMOR_PAL[mat];
  // details: rivets / trim
  if (mat === 'leather') {
    if (piece === 'chestplate') for (const [x, y] of [[6, 6], [9, 6], [7, 10], [8, 10]]) out.set(x, y + 1, pal[0]);
  } else {
    const hl = pal[3];
    if (piece === 'chestplate') { out.set(5, 5 + dy, hl); out.set(10, 5 + dy, pal[2]); }
    if (piece === 'helmet') { out.set(5, 4 + dy, hl); out.set(6, 3 + dy, hl); }
  }
  return out;
}

// ---- food ----
function apple() {
  const t = new Pix(16, 16);
  disc(t, 8, 9.4, 5.4, 5.0, (x, y, dx, dy, d) => {
    const s = -dx * 0.55 - dy * 0.55 + (1 - d) * 0.1;
    const pal = P('#8e1414', '#b81c1c', '#d92a26', '#ef4a3e', '#ff8a78');
    return pal[Math.max(0, Math.min(4, Math.floor((s + 0.65) * 3.4)))];
  });
  t.set(8, 4, hex('#d92a26')); t.set(8, 5, hex('#b81c1c')); t.set(7, 5, hex('#b81c1c'));
  line(t, 8, 2, 9, 4, hex('#5a3a1a'));
  for (const [x, y] of [[10, 2], [11, 2], [10, 3], [11, 3], [12, 3]]) t.set(x, y, hex(x === 12 || y === 2 ? '#4a9a2a' : '#5cb534'));
  t.set(6, 7, hex('#ffc2b4')); t.set(5, 8, hex('#ff9d8c'));
  return t;
}
function bread() {
  const t = new Pix(16, 16);
  disc(t, 8, 9, 6.6, 4.0, (x, y, dx, dy, d) => {
    const crust = d > 0.55;
    const base = crust ? P('#8b5420', '#a5692a', '#bd7f36') : P('#cf9a52', '#dcaa60', '#e8bb70');
    let k = dy < -0.2 ? 2 : dy < 0.3 ? 1 : 0;
    if (!crust && hash(x, y, 4) > 0.7) k = Math.max(0, k - 1);
    return base[k];
  });
  for (const x of [5, 8, 11]) { t.set(x, 7, hex('#8b5420')); t.set(x + 1, 8, hex('#8b5420')); }
  t.set(4, 8, hex('#f0cf8c')); t.set(6, 6, hex('#f0cf8c')); t.set(10, 6, hex('#f0cf8c'));
  return t;
}
function mutton(cooked) {
  const t = new Pix(16, 16);
  const meat = cooked ? P('#4a2412', '#6a3418', '#8a4a22', '#a85e2c') : P('#a83a44', '#c4505a', '#dc6a74', '#ee8e96');
  const fat = cooked ? hex('#d8b080') : hex('#f4dcd4');
  // bone
  line(t, 9, 9, 13, 13, hex('#efe6d0')); line(t, 10, 9, 14, 13, hex('#c9bfa6'));
  t.set(14, 12, hex('#efe6d0')); t.set(13, 14, hex('#efe6d0')); t.set(14, 14, hex('#c9bfa6'));
  disc(t, 7, 8, 5.4, 4.6, (x, y, dx, dy, d) => {
    let k = Math.max(0, Math.min(3, Math.floor((-dx * 0.4 - dy * 0.6 + 0.6) * 2.2 + (hash(x, y, 8) - 0.5) * 0.8)));
    let c = meat[k];
    if (d > 0.72 && dx < 0.2 && dy < 0.3) c = fat; // fat rim
    return c;
  });
  if (cooked) { line(t, 4, 6, 8, 10, hex('#321608')); line(t, 6, 5, 10, 9, hex('#321608')); }
  else { t.set(6, 7, hex('#f4b0b6')); t.set(5, 8, hex('#f4b0b6')); }
  return t;
}
function rottenFlesh() {
  const t = new Pix(16, 16);
  const pal = P('#4f3a22', '#6b4c2a', '#7e5e34', '#8f6f3e', '#6b7a3a');
  disc(t, 8, 8, 6.2, 5.0, (x, y, dx, dy, d) => {
    const n = vnoise(x * 0.7, y * 0.7, 9, 0);
    if (n > 0.78 && d > 0.3) return pal[4];
    return pal[Math.max(0, Math.min(3, Math.floor((n + (-dy) * 0.25) * 4)))];
  });
  const r = mulberry32(17);
  for (let i = 0; i < 18; i++) { const x = Math.floor(r() * 16), y = Math.floor(r() * 16); if (t.alpha(x, y)) t.set(x, y, hash(x, y, 3) > 0.5 ? hex('#3c2c18') : hex('#8a9a48')); }
  // ragged edge
  for (const [x, y] of [[2, 7], [13, 9], [4, 12], [11, 3]]) t.set(x, y, [0, 0, 0], 0);
  return t;
}
function carrot() {
  const t = new Pix(16, 16);
  for (let y = 0; y < 16; y++) for (let x = 0; x < 16; x++) {
    const p = x + y, q = x - y;
    // tip at q = -10 (bottom-left), base at q = 4; half-width grows with q
    if (q < -11 || q > 4) continue;
    const w = 0.5 + ((q + 11) / 15) * 2.4;
    const dp = p - 15;
    if (Math.abs(dp) <= w) {
      const pal = P('#c45a0e', '#e07418', '#f48a24', '#ffa84a');
      let k = dp > w * 0.35 ? 0 : dp > -w * 0.4 ? 1 : 2;
      if (dp < -w * 0.75) k = 3;
      if (q % 5 === 0 && Math.abs(dp) < w - 0.4) k = Math.max(0, k - 1); // ridges
      t.set(x, y, pal[k]);
    }
  }
  // leaves
  for (const [x, y, c] of [[11, 4, '#3e9a2a'], [12, 3, '#56b834'], [13, 2, '#56b834'], [12, 5, '#3e9a2a'], [13, 4, '#56b834'], [14, 3, '#3e9a2a'], [10, 3, '#4aa82e'], [11, 2, '#4aa82e'], [11, 1, '#3e9a2a']]) t.set(x, y, hex(c));
  return t;
}

// ---- materials ----
function stick() {
  const t = new Pix(16, 16);
  for (let i = 0; i < 12; i++) { t.set(2 + i, 13 - i, HANDLE[2]); t.set(3 + i, 13 - i, HANDLE[0]); }
  for (let i = 1; i < 11; i += 3) t.set(2 + i, 13 - i, HANDLE[1]);
  t.set(13, 2, HANDLE[2]); t.set(14, 2, HANDLE[1]);
  return t;
}
function lump(pal, seed, rx = 5.2, ry = 4.4, cx = 8, cy = 9) {
  const t = new Pix(16, 16);
  const rnd = mulberry32(seed);
  const wob = [rnd(), rnd(), rnd(), rnd(), rnd(), rnd()];
  disc(t, cx, cy, rx, ry, (x, y, dx, dy, d) => {
    const a = Math.atan2(dy, dx);
    const edge = 0.8 + 0.2 * Math.sin(a * 3 + wob[0] * 6) + 0.1 * Math.sin(a * 5 + wob[1] * 6);
    if (d > edge) return [0, 0, 0, 0];
    const s = -dx * 0.5 - dy * 0.6 + (hash(x, y, seed) - 0.5) * 0.5;
    return pal[Math.max(0, Math.min(pal.length - 1, Math.floor((s + 0.7) * (pal.length / 1.4))))];
  });
  // clear pixels flagged transparent by returning alpha 0: rebuild
  for (let y = 0; y < 16; y++) for (let x = 0; x < 16; x++) {
    const dx = (x + 0.5 - cx) / rx, dy = (y + 0.5 - cy) / ry;
    const d = dx * dx + dy * dy, a = Math.atan2(dy, dx);
    const edge = 0.8 + 0.2 * Math.sin(a * 3 + wob[0] * 6) + 0.1 * Math.sin(a * 5 + wob[1] * 6);
    if (d > edge) t.set(x, y, [0, 0, 0], 0);
  }
  return t;
}
function ingot(pal) {
  const t = new Pix(16, 16);
  // top face: parallelogram leaning right (rows 5..8); front face rows 9..12
  for (let y = 5; y <= 8; y++) {
    const off = 8 - y;
    for (let x = 3 + off; x <= 11 + off; x++) {
      const edge = y === 5 || x === 3 + off || x === 11 + off;
      t.set(x, y, edge ? pal[2] : pal[3]);
    }
  }
  for (let y = 9; y <= 12; y++) for (let x = 3; x <= 11; x++) t.set(x, y, y === 9 ? pal[2] : y === 12 ? pal[0] : pal[1]);
  // right end face
  for (let y = 9; y <= 12; y++) t.set(12, y, pal[0]);
  for (let k = 0; k < 3; k++) { t.set(12 + k, 8 - k, pal[1]); t.set(12 + k, 9 - k, pal[0]); }
  for (let y = 9; y <= 12; y++) { t.set(11, y, y === 9 ? pal[2] : pal[1]); }
  t.set(5, 6, pal[3]); t.set(7, 7, hex('#ffffff'));
  return t;
}
const GOLD = P('#9a6d0c', '#d49e14', '#f4c430', '#fff3a6');
const IRON = P('#80838a', '#b2b5bb', '#d8dade', '#ffffff');
function diamondGem() {
  const rows = [
    '................', '................', '....44444333....', '...4444433322...', '..444444333222..', '.34444433332221.',
    '.33444333322211.', '..334333322211..', '...3433332211...', '....33332211....', '.....333211.....', '......3211......', '.......21.......', '................',
  ];
  const pal = { 4: hex('#d8fffb'), 3: hex('#5fe8de'), 2: hex('#2fb8b0'), 1: hex('#17808a') };
  const t = ascii(rows, pal);
  // facet lines
  for (const [x, y] of [[7, 3], [8, 4], [5, 5], [10, 5], [7, 8], [8, 8]]) t.set(x, y, hex('#9af6ee'));
  t.set(5, 4, [255, 255, 255]); t.set(6, 4, [255, 255, 255]);
  return t;
}
function flint() {
  const t = new Pix(16, 16);
  const rows = [
    '................', '................', '.........33.....', '........3433....', '.......34433....', '......344333....', '.....3443332....', '....34433322....',
    '...344333222....', '..3443332221....', '..4433322211....', '..433222211.....', '...22221111.....', '................',
  ];
  return ascii(rows, { 4: hex('#8a8a92'), 3: hex('#5c5c64'), 2: hex('#3c3c44'), 1: hex('#26262c') });
}
function leather() {
  const t = new Pix(16, 16);
  const rows = [
    '................', '................', '....2222222.....', '...233333332....', '..23444443332...', '..2344444433332.', '.23444444333332.', '.23444444433332.',
    '..2344444433322.', '..23344443333221', '...233444333321.', '...2333333322...', '....22222222....', '................',
  ];
  const c = ascii(rows, { 4: hex('#b8733a'), 3: hex('#975a2a'), 2: hex('#6d3f1c') });
  for (let x = 4; x < 12; x += 2) c.set(x, 3, hex('#d9a066'));
  c.set(7, 7, hex('#d9a066')); c.set(8, 8, hex('#7a4a22'));
  return c;
}
function wheatItem() {
  const t = new Pix(16, 16);
  const g = P('#9a7e24', '#c4a233', '#e0be48', '#f4d868');
  for (const [x0, y0, x1, y1] of [[2, 14, 9, 3], [4, 14, 11, 4], [6, 14, 13, 6]]) {
    line(t, x0, y0, x1, y1, g[1]);
    line(t, x0 + 1, y0, x1 + 1, y1, g[0]);
  }
  for (const [hx, hy] of [[9, 3], [11, 4], [13, 6]]) {
    for (let k = 0; k < 4; k++) { t.set(hx - 1 + (k % 2) * 2, hy - 1 - Math.floor(k / 2), g[(k + 2) % 4]); t.set(hx, hy - k, g[2 + (k % 2)]); }
  }
  t.set(5, 13, hex('#6a5a1c')); t.set(6, 12, hex('#6a5a1c'));
  return t;
}
function snowball() {
  const t = new Pix(16, 16);
  disc(t, 8, 8, 5.2, 5.2, (x, y, dx, dy, d) => {
    const s = -dx * 0.5 - dy * 0.6;
    return s > 0.35 ? hex('#ffffff') : s > -0.1 ? hex('#e8f1fb') : s > -0.5 ? hex('#c8daf0') : hex('#a4bde0');
  });
  t.set(6, 6, [255, 255, 255]);
  return t;
}
function clayBall() {
  const t = new Pix(16, 16);
  disc(t, 8, 8, 5.2, 5.2, (x, y, dx, dy, d) => {
    const s = -dx * 0.5 - dy * 0.6;
    const pal = P('#7a8190', '#919aaa', '#a8b0bf', '#c0c8d6');
    return pal[Math.max(0, Math.min(3, Math.floor((s + 0.7) * 2.8)))];
  });
  return t;
}
function brickItem() {
  const t = new Pix(16, 16);
  const rows = [
    '................', '................', '................', '...4444444444...', '..444444444443..', '..444444444332..', '..333333333322..', '..322222222211..',
    '..222222222111..', '..11111111111...', '................',
  ];
  const c = ascii(rows, { 4: hex('#c4694e'), 3: hex('#a8503a'), 2: hex('#8e3f2e'), 1: hex('#6e2e22') });
  c.set(5, 5, hex('#dc8a70')); c.set(9, 4, hex('#dc8a70'));
  return c;
}
function glowDust() {
  const t = new Pix(16, 16);
  const pal = P('#c08a1e', '#e8b434', '#ffd860', '#fff4b8');
  const r = mulberry32(61);
  for (let i = 0; i < 46; i++) {
    const a = r() * Math.PI * 2, rad = Math.sqrt(r()) * 5.5;
    const x = Math.round(8 + Math.cos(a) * rad), y = Math.round(10 + Math.sin(a) * rad * 0.6 - (rad < 2 ? 1 : 0));
    t.set(x, y, pal[Math.floor(r() * 4)]);
  }
  for (const [x, y] of [[7, 7], [9, 8], [6, 9], [11, 10], [4, 11]]) t.set(x, y, pal[3]);
  return t;
}
function quartz() {
  const rows = [
    '................', '.........44.....', '........4443....', '.......44433....', '......444332....', '.....444332.....', '....444332......', '...444332.......',
    '..444332........', '..43332.........', '..4322..........', '................',
  ];
  const t = ascii(rows, { 4: hex('#fbf8f2'), 3: hex('#dcd5c8'), 2: hex('#b2aa9c') });
  // second crystal
  for (let i = 0; i < 6; i++) { t.set(6 + i, 12 - i + 0, hex('#efe9de')); t.set(7 + i, 12 - i, hex('#c4bcae')); }
  t.set(6, 12, hex('#ffffff')); t.set(12, 6, hex('#ffffff'));
  return t;
}
function stringItem() {
  const t = new Pix(16, 16);
  const pts = [[2, 13], [4, 11], [5, 12], [7, 9], [8, 10], [10, 7], [11, 8], [13, 4]];
  for (let i = 0; i < pts.length - 1; i++) { line(t, ...pts[i], ...pts[i + 1], hex('#f2f2f2')); }
  for (const [x, y] of pts) t.set(x, y, hex('#cfcfcf'));
  return t;
}
function seeds() {
  const t = new Pix(16, 16);
  for (const [x, y] of [[4, 9], [7, 6], [10, 9], [6, 12], [11, 5], [9, 12], [5, 5]]) {
    t.set(x, y, hex('#6a8a2a')); t.set(x + 1, y, hex('#4a6a1c')); t.set(x, y + 1, hex('#3c5a14')); t.set(x + 1, y + 1, hex('#8cac3e'));
    t.set(x, y, hex('#9ab84a'));
  }
  return t;
}
function bucket(water) {
  const rows = [
    '................', '................', '..666666666666..', '..6.........66..', '...6.......66...', '...5555555552...', '...4444444332...', '...4444444332...',
    '...4444443322...', '....44444332....', '....44444332....', '....4444332.....', '.....33322......', '................',
  ];
  const t = ascii(rows, { 6: hex('#6a6d74'), 5: hex('#d6d8dc'), 4: hex('#b2b5bb'), 3: hex('#8a8d94'), 2: hex('#6a6d74') });
  t.set(2, 3, hex('#4a4d54')); t.set(13, 3, hex('#4a4d54'));
  if (water) {
    for (let x = 3; x <= 12; x++) t.set(x, 3, hex(x % 3 === 0 ? '#7ab0ff' : '#4a88e8'));
    for (let x = 3; x < 12; x++) t.set(x, 4, hex('#3a70d0'));
    t.set(5, 3, hex('#cfe4ff')); t.set(8, 3, hex('#cfe4ff'));
  } else {
    for (let x = 4; x <= 11; x++) t.set(x, 3, hex('#32343a'));
  }
  return t;
}
function shears() {
  const t = new Pix(16, 16);
  const steel = P('#7f838b', '#aeb2b9', '#d8dbdf', '#f5f6f8');
  // blades crossing at (7,9)
  line(t, 7, 9, 12, 2, steel[1]); line(t, 8, 9, 13, 2, steel[2]); line(t, 7, 9, 13, 5, steel[1]); line(t, 7, 8, 14, 5, steel[2]);
  line(t, 7, 9, 3, 13, steel[0]); line(t, 7, 9, 3, 12, steel[1]);
  // handle rings
  const ring = (cx, cy, c) => { for (let a = 0; a < 16; a++) t.set(Math.round(cx + Math.cos((a / 16) * 6.283) * 2.1), Math.round(cy + Math.sin((a / 16) * 6.283) * 2.1), c); };
  ring(3.4, 12.6, hex('#8a2a2a')); ring(6.2, 13.8, hex('#6e2020'));
  t.set(7, 9, steel[3]); t.set(8, 8, steel[0]);
  return t;
}

// ---------- registry ----------
const SPRITES = {};
const toolDefs = { pickaxe: pickaxeHead, axe: axeHead, shovel: shovelHead, hoe: hoeHead };
for (const mat of ['wooden', 'stone', 'iron', 'diamond']) {
  for (const [type, fn] of Object.entries(toolDefs)) SPRITES[`${mat}_${type}`] = () => toolBase(fn, TIER_PAL[mat]);
  SPRITES[`${mat}_sword`] = () => swordDraw(TIER_PAL[mat]);
}
for (const mat of ['leather', 'iron', 'diamond']) {
  for (const piece of ['helmet', 'chestplate', 'leggings', 'boots']) SPRITES[`${mat}_${piece}`] = () => armorSprite(mat, piece);
}
Object.assign(SPRITES, {
  apple, bread, raw_mutton: () => mutton(false), cooked_mutton: () => mutton(true), rotten_flesh: rottenFlesh, carrot,
  stick,
  coal: () => lump(P('#0c0c0e', '#1a1a1f', '#2a2a31', '#44444e'), 31),
  charcoal: () => lump(P('#18130f', '#2a221b', '#3d332a', '#5a4d40'), 32, 5.0, 4.2),
  iron_ingot: () => ingot(IRON), gold_ingot: () => ingot(GOLD), diamond: diamondGem, flint, leather,
  wheat: wheatItem, snowball, clay_ball: clayBall, brick: brickItem, glowstone_dust: glowDust, quartz, string: stringItem,
  wheat_seeds: seeds, bucket: () => bucket(false), water_bucket: () => bucket(true), shears,
});

const spriteCache = new Map();
// 16x16 sprite for non-cube things (items, tools, torch/cross blocks). null for cube blocks.
export function getSprite(key) {
  if (spriteCache.has(key)) return spriteCache.get(key);
  let px = null;
  const def = ITEMS[key];
  const iconKey = def && def.icon && def.icon !== key ? def.icon : key;
  if (SPRITES[iconKey]) px = SPRITES[iconKey]();
  else {
    const b = BLOCK_BY_KEY[iconKey];
    if (b && (b.shape === 'cross' || b.shape === 'torch')) px = drawTile(b.tex.all || b.tex.side);
  }
  spriteCache.set(key, px);
  return px;
}

// ---------- isometric block icons ----------
function isoCube(top, side, side2, hFrac = 1) {
  const out = new Pix(32, 32);
  const O = [16, 2 + (1 - hFrac) * 14], U = [14, 7], V = [-14, 7], W = [0, 14 * hFrac];
  const sample = (tile, s, t) => tile.get(Math.min(15, Math.max(0, Math.floor(s * 16))), Math.min(15, Math.max(0, Math.floor(t * 16))));
  for (let y = 0; y < 32; y++) for (let x = 0; x < 32; x++) {
    const px = x + 0.5, py = y + 0.5;
    // solve p - O = a*U + b*V (top face, c=0)
    const rx = px - O[0], ry = py - O[1];
    // top: a,b
    const det = U[0] * V[1] - U[1] * V[0];
    const a = (rx * V[1] - ry * V[0]) / det, b = (U[0] * ry - U[1] * rx) / det;
    if (a >= 0 && a <= 1 && b >= 0 && b <= 1) {
      const c = sample(top, a, b); // u along a, v along b
      if (c[3]) out.set(x, y, shadeC(c, 1.0), c[3]);
      continue;
    }
    // left face: origin O+V, spanned by U (a) and W (c)
    {
      const lx = px - (O[0] + V[0]), ly = py - (O[1] + V[1]);
      const aa = lx / U[0]; // since W is vertical
      const cc = (ly - aa * U[1]) / (W[1] || 1);
      if (aa >= 0 && aa <= 1 && cc >= 0 && cc <= 1) {
        const c = sample(side, aa, cc);
        if (c[3]) out.set(x, y, shadeC(c, 0.8), c[3]);
        continue;
      }
    }
    // right face: origin O+U, spanned by V (b) and W (c)
    {
      const lx = px - (O[0] + U[0]), ly = py - (O[1] + U[1]);
      const bb = lx / V[0];
      const cc = (ly - bb * V[1]) / (W[1] || 1);
      if (bb >= 0 && bb <= 1 && cc >= 0 && cc <= 1) {
        const c = sample(side2, 1 - bb, cc);
        if (c[3]) out.set(x, y, shadeC(c, 0.62), c[3]);
      }
    }
  }
  return out;
}

const tileCache = new Map();
export function tilePix(key) {
  let t = tileCache.get(key);
  if (!t) { t = drawTile(key); tileCache.set(key, t); }
  return t;
}

const iconCache = new Map();
// 32x32 icon Pix for any item key (or block key)
export function getIconPix(key) {
  if (iconCache.has(key)) return iconCache.get(key);
  let icon;
  const spr = getSprite(key);
  if (spr) {
    icon = outline(upscale(spr, 2));
  } else {
    const b = BLOCK_BY_KEY[key];
    if (b) {
      const tex = b.tex;
      const top = tilePix(tex.top || tex.all), side = tilePix(tex.side || tex.all);
      const h = b.shape === 'bed' ? 9 / 16 : b.shape === 'farmland' ? 15 / 16 : 1;
      let tp = top, sd = side;
      if (b.render === 'cutout' && b.shape === 'cube') { // leaves: back the holes with a dark canopy so the icon reads solid
        const back = (tile) => { const c = tile.clone(); for (let y = 0; y < 16; y++) for (let x = 0; x < 16; x++) if (!c.alpha(x, y)) c.set(x, y, [22, 52, 24]); return c; };
        tp = back(top); sd = back(side);
      }
      const cube = isoCube(tp, sd, sd, h);
      icon = outline(cube, 0.42);
      if (b.render === 'translucent') { /* keep alpha */ }
    } else {
      icon = new Pix(32, 32);
      for (let y = 0; y < 32; y++) for (let x = 0; x < 32; x++) if (((x >> 2) + (y >> 2)) % 2) icon.set(x, y, [255, 0, 255]);
    }
  }
  iconCache.set(key, icon);
  return icon;
}
