// Run: node src/game/__tests__/logic.test.mjs
import assert from 'node:assert/strict';
import { ITEMS } from '../../data/items.js';
import { BLOCK_BY_KEY } from '../../data/blocks.js';
import { RECIPES, SMELTING, missingFor, craftOnce, craftMax, maxCrafts } from '../../data/recipes.js';
import { PHASES, phaseIndexFor, phaseInfo, makeForcedPlan, rollNext, rollLoot, cycleOf, CYCLE_LENGTH, FORCED_POOL } from '../../data/phases.js';
import { Inventory, makeStack } from '../Inventory.js';
import { breakInfo, rollDrops, materialOf } from '../rules.js';
import { encode, decode } from '../Save.js';

let pass = 0;
const t = (name, fn) => { fn(); pass++; console.log('ok  -', name); };
const B = (k) => BLOCK_BY_KEY[k].id;

t('all recipe ins/outs are real items', () => {
  for (const r of RECIPES) {
    assert.ok(ITEMS[r.out], 'out ' + r.out);
    for (const k of Object.keys(r.in)) assert.ok(k.startsWith('#') || ITEMS[k], 'in ' + k);
  }
  for (const [a, b] of Object.entries(SMELTING)) assert.ok(ITEMS[a] && ITEMS[b], a + '->' + b);
});

t('inventory add/remove/stacking', () => {
  const inv = new Inventory();
  assert.equal(inv.add('oak_log', 70), 0);
  assert.equal(inv.slots[0].n, 64); assert.equal(inv.slots[1].n, 6);
  assert.equal(inv.count('oak_log'), 70);
  assert.equal(inv.remove('oak_log', 66), 66);
  assert.equal(inv.count('oak_log'), 4);
  assert.equal(inv.add('wooden_pickaxe', 1), 0);
  assert.equal(inv.slots.find((s) => s && s.key === 'wooden_pickaxe').dur, 60);
  assert.equal(inv.add('snowball', 20), 0); // stack 16
  assert.equal(inv.count('snowball'), 20);
  const full = new Inventory();
  for (let i = 0; i < 36; i++) full.slots[i] = makeStack('stone', 64);
  assert.equal(full.add('stone', 5), 5);
  assert.equal(full.add('dirt', 1), 1);
  const rt = new Inventory().deserialize(JSON.parse(JSON.stringify(inv.serialize())));
  assert.deepEqual(rt.slots, inv.slots);
});

t('craftability + crafting flow from nothing', () => {
  const inv = new Inventory();
  const rec = (o) => RECIPES.find((r) => r.out === o);
  assert.deepEqual(missingFor(rec('oak_planks'), inv), { oak_log: 1 });
  inv.add('oak_log', 3);
  assert.equal(craftOnce(rec('oak_planks'), inv), true);
  assert.equal(inv.count('oak_planks'), 4);
  assert.equal(craftMax(rec('oak_planks'), inv), 2);
  assert.equal(inv.count('oak_planks'), 12);
  assert.equal(craftOnce(rec('stick'), inv), true);
  assert.equal(craftOnce(rec('crafting_table'), inv), true);
  assert.equal(craftOnce(rec('wooden_pickaxe'), inv), true);
  assert.equal(inv.count('stick'), 2);
  assert.equal(craftOnce(rec('wooden_pickaxe'), inv), true); // 3 planks + 2 sticks left
  assert.equal(craftOnce(rec('wooden_pickaxe'), inv), false); // none left
  // groups: mixed planks
  const g = new Inventory(); g.add('oak_planks', 2); g.add('spruce_planks', 2);
  assert.equal(craftOnce(rec('crafting_table'), g), true);
  assert.equal(g.count('oak_planks') + g.count('spruce_planks'), 0);
  assert.equal(maxCrafts(rec('bed'), (() => { const i = new Inventory(); i.add('red_wool', 3); i.add('white_wool', 3); i.add('oak_planks', 6); return i; })()), 2);
  // output room
  const full = new Inventory();
  for (let i = 0; i < 36; i++) full.slots[i] = makeStack('stone', 64);
  full.slots[0] = makeStack('oak_log', 1);
  assert.equal(craftOnce(rec('oak_planks'), full), true); // frees slot 0
});

