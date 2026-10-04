// Procedural 16x16 block tile art. Pure pixel buffers (no DOM).
import { Pix, P, hex, hash, vnoise, noiseFill, voronoi, mixC, shadeC, lum, mulberry32, clamp01 } from './pixel.js';

const D = {}; // key -> (t:Pix) => void
export const TILE_DRAWERS = D;

// ---------- reusable base materials ----------
function stoneBase(t, seed = 11) {
  noiseFill(t, P('#606064', '#6c6c70', '#78787c', '#858588', '#939396', '#a0a0a2'), { seed, c1: 4, c2: 8, jit: 0.45, gain: 2.6 });
  // a few darker cracks / pits
  const r = mulberry32(seed * 7 + 1);
  for (let i = 0; i < 5; i++) {
    let x = Math.floor(r() * 16), y = Math.floor(r() * 16);
    const len = 2 + Math.floor(r() * 3);
    for (let k = 0; k < len; k++) { t.set(x, y, [88, 88, 92]); x += r() < 0.5 ? 1 : 0; y += r() < 0.5 ? 1 : 0; }
  }
}
function netherBase(t, seed = 5) {
  noiseFill(t, P('#4e1a1c', '#5c2022', '#6d2829', '#7e3030', '#923a38', '#a64642'), { seed, c1: 3, c2: 6, jit: 0.55, gain: 2.4 });
}
function woodPlanks(t, pal, seed, joint) {
  noiseFill(t, pal, { seed, c1: 2, c2: 8, jit: 0.25, gain: 1.4, mix: 0.4 });
  // horizontal grain streaks
  for (let y = 0; y < 16; y++) for (let x = 0; x < 16; x++) {
    const g = vnoise(x * 0.35 + y * 7.3, y * 1.7, seed + 9, 0);
    if (g > 0.62) { const c = t.get(x, y); t.set(x, y, shadeC(c, 0.9)); }
  }
  for (let p = 0; p < 4; p++) {
    const y0 = p * 4;
    for (let x = 0; x < 16; x++) {
      t.set(x, y0 + 3, shadeC(joint, 0.82));
      t.set(x, y0, shadeC(t.get(x, y0), 1.08)); // lit upper edge
    }
    const jx = (p * 5 + 3) % 16; // staggered end joint
    for (let y = y0; y < y0 + 3; y++) t.set(jx, y, shadeC(joint, 0.85));
    t.set((jx + 8) % 16, y0 + 1, shadeC(joint, 1.0)); // nail
  }
}
function woolTile(t, base, seed) {
  const pal = [0.84, 0.91, 0.97, 1.03, 1.09].map((f) => shadeC(hex(base), f));
  noiseFill(t, pal, { seed, c1: 8, c2: 16, jit: 0.8, gain: 1.4, mix: 0.4 });
  const r = mulberry32(seed + 3);
  for (let i = 0; i < 9; i++) { // fibre flecks
    const x = Math.floor(r() * 15), y = Math.floor(r() * 16);
    t.set(x, y, shadeC(hex(base), 0.8)); t.set(x + 1, y, shadeC(hex(base), 0.88));
  }
}
function oreOn(t, baseFn, cols, seed, n = 7, sparkle = true) {
  baseFn(t);
  const r = mulberry32(seed);
  const shapes = [
    [[0, 0], [1, 0], [0, 1], [1, 1]], [[0, 0], [1, 0], [2, 0], [1, 1]], [[0, 0], [0, 1], [1, 1], [1, 2]],
    [[0, 0], [1, 0], [1, 1]], [[0, 0], [1, 0], [0, 1], [1, 1], [2, 1]], [[1, 0], [0, 1], [1, 1], [2, 1], [1, 2]],
  ];
  const centers = [];
  let tries = 0;
  while (centers.length < n && tries++ < 200) {
    const x = 1 + Math.floor(r() * 12), y = 1 + Math.floor(r() * 12);
    if (centers.every(([cx, cy]) => Math.abs(cx - x) + Math.abs(cy - y) >= 5)) centers.push([x, y]);
  }
  for (const [cx, cy] of centers) {
    const sh = shapes[Math.floor(r() * shapes.length)];
    for (const [dx, dy] of sh) {
      const tone = hash(cx + dx, cy + dy, seed) ;
      t.set(cx + dx, cy + dy, cols[Math.min(cols.length - 1, Math.floor(tone * cols.length))]);
    }
    // darker rim under the clump to pop it from the stone
    for (const [dx, dy] of sh) {
      const x = cx + dx, y = cy + dy + 1;
      if (!sh.some(([a, b]) => a === dx && b === dy + 1)) { const c = t.get(x, y); t.set(x, y, shadeC(c, 0.78)); }
    }
    if (sparkle) { const [dx, dy] = sh[0]; t.set(cx + dx, cy + dy, cols[cols.length - 1]); }
  }
}
function bevel(t, light, dark, k = 1) {
  for (let i = 0; i < 16; i++) {
    for (let b = 0; b < k; b++) {
      t.set(i, b, mixC(t.get(i, b), light, 0.55)); t.set(b, i, mixC(t.get(b, i), light, 0.55));
      t.set(i, 15 - b, mixC(t.get(i, 15 - b), dark, 0.5)); t.set(15 - b, i, mixC(t.get(15 - b, i), dark, 0.5));
    }
  }
}

