// One player's view: camera, private overlays (highlight, crack, viewmodel, underwater / damage tint).
// Created by Renderer.createView(seatIndex). World, sky, particles and shadows are shared by all views.
import * as THREE from 'three';
import { LineSegments2 } from 'three/addons/lines/LineSegments2.js';
import { LineMaterial } from 'three/addons/lines/LineMaterial.js';
import { BLOCKS } from '../data/blocks.js';
import { buildItemObject } from './itemMesh.js';

export const LAYER_PRIVATE = (seat) => 1 + seat;   // highlight / crack of that seat (only its own camera sees them)
export const LAYER_AVATAR = (seat) => 8 + seat;    // that seat's avatar (every camera EXCEPT its own sees it)

const tmpC = new THREE.Color();

export class View {
  constructor(renderer, seatIndex) {
    this.r = renderer;
    this.seatIndex = seatIndex;
    this.active = false;
    this.rect = { x: 0, y: 0, w: 0, h: 0 };       // CSS px relative to the container
    this.camera = new THREE.PerspectiveCamera(75, 16 / 9, 0.06, 1200);
    this.camera.rotation.order = 'YXZ';
    this.camera.layers.set(0);
    this.camera.layers.enable(LAYER_PRIVATE(seatIndex));
    for (let s = 0; s < 4; s++) if (s !== seatIndex) this.camera.layers.enable(LAYER_AVATAR(s));
    this._pf = { fov: 0, aspect: 0 };

    // block highlight + crack overlay (private layer)
    this.lineMat = new LineMaterial({ color: 0x0b0b10, linewidth: 2.4, transparent: true, opacity: 0.85, depthTest: true });
    this.highlight = new LineSegments2(renderer.boxLineGeo, this.lineMat);
    this.highlight.visible = false; this.highlight.renderOrder = 5; this.highlight.frustumCulled = false;
    this.highlight.layers.set(LAYER_PRIVATE(seatIndex));
    renderer.scene.add(this.highlight);
    this.highlightPos = null;
    const crack = renderer.crackTexBase.clone();
    crack.needsUpdate = true; crack.repeat.set(0.1, 1);
    this.crackTex = crack;
    this.crackMat = new THREE.MeshBasicMaterial({ map: crack, transparent: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2, toneMapped: false, color: 0xffffff });
    this.crack = new THREE.Mesh(renderer.crackGeo, this.crackMat);
    this.crack.visible = false; this.crack.renderOrder = 4;
    this.crack.layers.set(LAYER_PRIVATE(seatIndex));
    renderer.scene.add(this.crack);

    // viewmodel (own scene so it never clips into walls; lit by its own lights that follow the ambience)
    this.viewScene = new THREE.Scene();
    this.viewCam = new THREE.PerspectiveCamera(60, 1, 0.02, 10);
    this.viewHemi = new THREE.HemisphereLight(0xffffff, 0x887766, 1.6);
    this.viewDir = new THREE.DirectionalLight(0xffffff, 2.2);
    this.viewDir.position.set(-0.6, 1.2, 0.8);
    this.viewScene.add(this.viewHemi, this.viewDir);
    this.hand = new THREE.Group();
    this.viewScene.add(this.hand);
    this.armObj = renderer.armProto.clone();
    this.heldKey = null; this.heldObj = null; this.heldMode = 'arm';
    this.swing = 1; this.equip = 1;
    this.torchGlow = 0;
    this.setHeldItem(null);

    // screen tints (DOM, placed inside this view's rect)
    const mk = (css) => {
      const d = document.createElement('div');
      d.style.cssText = 'position:absolute;pointer-events:none;opacity:0;display:none;' + css;
      renderer.container.appendChild(d);
      return d;
    };
    this.uwDiv = mk('background:radial-gradient(ellipse at center, rgba(24,84,190,0.42) 0%, rgba(8,44,130,0.7) 100%);transition:opacity .18s;');
    this.hurtDiv = mk('background:radial-gradient(ellipse at center, rgba(255,0,0,0.12) 20%, rgba(220,0,0,0.55) 100%);');
    this.underwater = false; this.uw = 0;
  }

  // ---- public per-view API (SPEC-PLATFORMS §3a)
  setFov(deg) { this.camera.fov = deg; this.camera.updateProjectionMatrix(); this._pf.fov = deg; }

  setHighlight(pos) {
    if (!pos) { this.highlight.visible = false; this.highlightPos = null; return; }
    const id = this.r.world.getBlock(pos.x, pos.y, pos.z);
    const [sx, sy, sz, oy] = this.r._blockBox(BLOCKS[id] || BLOCKS[1]);
    this.highlight.visible = true;
    this.highlight.position.set(Math.floor(pos.x) + 0.5, Math.floor(pos.y) + oy, Math.floor(pos.z) + 0.5);
    this.highlight.scale.set(sx + 0.006, sy + 0.006, sz + 0.006);
    this.highlightPos = pos;
  }

