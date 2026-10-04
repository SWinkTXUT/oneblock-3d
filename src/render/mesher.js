// Chunk mesher: hidden-face culling, per-vertex AO, 4 output layers
// (0 opaque, 1 cutout, 2 translucent, 3 water) plus special shapes.
import { BLOCKS, BLOCK_BY_KEY } from '../data/blocks.js';
import { CS, lidx } from '../world/Chunk.js';
import { hash } from './pixel.js';

const NB = 256;
const OCCL = new Uint8Array(NB);     // opaque full cube: hides neighbours' faces, occludes AO
const LAYER = new Uint8Array(NB);
const SHAPE = new Uint8Array(NB);    // 0 cube 1 cross 2 torch 3 bed 4 farmland 5 water 6 wheat(#)
const SAMECULL = new Uint8Array(NB); // same-id neighbour hides the face
const HEIGHT = new Float32Array(NB).fill(1);
const WATER = BLOCK_BY_KEY.water.id;

for (const b of BLOCKS) {
  if (!b || b.id === 0) continue;
  const sh = b.shape;
  SHAPE[b.id] = sh === 'cross' ? (b.key.startsWith('wheat') ? 6 : 1) : sh === 'torch' ? 2 : sh === 'bed' ? 3 : sh === 'farmland' ? 4 : sh === 'water' ? 5 : 0;
  OCCL[b.id] = b.render === 'opaque' && sh === 'cube' ? 1 : 0;
  LAYER[b.id] = sh === 'water' ? 3 : b.render === 'translucent' ? 2 : b.render === 'cutout' ? 1 : 0;
  SAMECULL[b.id] = b.render === 'translucent' || sh === 'bed' || sh === 'farmland' ? 1 : 0;
  if (sh === 'bed') HEIGHT[b.id] = 9 / 16;
  if (sh === 'farmland') HEIGHT[b.id] = 15 / 16;
}

// face order: +x, -x, +y, -y, +z, -z
const FACE_N = [[1, 0, 0], [-1, 0, 0], [0, 1, 0], [0, -1, 0], [0, 0, 1], [0, 0, -1]];
const FACE_C = [
  [[1, 0, 1], [1, 0, 0], [1, 1, 0], [1, 1, 1]],
  [[0, 0, 0], [0, 0, 1], [0, 1, 1], [0, 1, 0]],
  [[0, 1, 1], [1, 1, 1], [1, 1, 0], [0, 1, 0]],
  [[0, 0, 0], [1, 0, 0], [1, 0, 1], [0, 0, 1]],
  [[0, 0, 1], [1, 0, 1], [1, 1, 1], [0, 1, 1]],
  [[1, 0, 0], [0, 0, 0], [0, 1, 0], [1, 1, 0]],
];
const UVC = [[0, 0], [1, 0], [1, 1], [0, 1]];
// AO sample offsets per face/vertex: [side1, side2, corner] each [dx,dy,dz]
const AO_OFF = FACE_N.map((n, f) => FACE_C[f].map((c) => {
  const axis = n[0] ? 0 : n[1] ? 1 : 2;
  const tang = [0, 1, 2].filter((a) => a !== axis);
  const s1 = [n[0], n[1], n[2]], s2 = [n[0], n[1], n[2]], cr = [n[0], n[1], n[2]];
  const e1 = c[tang[0]] * 2 - 1, e2 = c[tang[1]] * 2 - 1;
  s1[tang[0]] += e1; s2[tang[1]] += e2; cr[tang[0]] += e1; cr[tang[1]] += e2;
  return [s1, s2, cr];
}));
const AO_BRIGHT = [0.5, 0.67, 0.84, 1.0];

let UV = null; // per-id face uv rects [6][4]
export function initMesher(atlas) {
  UV = new Array(NB).fill(null);
  for (const b of BLOCKS) {
    if (!b || b.id === 0) continue;
    const t = b.tex;
    const top = atlas.uv(t.top || t.all), side = atlas.uv(t.side || t.all), bot = atlas.uv(t.bottom || t.all);
    UV[b.id] = [side, side, top, bot, side, side];
  }
}

const PW = 18;
const pad = new Uint8Array(PW * PW * PW);
const pidx = (x, y, z) => (y * PW + z) * PW + x; // x,y,z in 0..17

