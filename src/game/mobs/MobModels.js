// Procedural pixel-textured box models for sheep & zombie (SPEC §9). Model units: 16 px = 1 block, local +Z is "forward".
import * as THREE from 'three';

function rng(seed) { let s = seed >>> 0; return () => { s = (s + 0x6D2B79F5) >>> 0; let t = s; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }
const css = (c) => `rgb(${Math.max(0, Math.min(255, c[0] | 0))},${Math.max(0, Math.min(255, c[1] | 0))},${Math.max(0, Math.min(255, c[2] | 0))})`;
function fill(ctx, x, y, w, h, c) { ctx.fillStyle = Array.isArray(c) ? css(c) : c; ctx.fillRect(x, y, w, h); }
function noise(ctx, w, h, base, amp, seed, region) {
  const r = rng(seed);
  const [x0, y0, x1, y1] = region || [0, 0, w, h];
  for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) {
    const j = (r() - 0.5) * amp;
    fill(ctx, x, y, 1, 1, [base[0] + j, base[1] + j, base[2] + j]);
  }
}
const mul = (c, k) => [c[0] * k, c[1] * k, c[2] * k];

const texCache = new Map();
function tex(key, w, h, paint) {
  if (texCache.has(key)) return texCache.get(key);
  const c = document.createElement('canvas'); c.width = w; c.height = h;
  paint(c.getContext('2d'), w, h);
  const t = new THREE.CanvasTexture(c);
  t.magFilter = THREE.NearestFilter; t.minFilter = THREE.NearestFilter; t.generateMipmaps = false; t.colorSpace = THREE.SRGBColorSpace;
  texCache.set(key, t);
  return t;
}

/**
 * Box from px dims with per-face painters {px,nx,py,ny,pz,nz} (+x,-x,+y,-y,+z,-z). Face canvas sizes: ±x: d×h, ±y: w×d, ±z: w×h.
 * Returns { mesh, mats }. Materials are per-instance so hurt flashes do not leak between mobs.
 */
function box(name, w, h, d, painters, opts = {}) {
  const dims = { px: [d, h], nx: [d, h], py: [w, d], ny: [w, d], pz: [w, h], nz: [w, h] };
  const mats = ['px', 'nx', 'py', 'ny', 'pz', 'nz'].map((f, i) => {
    const [fw, fh] = dims[f];
    const t = tex(`${name}:${f}`, fw, fh, (ctx) => painters[f](ctx, fw, fh));
    return new THREE.MeshLambertMaterial({ map: t, transparent: !!opts.transparent, emissive: 0x000000 });
  });
  const mesh = new THREE.Mesh(new THREE.BoxGeometry(w / 16, h / 16, d / 16), mats);
  mesh.castShadow = true;
  return { mesh, mats };
}
const same = (p) => ({ px: p, nx: p, py: p, ny: p, pz: p, nz: p });

/** Part pivoted at its top (for limbs). pos in px. */
function pivoted(model, x, y, z, offY) {
  const g = new THREE.Group(); g.position.set(x / 16, y / 16, z / 16);
  model.mesh.position.y = offY / 16; g.add(model.mesh);
  return g;
}

