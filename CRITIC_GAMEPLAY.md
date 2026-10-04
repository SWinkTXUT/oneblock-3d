# CRITIC: Builder B (gameplay & UI)

Method: read SPEC/HANDOFF/data/game/ui/audio code; ran both existing test files (7 + 6 pass); wrote throwaway adversarial scripts in `/private/tmp/claude-501/crit/` (`adv.mjs` data/inventory/furnace probes, `kb.mjs` knockback probe); drove the real game in the Browser pane on port 5182 (the pane has no pointer lock and a throttled rAF, so I forced `input.locked`, stepped `updatePlay` manually and used `window.__game`). Console: zero errors/warnings during the whole session. Vite server killed. No source files edited (one `npm run build` was run; `dist/` is git-ignored).

## Verdict

The game is mechanically solid and visually polished. Data tables, recipes, loot, smelting math, inventory/armor-slot rules, save/load (incl. furnace/chest entities), bed, ice-to-water, one-block protection and phase looping all check out, and the UI (title, HUD, inventory + recipe book, furnace, chest, goals, settings, death, phase banner) looks good and reads clearly. The weak spot is the first ~100 breaks. (1) A new player gets no guidance: spawn pitch is 0 so the screen is just sky, and the only "punch the block" text is buried in the J panel. (2) Expanding the 1x1 island is almost undiscoverable: a ~4 degree pitch window. (3) A zombie rolled from the One Block spawns inside the player's own column and its knockback launches an off-centre or un-sneaking player off the island. I measured death in 5 of 8 bare-handed trials, and a fall in every knockback-probe case except dead-centre sneaking, with the inventory then lost to the void. That is the one finding I'd call a blocker. There is also a Save & Quit-from-death bug that writes a dead-in-the-void save. Everything else is polish.

## Acceptance criteria (SPEC section 14)

| # | Criterion | Result | Evidence |
|---|---|---|---|
| 1 | build passes; dev serves with no console errors | PASS (game page) | `npm run build` OK (only a >500 kB chunk warning). Game page loaded and ran a long scripted session with an empty console. demo.html not opened (Builder A scope). |
| 2 | demo.html blocks/day-night | UNVERIFIED | Out of Builder B scope; not exercised. In-game night sky (stars, moon) and phase ambience looked right in screenshots. |
| 3 | punch, logs, planks, table, wooden pickaxe, into phase 2 | PASS with usability caveat | Real DOM clicks on the recipe book: logs to 20 planks (shift-click) to crafting table; pickaxe row craftable. Forced plan always yields at least 3 logs by break 5 (2000 plans; min logs in first 100 breaks = 11). Phase 2 banner fired at break 100. Caveat: P1-1, P1-2 (nothing says punch; placing the table is very hard). |
| 4 | Shift stops edge fall; walking off = void death + death screen | PASS | Browser: sneak+S stopped at x=-0.296, y=1. sim.test confirms void death. Death screen shows the cause. |
| 5 | place/break updates mesh; AO; torch glow | PARTIAL | Table/dirt/stone placement and breaks visibly updated within a frame. AO and torch light are renderer-side (not examined). |
| 6 | sheep killable and shearable; zombies spawn at night, chase, hurt, burn, drop flesh | PASS (logic) | Sheared: wool x3, second shear refused, killed sheared sheep dropped 2 mutton and no wool. Zombie chased and hit for 3 per second. Burn and loot are code-verified. Night spawning only occurs with terrain 8-24 blocks away (P1-5). |
| 7 | furnace smelts + keeps going closed; chest stores; bed skips night | PASS | Furnace ran with UI closed, block swapped to lit_furnace (id 49), ingots banked. Chest quick-move OK. Sleep at t=400 led to t=5; daytime refused with message; zombie within 8 refused. |
| 8 | seeds to wheat; saplings to trees | PASS | sim.test.mjs (timers, farmland decay, tree growth). Not re-run in browser. |
| 9 | reload restores world/inventory/progress | PASS with quirks | `save()`, wipe, `readSave()/applySave()` gave identical inventory, durabilities, armor, furnace state (burn/cook), chest slots, blocksBroken. Quirks: time of day reset by title (P2-2), dropped items not persisted (P1-4), Save & Quit from death corrupts the save (P1-3). |
| 10 | >=55 fps with a few thousand blocks | PASS (conditional) | 2,980 blocks, 1024x768, high quality: 4.4 ms/frame including `gl.finish()` (adaptive pixel ratio 1.1). Hidden throttled pane, so real fps UNVERIFIED, but headroom is large. |

## Findings

### P0

