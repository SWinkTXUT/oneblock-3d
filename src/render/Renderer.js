// Renderer: chunk meshes, lighting, sky, post, particles, viewmodel. API per SPEC §4.
import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { LineSegments2 } from 'three/addons/lines/LineSegments2.js';
import { LineSegmentsGeometry } from 'three/addons/lines/LineSegmentsGeometry.js';
import { LineMaterial } from 'three/addons/lines/LineMaterial.js';
import { BLOCKS, BLOCK_BY_KEY } from '../data/blocks.js';
import { getAtlas, getWaterTexture, getCrackTexture, getIconDataURL, drawMobTexture } from './textures.js';
import { initMesher, meshChunk } from './mesher.js';
import { CS } from '../world/Chunk.js';
import { keyToChunk } from '../world/World.js';
import { Sky, computeSky, createSkyState } from './sky.js';
import { Particles } from './particles.js';
import { buildItemObject } from './itemMesh.js';

// color = zenith colour at midday, hcolor = horizon colour at midday (scaled down automatically as the day gets darker),
// s = how fully the phase replaces the normal sky, cm = cloud brightness, fog = fog distance, light = light multiplier, ex = exposure
const PHASE_TINTS = {
  plains: { color: '#2872ee', hcolor: '#b4dcff', s: 0, cm: 1, fog: 1.0, light: 1.0, ex: 1 },
  underground: { color: '#1c3048', hcolor: '#40607e', s: 0.95, cm: 0.5, fog: 0.5, light: 0.72, ex: 0.92 },
  snow: { color: '#5ca6f2', hcolor: '#f2f9ff', s: 0.9, cm: 1.15, fog: 0.7, light: 1.06, ex: 1.03 },
  desert: { color: '#f2b04a', hcolor: '#ffe2a0', s: 0.92, cm: 1.05, fog: 0.95, light: 1.1, ex: 1.04 },
  caverns: { color: '#241a52', hcolor: '#2c7090', s: 0.93, cm: 0.45, fog: 0.62, light: 0.76, ex: 0.95 },
  ember: { color: '#5c0c06', hcolor: '#ff5214', s: 0.95, cm: 0.25, fog: 0.58, light: 0.98, ex: 0.98 },
  skylands: { color: '#7a52e6', hcolor: '#68e8d6', s: 0.88, cm: 1.0, fog: 1.1, light: 1.02, ex: 1.0 },
};

const EMITTER_COLOR = {
  torch: [1.0, 0.62, 0.28], glowstone: [1.0, 0.8, 0.45], magma: [1.0, 0.38, 0.12], lit_furnace: [1.0, 0.55, 0.2],
};
const NUM_LIGHTS = 8;
const tmpC = new THREE.Color();
const V_R = new THREE.Vector3(), V_U = new THREE.Vector3();
const lum = (c) => 0.2126 * c.r + 0.7152 * c.g + 0.0722 * c.b;
const smooth = (a, b, x) => { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t); };

