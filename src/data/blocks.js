// SHARED CONTRACT — owned by the lead. Builders may ADD fields/blocks only with a note in HANDOFF.md;
// never renumber or remove existing ids (saves depend on them).
//
// Fields:
//   id         numeric id stored in the world (0 = air)
//   key        stable string key; also the item key when the block is held
//   name       display name
//   hardness   seconds to break by hand with no penalty (scaled by tool rules in SPEC §6). -1 = unbreakable
//   tool       preferred tool type: 'pickaxe' | 'axe' | 'shovel' | 'hoe' | null
//   minTier    tool tier required to get drops: 0 hand, 1 wood, 2 stone, 3 iron, 4 diamond
//   drops      array of { item, min, max, chance } rolled on break (when minTier is met). [] = nothing
//   solid      true if it has collision
//   render     'opaque' | 'cutout' (alpha-tested, e.g. leaves) | 'translucent' (glass, water, ice)
//   shape      'cube' | 'cross' (sapling, crops) | 'torch' | 'bed' | 'farmland' (15/16 tall) | 'water'
//   light      emitted light 0..15 (torch 14, glowstone 15, magma 6)
//   tex        texture keys { top, side, bottom } (or { all }) that textures.js must draw
//   placeable  true if the block item can be placed

export const BLOCKS = [];
export const BLOCK_BY_KEY = {};

function b(id, key, name, props) {
  const def = {
    id, key, name,
    hardness: 1, tool: null, minTier: 0,
    drops: [{ item: key, min: 1, max: 1, chance: 1 }],
    solid: true, render: 'opaque', shape: 'cube', light: 0,
    tex: { all: key }, placeable: true,
    ...props,
  };
  BLOCKS[id] = def;
  BLOCK_BY_KEY[key] = def;
  return def;
}
const drop = (item, min = 1, max = 1, chance = 1) => ({ item, min, max, chance });

b(0, 'air', 'Air', { hardness: 0, drops: [], solid: false, render: 'translucent', tex: {}, placeable: false });

// --- Required by the brief ---
b(1, 'grass', 'Grass Block', { hardness: 0.6, tool: 'shovel', drops: [drop('dirt'), drop('wheat_seeds', 1, 1, 0.15)],
  tex: { top: 'grass_top', side: 'grass_side', bottom: 'dirt' } });
b(2, 'dirt', 'Dirt', { hardness: 0.5, tool: 'shovel' });
b(3, 'sand', 'Sand', { hardness: 0.5, tool: 'shovel' });
b(4, 'gravel', 'Gravel', { hardness: 0.6, tool: 'shovel', drops: [drop('gravel', 1, 1, 0.9), drop('flint', 1, 1, 0.1)] });
b(5, 'farmland', 'Farmland', { hardness: 0.6, tool: 'shovel', drops: [drop('dirt')], shape: 'farmland',
  tex: { top: 'farmland_top', side: 'dirt', bottom: 'dirt' } });
b(6, 'stone', 'Stone', { hardness: 1.5, tool: 'pickaxe', minTier: 1, drops: [drop('cobblestone')] });
b(7, 'cobblestone', 'Cobblestone', { hardness: 2, tool: 'pickaxe', minTier: 1 });
b(8, 'oak_log', 'Oak Log', { hardness: 2, tool: 'axe', tex: { top: 'oak_log_top', side: 'oak_log_side', bottom: 'oak_log_top' } });
b(9, 'oak_planks', 'Oak Planks', { hardness: 2, tool: 'axe' });
b(10, 'oak_leaves', 'Oak Leaves', { hardness: 0.2, tool: 'hoe', render: 'cutout',
  drops: [drop('oak_sapling', 1, 1, 0.08), drop('apple', 1, 1, 0.04), drop('stick', 1, 2, 0.05)] });
b(11, 'white_wool', 'White Wool', { hardness: 0.8 });
b(12, 'coal_ore', 'Coal Ore', { hardness: 3, tool: 'pickaxe', minTier: 1, drops: [drop('coal', 1, 2)] });
b(13, 'iron_ore', 'Iron Ore', { hardness: 3, tool: 'pickaxe', minTier: 2 });
b(14, 'water', 'Water', { hardness: -1, drops: [], solid: false, render: 'translucent', shape: 'water', placeable: false });
b(15, 'crafting_table', 'Crafting Table', { hardness: 2.5, tool: 'axe',
  tex: { top: 'crafting_table_top', side: 'crafting_table_side', bottom: 'oak_planks' } });
b(16, 'furnace', 'Furnace', { hardness: 3.5, tool: 'pickaxe', minTier: 1,
  tex: { top: 'furnace_top', side: 'furnace_front', bottom: 'furnace_top' } });
b(17, 'chest', 'Chest', { hardness: 2.5, tool: 'axe', tex: { top: 'chest_top', side: 'chest_side', bottom: 'chest_top' } });
b(18, 'bed', 'Bed', { hardness: 0.2, shape: 'bed', solid: true, tex: { top: 'bed_top', side: 'bed_side', bottom: 'oak_planks' } });
b(19, 'torch', 'Torch', { hardness: 0, solid: false, render: 'cutout', shape: 'torch', light: 14 });
b(20, 'glass', 'Glass', { hardness: 0.3, drops: [], render: 'translucent' });

