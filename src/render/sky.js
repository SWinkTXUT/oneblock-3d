// Sky: time-of-day colour model, gradient dome (with hazy void below), stars, sun, moon, clouds.
import * as THREE from 'three';
import { mulberry32, hash, vnoise } from './pixel.js';

const C = (h) => new THREE.Color(h);
const KF = [
  { t: 0.00, z: '#4f78c0', h: '#ff9a58', sun: '#ffb070', sunI: 2.5, hs: '#b0b8e8', hg: '#8a6a5e', hi: 1.15, moon: 0.0, stars: 0.12, cloud: '#ffb890' },
  { t: 0.05, z: '#3f80e0', h: '#ffbe78', sun: '#ffd0a0', sunI: 3.0, hs: '#c0d0f4', hg: '#8a7a64', hi: 1.3, moon: 0.0, stars: 0.0, cloud: '#ffe0c0' },
  { t: 0.12, z: '#2877ec', h: '#a8d2ff', sun: '#fff0d8', sunI: 3.2, hs: '#c4dcff', hg: '#8c7e64', hi: 1.45, moon: 0.0, stars: 0.0, cloud: '#ffffff' },
  { t: 0.25, z: '#2872ee', h: '#b4dcff', sun: '#fff6e4', sunI: 3.2, hs: '#c4dcff', hg: '#8c8068', hi: 1.5, moon: 0.0, stars: 0.0, cloud: '#ffffff' },
  { t: 0.42, z: '#4a86d6', h: '#ffe0b4', sun: '#ffe2b8', sunI: 2.9, hs: '#bcd0f0', hg: '#8a7a64', hi: 1.35, moon: 0.0, stars: 0.0, cloud: '#fff0e0' },
  { t: 0.50, z: '#3a4488', h: '#ff7440', sun: '#ff9650', sunI: 2.5, hs: '#a890c0', hg: '#7a5a64', hi: 1.15, moon: 0.0, stars: 0.1, cloud: '#ff9a84' },
  { t: 0.56, z: '#1c2358', h: '#a05078', sun: '#ff7c48', sunI: 1.7, hs: '#6a60a0', hg: '#4a4060', hi: 0.9, moon: 0.7, stars: 0.6, cloud: '#7a6090' },
  { t: 0.64, z: '#070c2a', h: '#1b2a58', sun: '#000000', sunI: 0.0, hs: '#3e5090', hg: '#2c3358', hi: 0.8, moon: 1.0, stars: 1.0, cloud: '#323c64' },
  { t: 0.86, z: '#070c2a', h: '#1b2a58', sun: '#000000', sunI: 0.0, hs: '#3e5090', hg: '#2c3358', hi: 0.8, moon: 1.0, stars: 1.0, cloud: '#323c64' },
  { t: 0.94, z: '#1c2858', h: '#6a527e', sun: '#ff8050', sunI: 1.6, hs: '#5a60a0', hg: '#4a4060', hi: 0.95, moon: 0.7, stars: 0.5, cloud: '#6a5a80' },
  { t: 1.00, z: '#4f78c0', h: '#ff9a58', sun: '#ffb070', sunI: 2.5, hs: '#b0b8e8', hg: '#8a6a5e', hi: 1.15, moon: 0.0, stars: 0.12, cloud: '#ffb890' },
].map((k) => ({
  t: k.t, z: C(k.z), h: C(k.h), sun: C(k.sun), sunI: k.sunI, hs: C(k.hs), hg: C(k.hg), hi: k.hi, moon: k.moon, stars: k.stars, cloud: C(k.cloud),
}));

const smooth = (a, b, x) => { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t); };
const MOONCOL = new THREE.Color(0.5, 0.64, 1.0);
const EAST = new THREE.Vector3(1, 0, 0);
const UPV = new THREE.Vector3(0, 1, 0.35).normalize();
const AXIS = new THREE.Vector3().crossVectors(EAST, UPV).normalize();

export function createSkyState() {
  return {
    zenith: new THREE.Color(), horizon: new THREE.Color(), sunColor: new THREE.Color(), hemiSky: new THREE.Color(), hemiGround: new THREE.Color(),
    cloud: new THREE.Color(), sunDir: new THREE.Vector3(), moonDir: new THREE.Vector3(),
    sunI: 0, moonI: 0, hemiI: 1, stars: 0, sunElev: 1, angle: 0,
    keyDir: new THREE.Vector3(0, 1, 0), keyColor: new THREE.Color(), keyI: 0,
  };
}

