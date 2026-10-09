// Standalone engine showcase. No gameplay code: just World + Renderer.
import * as THREE from 'three';
import { World } from './world/World.js';
import { Renderer } from './render/Renderer.js';
import { BLOCKS, BLOCK_BY_KEY } from './data/blocks.js';
import { ITEMS, ALL_ITEM_KEYS } from './data/items.js';
import { InputHub } from './input/InputHub.js';
import { PLATFORMS, SEATS } from './platform.js';

const $ = (id) => document.getElementById(id);
const B = (k) => BLOCK_BY_KEY[k].id;

const world = new World();
const renderer = new Renderer($('view'), world);
const cam = new THREE.Object3D(); // seat-0 pose; copied onto the active view camera every frame
cam.rotation.order = 'YXZ';

// ------------------------------------------------------------------ build the sample island
function rnd(seed) { let s = seed; return () => ((s = (s * 1664525 + 1013904223) >>> 0) / 4294967296); }
const R = rnd(12345);

function buildIsland() {
  const set = (x, y, z, k) => world.setBlock(x, y, z, typeof k === 'number' ? k : B(k));
  const H = (x, z) => { // bumpy outline
    const a = Math.atan2(z, x);
    return 1 + Math.sin(a * 3 + 1) * 0.08 + Math.sin(a * 5 + 2) * 0.06;
  };
  const rTop = 9.5;
  for (let y = 0; y >= -12; y--) {
    const t = -y / 12;
    const r = rTop * Math.pow(1 - t, 0.62) + (y === 0 ? 0 : 0);
    for (let x = -11; x <= 11; x++) for (let z = -11; z <= 11; z++) {
      const d = Math.hypot(x * 0.95, z * 1.05) / H(x, z);
      if (d > r) continue;
      let k;
      if (y === 0) k = 'grass';
      else if (y >= -2) k = 'dirt';
      else {
        const roll = R();
        k = roll < 0.05 ? 'coal_ore' : roll < 0.08 ? 'iron_ore' : roll < 0.095 ? 'gold_ore' : roll < 0.105 ? 'diamond_ore' : roll < 0.2 ? 'cobblestone' : roll < 0.25 ? 'gravel' : 'stone';
        if (y < -8 && R() < 0.15) k = 'obsidian';
      }
      set(x, y, z, k);
    }
  }
  // hanging stalactites
  for (let i = 0; i < 14; i++) {
    const a = R() * Math.PI * 2, rr = R() * 5;
    const x = Math.round(Math.cos(a) * rr), z = Math.round(Math.sin(a) * rr);
    let y = -1;
    while (world.getBlock(x, y, z) !== 0 && y > -20) y--;
    const len = 1 + Math.floor(R() * 3);
    for (let k = 0; k < len; k++) set(x, y - k, z, R() < 0.5 ? 'stone' : 'cobblestone');
  }
  // sandy beach + pond
  const pond = { x: -3, z: 3, r: 2.4 };
  for (let x = -8; x <= 2; x++) for (let z = -2; z <= 8; z++) {
    const d = Math.hypot(x - pond.x, z - pond.z);
    if (d < pond.r) { set(x, 0, z, 'water'); set(x, -1, z, 'water'); set(x, -2, z, 'sand'); }
    else if (d < pond.r + 1.15 && world.getBlock(x, 0, z)) { set(x, 0, z, 'sand'); set(x, -1, z, 'sand'); }
  }
  // oak tree
  const tree = (x, z, h, log, leaf, r) => {
    for (let y = 1; y <= h; y++) set(x, y, z, log);
    for (let dx = -r; dx <= r; dx++) for (let dz = -r; dz <= r; dz++) for (let dy = h - 2; dy <= h + 2; dy++) {
      const d = Math.hypot(dx, dz, (dy - h) * 0.9);
      if (d <= r + 0.3 && !(dx === 0 && dz === 0 && dy <= h) && R() > 0.08) set(x + dx, dy, z + dz, leaf);
    }
    set(x, h + 3, z, leaf);
  };
  tree(4, -3, 5, 'oak_log', 'oak_leaves', 2);
  // spruce
  const spruce = (x, z) => {
    for (let y = 1; y <= 6; y++) set(x, y, z, 'spruce_log');
    for (let layer = 0; layer < 5; layer++) {
      const r = 3 - Math.floor(layer * 0.65);
      const y = 2 + layer;
      for (let dx = -r; dx <= r; dx++) for (let dz = -r; dz <= r; dz++) if (Math.abs(dx) + Math.abs(dz) <= r + 1 && !(dx === 0 && dz === 0 && y <= 6)) set(x + dx, y, z + dz, 'spruce_leaves');
    }
    set(x, 7, z, 'spruce_leaves');
  };
  spruce(-6, -4);
  // farm
  for (let x = -2; x <= 2; x++) for (let z = -6; z <= -4; z++) {
    set(x, 0, z, 'farmland');
    const stage = Math.min(3, x + 2 > 3 ? 3 : x + 2);
    set(x, 1, z, 'wheat_' + Math.min(3, Math.max(0, x + 1)));
  }
  set(3, 0, -5, 'water');
  set(0, 1, -7, 'oak_sapling'); set(1, 1, -7, 'oak_sapling');
  // the One Block centrepiece: stone-brick plinth + the block itself
  set(0, 1, 0, 'torch'); // beside
  // glass hut
  for (let x = 5; x <= 8; x++) for (let z = 1; z <= 4; z++) for (let y = 1; y <= 3; y++) {
    const edge = x === 5 || x === 8 || z === 1 || z === 4 || y === 3;
    if (edge) set(x, y, z, 'glass');
  }
  for (let x = 5; x <= 8; x++) for (let z = 1; z <= 4; z++) set(x, 0, z, 'oak_planks');
  set(5, 1, 2, 0); set(5, 2, 2, 0); // door
  set(7, 1, 3, 'bed'); set(6, 1, 3, 'bookshelf'); set(8, 1, 1, 'chest');
  set(6, 1, 1, 'torch'); set(7, 1, 4, 'torch');
  // workshop
  set(-1, 1, 3, 'crafting_table'); set(1, 1, 3, 'furnace'); set(2, 1, 3, 'lit_furnace'); set(0, 1, 3, 'chest');
  // glowing things
  set(-7, 1, 0, 'glowstone'); set(-7, 2, 0, 'glowstone'); set(-8, 1, 1, 'magma'); set(-7, 1, 1, 'amethyst');
  // torches around
  for (const [x, z] of [[2, 1], [-2, -1], [3, -6], [-5, 6]]) if (world.getBlock(x, 0, z)) set(x, 1, z, 'torch');
  // a little stone-brick tower to cast shadows
  for (let y = 1; y <= 4; y++) { set(-1, y, -2, 'stone_bricks'); set(-1, y, -3, 'stone_bricks'); }
  set(-1, 5, -2, 'torch');
  // the wool rainbow
  ['white_wool', 'red_wool', 'yellow_wool', 'green_wool', 'blue_wool', 'black_wool'].forEach((k, i) => set(2 + i, 1, 7, k));
}

