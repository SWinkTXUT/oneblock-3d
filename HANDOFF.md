# HANDOFF

## Builder A — Engine & Visuals

### Status: complete. `npm run build` passes; demo verified in a real browser (WebGL2, Apple GPU) with zero console errors.

### Implemented
- **World** (`src/world/World.js`, `Chunk.js`): sparse 16^3 chunks (Uint8Array), exactly the SPEC §4 API. `setBlock` returns false out of bounds, marks the chunk plus every neighbour (incl. diagonals) whose border AO/culling depends on the cell. Voxel-DDA `raycast` (skips air and water; torches/crops hittable; origin inside a block returns dist 0 with a zero normal), `getCollisionBoxes` (farmland 15/16, bed 9/16, strict overlap so standing on top does not collide), `topSolidY`, `forEachBlock`, RLE `serialize` (`{v:1, chunks:[[cx,cy,cz,[id,run,...]]]}`, about 2.5 KB for 200 blocks), `deserialize`, `onChange`. Test: `node src/world/__tests__/world.test.mjs`.
- **Textures** (`src/render/tiles.js`, `sprites.js`, `textures.js`, `pixel.js`): every `tex` key in blocks.js has a hand-tuned procedural 16x16 tile (noise palettes, dithering, grass fringe over dirt, log rings and bark, voronoi cobble/gravel/glowstone/magma/amethyst, ore clumps with sparkle flecks, glass frame + shine, leaves with holes, wheat stages, bed, furnace lit/unlit, chest with latch, bookshelf, bricks...). Atlas has 2 px extruded padding per tile + NearestFilter (no bleeding). A second "emissive atlas" makes glowstone, magma, lit furnace fire, torch flames, amethyst glints and ore sparkles self-lit (feeds bloom). **Icons**: `getItemIcon(key)` gives a cached 32x32 data URL for EVERY key in ITEMS (and also any block key, e.g. `lit_furnace`, `wheat_2`): isometric cubes for blocks, classic diagonal tier-coloured tools (wooden/stone/iron/diamond pickaxe/axe/shovel/hoe/sword), shears, 12 armor pieces (leather/iron/diamond), food, materials, buckets. All art is pure pixel buffers, so it was QA'd headlessly from node as PNG sheets.
- **Mesher** (`mesher.js`): hidden-face culling, per-vertex AO with diagonal flip, slight per-block brightness jitter, 4 layers (opaque, cutout, translucent, water), glass/ice/water same-id face culling, shapes: cross (4 quads, upward normal so plants are evenly lit), wheat `#` (8 quads), torch (2x2 px stick, 10 px tall, flame tip emissive), bed 9/16, farmland 15/16, water with surface 1/8 lower.
- **Renderer** (`Renderer.js`, `sky.js`, `particles.js`, `itemMesh.js`): SPEC §4 API exactly. Lambert terrain with vertex-colour AO, hemisphere + camera-following directional sun/moon with texel-snapped PCF shadow map (2048, +-30 blocks), up to 8 nearest real PointLights (torch/glowstone/magma/lit furnace; slots persist and fade in/out so lights never pop), gradient sky dome shader with warm horizon haze and a darker hazy void below the island, sun (square core + halo), pixel moon with craters, 1400 twinkling stars that rotate with time, soft drifting clouds at y=62, ACES tone mapping, subtle half-resolution UnrealBloom, MSAA(4x) HDR render target, fog = horizon colour, animated translucent water (two scrolling layers + vertex waves, shader patch), 3 s phase-ambience transition (tint, fog distance, ambient mote type per phase: dust / dust / snowfall / blowing sand / cyan spores / rising embers / pink sparkles), fat-line block highlight sized per shape, 10-stage crack overlay, GPU particles (block-colour bursts + smoke/flame/hearts/crit/sparkle/poof), first-person viewmodel in its own pass (held block cube / extruded-pixel sprite / arm when empty, swing + equip animation, lit by ambience and nearby torches), underwater tint+fog, damage flash (DOM vignette), `setQuality('low')` (no shadows/bloom/MSAA, 3 lights, shorter fog).
- **demo.html / src/demo.js**: free-fly camera (click to lock, WASD, Space/Shift up/down, Ctrl fast, wheel = speed), sample island with every block type (tree, spruce, pond, farm, glass hut with bed/chest/torches, workshop, glow blocks, wool row) plus a museum platform showing every block id, time slider + auto-advance, phase dropdown, quality select, held-item picker, swing / hurt / underwater / particle buttons, "+3000 blocks" stress button, LMB break (crack overlay + particles), RMB place held block, fps/draw-call/block counter, strip of every item icon. `window.__demo` exposes `{world, renderer, setView}` for scripted checks.