// ---------- terrain ----------
D.dirt = (t) => {
  noiseFill(t, P('#54361f', '#5f3d23', '#6b4628', '#78502e', '#855b34'), { seed: 21, c1: 4, c2: 8, jit: 0.5, gain: 2.0 });
  const r = mulberry32(99);
  for (let i = 0; i < 6; i++) t.set(Math.floor(r() * 16), Math.floor(r() * 16), [58, 38, 22]); // pits
  for (let i = 0; i < 5; i++) t.set(Math.floor(r() * 16), Math.floor(r() * 16), [150, 112, 70]); // pebbles
  for (let i = 0; i < 3; i++) t.set(Math.floor(r() * 16), Math.floor(r() * 16), [120, 120, 120]);
};
D.grass_top = (t) => {
  noiseFill(t, P('#3f7d27', '#49902d', '#549f33', '#60ae3a', '#6dbd42', '#7fcd4f'), { seed: 31, c1: 4, c2: 8, jit: 0.5, gain: 2.1 });
  const r = mulberry32(5);
  for (let i = 0; i < 14; i++) { // blades
    const x = Math.floor(r() * 16), y = Math.floor(r() * 15);
    t.set(x, y, [58, 120, 36]); t.set(x, y + 1, [112, 190, 70]);
  }
};
D.grass_side = (t) => {
  D.dirt(t);
  const r = mulberry32(14);
  const green = P('#3f7d27', '#4c9330', '#5aa535', '#6bb83f');
  for (let x = 0; x < 16; x++) {
    const h = 3 + Math.floor(r() * 3); // 3..5 rows of fringe
    for (let y = 0; y < h; y++) {
      const v = hash(x, y, 33);
      let c = green[Math.min(3, Math.floor(v * 3.5))];
      if (y === h - 1) c = shadeC(green[0], 0.82); // shadowed fringe tip
      t.set(x, y, c);
    }
    if (r() < 0.3) t.set(x, h, shadeC(green[0], 0.7)); // hanging blade
  }
};
D.sand = (t) => {
  noiseFill(t, P('#d2c184', '#dac98c', '#e2d295', '#eadb9f', '#f0e3ab'), { seed: 41, c1: 6, c2: 12, jit: 0.55, gain: 1.7 });
  const r = mulberry32(8);
  for (let i = 0; i < 8; i++) t.set(Math.floor(r() * 16), Math.floor(r() * 16), [190, 170, 112]);
};
D.gravel = (t) => {
  const v = voronoi(16, 16, 13, 77);
  const greys = [[112, 110, 108], [132, 129, 126], [150, 147, 143], [98, 96, 96], [165, 160, 152], [120, 112, 105]];
  v.forEach((c, i) => {
    const x = i % 16, y = (i / 16) | 0;
    let col = greys[c.id % greys.length];
    const sh = 0.92 + hash(x, y, 4) * 0.16;
    col = shadeC(col, sh);
    if (c.edge < 1.3) col = shadeC(col, 0.58);
    else if (c.edge < 2.2 && y > 7) col = shadeC(col, 0.9);
    t.set(x, y, col);
  });
};
D.farmland_top = (t) => {
  noiseFill(t, P('#3d2415', '#472b19', '#52331e', '#5c3a22'), { seed: 51, c1: 4, c2: 8, jit: 0.4, gain: 1.8 });
  for (let y = 0; y < 16; y++) {
    if (y % 4 === 1) for (let x = 0; x < 16; x++) t.set(x, y, shadeC(t.get(x, y), 0.68)); // furrows
    if (y % 4 === 2) for (let x = 0; x < 16; x++) t.set(x, y, shadeC(t.get(x, y), 1.18));
  }
};
D.stone = (t) => stoneBase(t, 61);
D.cobblestone = (t) => {
  const v = voronoi(16, 16, 9, 303);
  const greys = [[124, 124, 128], [142, 142, 144], [158, 156, 156], [112, 114, 118], [150, 148, 152]];
  v.forEach((c, i) => {
    const x = i % 16, y = (i / 16) | 0;
    let col = greys[c.id % greys.length];
    col = shadeC(col, 0.9 + hash(x, y, 5) * 0.2);
    if (c.edge < 1.5) col = [58, 58, 62];
    else if (c.edge < 2.6) col = shadeC(col, (x + y) % 2 ? 1.12 : 0.95);
    t.set(x, y, col);
  });
};
D.snow = (t) => {
  noiseFill(t, P('#e4edf7', '#edf3fa', '#f6f9fd', '#ffffff', '#f2f7fc'), { seed: 71, c1: 4, c2: 8, jit: 0.4, gain: 1.6 });
  const r = mulberry32(2);
  for (let i = 0; i < 6; i++) t.set(Math.floor(r() * 16), Math.floor(r() * 16), [208, 224, 244]);
};
D.clay = (t) => {
  noiseFill(t, P('#9aa0ae', '#a3a9b6', '#adb3c0', '#b7bdc9', '#a0a6b3'), { seed: 81, c1: 3, c2: 6, jit: 0.25, gain: 2.0 });
};
D.sandstone_top = (t) => {
  noiseFill(t, P('#dccb8c', '#e4d495', '#ebdc9f', '#d4c283'), { seed: 91, c1: 4, c2: 8, jit: 0.35, gain: 1.6 });
  for (let x = 0; x < 16; x++) { t.set(x, 0, shadeC(t.get(x, 0), 0.9)); t.set(x, 15, shadeC(t.get(x, 15), 0.9)); }
};
D.sandstone_side = (t) => {
  noiseFill(t, P('#d8c688', '#e0cf91', '#e7d89b', '#d0be80'), { seed: 92, c1: 4, c2: 8, jit: 0.3, gain: 1.4 });
  for (const y of [3, 4, 11]) for (let x = 0; x < 16; x++) t.set(x, y, shadeC(t.get(x, y), y === 4 ? 1.1 : 0.83));
  for (let x = 0; x < 16; x++) { t.set(x, 0, shadeC(t.get(x, 0), 1.08)); t.set(x, 15, shadeC(t.get(x, 15), 0.88)); }
  // carved band
  for (let x = 2; x < 14; x++) if (x % 3 !== 1) t.set(x, 7, shadeC(t.get(x, 7), 0.78)), t.set(x, 8, shadeC(t.get(x, 8), 0.78));
};
D.obsidian = (t) => {
  noiseFill(t, P('#0c0814', '#130d1f', '#1a1229', '#241a38', '#2f2248'), { seed: 101, c1: 4, c2: 8, jit: 0.4, gain: 2.0 });
  const r = mulberry32(31);
  for (let i = 0; i < 9; i++) { // glassy violet veins
    let x = Math.floor(r() * 16), y = Math.floor(r() * 16);
    for (let k = 0; k < 3; k++) { t.set(x, y, [74, 46, 118]); x++; if (r() < 0.5) y++; }
  }
  for (let i = 0; i < 4; i++) t.set(Math.floor(r() * 16), Math.floor(r() * 16), [130, 90, 190]);
};
D.netherrack = (t) => {
  netherBase(t, 111);
  const r = mulberry32(12);
  for (let i = 0; i < 7; i++) { const x = Math.floor(r() * 14), y = Math.floor(r() * 15); t.set(x, y, [60, 18, 20]); t.set(x + 1, y, [70, 22, 22]); }
};
D.end_stone = (t) => {
  noiseFill(t, P('#cfcc86', '#d9d695', '#e2dfa2', '#ebe8b0', '#c4c07a'), { seed: 121, c1: 4, c2: 8, jit: 0.5, gain: 1.9 });
  const r = mulberry32(44);
  for (let i = 0; i < 7; i++) { const x = Math.floor(r() * 14), y = Math.floor(r() * 15); t.set(x, y, [176, 170, 106]); t.set(x + 1, y + 1, [186, 182, 116]); }
};
D.glowstone = (t) => {
  const v = voronoi(16, 16, 11, 505);
  const pal = P('#b0741f', '#cf9328', '#e8b03a', '#f8cc55', '#ffe17f', '#fff0ad');
  v.forEach((c, i) => {
    const x = i % 16, y = (i / 16) | 0;
    let k = Math.floor((hash(c.id, 1, 5) * 0.55 + clamp01(c.d1 / 5) * -0.3 + 0.45 + hash(x, y, 2) * 0.15) * pal.length);
    let col = pal[Math.max(0, Math.min(pal.length - 1, k))];
    if (c.edge < 1.2) col = shadeC(col, 0.74);
    t.set(x, y, col);
  });
};
D.magma = (t) => {
  const v = voronoi(16, 16, 10, 909);
  v.forEach((c, i) => {
    const x = i % 16, y = (i / 16) | 0;
    let col;
    if (c.edge < 1.2) col = mixC([255, 150, 30], [255, 214, 80], hash(x, y, 3));
    else if (c.edge < 2.1) col = mixC([200, 70, 14], [232, 100, 20], hash(x, y, 4));
    else col = mixC([38, 14, 12], [70, 26, 16], hash(x, y, 5) * 0.8 + hash(c.id, 2, 2) * 0.2);
    t.set(x, y, col);
  });
};
D.amethyst = (t) => {
  const v = voronoi(16, 16, 8, 1313);
  const pal = P('#5b3399', '#6e43b3', '#8457cc', '#9b6fe0', '#b690f2', '#d4b8ff');
  v.forEach((c, i) => {
    const x = i % 16, y = (i / 16) | 0;
    let k = Math.floor((hash(c.id, 7, 1) * 0.6 + (x - y + 16) / 64 + 0.05) * pal.length);
    let col = pal[Math.max(0, Math.min(pal.length - 1, k))];
    if (c.edge < 1.1) col = shadeC(col, 0.66);
    t.set(x, y, col);
  });
  for (const [x, y] of [[3, 3], [11, 6], [6, 12], [13, 13]]) { t.set(x, y, [235, 220, 255]); t.set(x + 1, y, [200, 170, 255]); }
};

