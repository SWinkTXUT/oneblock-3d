# OneBlock 3D — Game Spec (source of truth)

A browser game: Minecraft "One Block" skyblock, 3D voxel, first-person, single player.
Stack: **Vite + Three.js (r186) + vanilla JS ES modules**. No other runtime deps. No external asset files —
all textures are drawn procedurally on canvas, all sounds synthesized with WebAudio.
Run: `npm run dev` → http://localhost:5173 (game), http://localhost:5173/demo.html (engine demo).

## 1. Decisions locked with the user
- First-person camera only. WASD + mouse look, crosshair, pointer lock.
- Classic One Block with phases (§5). Endless: after the last phase it loops back to phase 1 with a "Cycle N" counter.
- Full survival: 20 HP, 20 hunger, fall damage, void death, food, armor.
- Art: **stylized pixel voxel** — crisp 16×16 procedural pixel textures (NearestFilter) + modern lighting:
  soft shadows, per-vertex ambient occlusion, gradient sky, sun/moon, stars, drifting clouds, fog,
  day/night, bloom on torches/glowstone, translucent animated water. "Minecraft with shaders." Must look *beautiful*.
- Day/night cycle: 10 real minutes (day 5 min, sunset 1, night 3, sunrise 1). Zombies spawn at night, burn at sunrise.
  Sheep spawn in the day on grass. Bed skips the night.
- Crafting: **recipe book** (click a recipe to craft if you have the materials). Basic recipes always available;
  "table" recipes require being within 4 blocks of a crafting table.
- Autosave to localStorage + endless play + achievements/goals list.
- Synthesized SFX (no music).
- Extras: farming, armor, trees grow from saplings.
- Only two mobs: **sheep** and **zombie**.

## 2. File ownership (do not edit files you don't own — write requests in HANDOFF.md)
| Owner | Files |
|---|---|
| Lead (shared contract) | `src/data/blocks.js`, `src/data/items.js`, `SPEC.md` |
| **Builder A — Engine & Visuals** | `src/render/**`, `src/world/**`, `demo.html`, `src/demo.js` |
| **Builder B — Gameplay & UI** | `index.html`, `src/main.js`, `src/game/**`, `src/ui/**`, `src/audio/**`, `src/data/recipes.js`, `src/data/phases.js`, `src/styles.css` |

Both builders append notes to `HANDOFF.md` (section per builder): what's done, deviations, open questions.

## 3. Coordinate & world rules
- Integer block coords; block (x,y,z) occupies [x,x+1)×[y,y+1)×[z,z+1). +Y is up.
- **The One Block is at (0, 0, 0).** Player spawns standing on it: feet at (0.5, 1, 0.5).
- Build limits: x,z ∈ [-64, 63], y ∈ [-32, 95]. Below y = -40 is the void (instant death).
- World is sparse, chunked 16×16×16. Initially only (0,0,0) exists (as `grass`).

## 4. Engine API (Builder A implements, Builder B consumes) — exact signatures

### `src/world/World.js`
```js
export class World {
  constructor()                           // no scene needed; Renderer attaches meshes
  getBlock(x, y, z) -> number             // id, 0 = air; floats are floored
  setBlock(x, y, z, id) -> boolean        // false if out of bounds; marks chunk(s) dirty incl. neighbours on borders
  isSolid(x, y, z) -> boolean             // uses blocks.js `solid`
  getCollisionBoxes(minX,minY,minZ,maxX,maxY,maxZ) -> Array<{minX,minY,minZ,maxX,maxY,maxZ}>
                                          // boxes of solid blocks overlapping the AABB (farmland 15/16 tall, bed 9/16 tall)
  raycast(origin:{x,y,z}, dir:{x,y,z}, maxDist) -> null | { x, y, z, id, normal:{x,y,z}, dist }
                                          // voxel DDA; hits any non-air block except water (water skipped)
                                          // torch/cross blocks ARE hittable
  topSolidY(x, z) -> number | null        // highest solid block y in column, null if none
  forEachBlock(cb(x,y,z,id))              // iterate all non-air blocks
  serialize() -> object                   // JSON-safe, compact
  deserialize(obj)                        // replace contents
  onChange(cb(x,y,z,oldId,newId)) -> unsubscribe fn
}
```