function buildMuseum() {
  const set = (x, y, z, k) => world.setBlock(x, y, z, typeof k === 'number' ? k : B(k));
  // bridge
  for (let z = 8; z <= 11; z++) set(0, 0, z, 'oak_planks');
  // platform
  const cols = 14, spacing = 2, x0 = -13;
  const ids = [];
  for (const b of BLOCKS) if (b && b.id !== 0 && b.id !== 48) ids.push(b.id);
  const rows = Math.ceil(ids.length / cols);
  const z0 = 13;
  const xMax = x0 + cols * spacing + 1, zMax = z0 + rows * spacing + 1;
  for (let x = x0 - 1; x <= xMax; x++) for (let z = z0 - 2; z <= zMax; z++) {
    set(x, 0, z, 'stone_bricks'); set(x, -1, z, 'stone');
    if (x === x0 - 1 || x === xMax || z === z0 - 2 || z === zMax) set(x, 0, z, 'obsidian');
  }
  ids.forEach((id, i) => {
    const x = x0 + (i % cols) * spacing + 1, z = z0 + Math.floor(i / cols) * spacing;
    const b = BLOCKS[id];
    if (b.key === 'water') { set(x, 0, z, 'water'); return; }
    if (b.key.startsWith('wheat')) { set(x, 0, z, 'farmland'); set(x, 1, z, id); return; }
    if (b.key === 'oak_sapling') { set(x, 0, z, 'grass'); set(x, 1, z, id); return; }
    if (b.key === 'farmland') { set(x, 1, z, id); return; }
    set(x, 1, z, id);
  });
  // a bit of light on the museum
  for (let x = x0; x <= xMax - 1; x += 7) set(x, 1, z0 - 1, 'torch');
}

