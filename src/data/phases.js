// One Block phase tables (SPEC §5). Pure data + pure helpers (no DOM / three) so they can be unit-tested in node.
export const CYCLE_LENGTH = 1300;
export const CHEST_CHANCE = 1 / 30;

const L = (item, min, max, w) => ({ item, min, max, w });

export const PHASES = [
  { key: 'plains', name: 'Plains', at: 0,
    blocks: { grass: 30, dirt: 25, oak_log: 20, oak_leaves: 8, sand: 5, gravel: 5, clay: 3, white_wool: 4 },
    mobs: [{ kind: 'sheep', chance: 1 / 12 }],
    loot: [L('oak_sapling', 1, 2, 3), L('wheat_seeds', 2, 4, 3), L('bread', 1, 2, 2), L('apple', 1, 3, 3), L('torch', 2, 4, 2),
      L('oak_log', 2, 4, 2), L('stick', 2, 5, 2), L('bucket', 1, 1, 0.4)] },
  { key: 'underground', name: 'Underground', at: 100,
    blocks: { stone: 35, cobblestone: 10, coal_ore: 15, iron_ore: 10, gravel: 8, dirt: 8, oak_log: 6, clay: 4 },
    mobs: [{ kind: 'zombie', chance: 1 / 20 }],
    loot: [L('torch', 3, 6, 3), L('coal', 2, 5, 3), L('iron_ingot', 1, 3, 3), L('bucket', 1, 1, 1), L('bread', 1, 2, 1),
      L('oak_planks', 3, 6, 1), L('cobblestone', 4, 8, 1)] },
  { key: 'snow', name: 'Snowy Peaks', at: 250,
    blocks: { snow: 20, ice: 15, spruce_log: 18, spruce_leaves: 8, stone: 15, iron_ore: 10, coal_ore: 8, grass: 6 },
    mobs: [{ kind: 'sheep', chance: 1 / 12 }, { kind: 'zombie', chance: 1 / 30 }],
    loot: [L('water_bucket', 1, 1, 2), L('iron_ingot', 1, 3, 3), L('leather', 1, 3, 3), L('cooked_mutton', 1, 3, 3),
      L('snowball', 4, 8, 1), L('coal', 2, 4, 2), L('spruce_planks', 3, 6, 1)] },
  { key: 'desert', name: 'Sunlit Dunes', at: 400,
    blocks: { sand: 30, sandstone: 25, clay: 10, gold_ore: 6, iron_ore: 8, dirt: 6, grass: 5, glass: 3 },
    mobs: [{ kind: 'sheep', chance: 1 / 20 }, { kind: 'zombie', chance: 1 / 20 }],
    loot: [L('gold_ingot', 1, 2, 3), L('bread', 1, 3, 2), L('glass', 2, 4, 2), L('carrot', 1, 3, 3), L('iron_ingot', 1, 2, 2),
      L('apple', 1, 2, 1)] },
  { key: 'caverns', name: 'Deep Caverns', at: 550,
    blocks: { stone: 30, coal_ore: 12, iron_ore: 14, gold_ore: 8, diamond_ore: 4, obsidian: 3, gravel: 8, amethyst: 3 },
    mobs: [{ kind: 'zombie', chance: 1 / 12 }],
    loot: [L('diamond', 1, 2, 3), L('iron_ingot', 2, 4, 3), L('torch', 3, 6, 2), L('coal', 3, 6, 2), L('gold_ingot', 1, 3, 1.5),
      L('iron_helmet', 1, 1, 0.7), L('iron_chestplate', 1, 1, 0.7), L('iron_leggings', 1, 1, 0.7), L('iron_boots', 1, 1, 0.7)] },
  { key: 'ember', name: 'Ember Wastes', at: 750,
    blocks: { netherrack: 40, magma: 12, glowstone: 10, quartz_ore: 12, gravel: 8, obsidian: 4 },
    mobs: [{ kind: 'zombie', chance: 1 / 10 }],
    loot: [L('gold_ingot', 1, 3, 3), L('glowstone_dust', 2, 5, 3), L('quartz', 2, 4, 3), L('diamond', 1, 2, 2), L('cooked_mutton', 2, 4, 2),
      L('iron_ingot', 1, 3, 1)] },
  { key: 'skylands', name: 'The Skylands', at: 1000,
    blocks: { end_stone: 40, amethyst: 12, obsidian: 8, glass: 8, diamond_ore: 4, grass: 10, oak_log: 10 },
    mobs: [{ kind: 'sheep', chance: 1 / 15 }, { kind: 'zombie', chance: 1 / 15 }],
    loot: [L('diamond', 1, 3, 3), L('diamond_block', 1, 1, 0.4), L('oak_sapling', 1, 2, 2), L('cooked_mutton', 2, 4, 2), L('apple', 1, 3, 2),
      L('iron_ingot', 2, 4, 1.5), L('gold_ingot', 1, 3, 1)] },
];

