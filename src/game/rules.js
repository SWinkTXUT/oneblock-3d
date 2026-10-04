// Pure gameplay rules (no DOM / three).
import { ITEMS } from '../data/items.js';
import { BLOCKS } from '../data/blocks.js';

/** Break time per SPEC §6. Returns { time (s, Infinity if unbreakable), canHarvest, speed }. */
export function breakInfo(blockId, heldKey) {
  const b = BLOCKS[blockId];
  if (!b || b.hardness < 0) return { time: Infinity, canHarvest: false, speed: 1 };
  const tool = heldKey && ITEMS[heldKey] ? ITEMS[heldKey].tool : null;
  const matches = !!(tool && b.tool && tool.type === b.tool);
  const canHarvest = b.minTier === 0 || (matches && tool.tier >= b.minTier);
  const speed = matches ? tool.speed : 1;
  if (b.hardness === 0) return { time: 0, canHarvest, speed };
  return { time: (b.hardness * (canHarvest ? 1.5 : 5)) / speed, canHarvest, speed };
}

/** Roll a block's drops -> [{key,n}]. */
export function rollDrops(blockId, canHarvest, rng = Math.random) {
  const b = BLOCKS[blockId];
  if (!b || !canHarvest) return [];
  const out = [];
  for (const d of b.drops) {
    if (rng() <= (d.chance === undefined ? 1 : d.chance)) {
      const n = d.min + Math.floor(rng() * (d.max - d.min + 1));
      if (n > 0) out.push({ key: d.item, n });
    }
  }
  return out;
}

export const armorReduction = (points) => Math.min(20, points) * 0.04;

/** Block-key -> sound family. */
export function materialOf(key) {
  if (!key) return 'stone';
  if (/log|planks|crafting_table|chest|bookshelf|bed$/.test(key)) return 'wood';
  if (/wool/.test(key)) return 'wool';
  if (/glass|ice/.test(key)) return 'glass';
  if (/^(grass|dirt|farmland|clay|oak_sapling|wheat_\d|oak_leaves|spruce_leaves|snow)$/.test(key)) return 'dirt';
  if (/^(sand|gravel)$/.test(key)) return 'sand';
  return 'stone';
}