// ---------- ores ----------
D.coal_ore = (t) => oreOn(t, (p) => stoneBase(p, 61), P('#101012', '#1c1c20', '#2a2a30', '#3b3b42'), 201, 8, false);
D.iron_ore = (t) => oreOn(t, (p) => stoneBase(p, 61), P('#c0643c', '#dc7f52', '#ecA070'.toLowerCase(), '#ffd0a8'), 202, 7, true);
D.gold_ore = (t) => oreOn(t, (p) => stoneBase(p, 61), P('#d8a410', '#f0c21e', '#fcdc3c', '#fff59a'), 203, 7, true);
D.diamond_ore = (t) => oreOn(t, (p) => stoneBase(p, 61), P('#22b8c0', '#3ad8dc', '#6ff0f0', '#d8ffff'), 204, 6, true);
D.quartz_ore = (t) => oreOn(t, netherBase, P('#d6cfc4', '#e8e2d8', '#f6f2ea', '#ffffff'), 205, 8, true);

// ---------- wood ----------
function logSide(t, pal, seed) {
  for (let y = 0; y < 16; y++) for (let x = 0; x < 16; x++) {
    const col = hash(x, 0, seed);
    let n = col * 0.55 + vnoise(x * 0.8, y * 0.14, seed, 0) * 0.45 + (hash(x, y, seed + 1) - 0.5) * 0.28;
    n = (n - 0.5) * 1.9 + 0.5;
    t.set(x, y, pal[Math.min(pal.length - 1, Math.max(0, Math.floor(clamp01(n) * pal.length)))]);
  }
  // bark ridges
  const r = mulberry32(seed + 5);
  for (let i = 0; i < 6; i++) {
    const x = Math.floor(r() * 16), y0 = Math.floor(r() * 12);
    for (let y = y0; y < y0 + 3; y++) t.set(x, y, shadeC(t.get(x, y), 0.78));
  }
}
function logTop(t, ring, bark, seed) {
  for (let y = 0; y < 16; y++) for (let x = 0; x < 16; x++) {
    const dx = x - 7.5, dy = y - 7.5;
    const d = Math.max(Math.abs(dx), Math.abs(dy)) * 0.55 + Math.hypot(dx, dy) * 0.45;
    const edge = Math.max(Math.abs(dx), Math.abs(dy));
    if (edge > 6.6) {
      t.set(x, y, bark[Math.floor(hash(x, y, seed) * bark.length)]);
    } else {
      const k = (Math.floor(d * 1.15) + (hash(x, y, seed + 2) > 0.9 ? 1 : 0)) % 2;
      let c = ring[k];
      if (d < 1.2) c = shadeC(ring[1], 0.85);
      t.set(x, y, shadeC(c, 0.96 + hash(x, y, seed + 4) * 0.08));
    }
  }
}
D.oak_log_side = (t) => logSide(t, P('#5a4122', '#684c29', '#7a5a33', '#8b6840', '#9c7849'), 301);
D.oak_log_top = (t) => logTop(t, P('#b48d55', '#9c7743'), P('#46321b', '#553c21', '#3a2815'), 302);
D.spruce_log_side = (t) => logSide(t, P('#251a0f', '#2e2013', '#3a2819', '#47321f', '#563c26'), 311);
D.spruce_log_top = (t) => logTop(t, P('#7b5a37', '#664a2c'), P('#2e2013', '#3a2819', '#251a0f'), 312);
D.oak_planks = (t) => woodPlanks(t, P('#9e7a45', '#a98350', '#b48d58', '#bd9761'), 321, hex('#7a5a30'));
D.spruce_planks = (t) => woodPlanks(t, P('#634527', '#6c4d2c', '#765533', '#805e3b'), 322, hex('#47301a'));
function leaves(t, pal, seed, holeT) {
  for (let y = 0; y < 16; y++) for (let x = 0; x < 16; x++) {
    const fx = (x + 0.5) / 16, fy = (y + 0.5) / 16;
    let n = vnoise(fx * 4, fy * 4, seed, 4) * 0.55 + vnoise(fx * 8, fy * 8, seed + 3, 8) * 0.45;
    n = (n - 0.5) * 2.1 + 0.5 + (hash(x, y, seed + 9) - 0.5) * 0.45;
    const idx = Math.min(pal.length - 1, Math.max(0, Math.floor(clamp01(n) * pal.length)));
    const hole = vnoise(fx * 5 + 3, fy * 5 + 1, seed + 21, 5) * 0.7 + hash(x, y, seed + 7) * 0.3;
    if (hole > holeT) t.set(x, y, [0, 0, 0], 0);
    else t.set(x, y, pal[idx]);
  }
  // darker clump shadow below opaque pixels for depth
  for (let y = 15; y >= 1; y--) for (let x = 0; x < 16; x++) {
    if (t.alpha(x, y) && !t.alpha(x, y - 1)) { /* upper edge stays */ }
  }
  for (let y = 0; y < 15; y++) for (let x = 0; x < 16; x++) {
    if (t.alpha(x, y) && !t.alpha(x, y + 1)) t.set(x, y, shadeC(t.get(x, y), 0.78));
  }
}
D.oak_leaves = (t) => leaves(t, P('#2c5e1c', '#357024', '#3f822b', '#4a9632', '#5aab3c', '#6cc047'), 331, 0.69);
D.spruce_leaves = (t) => leaves(t, P('#17402a', '#1e4f33', '#265e3c', '#306e46', '#3c7f52'), 332, 0.70);