export function computeSky(t, out) {
  t = ((t % 1) + 1) % 1;
  let i = 0;
  while (i < KF.length - 2 && t >= KF[i + 1].t) i++;
  const a = KF[i], b = KF[i + 1];
  const f = smooth(0, 1, (t - a.t) / (b.t - a.t));
  out.zenith.copy(a.z).lerp(b.z, f);
  out.horizon.copy(a.h).lerp(b.h, f);
  out.sunColor.copy(a.sun).lerp(b.sun, f);
  out.hemiSky.copy(a.hs).lerp(b.hs, f);
  out.hemiGround.copy(a.hg).lerp(b.hg, f);
  out.cloud.copy(a.cloud).lerp(b.cloud, f);
  out.hemiI = a.hi + (b.hi - a.hi) * f;
  out.stars = a.stars + (b.stars - a.stars) * f;
  const sunBase = a.sunI + (b.sunI - a.sunI) * f;
  const moonBase = a.moon + (b.moon - a.moon) * f;
  const ang = t * Math.PI * 2;
  out.angle = ang;
  out.sunDir.copy(EAST).multiplyScalar(Math.cos(ang)).addScaledVector(UPV, Math.sin(ang)).normalize();
  out.moonDir.copy(out.sunDir).negate();
  out.sunElev = out.sunDir.y;
  // golden hour keeps a strong warm side light; it only fades once the sun is well below the horizon
  out.sunI = sunBase * (0.45 + 0.55 * smooth(-0.1, 0.28, out.sunDir.y)) * smooth(-0.34, -0.1, out.sunDir.y);
  out.moonI = 0.7 * moonBase * smooth(-0.12, 0.15, out.moonDir.y);
  // single key light that cross-fades sun -> moon (direction, colour and intensity) so shadows never pop
  const w = smooth(-0.2, -0.02, out.sunDir.y);
  out.keyDir.copy(out.sunDir).multiplyScalar(w).addScaledVector(out.moonDir, 1 - w);
  if (out.keyDir.lengthSq() < 1e-4) out.keyDir.copy(out.sunDir);
  out.keyDir.normalize();
  if (out.keyDir.y < 0.16) { out.keyDir.y = 0.16; out.keyDir.normalize(); }
  out.keyColor.copy(out.sunColor).lerp(MOONCOL, 1 - w);
  out.keyI = out.sunI * w + out.moonI * 1.1 * (1 - w);
  return out;
}

// ---------------- dome ----------------
const SKY_VERT = /* glsl */`
varying vec3 vDir;
void main() {
  vDir = position;
  vec4 p = modelViewMatrix * vec4(position, 1.0);
  gl_Position = projectionMatrix * p;
  gl_Position.z = gl_Position.w;
}`;
const SKY_FRAG = /* glsl */`
uniform vec3 uZenith; uniform vec3 uHorizon; uniform vec3 uVoid; uniform vec3 uVoidDeep; uniform vec3 uSunDir; uniform vec3 uSunColor;
uniform float uGlow; uniform vec3 uMoonDir; uniform float uMoonGlow;
varying vec3 vDir;
void main() {
  vec3 d = normalize(vDir);
  float y = d.y;
  float up = pow(clamp(y, 0.0, 1.0), 0.55);
  vec3 col = mix(uHorizon, uZenith, smoothstep(0.0, 1.0, up));
  col = mix(col, uHorizon * 1.08, exp(-abs(y) * 9.0) * 0.35);
  col = mix(col, uVoid, smoothstep(0.0, -0.3, y));
  col = mix(col, uVoidDeep, smoothstep(-0.15, -1.0, y));
  float s = max(dot(d, uSunDir), 0.0);
  col += uSunColor * (pow(s, 5.0) * 0.22 + pow(s, 40.0) * 0.55) * uGlow;
  float m = max(dot(d, uMoonDir), 0.0);
  col += vec3(0.30, 0.42, 0.75) * pow(m, 30.0) * uMoonGlow * 0.5;
  gl_FragColor = vec4(col, 1.0);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}`;