### `src/render/Renderer.js`
```js
export class Renderer {
  constructor(container: HTMLElement, world: World)
  camera: THREE.PerspectiveCamera         // Builder B moves/rotates it (rotation.order = 'YXZ'); fov 75
  scene: THREE.Scene                      // Builder B adds mob/item meshes here
  render(dt)                              // rebuilds dirty chunk meshes (budgeted, ≤ 4 per frame), animates water/clouds/particles, draws
  resize()                                // also auto-called on window resize
  setTimeOfDay(t)                         // t ∈ [0,1): 0 = sunrise, 0.25 noon, 0.5 sunset, 0.75 midnight
                                          // NOTE: Builder B maps the 10-min schedule in §1 onto this
  setPhaseAmbience(phaseKey)              // tints sky/fog/particles per phase key from §5 (smooth 3 s transition)
  setHighlight(pos | null)                // wireframe outline on targeted block {x,y,z}
  setBreakProgress(pos | null, p)         // crack overlay stages 0..9 from p ∈ [0,1]
  spawnBlockParticles(x, y, z, blockId)   // break burst using the block's texture colours
  spawnParticles(kind, x, y, z)           // 'smoke' | 'flame' | 'hearts' | 'crit' | 'sparkle' | 'poof'
  setHeldItem(itemKey | null)             // first-person viewmodel in lower right (block cube, flat sprite for items/tools)
  swingHand()                             // play viewmodel swing animation
  setUnderwater(bool)                     // blue tint + fog when camera inside water
  setDamageFlash()                        // brief red tint on screen (or Builder B does via CSS — either is fine)
  setQuality('low'|'high')                // low: no shadows/bloom, shorter view
  createItemMesh(itemKey) -> THREE.Object3D   // small 3D block or extruded sprite for dropped items (≈0.25 size)
  getItemIcon(itemKey) -> string          // data URL, 32×32 crisp icon for HUD (cached). Must cover EVERY key in ITEMS.
  getMobTexture(kind) -> THREE.Texture    // optional helper; Builder B may draw its own
}
```
Rendering requirements:
- Texture atlas (NearestFilter, no mipmap bleeding — pad tiles). Draw distinct, pretty textures for every `tex` key in blocks.js
  plus icons for every item in items.js (tools: classic diagonal pixel-art tools coloured by tier; armor; food; materials).
- Chunk mesher: hidden-face culling; per-vertex AO (smooth light in corners); separate opaque / cutout / translucent meshes;
  translucent water top surface 1/8 lower and animated (shader or UV scroll); glass faces between two glass blocks culled.
  Shapes: cross (two diagonal quads), torch (thin stick + glowing tip), bed (9/16 tall, red top/white pillow), farmland (15/16).
- Lighting: hemisphere + directional sun with soft shadow map following the player; moonlight bluish at night.
  Torch/glowstone/magma/lit_furnace: up to 8 nearest real `PointLight`s near camera (warm), plus emissive textures for bloom.
- Sky: gradient sky dome shader (zenith/horizon colours by time), sun & moon sprites, stars at night, soft cloud layer at y≈60 drifting.
- Post: UnrealBloomPass (subtle), ACES tone mapping, sRGB output. Fog matches horizon colour.
- Ambient below the island: a soft hazy void gradient so it doesn't look like a black hole; a few floating dust motes.
- Performance: ≥ 60 fps on an M-series MacBook with ~3000 blocks placed. `setQuality('low')` for weaker machines.

### `demo.html` / `src/demo.js` (Builder A)
Standalone engine showcase with a free-fly camera (WASD + mouse, space/shift up/down), a pre-built sample island
using every block type, a time-of-day slider, phase dropdown, and a row of all item icons. This is how the engine is verified
independent of gameplay.

## 5. The One Block & phases (Builder B, data in `src/data/phases.js`)
- Breaking the block at (0,0,0) yields its normal drops, then **after 0.25 s the block regenerates** as the next block
  rolled from the current phase table (weighted). `blocksBroken` counter increments.
- Every phase has a weighted block table, a chest chance, a mob chance, and a set of chest loot.
  - ~1/30 breaks: the block becomes a `chest` pre-filled with phase loot (opening/breaking it gives the loot; breaking it regenerates normally).
  - Mob chance: a sheep or zombie spawns on top of the one block (zombies only from phases that list them).