// ---------- wool ----------
D.white_wool = (t) => woolTile(t, '#eeeeee', 401);
D.red_wool = (t) => woolTile(t, '#b3302a', 402);
D.blue_wool = (t) => woolTile(t, '#3a47b0', 403);
D.yellow_wool = (t) => woolTile(t, '#eec52c', 404);
D.green_wool = (t) => woolTile(t, '#4f8f2a', 405);
D.black_wool = (t) => woolTile(t, '#25272b', 406);

// ---------- utility blocks ----------
D.crafting_table_top = (t) => {
  woodPlanks(t, P('#a07c46', '#aa8551', '#b58e5a'), 501, hex('#7a5a30'));
  // 3x3 crafting grid
  const line = hex('#4a3016');
  for (let i = 0; i < 16; i++) { t.set(i, 0, line); t.set(i, 15, line); t.set(0, i, line); t.set(15, i, line); }
  for (const k of [5, 10]) for (let i = 1; i < 15; i++) { t.set(i, k, line); t.set(k, i, line); }
  for (let y = 1; y < 15; y++) for (let x = 1; x < 15; x++) {
    if (x !== 5 && x !== 10 && y !== 5 && y !== 10) {
      const hl = (x === 1 || x === 6 || x === 11) || (y === 1 || y === 6 || y === 11);
      t.set(x, y, shadeC(t.get(x, y), hl ? 1.06 : 0.97));
    }
  }
};
D.crafting_table_side = (t) => {
  woodPlanks(t, P('#9a7642', '#a58049', '#b08a54'), 502, hex('#6b4c26'));
  // dark top apron
  for (let y = 0; y < 4; y++) for (let x = 0; x < 16; x++) t.set(x, y, shadeC(hex('#6e4c28'), 0.9 + hash(x, y, 4) * 0.2));
  for (let x = 0; x < 16; x++) t.set(x, 3, [60, 40, 20]);
  // saw (left) and hammer (right), hanging on the board
  const steel = P('#c9ccd0', '#9aa0a6', '#6e7378');
  for (let x = 2; x < 8; x++) { t.set(x, 6, steel[0]); t.set(x, 7, steel[1]); t.set(x, 8, x % 2 ? steel[2] : steel[1]); }
  t.set(8, 6, hex('#5a3a1a')); t.set(8, 7, hex('#5a3a1a')); t.set(9, 6, hex('#5a3a1a'));
  for (let y = 6; y < 14; y++) { t.set(12, y, hex('#4c3016')); t.set(13, y, hex('#5c3c1c')); }
  t.rect(10, 5, 5, 2, steel[1]); t.rect(10, 5, 5, 1, steel[0]); t.set(10, 6, steel[2]);
  for (let x = 0; x < 16; x++) { t.set(x, 0, [52, 34, 16]); }
};
function furnaceBody(t) {
  noiseFill(t, P('#707072', '#7a7a7c', '#848486', '#8d8d8f', '#6a6a6c'), { seed: 601, c1: 4, c2: 8, jit: 0.45, gain: 1.8 });
  bevel(t, [190, 190, 192], [60, 60, 64], 1);
}
D.furnace_top = (t) => {
  furnaceBody(t);
  for (let i = 3; i < 13; i++) { for (const [x, y] of [[i, 3], [i, 12], [3, i], [12, i]]) t.set(x, y, [58, 58, 62]); }
  t.rect(4, 4, 8, 8, [48, 48, 52]);
  for (let y = 5; y < 11; y++) for (let x = 5; x < 11; x++) t.set(x, y, shadeC([54, 54, 58], 0.9 + hash(x, y, 1) * 0.2));
};
function furnaceFront(t, lit) {
  furnaceBody(t);
  // upper vent slot
  t.rect(4, 3, 8, 2, [34, 34, 38]);
  t.rect(4, 5, 8, 1, [96, 96, 100]);
  // firebox opening
  t.rect(3, 7, 10, 7, [24, 22, 24]);
  t.rect(3, 7, 10, 1, [14, 12, 14]);
  t.rect(2, 7, 1, 7, [120, 120, 124]); t.rect(13, 7, 1, 7, [60, 60, 64]); t.rect(3, 14, 10, 1, [58, 58, 62]);
  if (lit) {
    const r = mulberry32(88);
    for (let y = 8; y < 14; y++) for (let x = 4; x < 12; x++) {
      const h = 13 - y;
      const flick = vnoise(x * 0.9, y * 0.8, 3, 0);
      if (h + flick * 3 > 2.2 + Math.abs(x - 7.5) * 0.55) {
        t.set(x, y, h > 3.4 + flick ? [255, 214, 90] : h > 1.8 ? [255, 150, 40] : [220, 80, 20]);
      } else t.set(x, y, [70, 26, 14]);
    }
    for (let x = 4; x < 12; x++) t.set(x, 13, [255, 120, 30]);
    t.set(7, 9, [255, 244, 170]); t.set(8, 10, [255, 244, 170]);
  } else {
    for (let x = 4; x < 12; x++) t.set(x, 13, [46, 44, 48]);
    t.set(5, 12, [70, 66, 70]); t.set(9, 12, [64, 60, 66]);
  }
}
D.furnace_front = (t) => furnaceFront(t, false);
D.furnace_front_lit = (t) => furnaceFront(t, true);
D.chest_top = (t) => {
  woodPlanks(t, P('#9a6d2f', '#a47636', '#ae803e'), 701, hex('#5b3d17'));
  const e = hex('#4a2f10');
  for (let i = 0; i < 16; i++) { t.set(i, 0, e); t.set(i, 15, e); t.set(0, i, e); t.set(15, i, e); }
  for (let i = 1; i < 15; i++) { t.set(i, 1, shadeC(t.get(i, 1), 1.15)); t.set(1, i, shadeC(t.get(1, i), 1.1)); }
};
D.chest_side = (t) => {
  woodPlanks(t, P('#9a6d2f', '#a47636', '#ae803e'), 702, hex('#5b3d17'));
  const e = hex('#4a2f10');
  for (let i = 0; i < 16; i++) { t.set(i, 0, e); t.set(i, 15, e); t.set(0, i, e); t.set(15, i, e); t.set(i, 5, e); t.set(i, 6, shadeC(e, 1.4)); }
  // latch plate
  t.rect(6, 4, 4, 5, [160, 164, 170]); t.rect(6, 4, 4, 1, [214, 218, 224]); t.rect(6, 8, 4, 1, [96, 100, 108]);
  t.rect(7, 6, 2, 2, [44, 44, 52]); t.set(7, 6, [255, 210, 80]);
};
D.bookshelf = (t) => {
  woodPlanks(t, P('#9e7a45', '#a98350', '#b48d58'), 801, hex('#7a5a30'));
  const r = mulberry32(81);
  const cols = P('#8b2c2c', '#2c5a8b', '#2c7a3c', '#7a5a1c', '#5a2c7a', '#a8742c', '#2c6a6a', '#8a8a8a');
  for (const [y0, y1] of [[3, 7], [9, 13]]) {
    for (let x = 0; x < 16; x++) for (let y = y0; y <= y1; y++) t.set(x, y, [36, 24, 14]);
    let x = 0;
    while (x < 16) {
      const w = 1 + Math.floor(r() * 2), h = y1 - y0 - Math.floor(r() * 2);
      const c = cols[Math.floor(r() * cols.length)];
      for (let xx = x; xx < Math.min(16, x + w); xx++) {
        for (let y = y1 - h + 1; y <= y1; y++) t.set(xx, y, shadeC(c, 0.85 + hash(xx, y, 5) * 0.2));
        t.set(xx, y1 - h + 1, shadeC(c, 1.3));
      }
      x += w + (r() < 0.2 ? 1 : 0);
    }
  }
  for (let x = 0; x < 16; x++) { t.set(x, 2, [92, 66, 34]); t.set(x, 8, [92, 66, 34]); t.set(x, 14, [92, 66, 34]); }
};
D.bricks = (t) => {
  const mortar = P('#b9b1a6', '#a9a196');
  const br = P('#9a4634', '#a64e3a', '#b25842', '#8e3f30');
  for (let y = 0; y < 16; y++) for (let x = 0; x < 16; x++) {
    const row = Math.floor(y / 4);
    const off = row % 2 ? 4 : 0;
    const bx = Math.floor((x + off) / 8);
    const ly = y % 4, lx = (x + off) % 8;
    if (ly === 3 || lx === 7) t.set(x, y, mortar[(x + y) % 2 ? 0 : 1]);
    else {
      let c = br[Math.floor(hash(bx, row, 6) * 4)];
      c = shadeC(c, 0.92 + hash(x, y, 9) * 0.16);
      if (ly === 0) c = shadeC(c, 1.12);
      t.set(x, y, c);
    }
  }
};
D.stone_bricks = (t) => {
  stoneBase(t, 63);
  const dark = [54, 54, 58], light = [150, 150, 154];
  for (let i = 0; i < 16; i++) { t.set(i, 7, dark); t.set(i, 15, dark); t.set(i, 0, light); t.set(i, 8, light); }
  for (let y = 0; y < 7; y++) { t.set(7, y, dark); t.set(8, y, light); }
  for (let y = 8; y < 15; y++) { t.set(3, y, dark); t.set(4, y, light); t.set(11, y, dark); t.set(12, y, light); }
  for (let y = 0; y < 16; y++) t.set(0, y, y < 8 ? [128, 128, 132] : t.get(0, y));
};
D.coal_block = (t) => {
  noiseFill(t, P('#0e0e10', '#151518', '#1d1d21', '#27272c', '#33333a'), { seed: 901, c1: 4, c2: 8, jit: 0.5, gain: 2.2 });
  const v = voronoi(16, 16, 7, 902);
  v.forEach((c, i) => { if (c.edge < 1.0) { const x = i % 16, y = (i / 16) | 0; t.set(x, y, shadeC(t.get(x, y), 0.55)); } });
  for (const [x, y] of [[3, 4], [10, 2], [12, 11], [5, 12], [8, 8]]) t.set(x, y, [74, 74, 86]);
};
D.iron_block = (t) => {
  noiseFill(t, P('#cfd0d2', '#d6d7d9', '#dddee0', '#e4e5e7'), { seed: 911, c1: 3, c2: 6, jit: 0.2, gain: 1.4 });
  bevel(t, [255, 255, 255], [120, 122, 128], 2);
  for (const [x, y] of [[2, 2], [13, 2], [2, 13], [13, 13]]) { t.set(x, y, [150, 152, 158]); }
  for (let i = 4; i < 12; i++) { t.set(i, 4, [170, 172, 178]); t.set(4, i, [170, 172, 178]); t.set(i, 11, [244, 244, 246]); t.set(11, i, [244, 244, 246]); }
};
D.diamond_block = (t) => {
  noiseFill(t, P('#2dbcb6', '#3ccdc6', '#52ddd6', '#72ebe4', '#98f6f0'), { seed: 921, c1: 3, c2: 6, jit: 0.3, gain: 1.7 });
  const v = voronoi(16, 16, 6, 922);
  v.forEach((c, i) => { const x = i % 16, y = (i / 16) | 0; if (c.edge < 1.0) t.set(x, y, shadeC(t.get(x, y), 0.72)); });
  bevel(t, [230, 255, 255], [18, 120, 126], 2);
  for (const [x, y] of [[4, 4], [5, 3], [11, 9], [9, 12]]) t.set(x, y, [255, 255, 255]);
};
D.oneblock = (t) => {
  stoneBase(t, 971);
  t.each((x, y, c) => shadeC(c, 0.7));
  const cyan = [90, 235, 255];
  for (let i = 2; i < 14; i++) for (const [x, y] of [[i, 2], [i, 13], [2, i], [13, i]]) t.set(x, y, shadeC(cyan, 0.8));
  for (const [x, y] of [[7, 5], [8, 5], [6, 6], [9, 6], [5, 7], [10, 7], [5, 8], [10, 8], [6, 9], [9, 9], [7, 10], [8, 10], [7, 7], [8, 8]]) t.set(x, y, cyan);
  t.set(7, 7, [255, 255, 255]);
};

