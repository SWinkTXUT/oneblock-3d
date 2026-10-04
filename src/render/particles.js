// GPU point-sprite particles (bursts) + ambient motes that react to the phase.
import * as THREE from 'three';
import { mulberry32 } from './pixel.js';

const VERT = /* glsl */`
attribute vec3 aColor; attribute float aSize; attribute float aAlpha; attribute float aShape;
uniform float uScale;
varying vec3 vColor; varying float vAlpha; varying float vShape;
void main() {
  vec4 mv = modelViewMatrix * vec4(position, 1.0);
  gl_Position = projectionMatrix * mv;
  gl_PointSize = clamp(aSize * uScale / max(0.05, -mv.z), 0.0, 96.0);
  vColor = aColor; vAlpha = aAlpha; vShape = aShape;
}`;
const FRAG = /* glsl */`
varying vec3 vColor; varying float vAlpha; varying float vShape;
void main() {
  vec2 pc = gl_PointCoord - 0.5;
  float a = 1.0;
  vec3 col = vColor;
  if (vShape < 0.5) {
    float e = max(abs(pc.x), abs(pc.y));
    col *= (e > 0.36) ? 0.78 : 1.0;
  } else if (vShape < 1.5) {
    float d = length(pc) * 2.0;
    a = smoothstep(1.0, 0.25, d);
  } else if (vShape < 2.5) {
    vec2 p = vec2(pc.x * 2.5, -(pc.y - 0.05) * 2.5);
    float h = pow(p.x * p.x + p.y * p.y - 1.0, 3.0) - p.x * p.x * p.y * p.y * p.y;
    if (h > 0.0) discard;
    col *= 1.0 - 0.25 * smoothstep(-0.5, 0.5, -p.y);
  } else {
    float d1 = max(0.0, 1.0 - (abs(pc.x) + abs(pc.y)) * 2.4);
    float d2 = max(0.0, 1.0 - min(abs(pc.x), abs(pc.y)) * 16.0) * max(0.0, 1.0 - length(pc) * 2.0);
    a = max(d1, d2);
  }
  if (a * vAlpha < 0.02) discard;
  gl_FragColor = vec4(col, a * vAlpha);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}`;

const lin = (c) => { const k = new THREE.Color(); k.setRGB(c[0] / 255, c[1] / 255, c[2] / 255, THREE.SRGBColorSpace); return k; };

export class Particles {
  constructor(scene, atlas) {
    this.atlas = atlas;
    this.max = 1000;
    const N = this.max;
    this.pos = new Float32Array(N * 3);
    this.colA = new Float32Array(N * 3);
    this.sizeA = new Float32Array(N);
    this.alphaA = new Float32Array(N);
    this.shapeA = new Float32Array(N);
    this.vel = new Float32Array(N * 3);
    this.life = new Float32Array(N);
    this.maxLife = new Float32Array(N);
    this.grav = new Float32Array(N);
    this.drag = new Float32Array(N);
    this.size0 = new Float32Array(N);
    this.size1 = new Float32Array(N);
    this.grow = new Float32Array(N);
    this.alpha0 = new Float32Array(N);
    this.next = 0;
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(this.pos, 3).setUsage(THREE.DynamicDrawUsage));
    g.setAttribute('aColor', new THREE.BufferAttribute(this.colA, 3).setUsage(THREE.DynamicDrawUsage));
    g.setAttribute('aSize', new THREE.BufferAttribute(this.sizeA, 1).setUsage(THREE.DynamicDrawUsage));
    g.setAttribute('aAlpha', new THREE.BufferAttribute(this.alphaA, 1).setUsage(THREE.DynamicDrawUsage));
    g.setAttribute('aShape', new THREE.BufferAttribute(this.shapeA, 1).setUsage(THREE.DynamicDrawUsage));
    this.geo = g;
    this.mat = new THREE.ShaderMaterial({
      vertexShader: VERT, fragmentShader: FRAG, transparent: true, depthWrite: false, fog: false,
      uniforms: { uScale: { value: 600 } },
    });
    this.points = new THREE.Points(g, this.mat);
    this.points.frustumCulled = false;
    this.points.renderOrder = 10;
    scene.add(this.points);
    this.rnd = mulberry32(777);

