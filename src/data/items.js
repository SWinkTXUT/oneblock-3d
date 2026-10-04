// SHARED CONTRACT — owned by the lead. Builders may ADD items only with a note in HANDOFF.md.
//
// Every block in blocks.js is automatically also an item (same key) unless placeable === false
// AND it never drops as itself. Non-block items are listed here.
//
// Fields:
//   key, name
//   stack       max stack size (tools/armor = 1)
//   kind        'material' | 'tool' | 'armor' | 'food' | 'placer' | 'block'
//   tool        { type: 'pickaxe'|'axe'|'shovel'|'hoe'|'sword'|'shears', tier: 1..4, speed, damage, durability }
//   armor       { slot: 'head'|'chest'|'legs'|'feet', points, durability, material }
//   food        { hunger, saturation }  (hunger in half-drumsticks, max 20)
//   places      block key this item places (seeds -> wheat_0, water_bucket -> water)
//   fuel        seconds of furnace burn time (one smelt = 10 s)
//   icon        texture key textures.js must draw as an item icon (defaults to key)

import { BLOCKS } from './blocks.js';

export const ITEMS = {};

function it(key, name, props = {}) {
  ITEMS[key] = { key, name, stack: 64, kind: 'material', icon: key, ...props };
  return ITEMS[key];
}

// --- Blocks as items ---
for (const blk of BLOCKS) {
  if (!blk || blk.id === 0) continue;
  if (!blk.placeable) continue;
  it(blk.key, blk.name, { kind: 'block', places: blk.key });
}

// --- Tools ---
// Tier: 1 wood, 2 stone, 3 iron, 4 diamond. speed = mining multiplier on the matching block type.
const TIERS = [
  { tier: 1, mat: 'wooden', label: 'Wooden', speed: 2, durability: 60, dmg: 0 },
  { tier: 2, mat: 'stone', label: 'Stone', speed: 4, durability: 132, dmg: 1 },
  { tier: 3, mat: 'iron', label: 'Iron', speed: 6, durability: 251, dmg: 2 },
  { tier: 4, mat: 'diamond', label: 'Diamond', speed: 8, durability: 1562, dmg: 3 },
];
const TOOL_TYPES = [
  { type: 'pickaxe', label: 'Pickaxe', baseDmg: 2 },
  { type: 'axe', label: 'Axe', baseDmg: 3 },
  { type: 'shovel', label: 'Shovel', baseDmg: 1.5 },
  { type: 'hoe', label: 'Hoe', baseDmg: 1 },
  { type: 'sword', label: 'Sword', baseDmg: 4 },
];
for (const t of TIERS) {
  for (const tt of TOOL_TYPES) {
    it(`${t.mat}_${tt.type}`, `${t.label} ${tt.label}`, {
      stack: 1, kind: 'tool',
      tool: { type: tt.type, tier: t.tier, speed: t.speed, damage: tt.baseDmg + t.dmg, durability: t.durability },
      fuel: t.tier === 1 ? 10 : undefined,
    });
  }
}
it('shears', 'Shears', { stack: 1, kind: 'tool', tool: { type: 'shears', tier: 3, speed: 5, damage: 1, durability: 238 } });

// --- Armor ---
const ARMOR = [
  { mat: 'leather', label: 'Leather', pts: { head: 1, chest: 3, legs: 2, feet: 1 }, dur: 80 },
  { mat: 'iron', label: 'Iron', pts: { head: 2, chest: 6, legs: 5, feet: 2 }, dur: 200 },
  { mat: 'diamond', label: 'Diamond', pts: { head: 3, chest: 8, legs: 6, feet: 3 }, dur: 450 },
];
const ARMOR_PIECES = [
  { slot: 'head', key: 'helmet', label: 'Helmet' },
  { slot: 'chest', key: 'chestplate', label: 'Chestplate' },
  { slot: 'legs', key: 'leggings', label: 'Leggings' },
  { slot: 'feet', key: 'boots', label: 'Boots' },
];
for (const a of ARMOR) {
  for (const p of ARMOR_PIECES) {
    it(`${a.mat}_${p.key}`, `${a.label} ${p.label}`, {
      stack: 1, kind: 'armor', armor: { slot: p.slot, points: a.pts[p.slot], durability: a.dur, material: a.mat },
    });
  }
}

// --- Food ---
it('raw_mutton', 'Raw Mutton', { kind: 'food', food: { hunger: 2, saturation: 1.2 } });
it('cooked_mutton', 'Cooked Mutton', { kind: 'food', food: { hunger: 6, saturation: 9.6 } });
it('bread', 'Bread', { kind: 'food', food: { hunger: 5, saturation: 6 } });
it('apple', 'Apple', { kind: 'food', food: { hunger: 4, saturation: 2.4 } });
it('rotten_flesh', 'Rotten Flesh', { kind: 'food', food: { hunger: 4, saturation: 0.8, poisonChance: 0.8 } });
it('carrot', 'Carrot', { kind: 'food', food: { hunger: 3, saturation: 3.6 } });

// --- Materials ---
it('stick', 'Stick', { fuel: 5 });
it('coal', 'Coal', { fuel: 80 });
it('charcoal', 'Charcoal', { fuel: 80 });
it('iron_ingot', 'Iron Ingot');
it('gold_ingot', 'Gold Ingot');
it('diamond', 'Diamond');
it('flint', 'Flint');
it('leather', 'Leather');
it('wheat', 'Wheat');
it('snowball', 'Snowball', { stack: 16 });
it('clay_ball', 'Clay Ball');
it('brick', 'Brick');
it('glowstone_dust', 'Glowstone Dust');
it('quartz', 'Nether Quartz');
it('string', 'String');

// --- Placers ---
it('wheat_seeds', 'Wheat Seeds', { kind: 'placer', places: 'wheat_0' }); // only onto farmland
it('bucket', 'Bucket', { stack: 16 });
it('water_bucket', 'Water Bucket', { stack: 1, kind: 'placer', places: 'water' });

// Fuel values for block items
for (const k of ['oak_log', 'spruce_log', 'oak_planks', 'spruce_planks', 'crafting_table', 'chest', 'bookshelf', 'oak_sapling'])
  if (ITEMS[k]) ITEMS[k].fuel = k.endsWith('sapling') ? 5 : 15;
if (ITEMS.coal_block) ITEMS.coal_block.fuel = 800;

export const itemByKey = (key) => ITEMS[key];
export const ALL_ITEM_KEYS = Object.keys(ITEMS);