- If the player stands on (0,0,0) when it regenerates, nothing special: they're already above it (block is solid underneath).
- The block at (0,0,0) can never be replaced by the player placing something; it's always the magic block. (World stores the real block id there; `oneblock` id 48 is not used in the world.)
- Phase announcement banner + sound + `renderer.setPhaseAmbience(key)` on phase change.

| # | key | name | at breaks | blocks (rough weights) | mobs | chest loot highlights |
|---|---|---|---|---|---|---|
| 1 | plains | Plains | 0 | grass 30, dirt 25, oak_log 20, oak_leaves 8, sand 5, gravel 5, clay 3, white_wool 4 | sheep 1/12 | oak_sapling, wheat_seeds, bread, apple, torch |
| 2 | underground | Underground | 100 | stone 35, cobblestone 10, coal_ore 15, iron_ore 10, gravel 8, dirt 8, oak_log 6, clay 4 | zombie 1/20 | torch, coal, iron_ingot, bucket |
| 3 | snow | Snowy Peaks | 250 | snow 20, ice 15, spruce_log 18, spruce_leaves 8, stone 15, iron_ore 10, coal_ore 8, grass 6 | sheep 1/12, zombie 1/30 | water_bucket, iron_ingot, leather, cooked_mutton |
| 4 | desert | Sunlit Dunes | 400 | sand 30, sandstone 25, clay 10, gold_ore 6, iron_ore 8, dirt 6, grass 5, glass 3 | sheep 1/20, zombie 1/20 | gold_ingot, bread, glass, carrot |
| 5 | caverns | Deep Caverns | 550 | stone 30, coal_ore 12, iron_ore 14, gold_ore 8, diamond_ore 4, obsidian 3, gravel 8, amethyst 3 | zombie 1/12 | diamond, iron_ingot, torch, iron armor piece |
| 6 | ember | Ember Wastes | 750 | netherrack 40, magma 12, glowstone 10, quartz_ore 12, gravel 8, obsidian 4 | zombie 1/10 | gold_ingot, glowstone_dust, quartz, diamond |
| 7 | skylands | The Skylands | 1000 | end_stone 40, amethyst 12, obsidian 8, glass 8, diamond_ore 4, grass 10, oak_log 10 | sheep 1/15, zombie 1/15 | diamond, diamond_block (rare), oak_sapling |
| loop | — | after 1300 breaks → cycle+1, back to Plains | | | | |

Starting items: none. (Classic: punch the block.) First break must always be `oak_log` (guarantees wood). Breaks 2–5 are forced
from {oak_log, dirt, grass, oak_leaves} so the player can make a crafting table and wooden pickaxe quickly.

## 6. Mining, tools, combat (Builder B)
- Hold LMB to break. Break time (s) = `hardness × (canHarvest ? 1.5 : 5) / speed`, where `speed` = tool.speed if tool.type
  matches block.tool else 1. `canHarvest` = block.minTier === 0 || (tool type matches && tool.tier ≥ minTier).
  Drops only if canHarvest. Hardness 0 → instant. Hardness -1 → unbreakable.