    // ambient motes
    this.ambient = new AmbientMotes(scene, this.mat.uniforms.uScale);
  }

  setScale(s) { this.mat.uniforms.uScale.value = s; }

  _emit(x, y, z, vx, vy, vz, col, size, life, o = {}) {
    const i = this.next; this.next = (this.next + 1) % this.max;
    const k = i * 3;
    this.pos[k] = x; this.pos[k + 1] = y; this.pos[k + 2] = z;
    this.vel[k] = vx; this.vel[k + 1] = vy; this.vel[k + 2] = vz;
    this.colA[k] = col.r; this.colA[k + 1] = col.g; this.colA[k + 2] = col.b;
    this.size0[i] = size; this.size1[i] = o.size1 ?? size; this.sizeA[i] = size;
    this.life[i] = life; this.maxLife[i] = life;
    this.grav[i] = o.grav ?? 0; this.drag[i] = o.drag ?? 0;
    this.shapeA[i] = o.shape ?? 0; this.alpha0[i] = o.alpha ?? 1; this.alphaA[i] = this.alpha0[i];
    this.grow[i] = o.fadeIn ?? 0;
  }

  blockBurst(x, y, z, blockId, def) {
    const t = def.tex;
    const key = t.side || t.all || t.top;
    for (let i = 0; i < 18; i++) {
      const c = lin(this.atlas.sample(i % 3 === 0 && t.top ? t.top : key, this.rnd));
      const a = this.rnd() * Math.PI * 2, s = 1.0 + this.rnd() * 2.6;
      this._emit(
        x + 0.5 + (this.rnd() - 0.5) * 0.8, y + 0.5 + (this.rnd() - 0.5) * 0.8, z + 0.5 + (this.rnd() - 0.5) * 0.8,
        Math.cos(a) * s, 1.5 + this.rnd() * 2.8, Math.sin(a) * s, c, 0.1 + this.rnd() * 0.07, 0.55 + this.rnd() * 0.5,
        { grav: 16, drag: 0.5, shape: 0 },
      );
    }
  }

  burst(kind, x, y, z) {
    const r = this.rnd;
    const cx = x, cy = y, cz = z;
    if (kind === 'smoke') {
      for (let i = 0; i < 7; i++) {
        const g = 0.25 + r() * 0.25;
        this._emit(cx + (r() - 0.5) * 0.5, cy + (r() - 0.5) * 0.3, cz + (r() - 0.5) * 0.5, (r() - 0.5) * 0.3, 0.7 + r() * 0.5, (r() - 0.5) * 0.3,
          new THREE.Color(g, g, g), 0.2, 1.1 + r() * 0.6, { shape: 1, alpha: 0.65, size1: 0.55, drag: 0.6 });
      }
    } else if (kind === 'flame') {
      for (let i = 0; i < 6; i++) {
        this._emit(cx + (r() - 0.5) * 0.4, cy + (r() - 0.3) * 0.5, cz + (r() - 0.5) * 0.4, (r() - 0.5) * 0.3, 0.8 + r() * 0.9, (r() - 0.5) * 0.3,
          new THREE.Color(2.4, 0.9 + r() * 0.9, 0.15), 0.16, 0.45 + r() * 0.3, { shape: 1, alpha: 0.95, size1: 0.04 });
      }
    } else if (kind === 'hearts') {
      for (let i = 0; i < 5; i++) {
        this._emit(cx + (r() - 0.5) * 0.9, cy + 0.3 + r() * 0.6, cz + (r() - 0.5) * 0.9, (r() - 0.5) * 0.3, 0.6 + r() * 0.4, (r() - 0.5) * 0.3,
          new THREE.Color(1.6, 0.18, 0.28), 0.3, 1.3 + r() * 0.4, { shape: 2, alpha: 1 });
      }
    } else if (kind === 'crit') {
      for (let i = 0; i < 10; i++) {
        const a = r() * Math.PI * 2, e = (r() - 0.3) * 1.5, s = 2.4 + r() * 2;
        this._emit(cx, cy, cz, Math.cos(a) * s, e * s * 0.6 + 1.0, Math.sin(a) * s, new THREE.Color(2.2, 1.9, 0.9), 0.24, 0.35 + r() * 0.2, { shape: 3, drag: 3, size1: 0.05 });
      }
    } else if (kind === 'sparkle') {
      for (let i = 0; i < 12; i++) {
        const col = new THREE.Color().setHSL(r(), 0.8, 0.7).multiplyScalar(1.7);
        this._emit(cx + (r() - 0.5) * 1.0, cy + (r() - 0.3) * 1.0, cz + (r() - 0.5) * 1.0, (r() - 0.5) * 0.6, 0.3 + r() * 0.8, (r() - 0.5) * 0.6, col, 0.2, 0.7 + r() * 0.5, { shape: 3, size1: 0.02 });
      }
    } else { // poof
      for (let i = 0; i < 12; i++) {
        const a = r() * Math.PI * 2, s = 0.8 + r() * 1.3, g = 0.82 + r() * 0.18;
        this._emit(cx, cy, cz, Math.cos(a) * s, (r() - 0.2) * 1.2, Math.sin(a) * s, new THREE.Color(g, g, g), 0.2, 0.45 + r() * 0.3, { shape: 1, alpha: 0.8, size1: 0.5, drag: 3.2 });
      }
    }
  }

  update(dt) {
    const N = this.max;
    for (let i = 0; i < N; i++) {
      if (this.life[i] <= 0) { this.alphaA[i] = 0; continue; }
      this.life[i] -= dt;
      const k = i * 3;
      const d = Math.max(0, 1 - this.drag[i] * dt);
      this.vel[k] *= d; this.vel[k + 2] *= d;
      this.vel[k + 1] = this.vel[k + 1] * d - this.grav[i] * dt;
      this.pos[k] += this.vel[k] * dt; this.pos[k + 1] += this.vel[k + 1] * dt; this.pos[k + 2] += this.vel[k + 2] * dt;
      const f = Math.max(0, this.life[i] / this.maxLife[i]);
      this.sizeA[i] = this.size1[i] + (this.size0[i] - this.size1[i]) * f;
      this.alphaA[i] = this.alpha0[i] * (f < 0.35 ? f / 0.35 : 1);
      if (this.life[i] <= 0) this.alphaA[i] = 0;
    }
    const g = this.geo.attributes;
    g.position.needsUpdate = true; g.aSize.needsUpdate = true; g.aAlpha.needsUpdate = true;
    g.aColor.needsUpdate = true; g.aShape.needsUpdate = true;
  }

  get active() { let n = 0; for (let i = 0; i < this.max; i++) if (this.life[i] > 0) n++; return n; }
}