export class Renderer {
  constructor(container, world) {
    this.container = container;
    this.world = world;
    this.quality = 'high';
    this.adaptive = true;
    this.timeOfDay = 0.22;
    this.time = 0;
    this._firstRender = true;
    this.chunkBudget = 4;

    if (getComputedStyle(container).position === 'static') container.style.position = 'relative';
    const { w, h } = this._size();

    const renderer = new THREE.WebGLRenderer({ antialias: false, powerPreference: 'high-performance', stencil: false });
    this.renderer = renderer;
    this.maxPixelRatio = Math.min(window.devicePixelRatio || 1, 1.5);
    this.pixelRatio = this.maxPixelRatio;
    this._ad = { t: 0, n: 0, calm: 0, hold: 0, skip: 60 };
    renderer.setPixelRatio(this.pixelRatio);
    renderer.setSize(w, h);
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.0;
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFShadowMap;
    renderer.setClearColor(0x000000, 1);
    renderer.info.autoReset = false;
    const cv = renderer.domElement;
    cv.style.display = 'block'; cv.style.width = '100%'; cv.style.height = '100%';
    container.appendChild(cv);

    this.scene = new THREE.Scene();
    this.scene.fog = new THREE.Fog(0xaaccff, 40, 130);
    this.camera = new THREE.PerspectiveCamera(75, w / h, 0.06, 1200);
    this.camera.rotation.order = 'YXZ';
    this.camera.position.set(0.5, 2.62, 0.5);
    this.scene.add(this.camera);

    this.atlas = getAtlas();
    initMesher(this.atlas);
    this._makeMaterials();

    // ---- lights
    this.hemi = new THREE.HemisphereLight(0xffffff, 0x666666, 1);
    this.scene.add(this.hemi);
    this.sun = new THREE.DirectionalLight(0xffffff, 3);
    this.sun.castShadow = true;
    this.sun.shadow.mapSize.set(2048, 2048);
    const R = 30;
    const sc = this.sun.shadow.camera;
    sc.left = -R; sc.right = R; sc.top = R; sc.bottom = -R; sc.near = 1; sc.far = 260;
    this.shadowR = R;
    this.sun.shadow.bias = -0.0004;
    this.sun.shadow.normalBias = 0.035;
    this.scene.add(this.sun, this.sun.target);
    this.lights = [];
    this.lightSlot = new Array(NUM_LIGHTS).fill(null); // emitter key per slot
    this.lightCur = new Float32Array(NUM_LIGHTS);
    for (let i = 0; i < NUM_LIGHTS; i++) {
      const l = new THREE.PointLight(0xffa860, 0, 15, 2);
      this.scene.add(l);
      this.lights.push(l);
    }
    this.maxLights = NUM_LIGHTS;

    // ---- sky
    this.sky = new Sky(this.scene);
    this.st = createSkyState();
    const mkTint = () => ({ color: new THREE.Color('#ffffff'), hcolor: new THREE.Color('#ffffff'), s: 0, b: 1, cm: 1, fog: 1, light: 1, ex: 1 });
    this.tint = mkTint();
    { const ns = computeSky(0.25, createSkyState()); this.refZ = lum(ns.zenith); this.refH = lum(ns.horizon); }
    this.tintTarget = mkTint();

    // ---- particles
    this.particles = new Particles(this.scene, this.atlas);

    // ---- chunk meshes
    this.chunkMeshes = new Map();
    this.chunkRoot = new THREE.Group();
    this.scene.add(this.chunkRoot);

    // ---- block highlight / crack overlay
    this._makeOverlays(w, h);

    // ---- viewmodel
    this._makeViewmodel();

    // ---- screen tints (DOM)
    this._makeDomOverlays();

    // ---- post
    this._makeComposer(w, h);
    this._updateScale();

    this.underwater = false; this.uw = 0; this.torchGlow = 0;
    this.dayFactor = 1;
    this._lightTimer = 0;

    this._onResize = () => this.resize();
    window.addEventListener('resize', this._onResize);
    if (typeof ResizeObserver !== 'undefined') {
      this._ro = new ResizeObserver(() => this.resize());
      this._ro.observe(container);
    }
    this.setQuality('high');
  }

  // ------------------------------------------------------------ setup
  _size() {
    const w = this.container.clientWidth || window.innerWidth || 800;
    const h = this.container.clientHeight || window.innerHeight || 600;
    return { w, h };
  }

  _makeMaterials() {
    const atlas = this.atlas;
    const base = { map: atlas.texture, vertexColors: true, emissiveMap: atlas.emissive, emissive: new THREE.Color(1, 1, 1), emissiveIntensity: 0.75 };
    this.matOpaque = new THREE.MeshLambertMaterial({ ...base });
    this.matCutout = new THREE.MeshLambertMaterial({ ...base, alphaTest: 0.5 });
    this.matTrans = new THREE.MeshLambertMaterial({ map: atlas.texture, vertexColors: true, transparent: true, depthWrite: false, alphaTest: 0.02 });
    this.waterTime = { value: 0 };
    const wt = getWaterTexture();
    this.matWater = new THREE.MeshLambertMaterial({ map: wt, transparent: true, opacity: 0.8, depthWrite: false, side: THREE.DoubleSide, color: new THREE.Color(0.5, 0.74, 1.0) });
    this.matWater.onBeforeCompile = (shader) => {
      shader.uniforms.uTime = this.waterTime;
      shader.vertexShader = 'uniform float uTime;\n' + shader.vertexShader.replace('#include <begin_vertex>', `#include <begin_vertex>
        {
          vec3 wp = (modelMatrix * vec4(transformed, 1.0)).xyz;
          float top = step(0.5, normal.y);
          transformed.y += top * (sin(wp.x * 1.9 + uTime * 1.7) + cos(wp.z * 2.3 + uTime * 1.3) + sin((wp.x + wp.z) * 1.1 + uTime * 0.9)) * 0.011;
        }`);
      shader.fragmentShader = 'uniform float uTime;\n' + shader.fragmentShader.replace('#include <map_fragment>', `
        #ifdef USE_MAP
          vec2 w1 = vMapUv * 0.5 + vec2(uTime * 0.035, uTime * 0.02);
          vec2 w2 = vMapUv * vec2(-0.65, 0.65) + vec2(-uTime * 0.025, uTime * 0.04) + 0.37;
          vec4 s1 = texture2D(map, w1);
          vec4 s2 = texture2D(map, w2);
          vec4 sampledDiffuseColor = (s1 + s2) * 0.5;
          float spark = smoothstep(0.62, 0.9, (s1.b + s2.b) * 0.5);
          sampledDiffuseColor.rgb *= 1.0 + spark * 0.35;
          diffuseColor *= sampledDiffuseColor;
        #endif`);
    };
    this.matWater.customProgramCacheKey = () => 'oneblock-water';
    // dropped / held item cube material shares the cutout material
    this.matItem = this.matCutout;
    this.matHeld = new THREE.MeshLambertMaterial({ ...base, alphaTest: 0.5, emissiveIntensity: 0.22 });
  }

