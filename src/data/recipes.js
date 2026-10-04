// Recipes (SPEC §8). `in` keys starting with '#' are ingredient groups (any member counts).
// Pure module: no DOM. `inv` arguments need only { count(key), remove(key,n), clone(), canAdd(), add() }.
import { ITEMS } from './items.js';

export const GROUPS = {
  '#planks': ['oak_planks', 'spruce_planks'],
  '#logs': ['oak_log', 'spruce_log'],
  '#coal': ['coal', 'charcoal'],
  '#wool': ['white_wool', 'red_wool', 'blue_wool', 'yellow_wool', 'green_wool', 'black_wool'],
};
export const GROUP_NAMES = { '#planks': 'Planks', '#logs': 'Logs', '#coal': 'Coal / Charcoal', '#wool': 'Wool' };
export const ingredientKeys = (k) => GROUPS[k] || [k];
export const ingredientIcon = (k) => (GROUPS[k] ? GROUPS[k][0] : k);
export const ingredientName = (k) => GROUP_NAMES[k] || (ITEMS[k] ? ITEMS[k].name : k);

export const RECIPES = [];
let _id = 0;
function R(out, count, ins, table, cat) { RECIPES.push({ id: _id++, out, count, in: ins, table, cat }); }

// --- Hand (2x2) ---
R('oak_planks', 4, { oak_log: 1 }, false, 'Basics');
R('spruce_planks', 4, { spruce_log: 1 }, false, 'Basics');
R('stick', 4, { '#planks': 2 }, false, 'Basics');
R('crafting_table', 1, { '#planks': 4 }, false, 'Basics');
R('torch', 4, { '#coal': 1, stick: 1 }, false, 'Basics');

// --- Tools ---
const MATS = [['wooden', '#planks'], ['stone', 'cobblestone'], ['iron', 'iron_ingot'], ['diamond', 'diamond']];
const SHAPES = [['pickaxe', 3, 2], ['axe', 3, 2], ['shovel', 1, 2], ['hoe', 2, 2], ['sword', 2, 1]];
for (const [mat, ing] of MATS) for (const [t, a, s] of SHAPES) R(`${mat}_${t}`, 1, { [ing]: a, stick: s }, true, 'Tools');
R('shears', 1, { iron_ingot: 2 }, true, 'Tools');
R('bucket', 1, { iron_ingot: 3 }, true, 'Tools');

// --- Armor ---
for (const [mat, ing] of [['leather', 'leather'], ['iron', 'iron_ingot'], ['diamond', 'diamond']])
  for (const [p, n] of [['helmet', 5], ['chestplate', 8], ['leggings', 7], ['boots', 4]]) R(`${mat}_${p}`, 1, { [ing]: n }, true, 'Armor');

// --- Utility / building ---
R('furnace', 1, { cobblestone: 8 }, true, 'Utility');
R('chest', 1, { '#planks': 8 }, true, 'Utility');
R('bed', 1, { '#wool': 3, '#planks': 3 }, true, 'Utility');
R('bookshelf', 1, { '#planks': 6, leather: 3 }, true, 'Building');
R('bricks', 1, { brick: 4 }, true, 'Building');
R('stone_bricks', 4, { stone: 4 }, true, 'Building');
R('sandstone', 1, { sand: 4 }, true, 'Building');
R('snow', 1, { snowball: 4 }, true, 'Building');
R('glowstone', 1, { glowstone_dust: 4 }, true, 'Building');
// dyed wool (documented dye choices: apple=red, snowball=blue, glowstone_dust=yellow, wheat_seeds=green, coal=black)
R('red_wool', 1, { white_wool: 1, apple: 1 }, true, 'Wool');
R('blue_wool', 1, { white_wool: 1, snowball: 1 }, true, 'Wool');
R('yellow_wool', 1, { white_wool: 1, glowstone_dust: 1 }, true, 'Wool');
R('green_wool', 1, { white_wool: 1, wheat_seeds: 1 }, true, 'Wool');
R('black_wool', 1, { white_wool: 1, coal: 1 }, true, 'Wool');
// food
R('bread', 1, { wheat: 3 }, true, 'Food');
// storage blocks
for (const [b, i] of [['coal_block', 'coal'], ['iron_block', 'iron_ingot'], ['diamond_block', 'diamond']]) {
  R(b, 1, { [i]: 9 }, true, 'Storage');
  R(i, 9, { [b]: 1 }, true, 'Storage');
}

// --- Smelting (furnace) ---
export const SMELTING = {
  iron_ore: 'iron_ingot', gold_ore: 'gold_ingot', sand: 'glass', cobblestone: 'stone', raw_mutton: 'cooked_mutton',
  oak_log: 'charcoal', spruce_log: 'charcoal', clay_ball: 'brick', rotten_flesh: 'leather',
};
export const SMELT_TIME = 10;

// --- Helpers ---
export function countIngredient(inv, k) { let n = 0; for (const m of ingredientKeys(k)) n += inv.count(m); return n; }
export function removeIngredient(inv, k, n) {
  for (const m of ingredientKeys(k)) { if (n <= 0) break; n -= inv.remove(m, n); }
  return n <= 0;
}
/** { key: missingCount } for ingredients the inventory lacks (empty object = craftable ingredients-wise). */
export function missingFor(recipe, inv) {
  const out = {};
  for (const [k, n] of Object.entries(recipe.in)) { const have = countIngredient(inv, k); if (have < n) out[k] = n - have; }
  return out;
}
export const hasIngredients = (recipe, inv) => Object.keys(missingFor(recipe, inv)).length === 0;
export function maxCrafts(recipe, inv) {
  let m = Infinity;
  for (const [k, n] of Object.entries(recipe.in)) m = Math.min(m, Math.floor(countIngredient(inv, k) / n));
  return m === Infinity ? 0 : m;
}
/** Craft once. Returns true on success (needs ingredients + room for the output). Table check is the caller's job. */
export function craftOnce(recipe, inv) {
  if (!hasIngredients(recipe, inv)) return false;
  const trial = inv.clone();
  for (const [k, n] of Object.entries(recipe.in)) removeIngredient(trial, k, n);
  if (trial.add(recipe.out, recipe.count) > 0) return false;
  inv.copyFrom(trial);
  return true;
}
export function craftMax(recipe, inv) {
  let c = 0;
  while (craftOnce(recipe, inv)) c++;
  return c;
}
