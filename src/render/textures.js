// Browser-side texture atlas + icon data URLs built from the pure-pixel generators.
import * as THREE from 'three';
import { BLOCKS } from '../data/blocks.js';
import { ITEMS } from '../data/items.js';
import { drawTile, EMISSIVE } from './tiles.js';
import { getIconPix, tilePix } from './sprites.js';
import { Pix, hash, mulberry32 } from './pixel.js';

export const TILE = 16;
const PAD = 8; // extruded border: safe through mip level 3
const CELL = TILE + PAD * 2;

export function collectTileKeys() {
  const keys = new Set();
  for (const b of BLOCKS) if (b) for (const v of Object.values(b.tex)) keys.add(v);
  return [...keys];
}

function makeCanvas(w, h) {
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  return c;
}

function pixToImageData(pix) {
  return new ImageData(new Uint8ClampedArray(pix.d), pix.w, pix.h);
}

let atlasCache = null;

export function getAtlas() {
  if (atlasCache) return atlasCache;
  const keys = collectTileKeys();
  const cols = 8;
  const rows = Math.ceil(keys.length / cols);
  const W = cols * CELL, H = rows * CELL;
  const canvas = makeCanvas(W, H);
  const ecanvas = makeCanvas(W, H);
  const ctx = canvas.getContext('2d');
  const ectx = ecanvas.getContext('2d');
  ectx.fillStyle = '#000'; ectx.fillRect(0, 0, W, H);
  const rects = new Map();
  const pixels = new Map();
  keys.forEach((key, i) => {
    const pix = tilePix(key);
    pixels.set(key, pix);
    const cx = (i % cols) * CELL, cy = Math.floor(i / cols) * CELL;
    const padded = new Pix(CELL, CELL);
    const epad = new Pix(CELL, CELL);
    const em = EMISSIVE[key];
    for (let y = 0; y < CELL; y++) for (let x = 0; x < CELL; x++) {
      const sx = Math.min(TILE - 1, Math.max(0, x - PAD)), sy = Math.min(TILE - 1, Math.max(0, y - PAD));
      const c = pix.get(sx, sy);
      padded.set(x, y, c, c[3]);
      if (em) {
        const f = em(sx, sy, c);
        epad.set(x, y, [c[0] * f * 0.8, c[1] * f * 0.8, c[2] * f * 0.8], 255);
      } else epad.set(x, y, [0, 0, 0], 255);
    }
    ctx.putImageData(pixToImageData(padded), cx, cy);
    ectx.putImageData(pixToImageData(epad), cx, cy);
    const u0 = (cx + PAD) / W, u1 = (cx + PAD + TILE) / W;
    const v1 = 1 - (cy + PAD) / H, v0 = 1 - (cy + PAD + TILE) / H;
    rects.set(key, [u0, v0, u1, v1]);
  });
  const mk = (cv) => {
    const t = new THREE.CanvasTexture(cv);
    t.colorSpace = THREE.SRGBColorSpace;
    t.magFilter = THREE.NearestFilter;
    t.minFilter = THREE.NearestMipmapLinearFilter; // crisp up close, no shimmer in the distance
    t.generateMipmaps = true;
    t.anisotropy = 4;
    t.wrapS = t.wrapT = THREE.ClampToEdgeWrapping;
    return t;
  };
  atlasCache = {
    canvas, ecanvas, texture: mk(canvas), emissive: mk(ecanvas), keys, pixels,
    uv(key) { return rects.get(key) || rects.get(keys[0]); },
    // random colour sample from a tile (for particles), returns [r,g,b] 0..255
    sample(key, rnd = Math.random) {
      const pix = pixels.get(key);
      for (let i = 0; i < 12; i++) {
        const c = pix.get(Math.floor(rnd() * 16), Math.floor(rnd() * 16));
        if (c[3] > 120) return c;
      }
      return [128, 128, 128, 255];
    },
  };
  return atlasCache;
}

// repeating water texture (animated by the renderer)
let waterTex = null;
export function getWaterTexture() {
  if (waterTex) return waterTex;
  const pix = drawTile('water');
  const c = makeCanvas(16, 16);
  c.getContext('2d').putImageData(pixToImageData(pix), 0, 0);
  waterTex = new THREE.CanvasTexture(c);
  waterTex.colorSpace = THREE.SRGBColorSpace;
  waterTex.wrapS = waterTex.wrapT = THREE.RepeatWrapping;
  waterTex.magFilter = THREE.NearestFilter;
  waterTex.minFilter = THREE.NearestFilter;
  waterTex.generateMipmaps = false;
  return waterTex;
}

