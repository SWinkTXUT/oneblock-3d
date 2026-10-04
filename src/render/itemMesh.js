// 3D item meshes: textured cubes for blocks, extruded-pixel sprites for everything else.
import * as THREE from 'three';
import { BLOCK_BY_KEY } from '../data/blocks.js';
import { getSprite } from './sprites.js';

const spriteGeoCache = new Map();

function srgb(c) { // 0..255 sRGB -> linear 0..1
  const v = c / 255;
  return v <= 0.04045 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4);
}

// Extrude a 16x16 RGBA sprite into a thin voxel slab centred on the origin, 1 unit wide.
export function spriteGeometry(key) {
  if (spriteGeoCache.has(key)) return spriteGeoCache.get(key);
  const pix = getSprite(key);
  if (!pix) return null;
  const pos = [], nor = [], col = [], idx = [];
  const T = 1.4 / 16; // thickness
  const z0 = -T / 2, z1 = T / 2;
  const solid = (x, y) => x >= 0 && y >= 0 && x < 16 && y < 16 && pix.alpha(x, y) > 60;
  const quad = (a, b, c, d, n, k, rgb) => {
    const base = pos.length / 3;
    for (const v of [a, b, c, d]) { pos.push(v[0], v[1], v[2]); nor.push(n[0], n[1], n[2]); col.push(rgb[0] * k, rgb[1] * k, rgb[2] * k); }
    idx.push(base, base + 1, base + 2, base, base + 2, base + 3);
  };
  for (let y = 0; y < 16; y++) for (let x = 0; x < 16; x++) {
    if (!solid(x, y)) continue;
    const c = pix.get(x, y);
    const rgb = [srgb(c[0]), srgb(c[1]), srgb(c[2])];
    const x0 = (x - 8) / 16, x1 = (x + 1 - 8) / 16, yt = (8 - y) / 16, yb = (7 - y) / 16;
    quad([x0, yb, z1], [x1, yb, z1], [x1, yt, z1], [x0, yt, z1], [0, 0, 1], 1, rgb);          // front
    quad([x1, yb, z0], [x0, yb, z0], [x0, yt, z0], [x1, yt, z0], [0, 0, -1], 1, rgb);       // back
    if (!solid(x - 1, y)) quad([x0, yb, z0], [x0, yb, z1], [x0, yt, z1], [x0, yt, z0], [-1, 0, 0], 0.7, rgb);
    if (!solid(x + 1, y)) quad([x1, yb, z1], [x1, yb, z0], [x1, yt, z0], [x1, yt, z1], [1, 0, 0], 0.7, rgb);
    if (!solid(x, y - 1)) quad([x0, yt, z1], [x1, yt, z1], [x1, yt, z0], [x0, yt, z0], [0, 1, 0], 0.9, rgb);
    if (!solid(x, y + 1)) quad([x0, yb, z0], [x1, yb, z0], [x1, yb, z1], [x0, yb, z1], [0, -1, 0], 0.55, rgb);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
  g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  g.setIndex(idx);
  g.computeBoundingSphere();
  spriteGeoCache.set(key, g);
  return g;
}

const cubeGeoCache = new Map();
export function blockCubeGeometry(def, atlas) {
  const k = def.key;
  if (cubeGeoCache.has(k)) return cubeGeoCache.get(k);
  const h = def.shape === 'bed' ? 9 / 16 : def.shape === 'farmland' ? 15 / 16 : 1;
  const g = new THREE.BoxGeometry(1, h, 1);
  const uvAttr = g.attributes.uv;
  const t = def.tex;
  const rects = [t.side || t.all, t.side || t.all, t.top || t.all, t.bottom || t.all, t.side || t.all, t.side || t.all].map((x) => atlas.uv(x));
  for (let f = 0; f < 6; f++) {
    const r = rects[f];
    for (let i = 0; i < 4; i++) {
      const j = f * 4 + i;
      const u = uvAttr.getX(j), v = uvAttr.getY(j);
      uvAttr.setXY(j, r[0] + u * (r[2] - r[0]), r[1] + v * (r[3] - r[1]));
    }
  }
  // the shared item material uses vertex colours (a missing attribute would read as black)
  const white = new Float32Array(g.attributes.position.count * 3).fill(1);
  g.setAttribute('color', new THREE.BufferAttribute(white, 3));
  cubeGeoCache.set(k, g);
  return g;
}

let spriteMat = null;
export function getSpriteMaterial() {
  if (!spriteMat) spriteMat = new THREE.MeshLambertMaterial({ vertexColors: true });
  return spriteMat;
}

// Build a mesh for an item key. size = edge length of a cube (sprites are scaled 1.3x that).
export function buildItemObject(key, atlas, cubeMat, size) {
  const def = BLOCK_BY_KEY[key];
  const spr = !def || def.shape === 'cross' || def.shape === 'torch' ? spriteGeometry(key) : null;
  if (spr) {
    const m = new THREE.Mesh(spr, getSpriteMaterial());
    m.scale.setScalar(size * 1.35);
    m.userData.isSprite = true;
    const g = new THREE.Group();
    g.add(m);
    return g;
  }
  if (def) {
    const m = new THREE.Mesh(blockCubeGeometry(def, atlas), cubeMat);
    m.scale.setScalar(size);
    const g = new THREE.Group();
    g.add(m);
    return g;
  }
  return new THREE.Group();
}