const STAR_VERT = /* glsl */`
attribute float aSize; attribute float aPhase;
uniform float uTime; uniform float uNight; uniform float uScale;
varying float vA;
void main() {
  vec3 wd = normalize(mat3(modelMatrix) * position);
  vec4 p = modelViewMatrix * vec4(position, 1.0);
  gl_Position = projectionMatrix * p;
  gl_Position.z = gl_Position.w;
  gl_PointSize = aSize * uScale;
  vA = uNight * (0.6 + 0.4 * sin(uTime * 1.7 + aPhase)) * smoothstep(-0.25, 0.08, wd.y);
}`;
const STAR_FRAG = /* glsl */`
varying float vA;
void main() {
  vec2 q = abs(gl_PointCoord - 0.5);
  float d = max(q.x, q.y);
  if (d > 0.5) discard;
  gl_FragColor = vec4(vec3(1.0, 0.96, 0.9) * 2.2, vA);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}`;

const BILL_VERT = /* glsl */`
varying vec2 vUv;
void main() {
  vUv = uv;
  vec4 p = modelViewMatrix * vec4(position, 1.0);
  gl_Position = projectionMatrix * p;
  gl_Position.z = gl_Position.w;
}`;
const SUN_FRAG = /* glsl */`
uniform vec3 uColor; uniform float uAlpha;
varying vec2 vUv;
void main() {
  vec2 p = vUv - 0.5;
  float r = length(p) * 2.0;
  float core = 1.0 - smoothstep(0.17, 0.20, max(abs(p.x), abs(p.y)) * 2.0);
  float halo = exp(-r * r * 7.0) * 0.55 + exp(-r * 3.2) * 0.12;
  vec3 col = uColor * (core * 2.4 + halo);
  float a = clamp(core + halo, 0.0, 1.0) * uAlpha;
  gl_FragColor = vec4(col, a);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}`;
const MOON_FRAG = /* glsl */`
uniform sampler2D uMap; uniform float uAlpha; uniform float uBright;
varying vec2 vUv;
void main() {
  vec4 t = texture2D(uMap, vUv);
  vec2 p = vUv - 0.5;
  float r = length(p) * 2.0;
  float halo = exp(-r * r * 6.0) * 0.28;
  vec3 col = t.rgb * uBright * t.a + vec3(0.45, 0.6, 1.0) * halo;
  float a = clamp(t.a + halo, 0.0, 1.0) * uAlpha;
  gl_FragColor = vec4(col, a);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}`;
const CLOUD_VERT = /* glsl */`
varying vec3 vWorld;
void main() {
  vec4 w = modelMatrix * vec4(position, 1.0);
  vWorld = w.xyz;
  gl_Position = projectionMatrix * viewMatrix * w;
}`;
const CLOUD_FRAG = /* glsl */`
uniform sampler2D uMap; uniform vec2 uOff; uniform vec3 uColor; uniform vec3 uCam; uniform float uOpacity; uniform vec3 uShadow;
varying vec3 vWorld;
void main() {
  vec2 uv = vWorld.xz * 0.0019 + uOff;
  float n = texture2D(uMap, uv).r;
  float n2 = texture2D(uMap, uv * 2.3 + 0.37).r;
  n = n * 0.78 + n2 * 0.22;
  float a = smoothstep(0.50, 0.66, n);
  float dist = distance(vWorld.xz, uCam.xz);
  a *= 1.0 - smoothstep(180.0, 420.0, dist);
  vec3 col = mix(uColor, uShadow, smoothstep(0.58, 0.85, n));
  gl_FragColor = vec4(col, a * uOpacity);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}`;