  _makeOverlays(w, h) {
    // fat-line highlight
    const edges = new THREE.EdgesGeometry(new THREE.BoxGeometry(1, 1, 1));
    const lg = new LineSegmentsGeometry().fromEdgesGeometry(edges);
    this.lineMat = new LineMaterial({ color: 0x0b0b10, linewidth: 2.4, transparent: true, opacity: 0.85, depthTest: true });
    this.lineMat.resolution.set(w, h);
    this.highlight = new LineSegments2(lg, this.lineMat);
    this.highlight.visible = false;
    this.highlight.renderOrder = 5;
    this.highlight.frustumCulled = false;
    this.scene.add(this.highlight);
    this.highlightPos = null;

    // crack overlay
    const crack = getCrackTexture().clone();
    crack.needsUpdate = true;
    crack.repeat.set(0.1, 1);
    this.crackTex = crack;
    this.crackMat = new THREE.MeshBasicMaterial({ map: crack, transparent: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2, toneMapped: false, color: 0xffffff });
    this.crack = new THREE.Mesh(new THREE.BoxGeometry(1.003, 1.003, 1.003), this.crackMat);
    this.crack.visible = false;
    this.crack.renderOrder = 4;
    this.scene.add(this.crack);
  }

  _makeViewmodel() {
    this.viewScene = new THREE.Scene();
    this.viewCam = new THREE.PerspectiveCamera(60, 1, 0.02, 10);
    this.viewHemi = new THREE.HemisphereLight(0xffffff, 0x887766, 1.6);
    this.viewDir = new THREE.DirectionalLight(0xffffff, 2.2);
    this.viewDir.position.set(-0.6, 1.2, 0.8);
    this.viewScene.add(this.viewHemi, this.viewDir);
    this.hand = new THREE.Group();
    this.viewScene.add(this.hand);
    this.heldKey = null;
    this.heldObj = null;
    this.swing = 1; // 0..1 progress, 1 = idle
    this.equip = 1;
    this._buildArm();
    this.setHeldItem(null);
  }

  _buildArm() {
    const tex = (fn) => {
      const c = document.createElement('canvas'); c.width = c.height = 8;
      const g = c.getContext('2d');
      for (let y = 0; y < 8; y++) for (let x = 0; x < 8; x++) { g.fillStyle = fn(x, y); g.fillRect(x, y, 1, 1); }
      const t = new THREE.CanvasTexture(c); t.magFilter = THREE.NearestFilter; t.minFilter = THREE.NearestFilter; t.generateMipmaps = false;
      t.colorSpace = THREE.SRGBColorSpace; return t;
    };
    const j = (x, y, s) => { let h = Math.sin(x * 12.9898 + y * 78.233 + s) * 43758.5453; return h - Math.floor(h); };
    const skin = tex((x, y) => { const v = 0.82 + j(x, y, 1) * 0.36 - (y > 5 ? 0.14 : 0) - (x < 2 ? 0.1 : 0); return `rgb(${200 * v | 0},${146 * v | 0},${108 * v | 0})`; });
    const sleeve = tex((x, y) => { let v = 0.9 + j(x, y, 2) * 0.2; if (y === 0) v = 1.25; if (y === 1) v *= 0.75; return `rgb(${44 * v | 0},${112 * v | 0},${160 * v | 0})`; });
    this.armMat = new THREE.MeshLambertMaterial({ map: skin });
    this.sleeveMat = new THREE.MeshLambertMaterial({ map: sleeve });
    const g = new THREE.Group();
    const arm = new THREE.Mesh(new THREE.BoxGeometry(0.15, 0.15, 0.36), this.armMat);
    arm.position.z = -0.08;
    const cuff = new THREE.Mesh(new THREE.BoxGeometry(0.2, 0.2, 0.32), this.sleeveMat);
    cuff.position.z = 0.26;
    g.add(arm, cuff);
    this.armObj = g;
  }

