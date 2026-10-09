// Minecraft-proportioned player avatar: coloured outfit, name tag, walk / swing / sneak / hurt / death animation,
// held item in the hand. Lives on camera layer LAYER_AVATAR(seat): every view except the owner's draws it.
import * as THREE from 'three';
import { SEATS } from '../platform.js';
import { buildItemObject } from './itemMesh.js';
import { hash } from './pixel.js';
import { LAYER_AVATAR } from './View.js';

function canvasTex(w, h, fn) {
  const c = document.createElement('canvas'); c.width = w; c.height = h;
  const g = c.getContext('2d');
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) { g.fillStyle = fn(x, y); g.fillRect(x, y, 1, 1); }
  const t = new THREE.CanvasTexture(c);
  t.magFilter = THREE.NearestFilter; t.minFilter = THREE.NearestFilter; t.generateMipmaps = false; t.colorSpace = THREE.SRGBColorSpace;
  return t;
}
const rgb = (c, f = 1) => `rgb(${Math.min(255, c.r * 255 * f) | 0},${Math.min(255, c.g * 255 * f) | 0},${Math.min(255, c.b * 255 * f) | 0})`;
const jit = (x, y, s, a) => 1 + (hash(x, y, s) - 0.5) * a;

export class Avatar {
  constructor(renderer, seatIndex) {
    this.r = renderer;
    this.seat = seatIndex;
    const info = SEATS[seatIndex] || SEATS[0];
    this.color = new THREE.Color(info.color); // sRGB hex -> linear working colour; rgb() below wants display values
    const sc = new THREE.Color(info.color).convertLinearToSRGB();
    const skin = [214, 160, 120];
    const skinF = (f) => `rgb(${skin[0] * f | 0},${skin[1] * f | 0},${skin[2] * f | 0})`;
    const tSkin = canvasTex(8, 8, (x, y) => skinF(jit(x, y, 1, 0.14)));
    const tHair = canvasTex(8, 8, (x, y) => { const f = jit(x, y, 2, 0.3); return `rgb(${70 * f | 0},${46 * f | 0},${28 * f | 0})`; });
    const tFace = canvasTex(8, 8, (x, y) => {
      if (y < 2 || (y === 2 && (x < 1 || x > 6))) { const f = jit(x, y, 3, 0.3); return `rgb(${70 * f | 0},${46 * f | 0},${28 * f | 0})`; }
      if (y === 4 && (x === 1 || x === 2)) return '#ffffff';
      if (y === 4 && (x === 5 || x === 6)) return '#ffffff';
      if (y === 4 && (x === 2 || x === 5)) return '#3a4fc0';
      if (y === 6 && x >= 3 && x <= 4) return '#8a4a3a';
      return skinF(jit(x, y, 4, 0.1));
    });
    const tShirt = canvasTex(8, 12, (x, y) => `rgb(${sc.r * 255 * jit(x, y, 5, 0.16) | 0},${sc.g * 255 * jit(x, y, 5, 0.16) | 0},${sc.b * 255 * jit(x, y, 5, 0.16) | 0})`);
    const tArm = canvasTex(4, 12, (x, y) => {
      if (y < 5) return `rgb(${sc.r * 255 * jit(x, y, 6, 0.16) | 0},${sc.g * 255 * jit(x, y, 6, 0.16) | 0},${sc.b * 255 * jit(x, y, 6, 0.16) | 0})`;
      if (y === 5) return `rgb(${sc.r * 120 | 0},${sc.g * 120 | 0},${sc.b * 120 | 0})`;
      return skinF(jit(x, y, 7, 0.12));
    });
    const tLeg = canvasTex(4, 12, (x, y) => {
      const f = jit(x, y, 8, 0.14);
      if (y >= 10) return `rgb(${58 * f | 0},${58 * f | 0},${64 * f | 0})`;
      return `rgb(${sc.r * 255 * 0.42 * f | 0},${sc.g * 255 * 0.42 * f | 0},${sc.b * 255 * 0.42 * f | 0})`;
    });
    const L = (map) => new THREE.MeshLambertMaterial({ map });
    this.mats = [];
    const M = (t) => { const m = L(t); this.mats.push(m); return m; };
    const mSkin = M(tSkin), mHair = M(tHair), mFace = M(tFace);

    this.root = new THREE.Group();
    this.model = new THREE.Group(); this.model.scale.setScalar(0.9);
    this.root.add(this.model);
    const box = (w, h, d, mat, ox, oy, oz) => {
      const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat);
      m.position.set(ox, oy, oz); m.castShadow = true;
      return m;
    };
    this.upper = new THREE.Group(); this.upper.position.y = 0.75; this.model.add(this.upper);
    this.body = box(0.5, 0.75, 0.25, M(tShirt), 0, 0.375, 0); this.upper.add(this.body);
    this.headPivot = new THREE.Group(); this.headPivot.position.y = 0.75; this.upper.add(this.headPivot);
    this.head = box(0.5, 0.5, 0.5, [mSkin, mSkin, mHair, mSkin, mFace, mHair], 0, 0.25, 0); this.headPivot.add(this.head);
    const armMat = M(tArm);
    this.armR = new THREE.Group(); this.armR.position.set(-0.375, 0.7, 0); this.armR.add(box(0.25, 0.75, 0.25, armMat, 0, -0.325, 0)); this.upper.add(this.armR);
    this.armL = new THREE.Group(); this.armL.position.set(0.375, 0.7, 0); this.armL.add(box(0.25, 0.75, 0.25, armMat, 0, -0.325, 0)); this.upper.add(this.armL);
    const legMat = M(tLeg);
    this.legR = new THREE.Group(); this.legR.position.set(-0.125, 0.75, 0); this.legR.add(box(0.25, 0.75, 0.25, legMat, 0, -0.375, 0)); this.model.add(this.legR);
    this.legL = new THREE.Group(); this.legL.position.set(0.125, 0.75, 0); this.legL.add(box(0.25, 0.75, 0.25, legMat, 0, -0.375, 0)); this.model.add(this.legL);

