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

## Builder B — Game, UI & Pages (Platforms round)

### Status: implemented and verified in the browser with fake gamepads and synthetic touch. Not tested on a real Xbox or iPad.
All node tests pass: `logic` (7), `sim` (8), `multiseat` (7, new), `input` (A), `world` (A). `npm run build` passes and emits `index/computer/xbox/ipad/demo.html` with relative asset URLs (also checked by serving `dist` under `/oneblock-3d/`).

### What was delivered (SPEC-PLATFORMS §4)
- **Pages:** `index.html` is now the launcher (3 cards, detects Xbox UA / iPad touch+Macintosh, highlights and focuses the detected card). `computer.html`, `xbox.html`, `ipad.html` set `<body data-platform>`; `src/main.js` reads `currentPlatform()`, sets `--ui-scale`, blocks page zoom/scroll on iPad, guards Escape/Back on Xbox. `Game` creates the `InputHub`, calls `renderer.setPlatform/setSafeArea`, uses per-platform `saveKey`/`settingsKey`.
- **Seat refactor:** `src/game/Seat.js` holds everything per player (Player, Inventory, sel, input source, view, avatar, SeatUI, spawn/bed, mining/eating/placing state, tutorial, pev callbacks, death/respawn, camera sync). `Game.slots[0..maxSeats-1]` are permanent slots (their data persists), `Game.seats` are the active ones in index order. `game.player`, `game.inv`, `game.sel`, `game.input` are seat-0 getters.
- **Shared-world rules** (pure helpers in `src/game/team.js`, unit tested): zombies target/spawn around the nearest/a random living seat and despawn only when far from every seat; phase spawns avoid every seat's column; drops go to the nearest living seat with room (inventory-full hint goes to that seat); furnace/chest windows stay live for several seats (slots re-render every frame from the shared entity); goals are team-wide (inventory polling scans all seats); sleep needs every living seat in a bed ("P2 is sleeping (1/3)", dead seats do not block); death is per seat (others keep playing, own death screen in the seat's rect, Respawn / Leave game).
- **Split-screen UI:** `src/ui/SeatUI.js` builds a HUD per seat inside `renderer.getViewRect(view)` (crosshair, hotbar, hearts/hunger/armor, hint bar, action messages, coloured border + P1..P4 chip, "Reconnect controller" overlay), scaled to the rect. Windows open inside that rect, scaled to fit; when the fit scale is small (quadrants, halves) the inventory becomes two tabs (Inventory / Recipes) switched with LB/RB or by tap. The shared phase/goal panel sits top-centre in multi-seat mode. With more than one seat, windows never pause the game; only the global pause menu does (it has "Leave game (Pn)").
- **Controller navigation:** `src/ui/focus.js` (spatial focus from on-screen rects, `MenuNav` for button menus). Every window, the pause/settings/confirm menus, the title/lobby, goals and the death screen are controller-navigable: D-pad/left stick moves a visible focus ring, A accept (pick up/put down, craft 1), X quick-move (craft max on a recipe), Y split/place one, B close, LB/RB tabs. Sliders adjust with left/right. Tooltips follow the focused slot.
- **Xbox lobby / drop-in:** title shows 4 seat cards ("Press Ⓐ to join" / "Ready!"); `hub.joinOnA` is on in the lobby, any joined player starts with A on "Start game". In game an unassigned controller pressing Menu drops in as a new seat at its bed/world spawn and the layout reflows (1→4). Leaving via the pause menu or death screen reflows back; slot data (inventory, bed, hotbar) stays in the save. Disconnect freezes that seat and shows "Reconnect controller"; the same pad returning resumes the seat, or any new pad pressing Menu takes over a frozen seat.
- **Hints use `input.glyph(action)`:** "Hold RT to break the block", "Press Ⓨ to open your inventory…", "Hold ⛏ …", "Left-Click" on keyboard (Hold/Tap prefixes from touch glyphs are stripped). Sneak hint names the device's control.
- **Save v2:** `{v:2, world, state, entities, drops, goals, seats:[{player,inv,sel,spawn}|null]×maxSeats}`. `decode()` migrates v1 in memory (spawn moves from `state` into seat 0); computer keeps key `oneblock3d.save.v1` and still loads old v1 saves, the next write is v2. A dead seat is saved in its respawned state (drops are in `drops`), a seat below y=-30 saves its last good state. Per-platform keys from `platform.js`.
- **Computer + controller:** seat 0 uses `hub.combine(keyboardMouse, pad0)` whenever a pad is connected (re-evaluated each frame). A controller-driven Resume does not need pointer lock (`game.noLock`); a mouse click on the canvas switches back to mouse look.
- **iPad:** hotbar slots are tappable (`seat.selectSlot`), every window has a ✕ close button (hidden on Xbox), slots/recipes use Pointer Events: tap = left click, long-press = split / craft max, double-tap = quick move. Larger buttons and slots under `body[data-platform=ipad]`, portrait shows "Rotate your iPad to landscape", safe-area insets on the panels.
- `src/game/Input.js` is deleted; `src/input/**` is used.