  _makeDomOverlays() {
    const mk = (css) => {
      const d = document.createElement('div');
      d.style.cssText = 'position:absolute;inset:0;pointer-events:none;opacity:0;' + css;
      this.container.appendChild(d);
      return d;
    };
    this.uwDiv = mk('background:radial-gradient(ellipse at center, rgba(24,84,190,0.42) 0%, rgba(8,44,130,0.7) 100%);transition:opacity .18s;');
    this.hurtDiv = mk('background:radial-gradient(ellipse at center, rgba(255,0,0,0.12) 20%, rgba(220,0,0,0.55) 100%);');
  }

  _makeComposer(w, h) {
    const pr = this.pixelRatio;
    const rt = new THREE.WebGLRenderTarget(w * pr, h * pr, { type: THREE.HalfFloatType, samples: 4 });
    this.composer = new EffectComposer(this.renderer, rt);
    this.composer.setPixelRatio(pr);
    this.composer.setSize(w, h);
    this.mainPass = new RenderPass(this.scene, this.camera);
    this.viewPass = new RenderPass(this.viewScene, this.viewCam);
    this.viewPass.clear = false;
    this.viewPass.clearDepth = true;
    this.bloom = new UnrealBloomPass(new THREE.Vector2(w, h), 0.2, 0.42, 1.25);
    const bs = this.bloom.setSize.bind(this.bloom); // blur chain at half the framebuffer size: ~4x cheaper, looks the same
    this.bloom.setSize = (bw, bh) => bs(Math.max(2, Math.floor(bw * 0.5)), Math.max(2, Math.floor(bh * 0.5)));
    this.bloom.setSize(w * pr, h * pr);
    this.outPass = new OutputPass();
    this.composer.addPass(this.mainPass);
    this.composer.addPass(this.viewPass);
    this.composer.addPass(this.bloom);
    this.composer.addPass(this.outPass);
  }

  _updateScale() {
    const { h } = this._size();
    const pxPerUnit = (h * this.pixelRatio) / (2 * Math.tan(THREE.MathUtils.degToRad(this.camera.fov) / 2));
    this.particles.setScale(pxPerUnit);
    this.sky.setPixelScale(this.pixelRatio * 1.0);
  }

  // ------------------------------------------------------------ public API
  resize() {
    const { w, h } = this._size();
    if (w === this._lw && h === this._lh) return;
    this._lw = w; this._lh = h;
    this.renderer.setPixelRatio(this.pixelRatio);
    this.renderer.setSize(w, h);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    this.viewCam.aspect = w / h;
    this.viewCam.updateProjectionMatrix();
    this.composer.setPixelRatio(this.pixelRatio);
    this.composer.setSize(w, h);
    this.lineMat.resolution.set(w, h);
    this._updateScale();
  }

  setTimeOfDay(t) { this.timeOfDay = ((t % 1) + 1) % 1; }
  getTimeOfDay() { return this.timeOfDay; }

  setPhaseAmbience(key) {
    const p = PHASE_TINTS[key] || PHASE_TINTS.plains;
    this.tintTarget.color.set(p.color); this.tintTarget.hcolor.set(p.hcolor);
    for (const f of ['s', 'cm', 'fog', 'light', 'ex']) this.tintTarget[f] = p[f];
    this.particles.ambient.setPhase(key);
    this.phaseKey = key;
  }

  _blockBox(def) {
    switch (def.shape) {
      case 'farmland': return [1, 15 / 16, 1, 15 / 32];
      case 'bed': return [1, 9 / 16, 1, 9 / 32];
      case 'torch': return [2 / 16 + 0.02, 10 / 16, 2 / 16 + 0.02, 5 / 16];
      case 'cross': return [0.8, 0.9, 0.8, 0.45];
      default: return [1, 1, 1, 0.5];
    }
  }

  setHighlight(pos) {
    if (!pos) { this.highlight.visible = false; this.highlightPos = null; return; }
    const id = this.world.getBlock(pos.x, pos.y, pos.z);
    const [sx, sy, sz, oy] = this._blockBox(BLOCKS[id] || BLOCKS[1]);
    this.highlight.visible = true;
    this.highlight.position.set(Math.floor(pos.x) + 0.5, Math.floor(pos.y) + oy, Math.floor(pos.z) + 0.5);
    this.highlight.scale.set(sx + 0.006, sy + 0.006, sz + 0.006);
    this.highlightPos = pos;
  }

  setBreakProgress(pos, p) {
    if (!pos || !(p > 0)) { this.crack.visible = false; return; }
    const stage = Math.max(0, Math.min(9, Math.floor(p * 10)));
    this.crackTex.offset.x = stage * 0.1;
    const id = this.world.getBlock(pos.x, pos.y, pos.z);
    const [sx, sy, sz, oy] = this._blockBox(BLOCKS[id] || BLOCKS[1]);
    this.crack.position.set(Math.floor(pos.x) + 0.5, Math.floor(pos.y) + oy, Math.floor(pos.z) + 0.5);
    this.crack.scale.set(sx, sy, sz);
    this.crack.visible = true;
  }