function moonTexture() {
  const c = document.createElement('canvas');
  c.width = c.height = 64;
  const g = c.getContext('2d');
  const img = g.createImageData(64, 64);
  for (let y = 0; y < 64; y++) for (let x = 0; x < 64; x++) {
    const dx = x - 31.5, dy = y - 31.5, d = Math.hypot(dx, dy);
    const i = (y * 64 + x) * 4;
    if (d < 17) {
      let v = 0.86 + (hash(x >> 1, y >> 1, 3) - 0.5) * 0.12;
      // craters (blocky)
      for (const [cx, cy, r] of [[-5, -4, 4], [5, 3, 5], [-4, 7, 3], [7, -7, 2.5]]) {
        const cd = Math.hypot(dx - cx, dy - cy);
        if (cd < r) v -= 0.17; else if (cd < r + 1.2 && dx - cx < 0) v += 0.05;
      }
      // soft terminator for a faint phase look
      v *= 0.82 + 0.18 * (1 - (dx + 17) / 34);
      img.data[i] = v * 238; img.data[i + 1] = v * 242; img.data[i + 2] = v * 255; img.data[i + 3] = 255;
    } else img.data[i + 3] = 0;
  }
  g.putImageData(img, 0, 0);
  const t = new THREE.CanvasTexture(c);
  t.magFilter = THREE.NearestFilter; t.minFilter = THREE.NearestFilter; t.generateMipmaps = false;
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

function cloudTexture() {
  const S = 128;
  const c = document.createElement('canvas');
  c.width = c.height = S;
  const g = c.getContext('2d');
  const img = g.createImageData(S, S);
  for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) {
    const fx = x / S, fy = y / S;
    let n = vnoise(fx * 4, fy * 4, 7, 4) * 0.5 + vnoise(fx * 8, fy * 8, 8, 8) * 0.28 + vnoise(fx * 16, fy * 16, 9, 16) * 0.15 + vnoise(fx * 32, fy * 32, 10, 32) * 0.07;
    n = (n - 0.5) * 1.6 + 0.5;
    const v = Math.max(0, Math.min(1, n)) * 255;
    const i = (y * S + x) * 4;
    img.data[i] = img.data[i + 1] = img.data[i + 2] = v; img.data[i + 3] = 255;
  }
  g.putImageData(img, 0, 0);
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.minFilter = THREE.LinearFilter; t.magFilter = THREE.LinearFilter; t.generateMipmaps = false;
  return t;
}