export const FORCED_POOL = ['oak_log', 'dirt', 'grass', 'oak_leaves'];

export const cycleOf = (total) => Math.floor(total / CYCLE_LENGTH) + 1;
export const localBreaks = (total) => total % CYCLE_LENGTH;

export function phaseIndexFor(total) {
  const n = localBreaks(total);
  let idx = 0;
  for (let i = 0; i < PHASES.length; i++) if (n >= PHASES[i].at) idx = i;
  return idx;
}

/** Progress info for the HUD. */
export function phaseInfo(total) {
  const index = phaseIndexFor(total);
  const phase = PHASES[index];
  const n = localBreaks(total);
  const end = index + 1 < PHASES.length ? PHASES[index + 1].at : CYCLE_LENGTH;
  return { index, phase, cycle: cycleOf(total), frac: (n - phase.at) / (end - phase.at), toNext: end - n,
    nextName: index + 1 < PHASES.length ? PHASES[index + 1].name : `Cycle ${cycleOf(total) + 1}` };
}

export function weightedPick(table, rng = Math.random) {
  let sum = 0;
  const entries = Array.isArray(table) ? table : Object.entries(table).map(([k, w]) => [k, w]);
  for (const [, w] of entries) sum += w;
  let r = rng() * sum;
  for (const [k, w] of entries) { r -= w; if (r < 0) return k; }
  return entries[entries.length - 1][0];
}

/** Forced early sequence: blocks present after break 1..4 (cycle 1 only). Always >= 2 logs among them so a table + pickaxe is guaranteed. */
export function makeForcedPlan(rng = Math.random) {
  const plan = ['oak_log', 'oak_log', FORCED_POOL[Math.floor(rng() * 4)], FORCED_POOL[Math.floor(rng() * 4)]];
  for (let i = plan.length - 1; i > 0; i--) { const j = Math.floor(rng() * (i + 1)); [plan[i], plan[j]] = [plan[j], plan[i]]; }
  return plan;
}

/** Decide the next block once `total` breaks have happened. Returns { block, chest, mob }. */
export function rollNext(total, forced, rng = Math.random) {
  if (total <= 0) return { block: 'oak_log', chest: false, mob: null };
  if (total <= 4 && cycleOf(total) === 1 && forced && forced[total - 1]) return { block: forced[total - 1], chest: false, mob: null };
  const phase = PHASES[phaseIndexFor(total)];
  if (rng() < CHEST_CHANCE) return { block: 'chest', chest: true, mob: null };
  const block = weightedPick(phase.blocks, rng);
  let mob = null;
  for (const m of phase.mobs) if (rng() < m.chance) { mob = m.kind; break; }
  return { block, chest: false, mob };
}

/** Roll chest contents: 3-5 distinct entries from the phase loot table. */
export function rollLoot(phaseIdx, rng = Math.random) {
  const phase = PHASES[phaseIdx];
  const pool = phase.loot.map((l) => [l, l.w]);
  const rolls = 3 + Math.floor(rng() * 3);
  const out = [];
  for (let i = 0; i < rolls && pool.length; i++) {
    const total = pool.reduce((s, [, w]) => s + w, 0);
    let r = rng() * total, pick = 0;
    for (let j = 0; j < pool.length; j++) { r -= pool[j][1]; if (r < 0) { pick = j; break; } }
    const [l] = pool.splice(pick, 1)[0];
    out.push({ key: l.item, n: l.min + Math.floor(rng() * (l.max - l.min + 1)) });
  }
  return out;
}