### Xbox / Edge research (WebSearch; sources are old and anecdotal, so unverified on hardware)
- Edge on Xbox delivers the Gamepad API, but by default the controller drives a mouse cursor / browser navigation (B = Back). Reports say Edge prompts to "use game controls", and holding Menu can switch to "Use game controls"; some reports of View button focus loss. Legacy Edge had `navigator.gamepadInputEmulation`.
- Implemented: fullscreen on Play (`requestFullscreen`, may need a user activation that a gamepad press may not give), cursor hidden by CSS, A's hub sets `gamepadInputEmulation` if present and traps history (`pushState`/`popstate`), `main.js` also `preventDefault`s Escape/BrowserBack/GamepadB, and the lobby shows "No controller detected - hold Menu and choose Use game controls" while `hub.controllerHint` is true.
- Sources: https://itch.io/post/7950872, https://itch.io/post/7955406/view-in-topic, https://itch.io/post/7951093, https://docs.webrcade.com/platforms/xbox/, https://lists.w3.org/Archives/Public/public-webapps-github/2015Oct/0467.html

### Verification (headless pane at 1920×1080 / 1180×820; pointer lock unavailable so I forced `hub.pointerLocked`/`noLock`)
- **Computer regression:** mine (mouse events through the hub) → E opens inventory → craft via pointer events → close → smart-place the table → bed + sleep → save v2 → reload → Continue restores inventory, world, spawn, goals. Real v1 save on the old key loads and is rewritten as v2. Death → Save & Quit → Continue restores the respawned player with the death drops.
- **Computer + fake pad:** combined source, RS look, RT mine, Y inventory, D-pad focus + A craft, B close, LT place, Menu pause, A resume (no lock).
- **Xbox, 4 fake pads:** lobby join (Menu) ×4, start with A, 4 quadrant views with coloured borders, own HUDs/hotbars/hints (screenshots of 4, 3 and 2 seat layouts). P3 controller-only crafting in its quadrant (Y, RB tab, D-pad, A, X, LB). Drop-in (2→3) and drop-out via pause menu (3→2) without errors; P3's inventory persisted in the save and returned on rejoin. Zombie hurt only the nearest player; 2/3 in bed no skip, 3/3 skip; one death left the others alone, A respawns; disconnect overlay + same-pad resume.
- **Xbox performance** (1920×1080, 6 498 blocks, no shadows/bloom per `qualityBudget`, frame = game update + render + `readPixels` GPU sync on the dev Mac): 4 views median 4.7 ms, p90 5.4 ms, max 10.1 ms; 3 views median 6.8 ms, p90 7.3 ms (target ≤ 33 ms).
- **iPad 1180×820, synthetic touch Pointer Events:** drag look, joystick move, hold Mine breaks, Use places, Jump, Sneak toggle, Inventory button, tap/long-press crafting, tap slot to move, ✕ closes, overlay hides in menus, no page scroll.
- **Launcher + built site** under a sub-path: links resolve, no console errors on index/computer/xbox/ipad.