function fillPad(world, chunk) {
  pad.fill(0);
  const d = chunk.data;
  for (let y = 0; y < CS; y++) for (let z = 0; z < CS; z++) {
    const src = lidx(0, y, z), dst = pidx(1, y + 1, z + 1);
    for (let x = 0; x < CS; x++) pad[dst + x] = d[src + x];
  }
  const bx = chunk.cx * CS - 1, by = chunk.cy * CS - 1, bz = chunk.cz * CS - 1;
  for (let y = 0; y < PW; y++) for (let z = 0; z < PW; z++) {
    if (y === 0 || y === 17 || z === 0 || z === 17) {
      for (let x = 0; x < PW; x++) pad[pidx(x, y, z)] = world.getBlock(bx + x, by + y, bz + z);
    } else {
      pad[pidx(0, y, z)] = world.getBlock(bx, by + y, bz + z);
      pad[pidx(17, y, z)] = world.getBlock(bx + 17, by + y, bz + z);
    }
  }
}

class Buf {
  constructor() { this.pos = []; this.nor = []; this.uv = []; this.col = []; this.idx = []; this.n = 0; }
  // 4 verts: p = [[x,y,z]x4], uv = [[u,v]x4], n = [nx,ny,nz], c = [brightness x4] or number
  quad(p, uv, n, c, flip) {
    const b = this.n;
    for (let i = 0; i < 4; i++) {
      this.pos.push(p[i][0], p[i][1], p[i][2]);
      this.nor.push(n[0], n[1], n[2]);
      this.uv.push(uv[i][0], uv[i][1]);
      const k = typeof c === 'number' ? c : c[i];
      this.col.push(k, k, k);
    }
    if (flip) this.idx.push(b + 1, b + 2, b + 3, b + 1, b + 3, b);
    else this.idx.push(b, b + 1, b + 2, b, b + 2, b + 3);
    this.n += 4;
  }
  finish() {
    if (!this.n) return null;
    return {
      pos: new Float32Array(this.pos), nor: new Float32Array(this.nor), uv: new Float32Array(this.uv),
      col: new Float32Array(this.col), idx: this.n > 65535 ? new Uint32Array(this.idx) : new Uint16Array(this.idx), count: this.n,
    };
  }
}

function faceVisible(id, nid) {
  if (nid === 0) return true;
  if (OCCL[nid]) return false;
  if (nid === id && SAMECULL[id]) return false;
  return true;
}