- Tool loses 1 durability per block broken / hit dealt; breaks at 0 (sound + particles).
- Swords: damage per tool def; hand damage 1. Attack cooldown 0.5 s. Knockback on hit. Critical hit (falling) ×1.5 + 'crit' particles.
- Armor: damage reduction = min(20, points) × 4%. Each hit costs 1 durability per worn piece.
- Hoe on grass/dirt → farmland. Shears on sheep → 1–3 wool, sheep becomes sheared (regrows after eating grass).
- Bucket on water → water_bucket (water removed). Water bucket on a face → places water, returns bucket.
- Breaking `ice` with a non-silk tool (always) → leaves `water` in that spot (unless it's the one block position, then regen as normal).

## 7. Blocks with behaviour (Builder B)
- **Crafting table**: RMB opens inventory with recipe book in "table" mode.
- **Furnace**: RMB opens furnace UI: input, fuel, output slots + flame & arrow progress. Smelt time 10 s per item.
  Keeps smelting while UI is closed (block entity ticks). While burning the block is swapped to `lit_furnace` (and back).
  Breaking it drops its contents.
- **Chest**: RMB opens 27-slot chest UI. Breaking drops contents.
- **Bed**: RMB at night (and no zombie within 8 blocks) → fade to black, skip to sunrise, set spawn. Daytime: "You can only sleep at night" + sets spawn.
- **Torch**: placeable on top or side faces (side torches may render as standing for simplicity — note it). Prevents zombie spawns within 7 blocks.
- **Farmland**: wheat_seeds placeable on top. Crops grow wheat_0→3 by random ticks (~40–90 s per stage; faster if water within 4 blocks). Farmland under a crop or near water stays; bare farmland with no water nearby reverts to dirt after ~2 min.
- **Sapling**: on grass/dirt grows into a tree after 60–150 s (oak: 4–6 log trunk + leaf blob; spruce sapling not needed). Needs space; tries again later otherwise.
- **Grass spread**: dirt next to grass with air above becomes grass slowly. Sheep eating grass turns it to dirt.
- **Glass** drops nothing (like MC).

## 8. Recipes (Builder B, `src/data/recipes.js`) — `{ out, count, in: {key: n}, table: bool }`
Hand (2×2) recipes: planks (4 from log, both woods), sticks (4 from 2 planks), crafting_table (4 planks), torch (4 from coal|charcoal + stick).
Table recipes: all 20 tools (wood=planks, stone=cobblestone, iron=iron_ingot, diamond=diamond; pickaxe 3+2 sticks, axe 3+2, shovel 1+2, hoe 2+2, sword 2+1),
furnace (8 cobblestone), chest (8 planks), bed (3 wool any colour [white_wool] + 3 planks), glass? (no — smelt sand),
bucket (3 iron), shears (2 iron), armor (leather/iron/diamond: helmet 5, chest 8, legs 7, boots 4), bread (3 wheat),
bricks (4 brick), stone_bricks (4 stone), bookshelf (6 planks + 3 wheat... use 3 leather), sandstone (4 sand),
coal_block/iron_block/diamond_block (9) and back (1 block → 9), dyed wool (white_wool + glowstone_dust→yellow, + coal→black,
+ quartz? keep simple: pick sensible dyes from available items, document choices), snow (4 snowball), glowstone (4 dust),
string? (not needed). Smelting: iron_ore→iron_ingot, gold_ore→gold_ingot, sand→glass, cobblestone→stone, raw_mutton→cooked_mutton,
oak_log/spruce_log→charcoal, clay_ball→brick, rotten_flesh→leather, wet nothing else.
Recipe book UI shows every recipe: craftable ones bright, missing-ingredient ones dimmed with the missing counts in red,
table-only ones locked with a table icon when not near a table. Click = craft 1, shift-click = craft max.

## 9. Mobs (Builder B, `src/game/mobs/**`)
Box-model, Minecraft-proportioned, textured with procedural pixel canvases, walk animation (leg/arm swing), hurt red flash, death tip-over + 'poof'.
- **Sheep**: 8 HP. Wander; never walk off an edge (check ground ahead; mobs may fall if pushed). Eat grass occasionally
  (head-down animation, grass→dirt, regrow wool). Flee briefly when hit. Drops on death: 1 white_wool (if not sheared) + 1–2 raw_mutton.
  Spawns: daytime on grass within 24 blocks of player, light not required, cap 4; also from phases.
- **Zombie**: 20 HP, 3 dmg (×armor), arms forward. Night spawns on any solid top surface with 2 air above, within 8–24 blocks of player,
  not within 7 blocks of a torch, cap 6. Chase player within 16 blocks (straight-line steering + jump 1-block steps); ok to fall into the void.
  Burns at day (flame particles, 1 dmg/s). Groans. Drops: 0–2 rotten_flesh; 5% iron_ingot; 5% carrot.
- Mobs that fall below y = -40 are removed. All mobs despawn after 5 minutes if > 32 blocks away.
- **Dropped items**: spinning, bobbing `renderer.createItemMesh` entities with gravity and simple collision; magnetize to the player within 1.5 blocks;
  merge with same item nearby; despawn after 5 min. Q drops the held item forward.

## 10. Player (Builder B)
- AABB 0.6 × 1.8 × 0.6, eye height 1.62. Walk 4.3 m/s, sprint (Ctrl or double-tap W) 5.6, sneak 1.3. Gravity 32 m/s², jump velocity ≈ 9 (1.25 block jump).
- **Sneak (Shift) prevents walking off edges** — essential on a one-block island.
- Swimming in water: slow, space to swim up, no fall damage when landing in water.
- Fall damage: max(0, fallDistance − 3) HP. Void (y < −40): death.
- Hunger: exhaustion from sprint/jump/attack; at hunger ≥ 18 regen 1 HP / 4 s; at 0 lose 1 HP / 4 s down to 1 HP. RMB holding food = eat (1.6 s, crunch sound).
- Death screen: "You fell out of the world" / "Slain by Zombie" etc., Respawn button. Inventory drops where you died (lost in void). Respawn at bed or (0.5, 1, 0.5); if the one block spot is somehow air, it's restored.
- Reach 5 blocks. RMB: use block (table/furnace/chest/bed) unless sneaking, else place held block on the hit face (not inside the player/mobs).

## 11. UI (Builder B) — polished, Minecraft-inspired but modern
- Title screen: game logo "ONE BLOCK" over the live renderer slowly orbiting the island; buttons Play / New World / Settings. Click → pointer lock.
- HUD: crosshair, 9-slot hotbar with item icons/counts/durability bars, hearts + hunger + armor rows (pixel icons), XP-free.
  Top-left: phase name + progress bar to next phase + "Blocks broken: N". Small clock/sun-moon indicator.
- Inventory (E): 27 + 9 slots, 4 armor slots, player-less is fine; recipe book panel at right. Click to pick up/put down stacks,
  right-click to split/place one, shift-click quick-move. Tooltip with name (+ durability).
- Furnace UI, chest UI, pause menu (Esc: Resume, Settings [mouse sensitivity, FOV, volume, quality, invert-Y], Save & Quit to title, New World with confirm).
- Toasts for achievements; Goals panel (J or in pause menu) listing ~15 goals: Getting Wood, Benchmarking (table), Time to Mine (wooden pickaxe),
  Upgrade (stone pick), Hot Topic (furnace), Iron Age (iron ingot), Shear Delight, Monster Hunter (kill zombie), Bake Bread, Plant a Tree,
  Suit Up (armor), Diamonds!, Sweet Dreams (sleep), Phase Walker (reach phase 4), Full Circle (complete cycle 1).
- All UI in DOM/CSS over the canvas; pixel font via CSS (`image-rendering: pixelated`, a bundled-free fallback like "Silkscreen"
  is NOT allowed from Google Fonts at runtime? → Google Fonts IS allowed: use `Press Start 2P` or `Silkscreen` via <link>, with monospace fallback).

## 12. Audio (Builder B, `src/audio/Sound.js`)
WebAudio synth, master volume. Sounds: dig (per material family: stone/wood/dirt/sand/glass/wool), place, break-finish, footsteps (material),
jump-land, hurt (player), eat, pickup pop, craft, furnace crackle, sheep baa, sheep hurt, zombie groan, zombie hurt, zombie death,
phase-change chime, achievement chime, tool break, splash, UI click. Resume AudioContext on first user gesture.

## 13. Save (Builder B, `src/game/Save.js`)
localStorage key `oneblock3d.save.v1`. Saves world (World.serialize), player pos/rot/health/hunger/spawn, inventory/armor,
block entities (furnaces, chests), time of day, blocksBroken, cycle, phase-forced-sequence state, achievements, settings
(settings in separate key `oneblock3d.settings`). Autosave every 30 s, on pause, and on `pagehide`. Mobs/dropped items not saved.

## 14. Acceptance criteria (critics check these)
1. `npm run build` succeeds with no errors; `npm run dev` serves both pages with no console errors on load.
2. demo.html shows every block type with distinct, attractive textures; slider sweeps a convincing day → sunset → night (stars, moon) → sunrise.
3. Game: from a fresh save you can punch the block, get logs, craft planks → table → wooden pickaxe, keep breaking into phase 2.
4. Shift prevents falling off the island edge; walking off without shift and falling to y < −40 kills you and shows the death screen.
5. Placing and breaking blocks updates the mesh within a frame or two; AO visible in corners; torches glow and light surroundings.
6. Sheep can be killed (wool + mutton) and sheared; zombies spawn at night, chase, hurt, burn at day, drop rotten flesh.
7. Furnace smelts with fuel and keeps going while closed; chest stores items; bed skips night.
8. Seeds on farmland grow to wheat; saplings grow into trees.
9. Reload page → world, inventory, and progress restored.
10. ≥ 55 fps typical on the dev machine with a few thousand blocks.