### Deviations / notes
- All seats spawn on the one-block (offsets of 0.2 apart), so drop pickups on ties go to the first seat; players are not solid to each other.
- New seats mid-game spawn at their bed or the world spawn (inventory/bed come from the slot).
- `Game.relayout()` calls `renderer.setViews(activeViews)`; at the title it calls `setViews([])`. There is still a small `LegacyView` fallback in `Game.js` for a renderer without `createView` (unused now).
- The iPad inventory/pause buttons are A's overlay buttons; I did not add my own.
- Xbox safe area: A's views inset by `safeArea`; my global HUD/title/menus are inset 5 % by CSS.

### Known gaps
- Not run on a real Xbox Series X / Edge or a real iPad: controller emulation quirks, fullscreen activation, Safari touch quirks and audio unlock are untested.
- Frame timing in the headless pane is only a proxy for the TV.
- Goals (J / X) open as a seat panel; on a single seat they still pause the world, with several seats they do not.
- Text sizes for the couch (uiScale 1.5) are applied via the HUD scale cap; the global panels are not enlarged beyond that.


## Platforms round (Builder A) — APIs landed

**Status: API surface is in and working** (multi-view renderer, avatars, InputHub with Kbm + Gamepad + Touch + combine). Polish / measurements follow below as they get done. Verified so far in the demo (`demo.html`, `Split screen views / platform` selectors): 1/2/3/4 views at 1920x1080 with safe area, avatars + name tags visible in other views.

### Renderer (`src/render/Renderer.js`, `View.js`, `Avatar.js`) — as SPEC-PLATFORMS §3a
- `setPlatform(key)`, `setSafeArea(frac)`, `createView(seat)`, `setViews(views)`, `views` (array of the *active* views; `[defaultView]` when none were set), `getViewRect(view)` (CSS px relative to the container, already includes the safe-area inset), `createPlayerAvatar(seat)`.
- `View`: `seatIndex, camera, setHighlight, setBreakProgress, setHeldItem, swingHand, setViewmodelVisible, setUnderwater, setDamageFlash, setFov`. Extra: `view.rect`, `view.hand`, `view.active`, `view.dispose()`.
- **Back-compat:** the renderer owns an implicit default view; `renderer.camera` and all single-view methods (`setHighlight`, `setHeldItem`, `swingHand`, `setViewmodelVisible`, `setUnderwater`, `setDamageFlash`, `renderer.hand`, `underwater`) target the *first active view*. After `setViews([a,b])`, `renderer.camera` becomes `a.camera` (re-read it; do not cache it across `setViews`).
- Views are laid out with `viewportRects(n)` inside the safe area; `qualityBudget(n, platform)` is applied on every `setViews`/`setPlatform`/`setQuality`. `setQuality('low')` additionally trims it. 1-2 views use the HDR+MSAA composer (bloom only with 1 view); **3-4 views render straight to the canvas** (no MSAA, no post, no shadows), smoothness first.
- 1 px dark separator lines are drawn between views; B draws the coloured borders (DOM) from `getViewRect`.
- Per view: camera, highlight, crack overlay, viewmodel, underwater fog + DOM tint, damage vignette. Shared: world, sky, particles, point lights (nearest to ANY view), one shadow map centred on the centroid of the cameras. Camera layers: highlight/crack on layer `1+seat` (only that seat's camera sees them), avatars on layer `8+seat` (every camera except the owner's sees them).
- `Avatar`: `object3d` (already added to `renderer.scene`; `dispose()` removes it), `update(dt, {x,y,z,yaw,pitch,moving,sneaking,swinging,heldItemKey,hurt,dead})` where x,y,z are the **feet** position and yaw/pitch are the camera's, `setVisible`, `dispose`. Outfit tinted with `SEATS[i].color`, name tag P1..P4 (always faces the camera, drawn on top).
- Ambient motes follow the first view only.