### How to view
`npm run dev` then open http://localhost:5173/demo.html (or whatever port Vite prints).

### Extra API (beyond SPEC §4)
- `World`: `dirty` (Set of chunk keys the renderer consumes), `emitters` (Map of light-emitting blocks), `chunks`, `version`, `onReset(cb)` (fires after `deserialize`), `countBlocks()`, `World.inBounds()`; exports `chunkKey`, `keyToChunk`, bounds constants.
- `Renderer`: `getTimeOfDay()`, `flushChunks(max?)` (mesh all dirty chunks now; the first `render()` already does this), `setViewmodelVisible(bool)` (also `renderer.hand` is the public viewmodel Group), `getSkyState()`, `stats` getter `{calls,triangles,chunks,dirty}`, `adaptive` (bool, default true), `dispose()`, `renderer.renderer` (the WebGLRenderer; its canvas is the only canvas in the container), `particles`, `atlas`.
- `spawnParticles(kind, x, y, z)`: x,y,z are the **world-space centre of the effect** (for a block pass x+0.5, y+0.5, z+0.5), matching how Builder B already calls it. `spawnBlockParticles(x,y,z,id)` takes block coords.
- `getMobTexture('zombie'|'sheep')` returns a rough 64x32 skin (unused by Builder B).

### Deviations / decisions
- **Adaptive resolution**: the fill-rate cost of MSAA+bloom+shadows on retina screens was too high (about 34 ms at 2048x1536 on the test GPU, 9.5 ms at 1024x768). High quality caps the pixel ratio at 1.75 and `render(dt)` automatically lowers it (down to 0.8) when frames average over about 19.5 ms, and creeps back up when there is headroom. Set `renderer.adaptive = false` to disable.
- Furnace/crafting-table etc. have no facing data, so the furnace front texture appears on all four sides; torches placed on walls render standing.
- Water is static single-level (surface at 7/8 height, no flow), per spec.
- Torch/crop/sapling blocks are raycast as full voxels (World.raycast), but the highlight box is sized to the real shape.
- Shadows only cover +-30 blocks around the camera; beyond that terrain is lit by hemisphere + sun only (no shadows).
- No baked block-light: torches light the world through the 8 real PointLights only (distant torches beyond the nearest 8 just show their emissive flame + bloom).

### Fixed after Builder B's report
- Held block / `createItemMesh` cubes rendered black because the shared item material uses vertex colours and the box geometry had none; now has a white colour attribute. Empty-hand/ambience lighting for the viewmodel now has a brightness floor and picks up nearby torch light.

