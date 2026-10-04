// Run: node src/game/__tests__/sim.test.mjs   (uses the real World from Builder A; no DOM/three needed)
import assert from 'node:assert/strict';
import { World } from '../../world/World.js';
import { BLOCK_BY_KEY } from '../../data/blocks.js';
import { Player } from '../Player.js';
import { Inventory, makeStack } from '../Inventory.js';
import { newFurnace, tickFurnace, serializeEntities, deserializeEntities, newChest } from '../BlockEntities.js';
import { Growth } from '../Growth.js';
import { Events } from '../Events.js';

let pass = 0;
const t = (n, f) => { f(); pass++; console.log('ok  -', n); };
const B = (k) => BLOCK_BY_KEY[k].id;
const none = { f: 0, r: 0, jump: false, sneak: false, sprint: false };
function run(p, w, secs, input, ev = {}) { for (let i = 0; i < secs * 60; i++) p.update(1 / 60, typeof input === 'function' ? input(i) : input, w, ev); }

t('player stands on the one block, jump height ~1.25', () => {
  const w = new World(); w.setBlock(0, 0, 0, B('grass'));
  const p = new Player(); p.reset(0.5, 1, 0.5);
  run(p, w, 1, none);
  assert.ok(Math.abs(p.y - 1) < 0.01 && p.onGround, `y=${p.y}`);
  let maxY = 1;
  for (let i = 0; i < 90; i++) { p.update(1 / 60, { ...none, jump: i === 0 }, w, {}); maxY = Math.max(maxY, p.y); }
  assert.ok(maxY - 1 > 1.15 && maxY - 1 < 1.4, `jump ${maxY - 1}`);
});

t('sneak prevents falling off the edge; walking off kills via void', () => {
  const w = new World(); w.setBlock(0, 0, 0, B('grass'));
  const p = new Player(); p.reset(0.5, 1, 0.5);
  run(p, w, 4, { ...none, f: 1, sneak: true }); // yaw 0 => walks toward -z
  assert.ok(p.onGround && p.y > 0.99, `y=${p.y} z=${p.z}`);
  assert.ok(p.z > -0.31 && p.z < 0.5, `z=${p.z}`);
  let died = null, falls = 0;
  const p2 = new Player(); p2.reset(0.5, 1, 0.5);
  run(p2, w, 8, { ...none, f: 1 }, { die: (c) => { died = c; }, hurt: () => {} });
  assert.ok(p2.y < -39 || died, `y=${p2.y}`);
  assert.equal(died, 'You fell out of the world'); void falls;
});

t('fall damage max(0, d-3), none into water', () => {
  const w = new World(); w.setBlock(0, 0, 0, B('stone'));
  let dmg = 0;
  const p = new Player(); p.reset(0.5, 11, 0.5); // 10 block fall
  run(p, w, 2, none, { hurt: (a) => { dmg = a; } });
  assert.equal(dmg, 7); assert.equal(p.health, 13);
  const w2 = new World(); w2.setBlock(0, 0, 0, B('stone')); w2.setBlock(0, 1, 0, B('water')); w2.setBlock(0, 2, 0, B('water'));
  const p2 = new Player(); p2.reset(0.5, 12, 0.5);
  run(p2, w2, 3, none, { hurt: () => assert.fail('no damage in water') });
  assert.equal(p2.health, 20);
});

t('hunger: regen at >=18, starve to 1 HP', () => {
  const w = new World(); w.setBlock(0, 0, 0, B('stone'));
  const p = new Player(); p.reset(0.5, 1, 0.5); p.health = 10;
  run(p, w, 8.5, none); assert.equal(p.health, 12);
  const q = new Player(); q.reset(0.5, 1, 0.5); q.hunger = 0; q.saturation = 0;
  run(q, w, 120, none, { hurt: () => {}, die: () => assert.fail('must not starve to death') });
  assert.equal(q.health, 1);
});

t('furnace: 10 s per smelt, fuel burn time, lit flag, keeps going', () => {
  const f = newFurnace();
  f.input = makeStack('iron_ore', 3); f.fuel = makeStack('coal', 1);
  let lit = null;
  for (let i = 0; i < 100 * 60; i++) { const c = tickFurnace(f, 1 / 60); if (c) lit = f.burn > 0; if (i === 10 * 60 + 5) assert.equal(f.output.n, 1); }
  assert.equal(f.output.key, 'iron_ingot'); assert.equal(f.output.n, 3);
  assert.equal(f.input, null); assert.equal(f.fuel, null); assert.equal(lit, false);
  const g = newFurnace(); g.input = makeStack('iron_ore', 1); // no fuel -> nothing
  for (let i = 0; i < 20 * 60; i++) tickFurnace(g, 1 / 60);
  assert.equal(g.output, null);
  const h = newFurnace(); h.input = makeStack('raw_mutton', 2); h.fuel = makeStack('oak_planks', 2); h.output = makeStack('iron_ingot', 1);
  for (let i = 0; i < 30 * 60; i++) tickFurnace(h, 1 / 60); // output blocked by different item
  assert.equal(h.input.n, 2);
  // serialize round trip
  const m = new Map([['1,2,3', f], ['0,0,0', newChest([{ key: 'diamond', n: 2 }])]]);
  const back = deserializeEntities(JSON.parse(JSON.stringify(serializeEntities(m))));
  assert.equal(back.get('1,2,3').output.n, 3); assert.equal(back.get('0,0,0').slots[0].key, 'diamond');
});

t('sapling grows into a tree; crops advance; farmland reverts', () => {
  const w = new World();
  for (let x = -3; x <= 3; x++) for (let z = -3; z <= 3; z++) w.setBlock(x, 0, z, B('grass'));
  const ev = new Events(); let grown = 0; ev.on('grow', () => grown++);
  const game = { world: w, player: { x: 20, y: 5, z: 20 }, events: ev };
  const gr = new Growth(game);
  w.onChange((x, y, z, o, n) => gr.track(x, y, z, o, n));
  w.setBlock(0, 1, 0, B('oak_sapling'));
  for (let i = 0; i < 160 * 60 && !grown; i++) gr.update(1 / 60);
  assert.equal(grown, 1);
  assert.equal(w.getBlock(0, 1, 0), B('oak_log')); assert.equal(w.getBlock(0, 4, 0), B('oak_log'));
  let leaves = 0; w.forEachBlock((x, y, z, id) => { if (id === B('oak_leaves')) leaves++; });
  assert.ok(leaves > 15, 'leaves ' + leaves);
  // crops
  w.setBlock(3, 0, 3, B('farmland')); w.setBlock(3, 1, 3, B('wheat_0')); w.setBlock(2, 0, 3, B('water'));
  for (let i = 0; i < 400 * 60 && w.getBlock(3, 1, 3) !== B('wheat_3'); i++) gr.update(1 / 60);
  assert.equal(w.getBlock(3, 1, 3), B('wheat_3'));
  // bare farmland with no water reverts to dirt
  w.setBlock(-3, 0, -3, B('farmland'));
  for (let i = 0; i < 400 * 60 && w.getBlock(-3, 0, -3) === B('farmland'); i++) gr.update(1 / 60);
  assert.equal(w.getBlock(-3, 0, -3), B('dirt'));
  // torches registry
  w.setBlock(1, 1, 1, B('torch'));
  assert.ok(gr.nearTorch(5, 1, 5, 7)); assert.ok(!gr.nearTorch(10, 1, 10, 7));
  w.setBlock(1, 1, 1, 0); assert.ok(!gr.nearTorch(1, 1, 1, 7));
});

console.log(`\n${pass} sim tests passed`);