// ----------------------------------------------------------------- ambient
const MOTE_CFG = {
  default: { color: [0.9, 0.95, 1.0], vy: 0.06, vx: 0.18, size: 0.07, alpha: 0.5, shape: 1, glow: 1.0 },
  plains: { color: [1.0, 0.98, 0.9], vy: 0.07, vx: 0.2, size: 0.07, alpha: 0.5, shape: 1, glow: 1.0 },
  underground: { color: [0.72, 0.8, 0.9], vy: 0.02, vx: 0.08, size: 0.06, alpha: 0.4, shape: 1, glow: 1.0 },
  snow: { color: [1, 1, 1], vy: -1.1, vx: 0.45, size: 0.09, alpha: 0.9, shape: 1, glow: 1.2 },
  desert: { color: [0.96, 0.82, 0.55], vy: 0.04, vx: 1.7, size: 0.06, alpha: 0.5, shape: 1, glow: 1.0 },
  caverns: { color: [0.35, 1.0, 0.9], vy: 0.14, vx: 0.07, size: 0.1, alpha: 0.85, shape: 1, glow: 2.2 },
  ember: { color: [1.0, 0.42, 0.12], vy: 1.0, vx: 0.35, size: 0.075, alpha: 0.95, shape: 1, glow: 3.0 },
  skylands: { color: [1.0, 0.72, 0.95], vy: 0.18, vx: 0.1, size: 0.12, alpha: 0.9, shape: 3, glow: 2.0 },
};