### Input (`src/input/**`) — as SPEC-PLATFORMS §3b
- `import { InputHub } from './input/InputHub.js'`. Constructor options exactly as the spec. `hub.poll(dt)` once per frame before game logic.
- Platform inputs come from `platform.inputs`: `kbm` -> `hub.keyboardMouse`, `touch` -> `hub.touch` (creates the on-screen controls overlay inside `container`), gamepads always scanned (standard mapping only; non-standard pads are ignored).
- Sources: `pressed(action)` (edge, consumed on read, silently expires after 250 ms if never read), `down`, `move()`, `look()` (radians to ADD this frame), `setMode('play'|'menu')`, `glyph(action)`, `rumble(i, ms)`, `kind`, `id`, `connected`, `seatIndex`.
- **Keyboard/mouse:** faithful port of `src/game/Input.js` (double-tap-W sprint latch, Ctrl sprint, Shift sneak, wheel -> `hotbarNext/Prev`, digits -> `hotbar1..9`, E `inventory`, J `goals`, Q `drop`, Ctrl+Q `dropStack`, Space `jump` edge, click-to-lock, buttons only count while locked). In `menu` mode arrows/Enter/Esc/Tab produce `ui_*`. `hub.lockOnClick` (default true) lets the game stop a click from re-locking while a UI is open. There is **no `pause` edge from the keyboard** (Esc exits pointer lock -> `onPointerLockChange(false)`), like the old code.
- **Gamepad:** LS move, RS look (radial deadzones 0.16 / 0.12, quadratic-ish curve, +55 % after 0.45 s at full deflection, `settings.sens`/`settings.padSens`/`invertY`), RT/LT = `primary`/`secondary` (hysteresis 0.5/0.35), A jump, B `drop` (tap) / `dropStack` (hold 0.6 s, fires once), Y `inventory`, X and View `goals`, Menu `pause`, LB/RB and D-pad L/R hotbar, L3 sprint (until stick released), R3 sneak toggle. Menu mode: stick/D-pad -> `ui_up/down/left/right` (first fire immediately, repeat after 350 ms, then every 110 ms), A `ui_accept`, B `ui_back`, X `ui_alt` (quick-move), Y `ui_split`, LB/RB `ui_tabPrev/Next`; Menu still raises `pause`.
- **Seats:** `hub.unassignedJoinPresses()` returns unassigned pads that pressed Menu since the last call (set `hub.joinOnA = true` on the lobby screen to also accept A). `hub.assign(src, seat)` / `unassign`. A disconnected pad keeps its source object (so the seat can show "Reconnect controller") and is revived if a pad with the same index returns; `hub.onDisconnect(cb)`, extra `hub.onConnect(cb)`.
- **Touch (iPad):** overlay `.ob3d-touch` inside the container, click-through except its buttons; gestures are read from the container with Pointer Events (`pointerType === 'touch'`): left 38 % = dynamic joystick (past 90 % sprints), anywhere else = look drag, buttons Mine (hold), Use (tap/hold), Jump, Sneak (toggle, lit), Inventory, Pause (top right). It hides itself in `menu` mode. Taps on other DOM (your hotbar etc.) are ignored by the overlay, so give those elements their own pointer handlers. `hub.onUserGesture` (optional callback you can set, e.g. `() => sound.resume()`) is called on key/mouse/touch down.
- `hub.combine(a, b)`: merged source (computer: `hub.combine(hub.keyboardMouse, hub.gamepads[0])`); glyphs follow whichever device was used last. NOTE: a pad that connects later has to be combined by you when `onConnect` fires.
- `hub.controllerHint` is true on Xbox while no pad is visible to the page (show "Hold Menu, then choose Use game controls").
- Node tests: `node src/input/__tests__/input.test.mjs` (deadzone, curve, edge consumption/expiry, menu repeat timing, trigger hysteresis, B tap vs hold, sneak/sprint, menu mode, join presses, combined).

