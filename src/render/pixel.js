// Tiny pure-JS pixel toolkit (no DOM) used by the procedural texture / icon generators,
// so the art can also be rendered headlessly from node for QA.

export const clamp01 = (v) => (v < 0 ? 0 : v > 1 ? 1 : v);
export const clamp255 = (v) => (v < 0 ? 0 : v > 255 ? 255 : v);

export function hex(s) {
  if (Array.isArray(s)) return s;
  const n = parseInt(s.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}
export const P = (...cols) => cols.map(hex);
export const mixC = (a, b, t) => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
export const shadeC = (c, f) => [clamp255(c[0] * f), clamp255(c[1] * f), clamp255(c[2] * f)];
export const lum = (c) => (0.299 * c[0] + 0.587 * c[1] + 0.114 * c[2]) / 255;

export function hash(x, y, s) {
  let h = (Math.imul(x | 0, 374761393) + Math.imul(y | 0, 668265263) + Math.imul(s | 0, 2147483647)) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  h ^= h >>> 16;
  return (h >>> 0) / 4294967296;
}

export function mulberry32(a) {
  return function () {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// value noise; `per` (integer) makes the lattice wrap so the result tiles
export function vnoise(x, y, s, per = 0) {
  const xi = Math.floor(x), yi = Math.floor(y);
  const fx = x - xi, fy = y - yi;
  const w = per ? (i) => ((i % per) + per) % per : (i) => i;
  const a = hash(w(xi), w(yi), s), b = hash(w(xi + 1), w(yi), s);
  const c = hash(w(xi), w(yi + 1), s), d = hash(w(xi + 1), w(yi + 1), s);
  const u = fx * fx * (3 - 2 * fx), v = fy * fy * (3 - 2 * fy);
  return a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v;
}

export class Pix {
  constructor(w = 16, h = 16) {
    this.w = w; this.h = h;
    this.d = new Uint8ClampedArray(w * h * 4);
  }
  set(x, y, c, a = 255) {
    x |= 0; y |= 0;
    if (x < 0 || y < 0 || x >= this.w || y >= this.h) return;
    const i = (y * this.w + x) * 4;
    this.d[i] = c[0]; this.d[i + 1] = c[1]; this.d[i + 2] = c[2]; this.d[i + 3] = a;
  }
  get(x, y) {
    if (x < 0 || y < 0 || x >= this.w || y >= this.h) return [0, 0, 0, 0];
    const i = (y * this.w + x) * 4;
    return [this.d[i], this.d[i + 1], this.d[i + 2], this.d[i + 3]];
  }
  alpha(x, y) {
    if (x < 0 || y < 0 || x >= this.w || y >= this.h) return 0;
    return this.d[(y * this.w + x) * 4 + 3];
  }
  fill(c, a = 255) {
    for (let y = 0; y < this.h; y++) for (let x = 0; x < this.w; x++) this.set(x, y, c, a);
  }
  rect(x0, y0, w, h, c, a = 255) {
    for (let y = y0; y < y0 + h; y++) for (let x = x0; x < x0 + w; x++) this.set(x, y, c, a);
  }
  each(fn) {
    for (let y = 0; y < this.h; y++) for (let x = 0; x < this.w; x++) {
      const r = fn(x, y, this.get(x, y));
      if (r) this.set(x, y, r, r[3] !== undefined ? r[3] : this.alpha(x, y));
    }
  }
  clone() {
    const p = new Pix(this.w, this.h);
    p.d.set(this.d);
    return p;
  }
}

// Palette-indexed noise fill. cells = noise frequency (cells per 16px, tileable).
export function noiseFill(t, pal, o = {}) {
  const { seed = 1, c1 = 4, c2 = 8, mix = 0.65, jit = 0.3, gain = 2.0, off = 0 } = o;
  for (let y = 0; y < t.h; y++) for (let x = 0; x < t.w; x++) {
    const fx = (x + 0.5) / t.w, fy = (y + 0.5) / t.h;
    let n = vnoise(fx * c1, fy * c1, seed, c1) * mix + vnoise(fx * c2, fy * c2, seed + 17, c2) * (1 - mix);
    n = (n - 0.5) * gain + 0.5 + (hash(x, y, seed + 3) - 0.5) * jit + off;
    const idx = Math.min(pal.length - 1, Math.max(0, Math.floor(clamp01(n) * pal.length)));
    t.set(x, y, pal[idx]);
  }
}

// Tileable voronoi. Returns {id, d1, d2, edge} grids per pixel.
export function voronoi(w, h, n, seed) {
  const pts = [];
  const rnd = mulberry32(seed);
  for (let i = 0; i < n; i++) pts.push([rnd() * w, rnd() * h]);
  const out = [];
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    let d1 = 1e9, d2 = 1e9, id = 0;
    for (let i = 0; i < n; i++) {
      for (let oy = -1; oy <= 1; oy++) for (let ox = -1; ox <= 1; ox++) {
        const dx = pts[i][0] + ox * w - (x + 0.5), dy = pts[i][1] + oy * h - (y + 0.5);
        const d = dx * dx + dy * dy;
        if (d < d1) { d2 = d1; d1 = d; id = i; } else if (d < d2) d2 = d;
      }
    }
    out.push({ id, d1: Math.sqrt(d1), d2: Math.sqrt(d2), edge: Math.sqrt(d2) - Math.sqrt(d1) });
  }
  return out;
}

// Add a dark outline (1px, 8-neighbour not needed -> 4 neighbour) around opaque pixels of a pix,
// colour = neighbour pixel darkened. Returns a new Pix of same size.
export function outline(src, f = 0.38, minA = 128) {
  const out = src.clone();
  for (let y = 0; y < src.h; y++) for (let x = 0; x < src.w; x++) {
    if (src.alpha(x, y) >= minA) continue;
    let best = null;
    for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      if (src.alpha(x + dx, y + dy) >= minA) { best = src.get(x + dx, y + dy); break; }
    }
    if (best) out.set(x, y, shadeC(best, f));
  }
  return out;
}

export function upscale(src, k) {
  const out = new Pix(src.w * k, src.h * k);
  for (let y = 0; y < out.h; y++) for (let x = 0; x < out.w; x++) {
    const c = src.get((x / k) | 0, (y / k) | 0);
    out.set(x, y, c, c[3]);
  }
  return out;
}