// ---------- translucent ----------
D.glass = (t) => {
  t.fill([200, 230, 240], 22);
  for (let i = 0; i < 16; i++) for (const [x, y] of [[i, 0], [i, 15], [0, i], [15, i]]) t.set(x, y, [225, 245, 255], 215);
  for (let i = 1; i < 15; i++) { t.set(i, 1, [235, 250, 255], 90); t.set(1, i, [235, 250, 255], 90); }
  // diagonal shine streaks
  for (const [x, y, len] of [[3, 6, 3], [5, 4, 4], [10, 11, 2], [12, 9, 3]]) {
    for (let k = 0; k < len; k++) t.set(x + k, y - k + len, [255, 255, 255], 190);
  }
};
D.ice = (t) => {
  noiseFill(t, P('#8ec7f0', '#9dd0f5', '#aedcfa', '#bfe6fd'), { seed: 1001, c1: 3, c2: 6, jit: 0.3, gain: 1.7 });
  t.each((x, y, c) => [c[0], c[1], c[2], 178]);
  for (const [x, y, len] of [[2, 10, 5], [7, 5, 6], [10, 12, 4], [3, 3, 3]]) {
    for (let k = 0; k < len; k++) t.set(x + k, y - k, [236, 248, 255], 235);
  }
  for (let i = 0; i < 16; i++) { t.set(i, 0, [215, 238, 255], 205); t.set(0, i, [215, 238, 255], 205); }
};
D.water = (t) => {
  for (let y = 0; y < 16; y++) for (let x = 0; x < 16; x++) {
    const n = vnoise((x + 0.5) / 16 * 4, (y + 0.5) / 16 * 4, 1101, 4);
    const w = Math.sin(((x * 0.5 + y) / 16) * Math.PI * 4 + n * 6);
    let k = 0.4 + n * 0.35 + w * 0.12 + (hash(x, y, 2) - 0.5) * 0.1;
    k = clamp01(k);
    const c = mixC(mixC([30, 80, 170], [48, 116, 214], k), [150, 200, 250], Math.max(0, k - 0.72) * 3);
    t.set(x, y, c);
  }
};