**P0-1. A One-Block zombie spawns on top of the player and kills them on a bare island.**
- Where: `src/game/Game.js:229` (`mobs.spawn(next.mob, 0.5, 1.05, 0.5)`), `src/game/mobs/Zombie.js:47-50` (first hit has `atkCd = 0`), `src/game/Player.js:161-164` (knockback: 6 m/s horizontal plus `vy >= 4.5`).
- Evidence: `kb.mjs` with the real `Player` and `World`: one zombie hit from 0.25 blocks away sends the player off the 1x1 island in every case except dead-centre while sneaking (not sneaking, px=0.5: falls; sneaking, px=0.35/0.2/0: falls). Airborne knockback travels ~1.0 m and the sneak guard only applies on the ground. In the browser, zombie spawned at (0.5,1.05,0.5) with the player within +-0.15 of centre: 16/16 immediate falls. Dead-centre there is no horizontal knockback but the player lost 17 HP in 6 s (zombie 20 HP vs fists 1 dmg per 0.5 s). Bare-handed fight with LMB held (8 trials): player died or fell 5 times, usually within 0.8 s. Phase 2 starts at break 100 with a 1/20 zombie roll per break (about 7 expected), and given P1-2 many players will still be on 1x1. Void death loses the whole inventory (`Game.js:635`); respawn is on the same island with the zombie possibly still there.
- Fix: (a) spawn grace: `atkCd = 2.5` on spawn, and skip the zombie roll while the player is within ~1.5 blocks of the One Block and their platform is under ~9 solid blocks (or make the roll mob a sheep). (b) Cap player knockback: `Player.js:163` change `vy = max(vy, 4.5)` to about 0 to 1.5 and `6` to about 3 so a hit can't throw a standing player more than ~0.4 m. (c) Let sneak resist knockback in the air.

### P1

**P1-1. No onboarding; the first screen is empty sky.**
- Where: `Game.js:100` (`player.reset` leaves pitch 0); `Goals.js:3` is the only "Punch the One Block" text; title hint line `UI.js:373`.
- Evidence: screenshot after Play shows only sky, HUD, crosshair. The block is directly underfoot and needs a pitch of about -80 degrees to see or hit (pitch -0.9 misses). Nothing mentions it.
- Fix: on a fresh world set pitch to about -1.45 and show a persistent hint ("Hold left click to punch the block under you") cleared on first break, then one-line chained hints (E to craft, how to place).

**P1-2. Placing a first block (table, dirt) on a 1x1 island is nearly impossible.**
- Where: `Game.js:576-600` (`placeBlock`, overlap rule at line 586).
- Evidence: standing on the block, RMB on the top face targets cell (0,1,0), which overlaps the player: silently does nothing. The -x side face is reachable only when sneaking at the edge in a pitch band of -1.38 to -1.44 (about 4 degrees; found by scanning pitch). The only easy route is jump + RMB while airborne (worked at y=2.03), which puts the block on top of the One Block and blocks further mining. The table is the first thing a player needs to place.
- Fix: when top-face placement fails due to the player's own box, place on the neighbouring cell nearest the crosshair hit point (or in the facing direction) and show feedback; at minimum add "You're standing there" feedback. Make bridging forgiving.

**P1-3. "Save & Quit to Title" on the death screen overwrites the clean death-save with a dead player.**
- Where: `src/ui/UI.js:328` (`player.dead = false; game.toTitle()`), `Game.js:127-136`, `saveAfterDeath` `Game.js:645-654`.
- Evidence (browser): void death: `saveAfterDeath` wrote `{x:0.5,y:1,health:20}`. Clicking Save & Quit then wrote `{x:5.5,y:-40.03,health:0}`. After Continue the player starts at y=-40 and dies on the first frame (death screen again). For a zombie death it saves the corpse position instead of bed/One Block.
- Fix: reset the player to `spawnPoint()` before `toTitle()` in that button, or skip the save in `toTitle` while dead.

**P1-4. Items dropped on death are never persisted, so closing the tab after dying loses everything permanently.**
- Where: `Game.js:631-654` (drops spawn, then `saveAfterDeath` stores an empty inventory); `Drops` not serialized.
- Evidence: death save has all-empty `inv.slots`. Combined with P0-1 this is harsh.
- Fix: defer the death-save until Respawn is pressed (a reload mid-death-screen then restores the pre-death state), or serialize nearby drops.

**P1-5. Night is toothless on a small island, then abruptly lethal on a big one, with no warning.**
- Where: `src/game/mobs/MobManager.js:54-60` (zombie spawn ring 8-24 blocks and needs `topSolidY` terrain), `Game.js:178`, `UI.js:124` (only the clock label changes at dusk).
- Evidence: on a 61x61 platform at night an idle bare-handed player died in 13 s (up to 6 zombies at once). A 1x1 to 5x5 island never sees a night zombie (ring starts at 8), so criterion 6 is invisible to most players until they expand.
- Fix: dusk banner ("Night falls"), ramp zombie count over the first minute, and include a nearer ring (4-12 blocks) over placed platforms.

**P1-6. No "what next" guidance in the HUD.**
- Where: `UI.js:buildHud`, `Windows.js:137-157`.
- Evidence: "Requires a nearby Crafting Table" is shown but nothing says how to place one; goals exist (`Goals.js`) but are only visible in the J panel.
- Fix: show the first undone goal's description under the phase panel.