buildIsland();
buildMuseum();
// the One Block marker sits at 0,0,0 (grass already); make it obvious with a diamond ring? keep as grass per SPEC.

// ------------------------------------------------------------------ camera / fly controls
const home = () => { cam.position.set(14, 6.5, 15); yaw = 0.74; pitch = -0.2; };
let yaw = 0, pitch = 0;
home();
const keys = new Set();
let locked = false;
let speedMul = 1;
const view = $('view');
view.addEventListener('click', () => { if (!locked) view.requestPointerLock?.(); });
document.addEventListener('pointerlockchange', () => {
  locked = document.pointerLockElement === view;
  $('cross').style.display = locked ? 'block' : 'none';
  $('hint').style.opacity = locked ? '0' : '1';
});
document.addEventListener('mousemove', (e) => {
  if (!locked) return;
  yaw -= e.movementX * 0.0022;
  pitch -= e.movementY * 0.0022;
  pitch = Math.max(-1.55, Math.min(1.55, pitch));
});
addEventListener('keydown', (e) => { keys.add(e.code); if (['Space', 'ShiftLeft'].includes(e.code) && locked) e.preventDefault(); });
addEventListener('keyup', (e) => keys.delete(e.code));
addEventListener('wheel', (e) => { speedMul = Math.max(0.2, Math.min(6, speedMul * (e.deltaY < 0 ? 1.15 : 0.87))); }, { passive: true });

// block interaction (LMB hold = break with crack overlay, RMB = place held block)
let mouseDown = false, breakT = 0, breakPos = null;
addEventListener('mousedown', (e) => {
  if (!locked) return;
  if (e.button === 0) { mouseDown = true; renderer.swingHand(); }
  if (e.button === 2) {
    const hit = ray();
    renderer.swingHand();
    const key = $('held').value;
    if (hit && key && BLOCK_BY_KEY[key] && BLOCK_BY_KEY[key].placeable) {
      const n = hit.normal;
      world.setBlock(hit.x + n.x, hit.y + n.y, hit.z + n.z, B(key));
    }
  }
});
addEventListener('mouseup', (e) => { if (e.button === 0) { mouseDown = false; breakT = 0; renderer.setBreakProgress(null, 0); } });
addEventListener('contextmenu', (e) => e.preventDefault());
const dirv = new THREE.Vector3();
function ray() {
  cam.updateMatrixWorld(); cam.getWorldDirection(dirv);
  return world.raycast(cam.position, dirv, 7);
}