### Round 2 (visuals critic fixes)
- **Golden hour:** one key light (`st.keyDir/keyColor/keyI`) cross-fades sun to moon in direction, colour and intensity (no pop, direction floored at about 9 degrees above the horizon so it never lights from below); sun intensity only fades once the sun is well below the horizon. Hemisphere ground colours lifted at every keyframe, so dusk/dawn are never darker than night. Verified at t=0.0, 0.1, 0.25, 0.5, 0.75 in the demo.
- **Dawn palette:** more saturated horizon at t=0.0/0.05, bluer zenith, new t=0.12 keyframe (clear saturated blue); t=0.05-0.15 is the "gorgeous" range for Builder B's start time (t about 0.10).
- **Point lights/emissive:** torch/glow lights scale by darkness (22% at noon, 100% at night), shorter range, emissive atlas capped (x0.8 atlas, 0.75 intensity), bloom strength/threshold ease with daylight. Glowstone keeps its texture in daylight.
- **Viewmodel:** arm has a shaded pixel skin texture and a visible sleeve+cuff; held items use their own material with emissive 0.22 (held glowstone no longer blows out).
- **Performance:** high-quality max pixel ratio 1.5; adaptive uses discrete levels (1.0 / 1.25 / 1.5), floor 1.0 (then sheds bloom), hysteresis, ignores hidden tabs, frames > 250 ms and 60 frames after any change, so the composer target is rarely reallocated. Particle update/uploads skipped when nothing is alive.
- **Brightness of sides:** side faces x1.05, oak bark lightened.
- **Phases:** each phase now replaces the sky with its own midday zenith/horizon colours (scaled by time-of-day brightness) plus light/exposure/fog/cloud changes: underground cool+dim, snow crisp blue-white, desert golden, caverns violet-teal dark, ember deep red-orange with near-black clouds, skylands violet/teal. 3 s blend.
- **P2:** atlas now has 8 px extruded padding, mipmaps (NearestMipmapLinear) and anisotropy 4; unknown block ids are dropped to air in `deserialize` (warn once) and skipped by the mesher; water renders after glass; water under a solid ceiling is full height; leaf-leaf shared faces culled; `raycast` ignores the cell containing the origin (never returns a zero normal; inside a block it reports the first surface the ray exits into, or null); sun/moon handover is smooth so shadows do not snap. Also: moon bigger, iron ore flecks stronger, per-frame Vector3 allocations hoisted.
- Skipped: P2 emitter-scan throttling, shadow edge fade, A/B API tidy-ups (B can use `setViewmodelVisible`).

### Known issues / gaps
- Not verified: real pointer lock / mouse feel in the demo, and real-time fps on an M-series Mac (the test pane is a hidden, throttled tab; I measured with forced GPU sync: 5769 blocks at 1024x768 high quality = 9.5 ms/frame, one chunk remesh = 2 ms, full 22-chunk mesh = 60 ms).
- Leaf and spruce textures show dark specks where holes expose shadowed interior leaves (looks like Minecraft fancy leaves, but can read busy at distance).
- Vertical wave on water top faces can leave hairline cracks where water meets a lower neighbour surface at extreme angles.
- No requests for blocks.js/items.js changes.

## Builder B — Gameplay & UI

### Status: complete, verified against Builder A's real engine
`npm run build` passes. Game loads with zero console errors; a 24k-frame randomized soak test (about 20 game-minutes of random moving/mining/placing, day and night) threw nothing.

### What is implemented (SPEC §5-§13)
- **Bootstrap/loop** (`src/main.js`, `src/game/Game.js`): title screen over the orbiting live island, Continue/Play, New World (confirm if a save exists), Settings. Pointer lock on Play click.
- **Player** (`Player.js`, `physics.js`): AABB sweep vs `world.getCollisionBoxes`, walk/sprint/sneak (sneak edge guard), swim and ledge climb-out, jump about 1.27 blocks, fall damage `ceil(fall-3)` (none into water), void death at y < -40, hunger/saturation/exhaustion, regen/starve, eating (hold RMB 1.6 s; rotten flesh can poison).
- **Mining/combat/placing**: break time and harvest rules exactly per §6 (`rules.js`), tool durability, crack overlay, particles, sounds, swings. Attack cooldown 0.5 s, crit on falling, knockback, armor reduction and wear. Place blocks/torches/saplings/seeds, hoe to farmland, shears, bucket and water bucket, ice leaves water, support rules (torches and crops pop when unsupported).
- **One Block** (`src/data/phases.js`, `Game.js`): 7 phase tables with chest loot and mob chances, 1/30 chests (block entity pre-filled), 0.25 s regen, forced early sequence, phase banner/sound/`setPhaseAmbience`, cycles every 1300 breaks. Anything standing on the block hovers during the regen window, and is lifted if the block would appear inside it.
- **Inventory/crafting/furnace/chest UI** (`src/ui/Windows.js`): 36 slots + 4 armor slots, click/right-click/shift-click/number-key-swap, tooltips with durability. Recipe book lists all 60 recipes, craftable ones bright, missing counts in red, table recipes locked until near a table (4 blocks) or opened from one; click = craft 1, shift-click = craft max. Furnace smelts in `tickFurnace` whether the UI is open or not, swapping `furnace`/`lit_furnace`. Chests hold 27 slots.
- **Bed**: sleep at night (no zombie within 8) fades to black and skips to morning; any use sets spawn. Respawn at bed if it still exists, else at the One Block (restored if missing).
- **Growth** (`Growth.js`): sapling to tree (60-150 s, retries if blocked), wheat stages (40-90 s, halved near water), bare farmland reverts after about 2 min, grass spread, torch registry (zombies will not spawn within 7 blocks).
- **Mobs** (`src/game/mobs/`): sheep and zombie box models with procedural pixel textures per face, walk animation, hurt flash, tip-over death + poof, sheep eat grass/flee/never walk off edges, zombies chase within 16, burn in daylight, groan. Spawn rules per §9 with caps; despawn after 5 min beyond 32 blocks.
- **Dropped items** (`Drops.js`): spinning/bobbing, gravity, magnet within 1.5, merging, 5 min despawn, Q drops (Ctrl+Q drops the stack).
- **HUD**: crosshair, hotbar with icons/counts/durability bars, hearts/hunger/armor rows with pixel icons, phase name + progress bar + blocks broken, sun/moon clock, goal toasts, phase banner, action messages, damage vignette. Pause, settings (sensitivity, FOV, volume, quality, invert-Y), goals (J), death screen.
- **Goals**: 15 goals listed in §11.
- **Audio** (`src/audio/Sound.js`): 38 synthesized sounds (dig/break/step per material family, place, land, hurt, eat, pop, craft, furnace, sheep and zombie voices, phase/achievement chimes, tool break, splash, click, sleep). Resumed on first gesture.
- **Save** (`Save.js`): key `oneblock3d.save.v1` (+ `oneblock3d.settings`), autosave every 30 s, on pause/title/hide/`pagehide`. Saves world, player, inventory/armor, furnaces/chests, time, blocksBroken, forced plan, spawn, goals. On death the world is saved with an empty inventory and a respawned player so a reload cannot resurrect the corpse.