// ---------- cutout / plants ----------
D.torch = (t) => {
  for (let y = 8; y < 16; y++) {
    t.set(7, y, shadeC(hex('#9c7338'), 0.95 + hash(7, y, 1) * 0.1));
    t.set(8, y, shadeC(hex('#6e5026'), 0.95 + hash(8, y, 2) * 0.1));
  }
  t.set(7, 8, hex('#3a2a12')); t.set(8, 8, hex('#2a1c0c'));
  t.set(7, 9, hex('#7a5a2c'));
  // flame head (rows 6-7), emissive
  t.set(7, 6, [255, 244, 160]); t.set(8, 6, [255, 214, 74]);
  t.set(7, 7, [255, 186, 50]); t.set(8, 7, [255, 140, 24]);
};
D.oak_sapling = (t) => {
  const stem = P('#5a3f1e', '#6e4e26');
  for (let y = 8; y < 16; y++) t.set(7 + (y > 12 ? 0 : 0), y, stem[y % 2]);
  t.set(8, 15, stem[0]); t.set(6, 15, stem[1]);
  const g = P('#2f6a1e', '#3e8a28', '#54a834', '#6cc044');
  const blob = (cx, cy, rr) => {
    for (let y = -rr; y <= rr; y++) for (let x = -rr; x <= rr; x++) {
      if (x * x + y * y <= rr * rr + 1 && hash(cx + x, cy + y, 7) > 0.18) {
        const tone = Math.min(3, Math.max(0, 2 - Math.round((y + x * 0.4) / 1.5) + (hash(x, y, 1) > 0.6 ? 1 : 0)));
        t.set(cx + x, cy + y, g[tone]);
      }
    }
  };
  blob(7, 4, 3); blob(4, 8, 2); blob(11, 7, 2); blob(8, 8, 2);
  t.set(5, 9, stem[1]); t.set(10, 9, stem[0]);
};
function wheat(t, stage) {
  const heights = [3, 6, 10, 14];
  const h = heights[stage];
  const greens = stage === 3 ? P('#b89a2c', '#d6b43a', '#e8c850', '#8c7220') : stage === 2 ? P('#6ca02c', '#80b836', '#9ccc40', '#4a7a1e') : P('#3f8a2a', '#52a436', '#68bc42', '#2e6a1e');
  const r = mulberry32(700 + stage);
  for (const cx of [1, 4, 7, 10, 13]) {
    const hh = Math.max(2, h - Math.floor(r() * 3));
    for (let k = 0; k < hh; k++) {
      const y = 15 - k;
      t.set(cx, y, greens[(k + cx) % 2]);
      t.set(cx + 1, y, greens[k % 3 === 0 ? 0 : 3]);
    }
    if (stage === 3) { // grain heads
      for (let k = 0; k < 4; k++) { t.set(cx - 1 + (k % 2) * 2, 15 - hh + 1 + k, greens[2]); }
      t.set(cx, 15 - hh, greens[2]); t.set(cx + 1, 15 - hh, greens[1]);
      t.set(cx, 15 - hh - 1 < 0 ? 0 : 15 - hh - 1, greens[2]);
    } else if (stage >= 1) {
      t.set(cx - 1, 15 - hh + 2, greens[1]); t.set(cx + 2, 15 - hh + 3, greens[0]);
    }
  }
}
D.wheat_0 = (t) => wheat(t, 0);
D.wheat_1 = (t) => wheat(t, 1);
D.wheat_2 = (t) => wheat(t, 2);
D.wheat_3 = (t) => wheat(t, 3);