  setBreakProgress(pos, p) {
    if (!pos || !(p > 0)) { this.crack.visible = false; return; }
    const stage = Math.max(0, Math.min(9, Math.floor(p * 10)));
    this.crackTex.offset.x = stage * 0.1;
    const id = this.r.world.getBlock(pos.x, pos.y, pos.z);
    const [sx, sy, sz, oy] = this.r._blockBox(BLOCKS[id] || BLOCKS[1]);
    this.crack.position.set(Math.floor(pos.x) + 0.5, Math.floor(pos.y) + oy, Math.floor(pos.z) + 0.5);
    this.crack.scale.set(sx, sy, sz);
    this.crack.visible = true;
  }

  setHeldItem(key) {
    if (this.heldObj) { this.hand.remove(this.heldObj); this.heldObj = null; }
    this.heldKey = key || null;
    this.heldMode = 'arm';
    if (key) {
      const obj = buildItemObject(key, this.r.atlas, this.r.matHeld, 1);
      const isSprite = !!obj.children[0]?.userData.isSprite;
      if (obj.children.length) {
        this.heldObj = obj;
        this.heldMode = isSprite ? 'sprite' : 'block';
        obj.children[0].scale.setScalar(isSprite ? 0.42 : 0.27);
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

  // ---- renderer-facing
  setActive(on) {
    this.active = on;
    const d = on ? 'block' : 'none';
    this.uwDiv.style.display = d; this.hurtDiv.style.display = d;
    if (!on) { this.highlight.visible = false; this.crack.visible = false; }
  }

  layoutDom(rect) {
    this.rect = rect;
    for (const el of [this.uwDiv, this.hurtDiv]) {
      el.style.left = rect.x + 'px'; el.style.top = rect.y + 'px'; el.style.width = rect.w + 'px'; el.style.height = rect.h + 'px';
    }
  }

  /** keep the projection in sync with the rect aspect / fov (B sets camera.fov directly) */
  syncProjection(aspect) {
    const c = this.camera;
    if (this._pf.fov !== c.fov || this._pf.aspect !== aspect) {
      c.aspect = aspect; c.updateProjectionMatrix();
      this._pf.fov = c.fov; this._pf.aspect = aspect;
    }
    if (this.viewCam.aspect !== aspect) { this.viewCam.aspect = aspect; this.viewCam.updateProjectionMatrix(); }
  }

  updateLighting(st, lm, sun) {
    this.viewHemi.color.copy(st.hemiSky);
    this.viewHemi.groundColor.copy(st.hemiGround);
    this.viewHemi.color.lerp(tmpC.setRGB(1, 1, 1), 0.35);
    this.viewHemi.intensity = Math.max(1.05, st.hemiI * 1.3) * lm + this.torchGlow * 1.6;
    this.viewDir.color.copy(sun.color);
    this.viewDir.intensity = Math.max(0.8, sun.intensity * 0.7) + this.torchGlow * 1.2;
  }

  updateViewmodel(dt, time) {
    this.equip = Math.min(1, this.equip + dt * 5.5);
    if (this.swing < 1) this.swing = Math.min(1, this.swing + dt * 3.6);
    const ease = 1 - Math.pow(1 - this.equip, 3);
    const sw = this.swing;
    const s1 = Math.sin(Math.sqrt(sw) * Math.PI), s2 = Math.sin(sw * Math.PI), s3 = Math.sin(Math.sqrt(sw) * Math.PI * 2);
    const bob = Math.sin(time * 1.6) * 0.004;
    const h = this.hand;
    if (this.heldMode === 'arm') {
      h.position.set(0.36 - s1 * 0.26, -0.34 - (1 - ease) * 0.5 + bob + s3 * 0.1, -0.5 - s2 * 0.18);
      h.rotation.set(-0.1 - s1 * 0.9, 0.5 + s1 * 0.5, 0.0);
    } else if (this.heldMode === 'block') {
      h.position.set(0.44 - s1 * 0.32, -0.37 - (1 - ease) * 0.55 + bob + s3 * 0.12, -0.72 - s2 * 0.22);
      h.rotation.set(0.12 - s1 * 0.6, -0.78 + s1 * 0.55, 0.0 + s3 * 0.1);
    } else {
      h.position.set(0.36 - s1 * 0.3, -0.27 - (1 - ease) * 0.55 + bob + s3 * 0.14, -0.62 - s2 * 0.2);
      h.rotation.set(0.05 - s1 * 1.0, Math.PI + 0.6 - s1 * 0.45, 0.28 - s3 * 0.2);
    }
  }

  dispose() {
    this.r.scene.remove(this.highlight, this.crack);
    this.lineMat.dispose(); this.crackMat.dispose(); this.crackTex.dispose();
    this.uwDiv.remove(); this.hurtDiv.remove();
  }
}