  spawnBlockParticles(x, y, z, blockId) {
    const def = BLOCKS[blockId];
    if (!def || blockId === 0) return;
    this.particles.blockBurst(Math.floor(x), Math.floor(y), Math.floor(z), blockId, def);
  }

  spawnParticles(kind, x, y, z) {
    // x,y,z = world-space centre of the effect (for a block pass x+0.5, y+0.5, z+0.5)
    this.particles.burst(kind, x, y, z);
  }

  setHeldItem(key) {
    if (this.heldObj) { this.hand.remove(this.heldObj); this.heldObj = null; }
    this.heldKey = key || null;
    this.heldMode = 'arm';
    if (key) {
      const def = BLOCK_BY_KEY[key];
      const obj = buildItemObject(key, this.atlas, this.matHeld, 1);
      const isSprite = !!obj.children[0]?.userData.isSprite;
      if (obj.children.length) {
        this.heldObj = obj;
        this.heldMode = isSprite ? 'sprite' : 'block';
        if (isSprite) obj.children[0].scale.setScalar(0.42);
        else obj.children[0].scale.setScalar(0.27);
        void def;
      }
    }
    if (!this.heldObj) { this.heldObj = this.armObj; this.heldMode = 'arm'; }
    this.hand.add(this.heldObj);
    this.equip = 0;
  }

  swingHand() { this.swing = 0; }
  setViewmodelVisible(v) { this.hand.visible = !!v; }

  setUnderwater(b) {
    this.underwater = !!b;
    this.uwDiv.style.opacity = b ? '1' : '0';
  }

  setDamageFlash() {
    const d = this.hurtDiv;
    d.style.transition = 'none';
    d.style.opacity = '1';
    void d.offsetWidth;
    d.style.transition = 'opacity .45s ease-out';
    d.style.opacity = '0';
  }

  setQuality(q) {
    this.quality = q === 'low' ? 'low' : 'high';
    const low = this.quality === 'low';
    this.sun.castShadow = !low;
    this.useComposer = !low;
    this.maxLights = low ? 3 : NUM_LIGHTS;
    this.maxPixelRatio = low ? 1 : Math.min(window.devicePixelRatio || 1, 1.5);
    this.pixelRatio = this.maxPixelRatio;
    this._ad = { t: 0, n: 0, calm: 0, hold: 0, skip: 60 };
    this.bloom.enabled = true;
    this.fogFar = low ? 78 : 140;
    this.sun.shadow.mapSize.set(low ? 512 : 2048, low ? 512 : 2048);
    if (this.sun.shadow.map) { this.sun.shadow.map.dispose(); this.sun.shadow.map = null; }
    this._lw = -1;
    this.resize();
    this.particles.ambient.points.visible = true;
  }

  createItemMesh(key) {
    const g = buildItemObject(key, this.atlas, this.matItem, 0.25);
    g.traverse((o) => { if (o.isMesh) { o.castShadow = true; } });
    return g;
  }

  getItemIcon(key) { return getIconDataURL(key); }

  getMobTexture(kind) {
    this._mobTex = this._mobTex || {};
    return (this._mobTex[kind] ||= drawMobTexture(kind));
  }

  // extras -----------------------------------------------------------------
  getSkyState() { return this.st; }
  flushChunks(maxChunks = Infinity) { this._rebuildDirty(maxChunks); }
  get stats() {
    const i = this.renderer.info;
    return { calls: i.render.calls, triangles: i.render.triangles, chunks: this.chunkMeshes.size, dirty: this.world.dirty.size };
  }
  dispose() {
    window.removeEventListener('resize', this._onResize);
    this._ro?.disconnect();
    this.renderer.dispose();
    this.renderer.domElement.remove();
  }

  // ------------------------------------------------------------ chunks
  _removeChunk(key) {
    const e = this.chunkMeshes.get(key);
    if (!e) return;
    for (const m of e.meshes) m.geometry.dispose();
    this.chunkRoot.remove(e.group);
    this.chunkMeshes.delete(key);
  }