// ------------------------------------------------------------------ UI
const tSlider = $('time');
tSlider.addEventListener('input', () => { $('tlabel').textContent = (+tSlider.value).toFixed(3); });
$('phase').addEventListener('change', (e) => renderer.setPhaseAmbience(e.target.value));
$('quality').addEventListener('change', (e) => renderer.setQuality(e.target.value));
$('swing').addEventListener('click', () => renderer.swingHand());
$('hurt').addEventListener('click', () => renderer.setDamageFlash());
let uw = false;
$('uw').addEventListener('click', () => { uw = !uw; renderer.setUnderwater(uw); });
$('home').addEventListener('click', home);
let fxT = 0;
$('fx').addEventListener('click', () => {
  const p = new THREE.Vector3(); cam.updateMatrixWorld(); cam.getWorldDirection(dirv); p.copy(cam.position).addScaledVector(dirv, 3);
  for (const k of ['smoke', 'flame', 'hearts', 'crit', 'sparkle', 'poof']) {
    const a = ['smoke', 'flame', 'hearts', 'crit', 'sparkle', 'poof'].indexOf(k);
    renderer.spawnParticles(k, p.x + (a - 2.5) * 0.8, p.y, p.z);
  }
});
$('stress').addEventListener('click', () => {
  const ids = BLOCKS.filter((b) => b && b.id && b.shape === 'cube' && b.id !== 48 && b.render !== 'translucent').map((b) => b.id);
  const r = rnd(99);
  let n = 0;
  for (let x = -40; x < 40 && n < 3000; x++) for (let z = -40; z < -16 && n < 3000; z++) {
    const h = 2 + Math.floor((Math.sin(x * 0.2) + Math.cos(z * 0.23)) * 2 + 3);
    for (let y = 0; y < h; y++) { world.setBlock(x, y - 14, z, ids[Math.floor(r() * ids.length)]); n++; }
  }
  console.log('placed', n, 'blocks; total', world.countBlocks());
});

// held item dropdown
const held = $('held');
for (const k of ALL_ITEM_KEYS) {
  const o = document.createElement('option');
  o.value = k; o.textContent = ITEMS[k].name;
  held.appendChild(o);
}
held.value = 'diamond_pickaxe';
renderer.setHeldItem('diamond_pickaxe');
held.addEventListener('change', () => renderer.setHeldItem(held.value || null));

// icon strip
const strip = $('icons');
for (const k of ALL_ITEM_KEYS) {
  const img = new Image();
  img.src = renderer.getItemIcon(k);
  img.title = ITEMS[k].name;
  img.addEventListener('click', () => { held.value = k; renderer.setHeldItem(k); strip.querySelectorAll('.sel').forEach((n) => n.classList.remove('sel')); img.classList.add('sel'); });
  strip.appendChild(img);
}