    // name tag
    const c = document.createElement('canvas'); c.width = 128; c.height = 64;
    const g = c.getContext('2d');
    g.fillStyle = 'rgba(8,10,18,0.78)'; g.beginPath(); g.roundRect(4, 6, 120, 52, 14); g.fill();
    g.lineWidth = 5; g.strokeStyle = info.color; g.stroke();
    g.fillStyle = '#fff'; g.font = 'bold 38px system-ui, sans-serif'; g.textAlign = 'center'; g.textBaseline = 'middle';
    g.fillText(info.name, 64, 33);
    const tagTex = new THREE.CanvasTexture(c); tagTex.colorSpace = THREE.SRGBColorSpace;
    this.tagMat = new THREE.SpriteMaterial({ map: tagTex, transparent: true, depthTest: false, depthWrite: false, fog: false, toneMapped: false });
    this.tag = new THREE.Sprite(this.tagMat);
    this.tag.scale.set(1.3, 0.65, 1); this.tag.position.y = 2.3; this.tag.renderOrder = 20;
    this.root.add(this.tag);

    this.object3d = this.root;
    this.root.userData.avatar = this;
    this.walkT = 0; this.walkAmp = 0; this.swingT = 1; this.wasSwinging = false;
    this.sneakA = 0; this.deadA = 0; this.hurtT = 0; this.heldKey = null; this.held = null;
    this.visible = true;
    this._setLayers(this.root);
    renderer.scene.add(this.root);
  }

  _setLayers(o) { o.traverse((c) => c.layers.set(LAYER_AVATAR(this.seat))); }

  setVisible(v) { this.visible = !!v; this.root.visible = this.visible; }

  _setHeld(key) {
    if (this.held) { this.armR.remove(this.held); this.held = null; }
    this.heldKey = key || null;
    if (!key) return;
    const obj = buildItemObject(key, this.r.atlas, this.r.matItem, 0.42);
    if (!obj.children.length) return;
    const sprite = !!obj.children[0].userData.isSprite;
    obj.position.set(0, -0.7, 0.2);
    if (sprite) { obj.children[0].scale.setScalar(0.62); obj.rotation.set(0.0, Math.PI / 2, 0.0); obj.rotation.z = 0; obj.position.set(0, -0.68, 0.2); obj.rotation.x = 0.0; obj.children[0].rotation.z = -Math.PI / 4; }
    else obj.rotation.set(0, 0.5, 0);
    obj.traverse((c) => { if (c.isMesh) c.castShadow = true; });
    this.armR.add(obj); this.held = obj;
    this._setLayers(obj);
  }

  /** state: { x, y, z (feet), yaw, pitch, moving, sneaking, swinging, heldItemKey, hurt, dead } */
  update(dt, s) {
    this.root.position.set(s.x, s.y, s.z);
    this.root.rotation.y = (s.yaw || 0) + Math.PI;
    this.headPivot.rotation.x = -(s.pitch || 0) * 0.9 - this.sneakA * 0.0;
    if ((s.heldItemKey || null) !== this.heldKey) this._setHeld(s.heldItemKey);

    this.walkAmp += ((s.moving ? 1 : 0) - this.walkAmp) * Math.min(1, dt * 10);
    this.walkT += dt * (s.sneaking ? 6 : 9) * (s.moving ? 1 : 0);
    const sw = Math.sin(this.walkT) * 0.75 * this.walkAmp;
    this.legR.rotation.x = sw; this.legL.rotation.x = -sw;
    this.armL.rotation.x = sw * 0.9;

    // swing (edge-triggered by `swinging`)
    if (s.swinging && !this.wasSwinging) this.swingT = 0;
    this.wasSwinging = !!s.swinging;
    if (this.swingT < 1) this.swingT = Math.min(1, this.swingT + dt * 3.6);
    const st = this.swingT < 1 ? Math.sin(Math.sqrt(this.swingT) * Math.PI) : 0;
    this.armR.rotation.x = -sw * 0.9 - st * 1.7 - (this.held ? 0.25 : 0);
    this.armR.rotation.z = st * 0.25;

    // sneak: lean the upper body, drop a little
    this.sneakA += ((s.sneaking ? 1 : 0) - this.sneakA) * Math.min(1, dt * 12);
    this.upper.rotation.x = this.sneakA * 0.42;
    this.model.position.y = -this.sneakA * 0.08;

    // hurt flash / death
    if (s.hurt) this.hurtT = 0.28;
    this.hurtT = Math.max(0, this.hurtT - dt);
    const e = this.hurtT > 0 ? 0.55 : 0;
    for (const m of this.mats) m.emissive.setRGB(e, 0, 0);
    this.deadA += ((s.dead ? 1 : 0) - this.deadA) * Math.min(1, dt * 6);
    this.model.rotation.z = this.deadA * Math.PI / 2;
    this.model.position.x = this.deadA * 0.5;
    this.model.position.y += this.deadA * 0.22;
    this.tag.position.y = 2.3 - this.deadA * 1.4;
  }

  tick() {}

  dispose() {
    this.r.scene.remove(this.root);
    this.r.avatars.delete(this);
    this.root.traverse((o) => { if (o.geometry) o.geometry.dispose(); });
    for (const m of this.mats) { m.map?.dispose(); m.dispose(); }
    this.tagMat.map.dispose(); this.tagMat.dispose();
  }
}