### Controls
WASD move, mouse look, LMB hold break/attack, RMB use/place/eat (hold), Shift sneak (edge guard), Ctrl or double-tap W sprint, Space jump/swim up, E inventory, J goals, Q drop (Ctrl+Q whole stack), 1-9 or wheel hotbar, Esc pause. In a window: hover a slot and press 1-9 to swap with that hotbar slot.

### Deviations / decisions
- **New worlds start with the One Block as `oak_log`** (not grass) so the "first break is oak_log" rule gives wood on the very first punch. Breaks 2-5 are the forced plan (always at least 2 logs among them, so table + pickaxe are guaranteed). The title screen of a fresh install shows the grass block; it becomes a log on New World / Play.
- Recipes support ingredient groups (`#planks`, `#logs`, `#coal`, `#wool`) so oak/spruce, coal/charcoal and any wool colour work. Dye choices: apple=red, snowball=blue, glowstone_dust=yellow, wheat_seeds=green, coal=black. Bookshelf = 6 planks + 3 leather (per spec). `stone_bricks` makes 4 from 4 stone.
- Side-placed torches render standing (as the spec allows). A torch only pops when no adjacent block (below or 4 sides) is solid.
- Sheared sheep regrow wool after eating grass or after 150 s (so a grass-less island cannot soft-lock wool). Sheep never eat the One Block itself.
- Zombies avoid walking off ledges deeper than 2 blocks (otherwise they all suicide on small islands). They can still be knocked off.
- Block drops/items pop with only a small horizontal speed so they land back on the one-block island and get picked up instead of flying off.
- Sand/gravel do not fall; water does not flow (static blocks); shears/hoe etc. wear 1 durability per use.
- Ctrl as sprint conflicts with Ctrl+W/Ctrl+click in some browsers; double-tap W is the reliable alternative.
- Title orbit camera is shifted sideways so the island sits beside the left-aligned menu on screens >= 900 px wide.

### Open requests / notes for Builder A / lead
- **Viewmodel arm / block looked solid black in my in-game test** (empty hand and a held `oak_log` block rendered as a black silhouette lower-right; held sprite tools such as the wooden pickaxe looked fine). Please check the viewmodel lighting for the 'arm' and 'block' modes in the real game (demo may differ because time/ambience calls differ).
- I rely on `renderer.renderer.domElement` being the only `<canvas>` inside the container (pointer lock element).
- `renderer.getMobTexture` is unused (mobs draw their own textures).
- No changes needed to `blocks.js` / `items.js`.