// ---------- bed ----------
D.bed_top = (t) => {
  woolTile(t, '#b3302a', 411);
  // blanket folds
  for (let x = 0; x < 16; x++) { t.set(x, 5, shadeC(t.get(x, 5), 0.78)); t.set(x, 6, shadeC(t.get(x, 6), 1.1)); }
  // pillow
  for (let y = 0; y < 5; y++) for (let x = 0; x < 16; x++) {
    if (x >= 2 && x <= 13 && y >= 0 && y <= 4) t.set(x, y, shadeC([236, 236, 240], 0.93 + hash(x, y, 3) * 0.1));
    else t.set(x, y, shadeC(hex('#7a5a30'), 0.95));
  }
  for (let x = 2; x <= 13; x++) t.set(x, 4, [200, 200, 210]);
  for (let y = 0; y < 5; y++) { t.set(2, y, [205, 205, 214]); t.set(13, y, [205, 205, 214]); }
  for (let y = 5; y < 16; y++) { t.set(0, y, shadeC(t.get(0, y), 0.8)); t.set(15, y, shadeC(t.get(15, y), 0.8)); }
};
D.bed_side = (t) => {
  woolTile(t, '#b3302a', 412);
  for (let x = 0; x < 16; x++) { t.set(x, 7, shadeC(t.get(x, 7), 1.18)); t.set(x, 10, shadeC(t.get(x, 10), 0.8)); }
  for (let y = 11; y < 16; y++) for (let x = 0; x < 16; x++) {
    const leg = x < 3 || x > 12;
    t.set(x, y, leg ? shadeC(hex('#7a5530'), 0.9 + hash(x, y, 2) * 0.2) : shadeC(hex('#8a6438'), y === 11 ? 0.6 : 0.85));
  }
  for (let y = 0; y < 7; y++) for (let x = 0; x < 16; x++) t.set(x, y, shadeC(t.get(x, y), 0.96));
};