class AmbientMotes {
  constructor(scene, scaleUniform) {
    const N = 180;
    this.N = N;
    this.box = new THREE.Vector3(44, 30, 44);
    this.pos = new Float32Array(N * 3);
    this.seed = new Float32Array(N);
    this.colA = new Float32Array(N * 3);
    this.sizeA = new Float32Array(N);
    this.alphaA = new Float32Array(N);
    this.shapeA = new Float32Array(N);
    const r = mulberry32(55);
    for (let i = 0; i < N; i++) {
      this.pos[i * 3] = (r() - 0.5) * this.box.x; this.pos[i * 3 + 1] = (r() - 0.5) * this.box.y; this.pos[i * 3 + 2] = (r() - 0.5) * this.box.z;
      this.seed[i] = r() * 100;
    }
    this.world = new Float32Array(N * 3);
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(this.world, 3).setUsage(THREE.DynamicDrawUsage));
    g.setAttribute('aColor', new THREE.BufferAttribute(this.colA, 3).setUsage(THREE.DynamicDrawUsage));
    g.setAttribute('aSize', new THREE.BufferAttribute(this.sizeA, 1).setUsage(THREE.DynamicDrawUsage));
    g.setAttribute('aAlpha', new THREE.BufferAttribute(this.alphaA, 1).setUsage(THREE.DynamicDrawUsage));
    g.setAttribute('aShape', new THREE.BufferAttribute(this.shapeA, 1).setUsage(THREE.DynamicDrawUsage));
    this.geo = g;
    this.mat = new THREE.ShaderMaterial({ vertexShader: VERT, fragmentShader: FRAG, transparent: true, depthWrite: false, fog: false, uniforms: { uScale: scaleUniform } });
    this.points = new THREE.Points(g, this.mat);
    this.points.frustumCulled = false;
    this.points.renderOrder = 9;
    scene.add(this.points);
    this.cur = { ...MOTE_CFG.default, color: [...MOTE_CFG.default.color] };
    this.target = this.cur;
    this.time = 0;
    this.enabled = true;
  }
  setPhase(key) {
    const t = MOTE_CFG[key] || MOTE_CFG.default;
    this.target = t;
  }
  update(dt, cam, nightBoost) {
    this.time += dt;
    const k = 1 - Math.exp(-dt * 1.2); // ~3 s transition
    const c = this.cur, t = this.target;
    for (let i = 0; i < 3; i++) c.color[i] += (t.color[i] - c.color[i]) * k;
    for (const f of ['vy', 'vx', 'size', 'alpha', 'glow']) c[f] += (t[f] - c[f]) * k;
    c.shape = t.shape;
    const B = this.box;
    const hb = [B.x / 2, B.y / 2, B.z / 2];
    for (let i = 0; i < this.N; i++) {
      const j = i * 3, s = this.seed[i];
      const swirl = Math.sin(this.time * 0.4 + s);
      this.pos[j] += (c.vx * (0.6 + 0.4 * Math.sin(s * 3)) + swirl * 0.12) * dt;
      this.pos[j + 1] += (c.vy + Math.cos(this.time * 0.5 + s * 2) * 0.05) * dt;
      this.pos[j + 2] += (Math.cos(this.time * 0.35 + s) * 0.14 + c.vx * 0.15) * dt;
      // wrap around the camera
      for (let a = 0; a < 3; a++) {
        const camv = a === 0 ? cam.x : a === 1 ? cam.y : cam.z;
        let w = this.pos[j + a] - camv;
        w = ((w + hb[a]) % B.getComponent(a) + B.getComponent(a)) % B.getComponent(a) - hb[a];
        this.pos[j + a] = camv + w;
        this.world[j + a] = this.pos[j + a];
      }
      this.colA[j] = c.color[0] * c.glow; this.colA[j + 1] = c.color[1] * c.glow; this.colA[j + 2] = c.color[2] * c.glow;
      this.sizeA[i] = c.size * (0.7 + 0.6 * ((Math.sin(s * 7) + 1) / 2));
      // fade out near the box edge so wrapping never pops
      const dx = Math.abs(this.pos[j] - cam.x) / hb[0], dy = Math.abs(this.pos[j + 1] - cam.y) / hb[1], dz = Math.abs(this.pos[j + 2] - cam.z) / hb[2];
      const edge = 1 - Math.max(dx, dy, dz);
      this.alphaA[i] = c.alpha * Math.min(1, edge * 4) * (0.6 + 0.4 * Math.sin(this.time * 1.3 + s)) * (nightBoost ?? 1);
      this.shapeA[i] = c.shape;
    }
    const g = this.geo.attributes;
    g.position.needsUpdate = true; g.aColor.needsUpdate = true; g.aSize.needsUpdate = true; g.aAlpha.needsUpdate = true; g.aShape.needsUpdate = true;
  }
}