// --- Additional blocks ---
b(21, 'oak_sapling', 'Oak Sapling', { hardness: 0, solid: false, render: 'cutout', shape: 'cross' });
b(22, 'wheat_0', 'Wheat Crop', { hardness: 0, solid: false, render: 'cutout', shape: 'cross', placeable: false, drops: [drop('wheat_seeds')] });
b(23, 'wheat_1', 'Wheat Crop', { hardness: 0, solid: false, render: 'cutout', shape: 'cross', placeable: false, drops: [drop('wheat_seeds')] });
b(24, 'wheat_2', 'Wheat Crop', { hardness: 0, solid: false, render: 'cutout', shape: 'cross', placeable: false, drops: [drop('wheat_seeds')] });
b(25, 'wheat_3', 'Wheat Crop', { hardness: 0, solid: false, render: 'cutout', shape: 'cross', placeable: false,
  drops: [drop('wheat'), drop('wheat_seeds', 1, 3)] });
b(26, 'gold_ore', 'Gold Ore', { hardness: 3, tool: 'pickaxe', minTier: 3 });
b(27, 'diamond_ore', 'Diamond Ore', { hardness: 3, tool: 'pickaxe', minTier: 3, drops: [drop('diamond')] });
b(28, 'obsidian', 'Obsidian', { hardness: 15, tool: 'pickaxe', minTier: 4 });
b(29, 'snow', 'Snow Block', { hardness: 0.3, tool: 'shovel', drops: [drop('snowball', 2, 4)] });
b(30, 'ice', 'Ice', { hardness: 0.5, tool: 'pickaxe', render: 'translucent', drops: [] }); // breaking ice leaves water (SPEC §7)
b(31, 'sandstone', 'Sandstone', { hardness: 0.8, tool: 'pickaxe', minTier: 1, tex: { top: 'sandstone_top', side: 'sandstone_side', bottom: 'sandstone_top' } });
b(32, 'clay', 'Clay', { hardness: 0.6, tool: 'shovel', drops: [drop('clay_ball', 4, 4)] });
b(33, 'spruce_log', 'Spruce Log', { hardness: 2, tool: 'axe', tex: { top: 'spruce_log_top', side: 'spruce_log_side', bottom: 'spruce_log_top' } });
b(34, 'spruce_leaves', 'Spruce Leaves', { hardness: 0.2, tool: 'hoe', render: 'cutout', drops: [drop('stick', 1, 2, 0.1)] });
b(35, 'netherrack', 'Netherrack', { hardness: 0.4, tool: 'pickaxe', minTier: 1 });
b(36, 'glowstone', 'Glowstone', { hardness: 0.3, light: 15, drops: [drop('glowstone_dust', 2, 4)] });
b(37, 'magma', 'Magma Block', { hardness: 0.5, tool: 'pickaxe', minTier: 1, light: 6 });
b(38, 'quartz_ore', 'Nether Quartz Ore', { hardness: 3, tool: 'pickaxe', minTier: 1, drops: [drop('quartz', 1, 2)] });
b(39, 'end_stone', 'End Stone', { hardness: 3, tool: 'pickaxe', minTier: 1 });
b(40, 'amethyst', 'Amethyst Block', { hardness: 1.5, tool: 'pickaxe', minTier: 1, light: 4 });
b(41, 'bricks', 'Bricks', { hardness: 2, tool: 'pickaxe', minTier: 1 });
b(42, 'bookshelf', 'Bookshelf', { hardness: 1.5, tool: 'axe', drops: [drop('oak_planks', 3, 3)], tex: { top: 'oak_planks', side: 'bookshelf', bottom: 'oak_planks' } });
b(43, 'stone_bricks', 'Stone Bricks', { hardness: 1.5, tool: 'pickaxe', minTier: 1 });
b(44, 'spruce_planks', 'Spruce Planks', { hardness: 2, tool: 'axe' });
b(45, 'coal_block', 'Block of Coal', { hardness: 5, tool: 'pickaxe', minTier: 1 });
b(46, 'iron_block', 'Block of Iron', { hardness: 5, tool: 'pickaxe', minTier: 2 });
b(47, 'diamond_block', 'Block of Diamond', { hardness: 5, tool: 'pickaxe', minTier: 3 });
b(48, 'oneblock', 'The One Block', { hardness: -1, drops: [], placeable: false, light: 3 }); // marker only; see SPEC §5
b(49, 'lit_furnace', 'Furnace', { hardness: 3.5, tool: 'pickaxe', minTier: 1, light: 13, drops: [drop('furnace')], placeable: false,
  tex: { top: 'furnace_top', side: 'furnace_front_lit', bottom: 'furnace_top' } });
b(50, 'red_wool', 'Red Wool', { hardness: 0.8 });
b(51, 'blue_wool', 'Blue Wool', { hardness: 0.8 });
b(52, 'yellow_wool', 'Yellow Wool', { hardness: 0.8 });
b(53, 'green_wool', 'Green Wool', { hardness: 0.8 });
b(54, 'black_wool', 'Black Wool', { hardness: 0.8 });

export const blockById = (id) => BLOCKS[id] || BLOCKS[0];
export const blockByKey = (key) => BLOCK_BY_KEY[key];
export const isBlockKey = (key) => key in BLOCK_BY_KEY;