### P2

**P2-1. Fresh install title shows two identical buttons ("Play" and "Play (new world)").** `UI.js:365-370`. Show one Play button until a save exists.

**P2-2. Title screen mutates the world clock, so quitting or reloading at night resumes in the morning.** `Game.js:249-251` (`updateTitle` advances `state.time` and clamps it to daylight), then `pagehide`/`visibilitychange` saves it. Free night-skip and a minor violation of "progress restored". Use a separate title clock.

**P2-3. No "Inventory full" feedback.** `Drops.js:46` silently skips the magnet when `canAdd` is false; items sit on the island (or are evicted at `MAX_DROPS = 140`, `Drops.js:13`). Add a rate-limited `ui.message('Inventory full')`.

**P2-4. Recipe rows re-sort under the cursor after every craft.** `Windows.js:165-167`. Observed rows swapping between clicks; risks mis-clicks when crafting several items. Keep stable order and only dim.

**P2-5. Shift-click of logs into a furnace goes to input (charcoal), never fuel.** `Windows.js:236` (`SMELTING[s.key] ? fIn : def.fuel ? fFuel`). If the input slot is occupied by another item the log doesn't fall through to fuel.

**P2-6. Goals/Inventory/Chest/Furnace windows do not pause the world.** `UI.js:11`. A zombie can kill you while reading Goals (J). Pause for `goals` at least.

**P2-7. Hunger is effectively decorative.** `Game.js:422` (0.005 per block); walking costs nothing (`Player.js:107-112`, only sprint). 1300 breaks cost about 1.6 hunger points, so food and farming (headline features) carry almost no pressure. Raise block exhaustion or add a small walk/jump cost, or accept as design.

**P2-8. Dead-end materials.** `gold_ingot`, `gold_ore`, `quartz`, `amethyst`, `magma`, `obsidian`, `string` have no recipes (`recipes.js`, `items.js:114`). Gold/quartz are in loot and ore tables, so they are dead drops. Add uses or drop them from loot.

**P2-9. Leather armor is vestigial.** First leather source is snow-phase chests (P=0.72 per chest, 1-3 each, `adv.mjs`) or zombie flesh smelting, and a full set costs 24; iron armor (also 24 ingots) is reachable from phase 2. Consider leather from sheep or a cheaper first armor tier.

**P2-10. Zombies steer straight at the player through walls.** `Zombie.js:26,43-46`. Matches the spec's straight-line steering, but they ignore cover and stall at ledges; acceptable.

**P2-11. Esc behaviour unverified in real Chrome.** Esc in Pause is a no-op (`UI.js:251`, documented browser-lock limit); Esc closing Inventory/Chest/Furnace (`UI.js:252`) re-requests lock and may land in Pause if refused. Not testable here (no pointer lock). Add a "Click to resume" hint.

**P2-12. Day/night boundaries differ from spec and leave a gap.** `Game.js:178-179`: night is 345-555, "day" (burn/sheep) is <320 or >=560. In 320-345 and 555-560 neither sheep nor zombies spawn and zombies don't burn. Spec: night 360-540.

**P2-13. Mob geometry is not disposed.** `Mob.js:96` disposes materials only; `MobModels.js` builds fresh geometry per mob (not profiled). Minor GPU leak in very long sessions.

## Checked and correct (no action)

- Recipes/loot/drops/smelting keys all resolve to real items (`adv.mjs` printed no BAD lines; only `farmland` and `string` are unobtainable, both expected). Chest loot never overflows a stack or repeats a key.
- Mining formula matches SPEC section 6 (hand log 3.0 s, stone with wooden pick 1.125 s, iron ore with wooden pick 7.5 s and no drop, obsidian harvestable only with a diamond pick, 2.81 s).
- Phase loop: `phaseInfo(1299)` skylands, `phaseInfo(1300)` plains cycle 2; forced plan not reused in cycle 2. Phase 2 banner and ambience fire at break 100.
- One block protection: placing onto (0,0,0) refused (stone and water bucket); ice at the One Block does not leave water; mid-regen saves restore the block on load.
- Chest rolled at the One Block: loot present, RMB opens it, breaking by hand releases loot and the block regenerates (phase 5 test: iron ingots, coal, torches, iron helmet).
- Armor slots (wrong slot rejected, shift-click auto-equips, defense total correct); stack split / place-one; cursor stack returned to inventory (or dropped when full) on window close.
- Furnace math: planks 15 s (1 smelt plus 5 s wasted), 4 sticks = 1 smelt (2 left), coal 80 s = 8 smelts, blocked output halts without burning fuel, non-smeltable input keeps fuel. Block entities survive save/load.
- Bed: night skip, daytime refusal message with spawn set, monsters-within-8 refusal; spawn point honoured on respawn.
- UI polish: title, HUD, inventory + recipe book, furnace, chest, goals, settings, death, phase banner all rendered cleanly at 800x600 and 1024x768 with no overlap.