// ------------------------------------------------------------------ split screen + input harness
let platformKey = 'computer';
let hub = new InputHub({ platform: PLATFORMS.computer, canvas: renderer.renderer.domElement, container: $('view'), settings: { sens: 1 } });
const seats = [0, 1, 2, 3].map((i) => ({ i, view: null, avatar: null, src: null, pos: new THREE.Vector3(), yaw: 0, pitch: 0, t: i * 1.7, walking: false }));
let nViews = 1;
function setViewCount(n) {
  nViews = n;
  for (const s of seats) if (s.i >= n && s.view) { s.avatar?.dispose(); s.avatar = null; s.view.dispose(); s.view = null; }
  if (n === 1 && !seats[0].src) { for (const s of seats) { s.avatar?.dispose(); s.avatar = null; s.view?.dispose(); s.view = null; } renderer.setViews([]); renderer.setPlatform(platformKey); return; }
  for (let i = 0; i < n; i++) {
    const s = seats[i];
    if (!s.view) { s.view = renderer.createView(i); s.view.setHeldItem(['diamond_pickaxe', 'iron_sword', 'torch', 'bread'][i]); }
    if (!s.avatar) s.avatar = renderer.createPlayerAvatar(i);
    s.avatar.setVisible(true);
    if (i > 0) { s.pos.set(Math.cos(s.t) * (5 + i), 2.6, Math.sin(s.t) * (5 + i)); }
  }
  renderer.setPlatform(platformKey);
  renderer.setViews(seats.slice(0, n).map((s) => s.view));
}
$('views').addEventListener('change', (e) => setViewCount(+e.target.value));
$('platform').addEventListener('change', (e) => {
  platformKey = e.target.value;
  hub.dispose();
  hub = new InputHub({ platform: PLATFORMS[platformKey], canvas: renderer.renderer.domElement, container: $('view'), settings: { sens: 1 } });
  renderer.setPlatform(platformKey); renderer.setSafeArea(PLATFORMS[platformKey].safeArea);
  for (const s of seats) s.src = null;
  if (hub.touch) $('hint').textContent = 'iPad mode: left thumb = move, drag = look, buttons bottom-right';
});
function seatFly(s, dt) {
  const src = s.src; const m = src.move(), l = src.look();
  s.yaw += l.dyaw; s.pitch = Math.max(-1.5, Math.min(1.5, s.pitch + l.dpitch));
  const sp = (m.sprint ? 12 : 6) * dt;
  s.pos.x += (-Math.sin(s.yaw) * m.f + Math.cos(s.yaw) * m.r) * sp;
  s.pos.z += (-Math.cos(s.yaw) * m.f - Math.sin(s.yaw) * m.r) * sp;
  s.pos.y += ((m.jump ? 1 : 0) - (m.sneak ? 1 : 0)) * sp;
  s.walking = Math.hypot(m.f, m.r) > 0.1;
  for (const a of ['primary', 'secondary', 'jump', 'inventory', 'pause', 'drop', 'goals', 'hotbarNext', 'hotbarPrev']) if (src.pressed(a)) { s.last = a; if (a === 'primary') s.view?.swingHand(); }
}
function updateSeats(dt) {
  hub.poll(dt);
  for (const p of hub.unassignedJoinPresses()) {
    const free = seats.find((s) => !s.src && (s.i > 0 || hub.gamepads.length));
    if (free) { free.src = p; hub.assign(p, free.i); if (nViews < free.i + 1) { $('views').value = free.i + 1; setViewCount(free.i + 1); } }
  }
  if (hub.touch && !seats[0].src) seats[0].src = hub.touch;
  const info = [];
  for (const s of seats) if (s.src) info.push(`P${s.i + 1}:${s.src.kind}`);
  $('pads').textContent = `${hub.gamepads.length} pad(s) · ${info.join(' ') || 'no seats'} · ${hub.gamepads[0] ? hub.gamepads[0].glyph('primary') : ''}`;
  if (nViews < 2 && !(seats[0].src)) return;
  for (const s of seats) {
    if (s.i >= nViews || !s.view) continue;
    if (s.i === 0 && !s.src) { s.pos.copy(cam.position); s.yaw = yaw; s.pitch = pitch; s.walking = keys.has('KeyW'); }
    else if (s.src) { if (s.i === 0 && !s.fresh) { s.pos.copy(cam.position); s.yaw = yaw; s.pitch = pitch; s.fresh = true; } seatFly(s, dt); if (s.i === 0) { cam.position.copy(s.pos); yaw = s.yaw; pitch = s.pitch; } }
    else { s.t += dt * 0.25; s.pos.set(Math.cos(s.t) * (5 + s.i), 2.6 + Math.sin(s.t * 2) * 0.3, Math.sin(s.t) * (5 + s.i)); s.yaw = -s.t - Math.PI / 2 + Math.PI; s.pitch = -0.1; s.walking = true; }
    const v = s.view;
    v.camera.position.copy(s.pos); v.camera.rotation.set(s.pitch, s.yaw, 0, 'YXZ');
    s.avatar.update(dt, { x: s.pos.x, y: s.pos.y - 1.62, z: s.pos.z, yaw: s.yaw, pitch: s.pitch, moving: s.walking, sneaking: false, swinging: false, heldItemKey: ['diamond_pickaxe', 'iron_sword', 'torch', 'bread'][s.i], hurt: false, dead: false });
  }
}