export class Sky {
  constructor(scene) {
    this.group = new THREE.Group();
    this.group.frustumCulled = false;
    scene.add(this.group);
    this.state = createSkyState();
    this.time = 0;

    // dome
    this.domeMat = new THREE.ShaderMaterial({
      vertexShader: SKY_VERT, fragmentShader: SKY_FRAG, side: THREE.BackSide, depthWrite: false, depthTest: false, fog: false,
      uniforms: {
        uZenith: { value: new THREE.Color() }, uHorizon: { value: new THREE.Color() }, uVoid: { value: new THREE.Color() }, uVoidDeep: { value: new THREE.Color() },
        uSunDir: { value: new THREE.Vector3() }, uSunColor: { value: new THREE.Color() }, uGlow: { value: 1 },
        uMoonDir: { value: new THREE.Vector3() }, uMoonGlow: { value: 0 },
      },
    });
    this.dome = new THREE.Mesh(new THREE.SphereGeometry(500, 32, 24), this.domeMat);
    this.dome.renderOrder = -1000;
    this.dome.frustumCulled = false;
    this.group.add(this.dome);

    // stars
    const N = 1400;
    const pos = new Float32Array(N * 3), size = new Float32Array(N), phase = new Float32Array(N);
    const r = mulberry32(2024);
    for (let i = 0; i < N; i++) {
      const u = r() * 2 - 1, th = r() * Math.PI * 2, s = Math.sqrt(1 - u * u);
      pos[i * 3] = Math.cos(th) * s * 480; pos[i * 3 + 1] = u * 480; pos[i * 3 + 2] = Math.sin(th) * s * 480;
      size[i] = r() < 0.06 ? 3.2 : r() < 0.3 ? 2.2 : 1.5;
      phase[i] = r() * 6.28;
    }
    const sg = new THREE.BufferGeometry();
    sg.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    sg.setAttribute('aSize', new THREE.BufferAttribute(size, 1));
    sg.setAttribute('aPhase', new THREE.BufferAttribute(phase, 1));
    this.starMat = new THREE.ShaderMaterial({
      vertexShader: STAR_VERT, fragmentShader: STAR_FRAG, transparent: true, depthWrite: false, fog: false,
      uniforms: { uTime: { value: 0 }, uNight: { value: 0 }, uScale: { value: 1 } },
    });
    this.stars = new THREE.Points(sg, this.starMat);
    this.stars.frustumCulled = false;
    this.stars.renderOrder = -900;
    this.starGroup = new THREE.Group();
    this.starGroup.add(this.stars);
    this.group.add(this.starGroup);

    // sun & moon
    this.sunMat = new THREE.ShaderMaterial({
      vertexShader: BILL_VERT, fragmentShader: SUN_FRAG, transparent: true, depthWrite: false, fog: false,
      blending: THREE.AdditiveBlending, uniforms: { uColor: { value: new THREE.Color(1, 0.9, 0.7) }, uAlpha: { value: 1 } },
    });
    this.sun = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), this.sunMat);
    this.sun.scale.setScalar(150);
    this.sun.renderOrder = -890; this.sun.frustumCulled = false;
    this.group.add(this.sun);
    this.moonMat = new THREE.ShaderMaterial({
      vertexShader: BILL_VERT, fragmentShader: MOON_FRAG, transparent: true, depthWrite: false, fog: false,
      uniforms: { uMap: { value: moonTexture() }, uAlpha: { value: 1 }, uBright: { value: 1.25 } },
    });
    this.moon = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), this.moonMat);
    this.moon.scale.setScalar(130);
    this.moon.renderOrder = -880; this.moon.frustumCulled = false;
    this.group.add(this.moon);

    // clouds
    this.cloudTex = cloudTexture();
    this.cloudMat = new THREE.ShaderMaterial({
      vertexShader: CLOUD_VERT, fragmentShader: CLOUD_FRAG, transparent: true, depthWrite: false, side: THREE.DoubleSide, fog: false,
      uniforms: {
        uMap: { value: this.cloudTex }, uOff: { value: new THREE.Vector2() }, uColor: { value: new THREE.Color(1, 1, 1) },
        uShadow: { value: new THREE.Color(0.7, 0.75, 0.85) }, uCam: { value: new THREE.Vector3() }, uOpacity: { value: 0.92 },
      },
    });
    this.clouds = new THREE.Mesh(new THREE.PlaneGeometry(1000, 1000).rotateX(-Math.PI / 2), this.cloudMat);
    this.clouds.renderOrder = -500;
    this.clouds.frustumCulled = false;
    scene.add(this.clouds);
    this.cloudY = 62;
  }

  setPixelScale(s) { this.starMat.uniforms.uScale.value = s; }

  // position the camera-following parts (dome, sun, stars, clouds) for the view about to be rendered
  place(camPos) {
    this.group.position.copy(camPos);
    this.clouds.position.set(camPos.x, this.cloudY, camPos.z);
    this.cloudMat.uniforms.uCam.value.copy(camPos);
  }

  update(dt, camPos, st) {
    this.time += dt;
    this.group.position.copy(camPos);
    this.state = st;
    const u = this.domeMat.uniforms;
    u.uZenith.value.copy(st.zenith);
    u.uHorizon.value.copy(st.horizon);
    u.uVoid.value.copy(st.horizon).lerp(st.zenith, 0.4).multiplyScalar(0.72);
    u.uVoidDeep.value.copy(st.zenith).lerp(st.horizon, 0.12).multiplyScalar(0.34);
    u.uSunDir.value.copy(st.sunDir);
    u.uMoonDir.value.copy(st.moonDir);
    u.uSunColor.value.copy(st.sunColor);
    u.uGlow.value = 0.25 + Math.min(1, st.sunI / 2.0) * 0.9 * smooth(-0.15, 0.1, st.sunElev);
    u.uMoonGlow.value = Math.min(1, st.moonI);

    // sun / moon billboards
    this.sun.position.copy(st.sunDir).multiplyScalar(440);
    this.sun.lookAt(this.group.position);
    this.sunMat.uniforms.uColor.value.copy(st.sunColor).multiplyScalar(1.15);
    this.sunMat.uniforms.uAlpha.value = smooth(-0.22, -0.02, st.sunElev);
    this.moon.position.copy(st.moonDir).multiplyScalar(430);
    this.moon.lookAt(this.group.position);
    this.moonMat.uniforms.uAlpha.value = smooth(-0.22, -0.02, st.moonDir.y) * (0.25 + 0.75 * Math.min(1, st.stars * 1.2));

    // stars
    this.starGroup.quaternion.setFromAxisAngle(this.axis, st.angle);
    this.starMat.uniforms.uNight.value = st.stars;
    this.starMat.uniforms.uTime.value = this.time;

    // clouds
    this.clouds.position.set(camPos.x, this.cloudY, camPos.z);
    const cu = this.cloudMat.uniforms;
    cu.uCam.value.copy(camPos);
    cu.uOff.value.x += dt * 0.0026; cu.uOff.value.y += dt * 0.0009;
    cu.uColor.value.copy(st.cloud);
    cu.uShadow.value.copy(st.cloud).lerp(st.zenith, 0.35).multiplyScalar(0.72);
  }
}
Sky.prototype.axis = AXIS;