// ---------------------------------------------------------------- Zombie
export function buildZombie() {
  const skin = [90, 142, 72], skinD = [66, 108, 54], shirt = [52, 128, 150], pants = [60, 54, 128], boot = [38, 36, 60];
  const mats = [];
  const reg = (m) => { mats.push(...m.mats); return m; };
  const head = reg(box('z_head', 8, 8, 8, {
    px: (c, w, h) => noise(c, w, h, skinD, 22, 1), nx: (c, w, h) => noise(c, w, h, skinD, 22, 2),
    py: (c, w, h) => noise(c, w, h, mul(skin, 0.8), 24, 3), ny: (c, w, h) => noise(c, w, h, skinD, 20, 4),
    nz: (c, w, h) => noise(c, w, h, skinD, 24, 5),
    pz: (c, w, h) => {
      noise(c, w, h, skin, 26, 6);
      fill(c, 1, 3, 2, 2, [20, 24, 20]); fill(c, 5, 3, 2, 2, [20, 24, 20]); // eyes
      fill(c, 1, 3, 1, 1, [150, 30, 30]); fill(c, 6, 3, 1, 1, [150, 30, 30]);
      fill(c, 3, 4, 2, 1, skinD); fill(c, 2, 6, 4, 1, [30, 40, 28]); fill(c, 3, 7, 2, 1, [50, 20, 20]); // nose, mouth
    },
  }));
  const body = reg(box('z_body', 8, 12, 4, {
    px: (c, w, h) => noise(c, w, h, shirt, 18, 7), nx: (c, w, h) => noise(c, w, h, shirt, 18, 8),
    py: (c, w, h) => noise(c, w, h, skinD, 16, 9), ny: (c, w, h) => noise(c, w, h, pants, 16, 10),
    pz: (c, w, h) => { noise(c, w, h, shirt, 18, 11); fill(c, 0, 10, w, 2, mul(pants, 1.05)); fill(c, 3, 2, 2, 2, mul(shirt, 0.82)); },
    nz: (c, w, h) => { noise(c, w, h, shirt, 18, 12); fill(c, 0, 10, w, 2, mul(pants, 1.05)); },
  }));
  const armPaint = (seed) => (c, w, h) => { noise(c, w, h, shirt, 16, seed, [0, 0, w, 8]); noise(c, w, h, skin, 22, seed + 1, [0, 8, w, h]); };
  const armA = reg(box('z_arm', 4, 12, 4, { px: armPaint(13), nx: armPaint(15), pz: armPaint(17), nz: armPaint(19),
    py: (c, w, h) => noise(c, w, h, shirt, 14, 21), ny: (c, w, h) => noise(c, w, h, skin, 14, 22) }));
  const armB = reg(box('z_arm2', 4, 12, 4, { px: armPaint(23), nx: armPaint(25), pz: armPaint(27), nz: armPaint(29),
    py: (c, w, h) => noise(c, w, h, shirt, 14, 31), ny: (c, w, h) => noise(c, w, h, skin, 14, 32) }));
  const legPaint = (seed) => (c, w, h) => { noise(c, w, h, pants, 16, seed, [0, 0, w, 9]); noise(c, w, h, boot, 10, seed + 1, [0, 9, w, h]); };
  const legA = reg(box('z_leg', 4, 12, 4, { px: legPaint(41), nx: legPaint(43), pz: legPaint(45), nz: legPaint(47),
    py: (c, w, h) => noise(c, w, h, pants, 12, 49), ny: (c, w, h) => noise(c, w, h, boot, 12, 50) }));
  const legB = reg(box('z_leg2', 4, 12, 4, { px: legPaint(51), nx: legPaint(53), pz: legPaint(55), nz: legPaint(57),
    py: (c, w, h) => noise(c, w, h, pants, 12, 59), ny: (c, w, h) => noise(c, w, h, boot, 12, 60) }));

  const group = new THREE.Group();
  const bodyG = new THREE.Group(); bodyG.position.y = 18 / 16; body.mesh.position.y = 0; bodyG.add(body.mesh); group.add(bodyG); // centre at 12..24
  const headG = new THREE.Group(); headG.position.set(0, 24 / 16, 0); head.mesh.position.y = 4 / 16; headG.add(head.mesh); group.add(headG);
  const armL = pivoted(armA, -6, 22, 0, -4); const armR = pivoted(armB, 6, 22, 0, -4);
  const legL = pivoted(legA, -2, 12, 0, -6); const legR = pivoted(legB, 2, 12, 0, -6);
  group.add(armL, armR, legL, legR);
  return { group, mats, parts: { head: headG, armL, armR, legL, legR, body: bodyG } };
}