### Verification run
- `node src/game/__tests__/logic.test.mjs` (7 tests): recipe sanity, inventory stacking, crafting flow, mining-time formula and harvest tiers, phase rolling and forced sequence, material reachability, save round-trip.
- `node src/game/__tests__/sim.test.mjs` (6 tests, uses the real `World`): stand on the block, jump height, sneak edge guard, void death, fall damage, hunger regen/starve, furnace timing and lit swap, sapling to tree, crops, farmland decay, torch registry.
- Browser (Vite dev server, real renderer): punch to logs to planks/table/pickaxe through the recipe book DOM, mob kills and drops, shears, furnace running while closed, chest moves, bed/sleep, death/void/respawn, save and reload, bucket/hoe/seeds, phase change, soak test, all 38 sounds execute.
- Not testable in my headless pane: real pointer lock (a click-to-resume fallback via the pause menu is built in), and real-time frame rate (sim cost measured at about 0.2 ms/frame; rendering cost is Builder A's).

### Round 2 (gameplay critic fixes, lead decisions applied)
- **P0-1 zombie on the new player.** `src/game/spawning.js` (pure): phase mob spawns now pick another walkable cell within 4 of the One Block, at least 1.5 from the player and never in the player's column; no spot means no mob. A zombie roll becomes a sheep until the island has >= 12 walkable surface blocks. Player knockback is now a capped 0.35-block displacement (no upward launch) that goes through the sneak edge guard. Regression tests in `src/game/__tests__/sim.test.mjs` (spawn planning and knockback/edge cases).
- **Onboarding.** New worlds start at t=60 s (about 0.10 renderer time) with the player looking down. Deviation: pitch is -1.30 rad (about -74 degrees), not -55 degrees, because from eye height 1.62 any pitch shallower than about -73 degrees misses the 1x1 block and LMB would do nothing. Hint bar (bottom centre): break block, E craft planks, craft table, place table, craft pickaxe, sneak (once, until used or 12 s), then "Goal: ..." for 10 s after each goal. Goal tracker under the phase bar always shows the next unmet goal.
- **Smart placement.** Top-face hit blocked by your own body places at the hit block's level in the dominant horizontal look direction. With nothing targeted at shallow pitch while standing on a block, RMB bridges from the block under your feet the same way.
- **Saving.** No save while dead or y < -30. The death snapshot (taken at death, includes the death-drop items, empty inventory, respawned player) is the good state; Save & Quit from the death screen reloads it instead of overwriting it. Dropped items are now saved (override of SPEC section 13); items in the void are lost.
- **Night.** Spawn ring 4-24; cap = clamp(floor(surface/25), 0, 6); one attempt every 8 s. Zombies rise from the ground for 1.5 s (particles, cannot attack, cannot move). Dusk toast "Night is falling" once per night.
- Title screen uses its own clock and never touches the world clock. "Inventory full" message (rate limited). Recipe rows keep a fixed order (only dim/bright changes). Hunger: block break exhaustion 0.04, walking 0.02/m (sprint 0.1/m). Uses `renderer.setViewmodelVisible`.
- Also fixed: single Play button on fresh install, goals window pauses the world, shift-click of logs falls through to fuel when the furnace input is occupied by something else.
- Not done: gold/quartz/obsidian/amethyst/magma stay dead-end materials (no suitable items exist; a golden apple would need a new item in `items.js`). Day/night gap (P2-12), leather armor rebalance (P2-9), mob geometry disposal (P2-13), "click to resume" hint (P2-11) left as is.

### Known gaps / issues
- Real pointer lock, mouse feel and audio output were not verified by ear/hand, only by logic and simulated input.
- Pressing Esc to close an inventory may land on the pause menu if the browser refuses to re-lock without a click (Chrome policy); Resume re-locks.
- Mobs are not saved (per spec); dropped items are not saved.
- Mob and viewmodel looks depend on Builder A's lighting; sheep/zombie textures are my own procedural ones.

## Critic findings

_(none yet)_

---
# Platforms round (SPEC-PLATFORMS.md)

## Builder A — Engine, Views & Input

_(not started)_

## Builder B — Game, UI & Pages

_(not started)_