export function meshChunk(world, chunk) {
  fillPad(world, chunk);
  const bufs = [new Buf(), new Buf(), new Buf(), new Buf()];
  const ox = chunk.cx * CS, oy = chunk.cy * CS, oz = chunk.cz * CS;
  const aoV = [0, 0, 0, 0];
  const P4 = [[0, 0, 0], [0, 0, 0], [0, 0, 0], [0, 0, 0]];
  const UV4 = [[0, 0], [0, 0], [0, 0], [0, 0]];

  for (let ly = 0; ly < CS; ly++) for (let lz = 0; lz < CS; lz++) for (let lx = 0; lx < CS; lx++) {
    const px = lx + 1, py = ly + 1, pz = lz + 1;
    const id = pad[pidx(px, py, pz)];
    if (!id) continue;
    const shape = SHAPE[id];
    const layer = LAYER[id];
    const B = bufs[layer];
    const uvs = UV[id];
    const jit = 0.965 + hash(ox + lx, oy + ly, oz + lz) * 0.07;

    if (shape === 1 || shape === 6) { // cross / wheat
      const r = uvs[2];
      const uv = [[r[0], r[1]], [r[2], r[1]], [r[2], r[3]], [r[0], r[3]]];
      const planes = shape === 1
        ? [[0.1, 0.1, 0.9, 0.9], [0.1, 0.9, 0.9, 0.1]]
        : [[0.25, 0, 0.25, 1], [0.75, 0, 0.75, 1], [0, 0.25, 1, 0.25], [0, 0.75, 1, 0.75]];
      const hh = 1;
      for (const [x0, z0, x1, z1] of planes) {
        const a = [lx + x0, ly, lz + z0], b = [lx + x1, ly, lz + z1], c = [lx + x1, ly + hh, lz + z1], d = [lx + x0, ly + hh, lz + z0];
        B.quad([a, b, c, d], uv, [0, 1, 0], jit);
        B.quad([b, a, d, c], uv, [0, 1, 0], jit);
      }
      continue;
    }

    if (shape === 2) { // torch: 2x2 px stick, 10px tall
      const r = uvs[0];
      const du = r[2] - r[0], dv = r[3] - r[1];
      const x0 = 7 / 16, x1 = 9 / 16, h = 10 / 16;
      const su0 = r[0] + du * 7 / 16, su1 = r[0] + du * 9 / 16;
      const sv0 = r[1], sv1 = r[1] + dv * h;
      const sideUV = [[su0, sv0], [su1, sv0], [su1, sv1], [su0, sv1]];
      for (let f = 0; f < 6; f++) {
        if (f === 3) continue;
        const corners = FACE_C[f];
        for (let i = 0; i < 4; i++) {
          const c = corners[i];
          P4[i][0] = lx + (c[0] ? x1 : x0); P4[i][1] = ly + c[1] * h; P4[i][2] = lz + (c[2] ? x1 : x0);
        }
        if (f === 2) {
          const tv0 = r[1] + dv * 8 / 16, tv1 = r[1] + dv * 10 / 16;
          B.quad(P4, [[su0, tv0], [su1, tv0], [su1, tv1], [su0, tv1]], FACE_N[f], 1);
        } else B.quad(P4, sideUV, FACE_N[f], 1);
      }
      continue;
    }

    // ----- cube-like (cube, bed, farmland, water) -----
    const isWater = shape === 5;
    let h = HEIGHT[id];
    if (isWater && pad[pidx(px, py + 1, pz)] !== WATER) h = 14 / 16;
    const useAO = layer < 2;
    for (let f = 0; f < 6; f++) {
      const n = FACE_N[f];
      const nid = pad[pidx(px + n[0], py + n[1], pz + n[2])];
      let vis;
      if (isWater) vis = nid !== WATER && !OCCL[nid];
      else vis = faceVisible(id, nid);
      if (!vis) continue;
      const corners = FACE_C[f];
      if (useAO) {
        const ao = AO_OFF[f];
        for (let i = 0; i < 4; i++) {
          const [s1, s2, cr] = ao[i];
          const a = OCCL[pad[pidx(px + s1[0], py + s1[1], pz + s1[2])]];
          const b = OCCL[pad[pidx(px + s2[0], py + s2[1], pz + s2[2])]];
          const c = OCCL[pad[pidx(px + cr[0], py + cr[1], pz + cr[2])]];
          aoV[i] = AO_BRIGHT[a && b ? 0 : 3 - (a + b + c)] * jit;
        }
      } else aoV[0] = aoV[1] = aoV[2] = aoV[3] = 1;
      for (let i = 0; i < 4; i++) {
        const c = corners[i];
        P4[i][0] = lx + c[0]; P4[i][1] = ly + c[1] * h; P4[i][2] = lz + c[2];
      }
      if (isWater) {
        for (let i = 0; i < 4; i++) {
          const c = corners[i];
          if (f >= 2 && f <= 3) { UV4[i][0] = ox + lx + c[0]; UV4[i][1] = oz + lz + c[2]; }
          else if (f < 2) { UV4[i][0] = oz + lz + c[2]; UV4[i][1] = oy + ly + c[1] * h; }
          else { UV4[i][0] = ox + lx + c[0]; UV4[i][1] = oy + ly + c[1] * h; }
        }
      } else {
        const r = uvs[f];
        const vTop = h < 1 && f !== 2 && f !== 3 ? r[1] + (r[3] - r[1]) * h : r[3];
        for (let i = 0; i < 4; i++) {
          const c = UVC[i];
          UV4[i][0] = c[0] ? r[2] : r[0];
          UV4[i][1] = c[1] ? vTop : r[1];
        }
      }
      const flip = aoV[0] + aoV[2] < aoV[1] + aoV[3];
      B.quad(P4, UV4, n, aoV, flip);
    }
  }
  return bufs.map((b) => b.finish());
}