// ---------------------------------------------------------------- Sheep
export function buildSheep() {
  const wool = [236, 236, 232], skin = [214, 176, 156], skinD = [186, 148, 130], leg = [172, 150, 136];
  const woolPaint = (seed, sh = 1) => (c, w, h) => {
    noise(c, w, h, mul(wool, sh), 14, seed);
    const r = rng(seed * 7);
    for (let i = 0; i < w * h * 0.12; i++) { const x = Math.floor(r() * w), y = Math.floor(r() * h); fill(c, x, y, 1, 1, mul(wool, sh * (r() > 0.5 ? 1.06 : 0.84))); }
  };
  const mats = [];
  const reg = (m) => { mats.push(...m.mats); return m; };
  const woolBody = reg(box('s_wool', 11, 10, 17, { px: woolPaint(1, 0.96), nx: woolPaint(2, 0.96), py: woolPaint(3, 1.04), ny: woolPaint(4, 0.8), pz: woolPaint(5), nz: woolPaint(6) }));
  const skinBody = reg(box('s_skin', 8, 7, 14, same((c, w, h) => noise(c, w, h, skin, 14, 8))));
  const headM = reg(box('s_head', 6, 6, 7, {
    px: (c, w, h) => noise(c, w, h, skinD, 14, 9), nx: (c, w, h) => noise(c, w, h, skinD, 14, 10),
    py: (c, w, h) => noise(c, w, h, skin, 12, 11), ny: (c, w, h) => noise(c, w, h, skinD, 12, 12), nz: (c, w, h) => noise(c, w, h, skinD, 12, 13),
    pz: (c, w, h) => {
      noise(c, w, h, skin, 12, 14);
      fill(c, 0, 1, 2, 2, [255, 255, 255]); fill(c, 4, 1, 2, 2, [255, 255, 255]); fill(c, 1, 1, 1, 2, [30, 30, 30]); fill(c, 4, 1, 1, 2, [30, 30, 30]);
      fill(c, 2, 4, 2, 2, [232, 156, 150]); fill(c, 2, 4, 2, 1, [150, 90, 90]);
    },
  }));
  const woolCap = reg(box('s_cap', 7, 3, 5, { px: woolPaint(21), nx: woolPaint(22), py: woolPaint(23, 1.04), ny: woolPaint(24, 0.8), pz: woolPaint(25), nz: woolPaint(26) }));
  const earA = reg(box('s_ear', 3, 2, 1, same((c, w, h) => noise(c, w, h, skin, 10, 31))));
  const earB = reg(box('s_ear2', 3, 2, 1, same((c, w, h) => noise(c, w, h, skin, 10, 32))));
  const legPaint = (seed) => (c, w, h) => { noise(c, w, h, leg, 12, seed, [0, 0, w, 9]); noise(c, w, h, [90, 78, 70], 8, seed + 1, [0, 9, w, h]); };
  const legs = [0, 1, 2, 3].map((i) => reg(box('s_leg' + i, 4, 12, 4, { px: legPaint(40 + i), nx: legPaint(50 + i), pz: legPaint(60 + i), nz: legPaint(70 + i),
    py: (c, w, h) => noise(c, w, h, leg, 10, 80 + i), ny: (c, w, h) => noise(c, w, h, [90, 78, 70], 8, 90 + i) })));

  const group = new THREE.Group();
  woolBody.mesh.position.set(0, 17 / 16, 0);
  skinBody.mesh.position.set(0, 16.5 / 16, 0);
  group.add(skinBody.mesh, woolBody.mesh);
  const headG = new THREE.Group(); headG.position.set(0, 19 / 16, 8 / 16);
  headM.mesh.position.set(0, 2.5 / 16, 3 / 16); headG.add(headM.mesh);
  woolCap.mesh.position.set(0, 6 / 16, 1.5 / 16); headG.add(woolCap.mesh);
  earA.mesh.position.set(-3.8 / 16, 4.5 / 16, 0); earB.mesh.position.set(3.8 / 16, 4.5 / 16, 0); headG.add(earA.mesh, earB.mesh);
  group.add(headG);
  const L = [[-3, 12, 5.5], [3, 12, 5.5], [-3, 12, -5.5], [3, 12, -5.5]].map(([x, y, z], i) => pivoted(legs[i], x, y, z, -6));
  group.add(...L);
  return { group, mats, parts: { head: headG, legs: L, woolBody: woolBody.mesh, woolCap: woolCap.mesh } };
}