// ------------------------------------------------------------------ main loop
let last = performance.now(), frames = 0, acc = 0, fpsMin = 999;
const move = new THREE.Vector3();
function frame(now) {
  requestAnimationFrame(frame);
  const dt = Math.min(0.1, (now - last) / 1000);
  last = now;

  // fly
  cam.rotation.set(pitch, yaw, 0, 'YXZ');
  if (nViews < 2 && !hub.touch && !seats[0].src) { const vc = renderer.views[0].camera; vc.position.copy(cam.position); vc.rotation.copy(cam.rotation); }
  const fast = keys.has('ControlLeft') || keys.has('ControlRight') ? 3 : 1;
  const v = 7 * speedMul * fast * dt;
  move.set(0, 0, 0);
  if (keys.has('KeyW')) move.z -= 1;
  if (keys.has('KeyS')) move.z += 1;
  if (keys.has('KeyA')) move.x -= 1;
  if (keys.has('KeyD')) move.x += 1;
  if (move.lengthSq()) {
    move.normalize().applyEuler(new THREE.Euler(0, yaw, 0));
    cam.position.addScaledVector(move, v);
  }
  if (keys.has('Space')) cam.position.y += v;
  if (keys.has('ShiftLeft') || keys.has('ShiftRight')) cam.position.y -= v;

  updateSeats(dt);
  if (nViews < 2 && (hub.touch || seats[0].src)) { const vc = renderer.views[0].camera; vc.position.copy(cam.position); vc.rotation.set(pitch, yaw, 0, 'YXZ'); }
  // time
  if ($('play').checked) {
    tSlider.value = ((+tSlider.value + dt / 40) % 1).toFixed(4);
    $('tlabel').textContent = (+tSlider.value).toFixed(3);
  }
  renderer.setTimeOfDay(+tSlider.value);

  // targeting
  const hit = ray();
  if (hit) renderer.setHighlight(hit); else renderer.setHighlight(null);
  if (mouseDown && hit) {
    if (!breakPos || breakPos.x !== hit.x || breakPos.y !== hit.y || breakPos.z !== hit.z) { breakPos = { x: hit.x, y: hit.y, z: hit.z }; breakT = 0; }
    breakT += dt / 0.55;
    renderer.setBreakProgress(breakPos, breakT);
    if (breakT >= 1) {
      renderer.spawnBlockParticles(hit.x, hit.y, hit.z, hit.id);
      world.setBlock(hit.x, hit.y, hit.z, 0);
      breakT = 0; renderer.setBreakProgress(null, 0); breakPos = null;
    }
  }

  // underwater auto-detect (also lets the toggle force it)
  const inWater = world.getBlock(cam.position.x, cam.position.y, cam.position.z) === B('water');
  if (inWater !== renderer._autoUW) { renderer._autoUW = inWater; if (!uw) renderer.setUnderwater(inWater); }

  renderer.render(dt);

  frames++; acc += dt; fpsMin = Math.min(fpsMin, 1 / Math.max(dt, 1e-4));
  if (acc >= 0.5) {
    const s = renderer.stats;
    $('fps').textContent = `${Math.round(frames / acc)} fps\n${s.calls} calls · ${(s.triangles / 1000).toFixed(0)}k tris\n${world.countBlocks()} blocks · ${s.chunks} chunks`;
    frames = 0; acc = 0; fpsMin = 999;
  }
}
requestAnimationFrame(frame);

window.__demo = { world, renderer, THREE, seats, updateSeats, get hub() { return hub; }, setViewCount, get cam() { return cam; }, setView(x, y, z, yw, pt) { cam.position.set(x, y, z); yaw = yw; pitch = pt; }, home };