### Deviations
- `createView(seat)` always makes a fresh View; the implicit default view stays inactive once you `setViews([...])`.
- `Avatar.object3d` is added to `renderer.scene` automatically.

### Platforms round — verification, Xbox findings, known gaps
**Verified (demo at `/demo.html`, Vite on 5174, fake gamepads per SPEC §5):**
- 1/2/3/4 views at 1920x1080 with the xbox safe area (5 %): correct `viewportRects` layout, dark separators, per-view highlight/viewmodel, avatars + coloured P1..P4 tags visible in the other views and absent from their owner's view. 4 fake controllers each press Menu -> seats join and the layout reflows 1->2->3->4; a stick drives a seat; `glyph('primary')` is `RT`.
- iPad at 1180x820 with synthetic touch `PointerEvent`s: joystick moves (past 90 % sprints, releases to 0), drag looks, Mine/Use held states, Jump, Sneak toggle, Inventory/Pause edges, overlay hides in menu mode, page does not scroll. Buttons are 64-92 px.
- Frame time (GPU-synced, Apple GPU, hidden pane, 2769 blocks, 1920x1080 canvas, `setPlatform('xbox')`): **4 views 3.4 ms (259 draw calls, 35k tris), 3 views 3.0 ms, 2 views 19.7 ms (HDR+MSAA+shadows), 1 view 18.3 ms (+bloom)**, 4 views low quality 2.2 ms. Optional MSAA for 3-4 views (`renderer.setMultiViewAA(true)`) costs about 8.7 ms at 4 views. The Series X will be slower than this Mac (CPU/draw calls matter more with 4 views), but there is large headroom against the 33 ms target.
- Node tests: `node src/input/__tests__/input.test.mjs`, `node src/world/__tests__/world.test.mjs` pass; full `npm run build` passes now that B's pages exist; `computer.html` boots with the new renderer and no console errors.

**Xbox / Edge findings (web research; could not test on a console):**
- Chromium Edge on Xbox does expose the Gamepad API to pages once a button is pressed, but it has a "mouse/cursor mode" in which the sticks move a pointer. `navigator.gamepadInputEmulation = 'gamepad'` only existed in legacy EdgeHTML; the hub still sets it when present (harmless). Chromium Edge has **no page-level switch**: the player holds **Menu -> "Use game controls"**. UI should show `hub.controllerHint` ("Hold Menu, then choose Use game controls") while no pad is visible.
- In browser mode **B navigates Back**. The hub (when `platform.key === 'xbox'` or the UA contains "Xbox") pushes a history entry and re-pushes on every `popstate`, so B/Back cannot leave the page. In game-controls mode B reaches the page as button 1. Fullscreen needs a user gesture; pad presses in game-controls mode may not count as one, so B should request fullscreen from the first click/Play press in cursor mode.
- Sources: [Edge on Xbox guide](https://www.microsoft.com/en-us/edge/learning-center/how-to-use-microsoft-edge-on-xbox), [Xbox controller moving the cursor (Microsoft Q&A)](https://learn.microsoft.com/en-us/answers/questions/4292451/xbox-controller-moving-mouse-cursor-how-to-stop), [Xbox fullscreen / game-controls flow (opti-sailing PR)](https://github.com/retromonk/opti-sailing/pull/33). Treat as unconfirmed until tested on hardware.

**Known gaps / notes for B:**
- Held-item pose on avatars is approximate (sprite tools are rotated by eye); name tags are drawn over geometry (no depth test) so they stay readable through walls.
- Ambient motes/dust follow the first view only; shadows are centred on the centroid of all cameras (R = 30), so players far apart on a big build may leave the shadow area.
- Touch overlay does not draw its own hotbar; `inventory` is a plain `pressed('inventory')` edge, B opens the UI and calls `setMode('menu')`. The joystick/look use `settings.sens` / `invertY`.
- A pad that connects after startup is not auto-combined with the keyboard on the computer platform: call `hub.combine(hub.keyboardMouse, pad)` from `hub.onConnect`.
- Non-standard-mapping controllers are ignored.