t('mining-time formula', () => {
  const near = (a, b) => assert.ok(Math.abs(a - b) < 1e-9, `${a} vs ${b}`);
  near(breakInfo(B('dirt'), null).time, 0.5 * 1.5);
  near(breakInfo(B('stone'), null).time, 1.5 * 5); // can't harvest by hand
  assert.equal(breakInfo(B('stone'), null).canHarvest, false);
  near(breakInfo(B('stone'), 'wooden_pickaxe').time, 1.5 * 1.5 / 2);
  assert.equal(breakInfo(B('iron_ore'), 'wooden_pickaxe').canHarvest, false);
  assert.equal(breakInfo(B('iron_ore'), 'stone_pickaxe').canHarvest, true);
  assert.equal(breakInfo(B('diamond_ore'), 'stone_pickaxe').canHarvest, false);
  assert.equal(breakInfo(B('diamond_ore'), 'iron_pickaxe').canHarvest, true);
  assert.equal(breakInfo(B('obsidian'), 'iron_pickaxe').canHarvest, false);
  near(breakInfo(B('obsidian'), 'diamond_pickaxe').time, 15 * 1.5 / 8);
  near(breakInfo(B('oak_log'), null).time, 3); // hand on log: harvestable (minTier 0)
  assert.equal(breakInfo(B('torch'), null).time, 0);
  assert.equal(breakInfo(B('water'), null).time, Infinity);
  assert.deepEqual(rollDrops(B('stone'), false), []);
  assert.deepEqual(rollDrops(B('stone'), true), [{ key: 'cobblestone', n: 1 }]);
  assert.deepEqual(rollDrops(B('glass'), true), []);
  assert.equal(materialOf('oak_planks'), 'wood');
});

const seeded = (s) => () => ((s = (s * 1664525 + 1013904223) >>> 0) / 4294967296);

t('phase rolling & forced early sequence', () => {
  assert.equal(phaseIndexFor(0), 0); assert.equal(phaseIndexFor(99), 0); assert.equal(phaseIndexFor(100), 1);
  assert.equal(phaseIndexFor(999), 5); assert.equal(phaseIndexFor(1000), 6); assert.equal(phaseIndexFor(1299), 6);
  assert.equal(phaseIndexFor(1300), 0); assert.equal(cycleOf(1300), 2); assert.equal(cycleOf(1299), 1);
  assert.equal(phaseInfo(400).phase.key, 'desert');
  for (let s = 1; s < 50; s++) {
    const rng = seeded(s);
    const plan = makeForcedPlan(rng);
    assert.equal(plan.length, 4);
    assert.ok(plan.filter((k) => k === 'oak_log').length >= 2);
    for (const k of plan) assert.ok(FORCED_POOL.includes(k));
    for (let n = 1; n <= 4; n++) assert.equal(rollNext(n, plan, rng).block, plan[n - 1]);
  }
  assert.equal(rollNext(0, null).block, 'oak_log');
  // distribution sanity per phase: only keys from the phase table (or chest), every key is a block
  for (let p = 0; p < PHASES.length; p++) {
    const rng = seeded(7 + p); let chests = 0;
    const N = 6000;
    for (let i = 0; i < N; i++) {
      const r = rollNext(PHASES[p].at + 10, null, rng);
      if (r.chest) { chests++; continue; }
      assert.ok(r.block in PHASES[p].blocks, r.block);
      assert.ok(BLOCK_BY_KEY[r.block]);
    }
    assert.ok(chests / N > 0.02 && chests / N < 0.05, `chest rate ${chests / N}`);
    for (let i = 0; i < 100; i++) {
      const loot = rollLoot(p, rng);
      assert.ok(loot.length >= 3 && loot.length <= 5);
      for (const l of loot) assert.ok(ITEMS[l.key] && l.n >= 1);
    }
  }
  assert.ok(CYCLE_LENGTH === 1300);
});

t('early game is completable: materials reachable', () => {
  // every ingredient of progression recipes obtainable from phase blocks / drops / smelting
  const obtainable = new Set();
  for (const p of PHASES) {
    for (const bk of Object.keys(p.blocks)) { obtainable.add(bk); for (const d of BLOCK_BY_KEY[bk].drops) obtainable.add(d.item); }
    for (const l of p.loot) obtainable.add(l.item);
  }
  for (const [a, b] of Object.entries(SMELTING)) if (obtainable.has(a)) obtainable.add(b);
  obtainable.add('rotten_flesh'); obtainable.add('raw_mutton'); obtainable.add('wheat'); obtainable.add('leather'); obtainable.add('stick');
  for (const r of RECIPES) for (const k of Object.keys(r.in)) {
    if (k.startsWith('#')) continue;
    // recipe outputs themselves are craftable
    if (!obtainable.has(k) && !RECIPES.some((x) => x.out === k)) assert.fail('unobtainable ingredient ' + k + ' for ' + r.out);
  }
});

t('save round-trip', () => {
  const data = { world: { c: [1, 2, 3] }, inv: new Inventory().deserialize({ slots: [['oak_log', 5, -1], 0, ['wooden_pickaxe', 1, 33]], armor: [['iron_helmet', 1, 100]] }).serialize(), state: { blocksBroken: 12, forced: ['oak_log'] } };
  const out = decode(encode(data));
  assert.deepEqual(out.world, data.world);
  assert.deepEqual(out.inv, data.inv);
  assert.equal(out.state.blocksBroken, 12);
  assert.equal(decode('garbage'), null);
  assert.equal(decode(JSON.stringify({ v: 99, world: {} })), null);
  const inv2 = new Inventory().deserialize(out.inv);
  assert.equal(inv2.slots[2].dur, 33); assert.equal(inv2.armor[0].key, 'iron_helmet');
});

console.log(`\n${pass} tests passed`);