  _buildChunk(key) {
    const chunk = this.world.chunks.get(key);
    if (!chunk) { this._removeChunk(key); return; }
    const layers = meshChunk(this.world, chunk);
    let e = this.chunkMeshes.get(key);
    if (e) { for (const m of e.meshes) { e.group.remove(m); m.geometry.dispose(); } e.meshes.length = 0; }
    const mats = [this.matOpaque, this.matCutout, this.matTrans, this.matWater];
    const orders = [0, 0, 2, 3]; // glass/ice first, water after
    const meshes = [];
    let any = false;
    layers.forEach((L, i) => {
      if (!L) return;
      any = true;
      const g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.BufferAttribute(L.pos, 3));
      g.setAttribute('normal', new THREE.BufferAttribute(L.nor, 3));
      g.setAttribute('uv', new THREE.BufferAttribute(L.uv, 2));
      g.setAttribute('color', new THREE.BufferAttribute(L.col, 3));
      g.setIndex(new THREE.BufferAttribute(L.idx, 1));
      g.computeBoundingSphere();
      const m = new THREE.Mesh(g, mats[i]);
      m.castShadow = i < 2;
      m.receiveShadow = i < 3;
      m.renderOrder = orders[i];
      meshes.push(m);
    });
    if (!any) { if (e) this._removeChunk(key); return; }
    if (!e) {
      const group = new THREE.Group();
      group.position.set(chunk.cx * CS, chunk.cy * CS, chunk.cz * CS);
      group.matrixAutoUpdate = false;
      group.updateMatrix();
      this.chunkRoot.add(group);
      e = { group, meshes: [] };
      this.chunkMeshes.set(key, e);
    }
    for (const m of meshes) { e.group.add(m); e.meshes.push(m); }
  }

  _rebuildDirty(budget) {
    const dirty = this.world.dirty;
    if (!dirty.size) return;
    const cam = this.camera.position;
    for (const k of [...dirty]) if (!this.world.chunks.has(k)) { dirty.delete(k); this._removeChunk(k); } // removals are free
    if (!dirty.size) return;
    let keys = [...dirty];
    if (keys.length > budget) {
      keys = keys.map((k) => {
        const c = keyToChunk(k);
        const dx = c.cx * 16 + 8 - cam.x, dy = c.cy * 16 + 8 - cam.y, dz = c.cz * 16 + 8 - cam.z;
        return [k, dx * dx + dy * dy + dz * dz];
      }).sort((a, b) => a[1] - b[1]).slice(0, budget).map((x) => x[0]);
    }
    for (const k of keys) { dirty.delete(k); this._buildChunk(k); }
  }

  // ------------------------------------------------------------ per-frame
  // Replace the sky colour with the phase colour, keeping the time-of-day brightness (so night stays dark).
  _applyTint(col, ref, horizon) {
    if (this.tint.s < 1e-3) return;
    const tc = horizon ? this.tint.hcolor : this.tint.color;
    const f = Math.min(1.5, lum(col) / ref);
    tmpC.copy(tc).multiplyScalar(f);
    col.lerp(tmpC, this.tint.s);
  }
  // Hue-only tint that keeps luminance (hemisphere, key light, clouds).
  _hueTint(col, k, mul = 1) {
    if (this.tint.s < 1e-3) return;
    const tc = this.tint.hcolor;
    tmpC.copy(tc).multiplyScalar(lum(col) / Math.max(0.05, lum(tc)));
    col.lerp(tmpC, Math.min(1, this.tint.s * k));
    col.multiplyScalar(1 + (mul - 1) * this.tint.s);
  }

  _updateSkyAndLights(dt) {
    // tint transition (~3 s)
    const k = 1 - Math.exp(-dt * 1.3);
    this.tint.color.lerp(this.tintTarget.color, k);
    this.tint.hcolor.lerp(this.tintTarget.hcolor, k);
    for (const f of ['s', 'cm', 'fog', 'light', 'ex']) this.tint[f] += (this.tintTarget[f] - this.tint[f]) * k;

    const st = this.st;
    computeSky(this.timeOfDay, st);
    this._applyTint(st.zenith, this.refZ, false);
    this._applyTint(st.horizon, this.refH, true);
    this._hueTint(st.hemiSky, 0.55);
    this._hueTint(st.hemiGround, 0.3);
    this._hueTint(st.cloud, 0.8, this.tint.cm);
    this._hueTint(st.keyColor, 0.35);
    this.dayFactor = Math.min(1, st.hemiI / 1.3);
    this.bloom.strength = 0.2 - 0.09 * this.dayFactor;
    this.bloom.threshold = 1.25 + 0.35 * this.dayFactor;

    // fog
    const fog = this.scene.fog;
    const far = this.fogFar * this.tint.fog;
    const uw = this.uw += ((this.underwater ? 1 : 0) - this.uw) * Math.min(1, dt * 10);
    tmpC.setRGB(0.02, 0.14, 0.4).multiplyScalar(0.18 + 0.82 * this.dayFactor);
    fog.color.copy(st.horizon).lerp(tmpC, uw);
    fog.near = (far * 0.34) * (1 - uw) + 0.1 * uw;
    fog.far = far * (1 - uw) + 13 * uw;

    // hemisphere + directional
    const lm = this.tint.light;
    this.hemi.color.copy(st.hemiSky);
    this.hemi.groundColor.copy(st.hemiGround);
    this.hemi.intensity = st.hemiI * 1.15 * lm;
    const dir = st.keyDir;
    this.sun.color.copy(st.keyColor);
    this.sun.intensity = st.keyI * lm;
    // follow the camera, snapped to shadow texels to avoid shimmer
    const cp = this.camera.position;
    const texel = (2 * this.shadowR) / this.sun.shadow.mapSize.x;
    const r = V_R.set(0, 1, 0).cross(dir);
    if (r.lengthSq() < 1e-4) r.set(1, 0, 0);
    r.normalize();
    const u = V_U.crossVectors(dir, r).normalize();
    const tx = Math.round(cp.dot(r) / texel) * texel, ty = Math.round(cp.dot(u) / texel) * texel, tz = cp.dot(dir);
    const target = r.multiplyScalar(tx).addScaledVector(u, ty).addScaledVector(dir, tz);
    this.sun.target.position.copy(target);
    this.sun.position.copy(target).addScaledVector(dir, 120);
    this.sun.target.updateMatrixWorld();

    // viewmodel lights follow the ambience
    this.viewHemi.color.copy(st.hemiSky);
    this.viewHemi.groundColor.copy(st.hemiGround);
    this.viewHemi.color.lerp(tmpC.setRGB(1, 1, 1), 0.35);
    this.viewHemi.intensity = Math.max(1.05, st.hemiI * 1.3) * lm + (this.torchGlow || 0) * 1.6;
    this.viewDir.color.copy(this.sun.color);
    this.viewDir.intensity = Math.max(0.8, this.sun.intensity * 0.7) + (this.torchGlow || 0) * 1.2;

    // exposure: slightly brighter at night so the moonlit island stays readable
    this.renderer.toneMappingExposure = (1.0 + (1 - this.dayFactor) * 0.28) * this.tint.ex;

    this.sky.update(dt, cp, st);
  }

  _updatePointLights(dt) {
    const em = this.world.emitters;
    const cp = this.camera.position;
    const maxL = this.maxLights;
    // nearest emitters (within range)
    const best = [];
    for (const [k, e] of em) {
      const dx = e.x + 0.5 - cp.x, dy = e.y + 0.5 - cp.y, dz = e.z + 0.5 - cp.z;
      const d = dx * dx + dy * dy + dz * dz;
      if (d > 34 * 34) continue;
      if (maxL <= 0) break;
      if (best.length < maxL) { best.push([k, d]); best.sort((a, b) => a[1] - b[1]); }
      else if (d < best[best.length - 1][1]) { best[best.length - 1] = [k, d]; best.sort((a, b) => a[1] - b[1]); }
    }
    const want = new Set(best.map((b) => b[0]));
    const slots = this.lightSlot;
    // free slots whose emitter vanished / fell out of the nearest set once they have faded out
    for (let i = 0; i < NUM_LIGHTS; i++) {
      const sk = slots[i];
      if (sk === null) continue;
      if (!em.has(sk)) { slots[i] = null; this.lightCur[i] = 0; }
      else if (!want.has(sk) && this.lightCur[i] < 0.03) slots[i] = null;
    }
    // assign newly wanted emitters to free slots
    const assigned = new Set(slots.filter((k) => k !== null));
    for (const [k] of best) {
      if (assigned.has(k)) continue;
      const free = slots.indexOf(null);
      if (free < 0) break;
      slots[free] = k; assigned.add(k); this.lightCur[free] = 0;
    }
    const t = this.time;
    let glow = 0;
    for (const [k, d2] of best) { const e = em.get(k); glow = Math.max(glow, (BLOCKS[e.id].light / 14) * Math.max(0, 1 - Math.sqrt(d2) / 8)); }
    this.torchGlow += (glow - this.torchGlow) * Math.min(1, dt * 6);
    for (let i = 0; i < NUM_LIGHTS; i++) {
      const l = this.lights[i];
      const sk = slots[i];
      const e = sk !== null ? em.get(sk) : null;
      if (!e) { l.intensity = 0; continue; }
      const target = want.has(sk) ? 1 : 0;
      this.lightCur[i] += (target - this.lightCur[i]) * Math.min(1, dt * 8);
      const def = BLOCKS[e.id];
      const col = EMITTER_COLOR[def.key] || EMITTER_COLOR.torch;
      l.color.setRGB(col[0], col[1], col[2]);
      l.position.set(e.x + 0.5, e.y + (def.shape === 'torch' ? 0.8 : 0.5), e.z + 0.5);
      const flick = def.shape === 'torch' ? 1 + Math.sin(t * 9 + e.x * 3.1 + e.z * 1.7) * 0.05 + Math.sin(t * 23 + e.y) * 0.03 : 1;
      const dark = 0.22 + 0.78 * (1 - this.dayFactor); // point lights are subtle in daylight, full strength at night
      l.intensity = def.light * 0.8 * flick * this.lightCur[i] * dark * (1 + (1 - this.dayFactor) * 0.3);
      l.distance = 6 + def.light * 0.7;
    }
  }

  _updateViewmodel(dt) {
    this.equip = Math.min(1, this.equip + dt * 5.5);
    if (this.swing < 1) this.swing = Math.min(1, this.swing + dt * 3.6);
    const ease = 1 - Math.pow(1 - this.equip, 3);
    const sw = this.swing;
    const s1 = Math.sin(Math.sqrt(sw) * Math.PI), s2 = Math.sin(sw * Math.PI), s3 = Math.sin(Math.sqrt(sw) * Math.PI * 2);
    const bob = Math.sin(this.time * 1.6) * 0.004;
    const h = this.hand;
    if (this.heldMode === 'arm') {
      h.position.set(0.36 - s1 * 0.26, -0.34 - (1 - ease) * 0.5 + bob + s3 * 0.1, -0.5 - s2 * 0.18);
      h.rotation.set(-0.1 - s1 * 0.9, 0.5 + s1 * 0.5, 0.0);
      h.scale.setScalar(1);
    } else if (this.heldMode === 'block') {
      h.position.set(0.44 - s1 * 0.32, -0.37 - (1 - ease) * 0.55 + bob + s3 * 0.12, -0.72 - s2 * 0.22);
      h.rotation.set(0.12 - s1 * 0.6, -0.78 + s1 * 0.55, 0.0 + s3 * 0.1);
    } else {
      h.position.set(0.36 - s1 * 0.3, -0.27 - (1 - ease) * 0.55 + bob + s3 * 0.14, -0.62 - s2 * 0.2);
      h.rotation.set(0.05 - s1 * 1.0, Math.PI + 0.6 - s1 * 0.45, 0.28 - s3 * 0.2);
    }
  }

  // Dynamic resolution with a few discrete levels (no per-step target churn), hysteresis and warm-up.
  _levels() {
    const m = this.maxPixelRatio, L = [1.0, 1.25, 1.5].filter((v) => v <= m + 1e-6);
    if (!L.length || Math.abs(L[L.length - 1] - m) > 1e-3) L.push(m);
    return L;
  }
  _adaptResolution(rawDt) {
    const a = this._ad;
    if (!this.adaptive || document.hidden || rawDt > 0.25) { a.t = 0; a.n = 0; return; }
    if (a.skip > 0) { a.skip--; return; }
    a.t += rawDt; a.n++;
    if (a.n < 45) return;
    const avg = a.t / a.n;
    a.t = 0; a.n = 0;
    const L = this._levels();
    let i = L.findIndex((v) => Math.abs(v - this.pixelRatio) < 1e-3); if (i < 0) i = L.length - 1;
    if (avg > 0.0195) {
      a.calm = 0; a.hold = 8; // stay down for 8 good windows (~6 s)
      if (i > 0) i--;
      else if (this.bloom.enabled && this.quality === 'high') this.bloom.enabled = false; // already at floor: shed bloom
    } else if (avg < 0.0178) {
      if (a.hold > 0) a.hold--;
      else if (++a.calm >= 4 && i < L.length - 1) { i++; a.calm = 0; a.hold = 8; if (!this.bloom.enabled) this.bloom.enabled = true; }
    }
    const next = L[i];
    if (Math.abs(next - this.pixelRatio) > 1e-3) { this.pixelRatio = next; this._lw = -1; a.skip = 60; this.resize(); }
  }

  render(dt = 1 / 60) {
    this._adaptResolution(dt);
    dt = Math.min(Math.max(dt, 0), 0.1);
    this.time += dt;
    this.waterTime.value = this.time;
    this.renderer.info.reset();

    if (this._firstRender) { this._firstRender = false; this._rebuildDirty(Infinity); this.resize(); }
    else this._rebuildDirty(this.chunkBudget);

    this._updateSkyAndLights(dt);
    this._updatePointLights(dt);
    this.particles.update(dt);
    this.particles.ambient.update(dt, this.camera.position, 0.35 + 0.65 * (1 - this.dayFactor * 0.55));
    this._updateViewmodel(dt);
    this.camera.updateMatrixWorld();

    if (this.useComposer) {
      this.composer.render(dt);
    } else {
      const r = this.renderer;
      r.autoClear = true;
      r.render(this.scene, this.camera);
      r.autoClear = false;
      r.clearDepth();
      r.render(this.viewScene, this.viewCam);
      r.autoClear = true;
    }
  }
}