// ---------- emissive (self-lit) masks: return 0..1 factor per pixel or 0 ----------
export const EMISSIVE = {
  glowstone: (x, y, c) => 0.55 + lum(c) * 0.6,
  magma: (x, y, c) => (c[0] > 150 && c[1] > 60 ? 0.9 : 0.12),
  furnace_front_lit: (x, y, c) => (y >= 8 && y <= 13 && x >= 4 && x < 12 && c[0] > 190 ? 0.95 : 0),
  torch: (x, y, c) => (y <= 7 ? 1.0 : 0),
  amethyst: (x, y, c) => (lum(c) > 0.62 ? 0.28 : 0.05),
  oneblock: (x, y, c) => (c[2] > 200 ? 0.8 : 0),
  diamond_ore: (x, y, c) => (c[1] > 200 && c[0] < 200 ? 0.18 : 0),
  gold_ore: (x, y, c) => (c[0] > 245 && c[2] > 100 ? 0.2 : 0),
};

export function drawTile(key) {
  const t = new Pix(16, 16);
  const fn = D[key];
  if (fn) fn(t);
  else { // visible placeholder so a missing texture is obvious
    for (let y = 0; y < 16; y++) for (let x = 0; x < 16; x++) t.set(x, y, ((x >> 2) + (y >> 2)) % 2 ? [255, 0, 255] : [20, 0, 20]);
  }
  return t;
}