// crack stages 0..9 as a 160x16 strip
let crackTex = null;
export function getCrackTexture() {
  if (crackTex) return crackTex;
  const order = [];
  const r = mulberry32(4242);
  const seen = new Set();
  const add = (x, y) => { const k = x + ',' + y; if (x < 0 || y < 0 || x > 15 || y > 15 || seen.has(k)) return; seen.add(k); order.push([x, y]); };
  // several branches growing out of the centre
  const branches = [];
  for (let i = 0; i < 6; i++) branches.push({ x: 7 + Math.floor(r() * 3), y: 7 + Math.floor(r() * 3), a: (i / 6) * Math.PI * 2 + r() * 0.8 });
  for (let step = 0; step < 14; step++) {
    for (const b of branches) {
      b.a += (r() - 0.5) * 1.0;
      b.x += Math.cos(b.a) * 1.0; b.y += Math.sin(b.a) * 1.0;
      add(Math.round(b.x), Math.round(b.y));
      if (r() < 0.35) add(Math.round(b.x) + (r() < 0.5 ? 1 : 0), Math.round(b.y));
    }
  }
  const strip = new Pix(160, 16);
  for (let s = 0; s < 10; s++) {
    const n = Math.floor(((s + 1) / 10) * order.length);
    for (let i = 0; i < n; i++) {
      const [x, y] = order[i];
      strip.set(s * 16 + x, y, [8, 8, 10], 215);
    }
    // soft darkening scatter that grows with the stage
    for (let i = 0; i < s * 7; i++) {
      const x = Math.floor(hash(i, s, 1) * 16), y = Math.floor(hash(i, s, 2) * 16);
      if (!strip.alpha(s * 16 + x, y)) strip.set(s * 16 + x, y, [10, 10, 14], 70);
    }
  }
  const c = makeCanvas(160, 16);
  c.getContext('2d').putImageData(pixToImageData(strip), 0, 0);
  crackTex = new THREE.CanvasTexture(c);
  crackTex.magFilter = THREE.NearestFilter;
  crackTex.minFilter = THREE.NearestFilter;
  crackTex.generateMipmaps = false;
  crackTex.colorSpace = THREE.SRGBColorSpace;
  crackTex.wrapS = THREE.ClampToEdgeWrapping;
  return crackTex;
}

const iconURLs = new Map();
// 32x32 data URL for any item (or block) key; cached
export function getIconDataURL(key) {
  let url = iconURLs.get(key);
  if (url) return url;
  const pix = getIconPix(key);
  const c = makeCanvas(32, 32);
  c.getContext('2d').putImageData(pixToImageData(pix), 0, 0);
  url = c.toDataURL('image/png');
  iconURLs.set(key, url);
  return url;
}

export { getIconPix };

// Simple procedural mob skins (MC-like 64x32 layout), optional helper for Builder B.
export function drawMobTexture(kind) {
  const c = makeCanvas(64, 32);
  const g = c.getContext('2d');
  const px = (x, y, w, h, col) => { g.fillStyle = col; g.fillRect(x, y, w, h); };
  const noise = (x, y, w, h, base, amt, seed) => {
    for (let j = 0; j < h; j++) for (let i = 0; i < w; i++) {
      const v = 1 + (hash(x + i, y + j, seed) - 0.5) * amt;
      const n = parseInt(base.slice(1), 16);
      g.fillStyle = `rgb(${Math.min(255, ((n >> 16) & 255) * v) | 0},${Math.min(255, ((n >> 8) & 255) * v) | 0},${Math.min(255, (n & 255) * v) | 0})`;
      g.fillRect(x + i, y + j, 1, 1);
    }
  };
  if (kind === 'zombie') {
    noise(0, 0, 32, 16, '#5a8a48', 0.25, 1); // head
    px(8, 8, 8, 8, '#5a8a48'); px(10, 11, 2, 2, '#1a1a1a'); px(14, 11, 2, 2, '#1a1a1a'); px(12, 14, 4, 1, '#3a5a2e');
    noise(16, 16, 24, 16, '#2f6fa3', 0.3, 2); // body
    noise(40, 16, 16, 16, '#5a8a48', 0.25, 3); // arms
    noise(0, 16, 16, 16, '#3a3a8a', 0.3, 4); // legs
  } else {
    noise(0, 0, 32, 16, '#c8b8a0', 0.2, 5); // sheep head/skin
    px(8, 8, 8, 8, '#c8b8a0'); px(10, 11, 1, 1, '#111'); px(14, 11, 1, 1, '#111');
    noise(16, 16, 24, 16, '#ececec', 0.25, 6);
    noise(40, 16, 16, 16, '#d8d0c4', 0.2, 7);
    noise(0, 16, 16, 16, '#d8d0c4', 0.2, 8);
  }
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.magFilter = THREE.NearestFilter;
  t.minFilter = THREE.NearestFilter;
  t.generateMipmaps = false;
  return t;
}

export { ITEMS, BLOCKS };
