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

const PHASE_TINTS = {
  plains: { color: '#ffffff', s: 0, fog: 1.0, light: 1.0 },
  underground: { color: '#8ea2bc', s: 0.3, fog: 0.9, light: 0.92 },
  snow: { color: '#d4eaff', s: 0.42, fog: 0.72, light: 1.02 },
  desert: { color: '#ffc97a', s: 0.4, fog: 0.95, light: 1.05 },
  caverns: { color: '#5a40b4', s: 0.5, fog: 0.8, light: 0.85 },
  ember: { color: '#ff4a1c', s: 0.58, fog: 0.72, light: 0.95 },
  skylands: { color: '#ff90d4', s: 0.36, fog: 1.1, light: 1.02 },
};

const EMITTER_COLOR = {
  torch: [1.0, 0.62, 0.28], glowstone: [1.0, 0.8, 0.45], magma: [1.0, 0.38, 0.12], lit_furnace: [1.0, 0.55, 0.2],
};
const NUM_LIGHTS = 8;
const tmpC = new THREE.Color();
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
    this.maxPixelRatio = Math.min(window.devicePixelRatio || 1, 1.75);
    this.pixelRatio = this.maxPixelRatio;
    this._ad = { t: 0, n: 0, calm: 0, ceiling: this.maxPixelRatio };
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
    this.tint = { color: new THREE.Color('#ffffff'), s: 0, fog: 1, light: 1 };
    this.tintTarget = { color: new THREE.Color('#ffffff'), s: 0, fog: 1, light: 1 };

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
    const base = { map: atlas.texture, vertexColors: true, emissiveMap: atlas.emissive, emissive: new THREE.Color(1, 1, 1), emissiveIntensity: 1.0 };
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
    this.armMat = new THREE.MeshLambertMaterial({ color: 0xc58a62 });
    this.sleeveMat = new THREE.MeshLambertMaterial({ color: 0x2f7fa3 });
    this._buildArm();
    this.setHeldItem(null);
  }

  _buildArm() {
    const g = new THREE.Group();
    const arm = new THREE.Mesh(new THREE.BoxGeometry(0.17, 0.17, 0.62), this.armMat);
    arm.position.z = -0.0;
    const sleeve = new THREE.Mesh(new THREE.BoxGeometry(0.19, 0.19, 0.28), this.sleeveMat);
    sleeve.position.z = 0.19;
    g.add(arm, sleeve);
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
    this.tintTarget.color.set(p.color);
    this.tintTarget.s = p.s; this.tintTarget.fog = p.fog; this.tintTarget.light = p.light;
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
      const obj = buildItemObject(key, this.atlas, this.matItem, 1);
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
    this.maxPixelRatio = low ? 1 : Math.min(window.devicePixelRatio || 1, 1.75);
    this.pixelRatio = this.maxPixelRatio;
    this._ad = { t: 0, n: 0, calm: 0, ceiling: this.maxPixelRatio };
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
    const orders = [0, 0, 3, 2];
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
  _applyTint(col, k) {
    const L = lum(col);
    const tl = Math.max(0.05, lum(this.tint.color));
    tmpC.copy(this.tint.color).multiplyScalar(L / tl);
    col.lerp(tmpC, this.tint.s * k);
  }

  _updateSkyAndLights(dt) {
    // tint transition (~3 s)
    const k = 1 - Math.exp(-dt * 1.3);
    this.tint.color.lerp(this.tintTarget.color, k);
    this.tint.s += (this.tintTarget.s - this.tint.s) * k;
    this.tint.fog += (this.tintTarget.fog - this.tint.fog) * k;
    this.tint.light += (this.tintTarget.light - this.tint.light) * k;

    const st = this.st;
    computeSky(this.timeOfDay, st);
    this._applyTint(st.zenith, 0.95);
    this._applyTint(st.horizon, 0.85);
    this._applyTint(st.hemiSky, 0.6);
    this._applyTint(st.cloud, 0.7);
    this._applyTint(st.sunColor, 0.35);
    this.dayFactor = Math.min(1, st.hemiI / 1.3);

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
    const useSun = st.sunI >= st.moonI;
    const dir = useSun ? st.sunDir : st.moonDir;
    if (useSun) { this.sun.color.copy(st.sunColor); this.sun.intensity = st.sunI * lm; }
    else { this.sun.color.setRGB(0.5, 0.64, 1.0); this.sun.intensity = st.moonI * 1.1; }
    // follow the camera, snapped to shadow texels to avoid shimmer
    const cp = this.camera.position;
    const texel = (2 * this.shadowR) / this.sun.shadow.mapSize.x;
    const r = new THREE.Vector3(0, 1, 0).cross(dir);
    if (r.lengthSq() < 1e-4) r.set(1, 0, 0);
    r.normalize();
    const u = new THREE.Vector3().crossVectors(dir, r).normalize();
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
    this.renderer.toneMappingExposure = 1.0 + (1 - this.dayFactor) * 0.28;

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
      const night = 1 + (1 - this.dayFactor) * 0.35;
      l.intensity = def.light * 0.72 * flick * this.lightCur[i] * night;
      l.distance = 8 + def.light * 0.85;
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

  // Dynamic resolution: keep ~60 fps on fill-rate-bound (retina) screens by trading pixel ratio.
  _adaptResolution(rawDt) {
    const a = this._ad;
    if (!this.adaptive || rawDt > 0.25) return;
    a.t += rawDt; a.n++;
    if (a.n < 40) return;
    const avg = a.t / a.n;
    a.t = 0; a.n = 0;
    let next = this.pixelRatio;
    if (avg > 0.0195 && this.pixelRatio > 0.8) {
      next = Math.max(0.8, this.pixelRatio - 0.15);
      a.ceiling = Math.min(a.ceiling, this.pixelRatio); // don't go back up to the ratio that was too slow...
      a.calm = -6; // ...for a good while
    } else if (avg < 0.0182) {
      a.calm++;
      if (a.calm >= 5 && this.pixelRatio < this.maxPixelRatio) { next = Math.min(this.maxPixelRatio, this.pixelRatio + 0.1); a.calm = 0; if (next >= a.ceiling) { next = this.pixelRatio; a.ceiling = Math.min(this.maxPixelRatio, a.ceiling + 0.15); } }
    }
    if (Math.abs(next - this.pixelRatio) > 1e-3) { this.pixelRatio = next; this._lw = -1; this.resize(); }
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
