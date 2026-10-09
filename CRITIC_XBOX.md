# CRITIC_XBOX: Xbox split-screen review

Method: Vite on :5183, built-in browser at 1920x1080, scripted fake standard-mapping pads (`navigator.getGamepads` override plus `gamepadconnected`). The pane was often hidden, so rAF stopped; I drove frames with a timer loop and also called `updatePlay`/`render` directly. No source files were edited. The save key was cleared at the end and the server killed.

## Verdict

The Xbox version is functionally solid in the headless pane. Lobby join 1→4, quadrant/half/3-seat layouts, per-seat HUDs and borders, name tags and avatar visibility, controller-only mining/placing/crafting/chest/furnace, drop-in/leave, disconnect/reconnect, per-seat death, all-in-bed sleep, nearest pickup and the v2 save all worked with no console errors.

It is **not couch-ready** for four reasons:
1. TV text is far too small. `--ui-scale` 1.5 is declared but never used in CSS, so most text lands at 11–14 px effective at 1080p.
2. A pause-owner pad disconnect soft-locks the whole table.
3. Saved-seat ownership is by join order, not by controller, so inventories go to whoever joins in that slot.
4. Performance falls off a cliff at 1–2 views. They cost about 17–21 ms on this Mac against about 2 ms for 3–4 views, and the 1–2 view path is the one that will miss 30 fps on a console that is 2–3× slower.

The riskiest real-console item is Edge's controller mode. If the player never picks "Use game controls", nothing works. Pressing Menu to pause and join also collides with Edge's hold-Menu menu.

## Acceptance (SPEC-PLATFORMS §6)

| # | Item | Result | Evidence |
|---|---|---|---|
| 3 | 4 pads → lobby → 4 quadrants, coloured borders, own HUD/hotbar | PASS | Pads 0–3 joined by A/Menu. Rects were (96,54,864,486) etc. Borders, P1–P4 chips and per-seat hearts/hunger/hotbar were all present. |
| 3 | Independent move/look/mine/place | PASS | One 1 s stick script moved P1 fwd, P2 strafed, P3 yawed and P4 pitched independently. 3 drops appeared from four mining seats. P2 placed dirt (5→4). Hotbar LB/RB/D-pad worked per seat. |
| 3 | Own inventory + craft with controller only in a quadrant | PASS (see F10) | Y opens a tabbed window in the quadrant. RB goes to the book. DOWN+A crafted planks, X crafted max (24), LB returned to the inventory. A/Y/X on slots (pick, split-one, quick-move) were correct, and B closed. Chest (two seats, live sync, closed on break) and furnace (X quick-move input and fuel, it smelted) were fine. |
| 3 | Avatars and name tags in other views, not own | PASS | Screenshot with players spread out: each view shows the others' coloured avatars with P-tags and never its own. |
| 4 | P3 leaves 3→2, joins mid-game 2→3, no errors | PASS | Pause → "Leave game (P3)" took 3 DOWN presses. The layout became 3 views (P1 top, P2/P4 bottom). Menu on the same pad rejoined, got "P3 joined" and the inventory back. No console errors. |
| 4 | Inventory persists in save | PASS with caveat | The v2 save held seats[0..3]. After a reload, slot data (P2 `dirt4,stick9`) was restored. **Ownership is by join order, not by pad: see F3.** |
| 5 | Zombies chase nearest | UNVERIFIED live, plausible by code | `Zombie.think` uses `nearestSeat`. Natural night zombies killed seats during my run, but I did not isolate a clean two-player nearest test. The team.js unit tests cover it. |
| 5 | Night skip only when all living in bed | PASS | At night, P1 in bed showed "P1 sleeping (1/3)", then P1,P2 showed "(2/3)", and time was unchanged. P3 in bed made sleepT 2.3 and time 7, with all spawns set. A dead seat does not block. |
| 5 | One death doesn't affect others | PASS | The death screen appeared in the seat rect only, and others stayed in play mode. A on the death screen respawned that seat (pad index matters, my mistake). |
| 6 | Save v2 3-seat round trip | PASS | Keys `world,state,entities,goals,drops,seats,v,t`. Seat data, sel and x all restored after reload. |
| 6 | Drops to nearest seat with room | PASS | Tie goes to P1. When P1's inventory was full, the drop went to P2. |

## Performance (1920x1080, 3040 blocks, GPU-synced with readPixels, this Mac)

Median ms per frame (game update + render):

| Views | Budget path | ms |
|---|---|---|
| 4 | direct render | 2.0 |
| 3 | direct render | 1.8 |
| 2 | HDR + MSAA composer + shadow | 16.7 |
| 1 | HDR + MSAA composer + shadow + bloom | 20.7–21.6 |

Variant breakdown at 1 view:

| Variant | ms |
|---|---|
| Composer, no bloom | 11.9 |
| Composer, no bloom, no shadow | 9.8 |
| Direct render + shadow | 1.9 |
| Direct render, no shadow | 1.1 |

At 2 views:

| Variant | ms |
|---|---|
| Default | 16 |
| Direct render + shadow | 3.3 |
| Direct render, no shadow | 1.3 |

So bloom costs about 10 ms, the half-float 4× MSAA composer about 8–10 ms, and the shadow about 1–2 ms. One run showed 114–120 ms outliers from GPU contention with another agent's tab, which I discarded.

**Recommended `qualityBudget` for xbox** (the renderer needs a small change to honour it):
- Add `composer: false` (HDR+MSAA off, direct render) for all xbox view counts, and make `Renderer._applyBudget` use `useComposer = b.composer ?? (n < 3)`. Today `useComposer` ignores the budget, so `platform.js` alone cannot fix 2 views.
- 1 view: `{shadows:true, bloom:false, composer:false, pixelRatioMax:1, viewDistance:80, pointLights:6}`. At 2.5× this is about 5 ms, leaving room for bloom to be re-enabled via an optional setting.
- 2 views: `{shadows:true, bloom:false, composer:false, viewDistance:56, pointLights:3}`. Shadow map 1024 (it is 1536 now).
- 3–4 views: keep as is (`shadows:false`, `viewDistance:48`). Optionally add MSAA via `setMultiViewAA` only if the console shows more than 10 ms of headroom.
- If MSAA is wanted, use `samples:2` or the final-blit approach, not 4× half-float.
- The dynamic-resolution ladder floors at 1.0 (`_levels`), and xbox is already at 1.0, so adaptation can only shed bloom. Add 0.75 and 0.6 levels for xbox so a slow console degrades by resolution, not frame rate.
- `qualityBudget(1,'xbox')` is currently the same as the computer's best path. Treat the 20 ms Mac number ×2.5 = about 50 ms (about 20 fps) as the expected 1-player result.

## Findings

### P0

**F1. `--ui-scale` is a no-op, so TV text is unreadable.** `src/main.js:6` sets `--ui-scale`, but `src/styles.css:271` only declares it and nothing consumes it. `SeatUI.layout()` (`src/ui/SeatUI.js:~118`) scales the HUD by `min(cap, r.w/520, r.h/380)`, which gives 1.28× in a quadrant. Measured effective sizes at 1080p:

| Text | Size |
|---|---|
| Hint bar | 11 px × 1.28 ≈ 14 px |
| Name chip | 9 px |
| Hotbar number | 9 px |
| Phase panel info/tracker (`styles.css:70-71`) | 9.5 px |
| Phase panel name | 11 px |
| Title control legend (`styles.css:275`) | 13 px |

Xbox guidance is roughly 20 px or more at 1080p. Fix:
- Use `calc(Npx * var(--ui-scale))` for global text, or set `body[data-platform=xbox]{zoom:1.5}` on the global HUD, title and menus.
- Raise the quadrant HUD floor (min scale 0.55) and enlarge the hint/chip text on xbox, and let the hint wrap.
- Phase panel fonts should be at least 16 px, with the panel moved to the top-centre safe band.

**F2. Pause owner's pad disconnect soft-locks all players.** `Game.menuSources()` (`Game.js:~180`) returns only `[owner.input]` while paused, and other seats are `drain()`ed (`Game.js:~449`). `onPadDisconnect` sets `disconnected`, but the pause menu stays. Repro: P1 Menu, then `unplug(0)`, then P2/P3/P4 press B, Menu and A. `ui.current` stays `'pause'` forever. `unassignedJoinPresses` ignores assigned pads, so only the owner's pad returning, or a fresh fifth pad, recovers it. A dead controller battery will do this on a real console. Fix: when the owner is disconnected, or on any disconnect during pause, hand `pauseOwner` to the first connected seat (or let any seat drive the menu); better, auto-close the pause menu if the owner disconnects.

**F3. Saved-seat ownership is by join order.** `Game.handleJoins` (`Game.js:~169`) and `addSeat` assign the first free slot. The save has no controller identity. Repro: P1, P2, P3, P4 played, then reload with pads 0, 2, 3 joining. Pad 2 became P2 and received P2's inventory, and pad 3 became P3 and received P3's. The seat the player had before is arbitrary, and P4's diamonds sit orphaned. A leave-and-rejoin player also takes the lowest free slot, not their old one. SPEC §4 says "P3 rejoining gets P3's inventory back", which cannot hold for a different person. Fix: on Continue, show per-slot cards with a summary ("P3: 23 planks, 3 diamonds") and let each joiner press A on the card they want, or press Menu to take "next free". Alternatively keep slot ownership and let the leaving pad reclaim the same slot.

### P1

**F4. Hint bar sits on the crosshair.** `styles.css:236` has `bottom:168px`. Measured in a quadrant: hint y 272–325, crosshair y 283–311, so the hint covers the aim point. Fix: put the hint near the top of the rect (about 12% down) or lower it to just above the hotbar, with `max-width` 80%.

**F5. A disconnected seat blocks night skip.** `team.js:3` (`isLiving`) ignores `disconnected`, so `sleepStatus` counts the frozen seat as a living non-sleeper. A dead controller therefore stops the whole table sleeping. Fix: exclude `s.disconnected` seats from `sleepStatus`; consider also excluding them from mob targeting, or give them damage immunity while frozen. A frozen player stands in the open and gets killed by zombies, and in the lobby a vanished pad shows "Ready!".

**F6. Ghost seat after a lobby disconnect.** `onPadDisconnect` (`Game.js:~158`) marks `disconnected` even at the title. `startPlaying` (`Game.js:~277`) then does `s.disconnected = false` for all slots. The seat starts with a dead pad, shows no "Reconnect controller" overlay, cannot be taken over (the `dis` search in `handleJoins` needs `disconnected`), and blocks sleep as in F5. Fix: in `startPlaying`, keep `disconnected = !s.input.connected`, and drop seats whose pads are gone before starting.

**F7. Circled-letter glyphs (Ⓐ Ⓑ Ⓧ Ⓨ) in the Press Start 2P/Silkscreen stack.** `GamepadSource.js GLYPHS`, `UI.js` lobby cards and controls line. In the screenshot "Press Ⓨ" rendered as a small ⊙-like symbol. Those code points are not in the web fonts, and the Xbox Edge system fallback is unknown, so they may be tofu on the console. Fix: render buttons as styled HTML chips (a round coloured `<span class="btn-y">Y</span>`) rather than Unicode, with Xbox colours (A green, B red, X blue, Y yellow). Also the lobby "Press Ⓐ to join" says A, but Menu also joins.

**F8. Fullscreen on Play is called from a gamepad press.** `Game.startPlaying()` → `goFullscreen()` swallows the rejection. Gamepad presses do not grant transient user activation in Chromium, so this likely fails silently on the console, leaving the Edge chrome and a smaller viewport. Edge on Xbox has also had "stuck in fullscreen" reports (old, see Sources). Fix:
- Show a one-time "Press the Menu/View button... or choose fullscreen from the Edge menu" hint when `!document.fullscreenElement` on Play, and re-attempt on `pointerdown`/`keydown`.
- Re-read `innerWidth/innerHeight` on `resize` for the 4-view layout.
- On the real console, check whether the viewport is 1920x1080 or 960x540 at DPR 2. Several pixel thresholds (`UI.js innerWidth>=900`, `r.w/520`) depend on it, and `pixelRatioMax:1` would then render soft.

**F9. Menu/pause collides with Edge's hold-Menu menu.** Join and pause are on Menu, and Edge's own "Use game controls" menu is opened by holding Menu. In game-controls mode a short press should reach the page, but this is unverified. `GamepadSource` uses `BTN.MENU` for the `pause` and join edges (and View for goals). Fix: also accept View (button 8) as an alternate pause/join, and print both in the lobby hint. The page also cannot know the mode: add an in-game "no input from controller P_n for 10 s" hint rather than only the "no controller detected" banner (`UI.js updateLobby`).

**F10. Cursor-mode guidance is shown only when zero pads are visible.** `hub.controllerHint` (`InputHub.js:~63`) is true only when `gamepads.length === 0`. After Edge exposes one pad it never reappears, and in cursor mode before the first button press no pad is visible at all. The text is small (the lobby note is 13 px or less). Fix: make the lobby note large and keep it visible with a "Controller not working? Hold Menu, choose Use game controls" line near the title, and rely on the first A press as the proof.

**F11. 60-row recipe book with no jump or default filter.** In the tabbed quadrant the book lists 60 recipes, and reaching "Diamond" takes about 55 D-pad presses (110 ms repeat). Focus can only step row by row. Fix: default the filter to "Craftable", map LT/RT to page up/down (or LB/RB should switch category groups), and keep the table-recipe icon visible.

### P2

**F12. Shared tooltip clobbering.** `UI.showTip`/`this.tip` is one element for every seat (`UI.js`). Two seats moving focus hide each other's tooltip. It is clamped to `innerWidth/innerHeight`, not the seat rect, so a quadrant tooltip can float into a neighbour's window. Fix: one tooltip per `SeatUI`, clamped to its rect.

**F13. Disconnect overlay under the hint.** The seat's hint bar text ("Hold RT to break the block") shows through the "Reconnect controller" overlay (screenshot). `SeatUI.updateHud` should hide `hintEl` and the HUD when `seat.disconnected`. The overlay says "Press Menu on the controller to rejoin", but a controller that is gone cannot press anything. Reword: "Controller disconnected — turn it on again".

**F14. Starting position is a pile-up.** All four seats spawn on the One Block at 0.2 offsets (`SPAWN_OFFS`), and at `pitch -1.3`. The first frame of each view is mostly the other players' torsos (screenshot: solid yellow/red/green blocks). Players are non-solid. Fix: lay out four spawns around the island edge, facing the block, or spawn on a radius of 1.0.

**F15. Safe area draws a visible black frame.** `setSafeArea(0.05)` plus `setViews([])` leave a black 96/54 px margin around the world, including on the title (screenshot). On a calibrated TV this reads as a letterbox. Fix: extend the clear colour or sky to the full canvas and inset only the UI; or drop to 3%. A settings entry for the safe area would also help.

**F16. Leave-and-rejoin heals and teleports.** `addSeat` resets the player to `spawnPoint()`, and `player.reset` restores health 20. A player in danger can leave, rejoin and respawn full health at the bed with all items kept. Fix: restore saved hp/hunger for a slot with data, or only reset position.

**F17. Phase/goal panel overlaps seat content.** The 280x103 top-centre `.ghud .phase` sits over the P1/P2 boundary in the 3- and 4-seat layouts and over the P1 death panel in the 3-seat layout (screenshot). Fix: move to a thin strip or fade it to a one-line "Phase / blocks" and let the seat HUDs dock below it.

**F18. Unsolid players hold chunks of the world.** `addSeat` creates avatars once per slot and only hides them on leave (not disposed). That is acceptable since slots are permanent, but the hidden `avatar.object3d` stays in the scene graph (cheap), and `Avatar.update` stops for hidden seats. Note only: confirm `seat.avatar.setVisible(true)` is reapplied on rejoin (it is).

**F19. Goals and windows pause behaviour differs.** Per HANDOFF a single seat's goals pause the world, while with several seats they do not (`Game.updatePlay goalsFreeze`). A 1-seat game that adds a second seat mid-goals drops the freeze. Low impact.

**F20. `B` drops items in play.** Per spec, but B tap on the controller drops one item. The Edge browser-mode B is Back (guarded by the history trap and keydown guard, `InputHub._xboxGuards`, `main.js:16`), and the extra `pushState` entry means a real Back could still leave if the user hits it more times than the re-push handles. The `popstate` handler re-pushes on each pop, so this should hold, but it is unverified on hardware. Fix: also set `onbeforeunload` while playing.

**F21. Join messages spam all seats.** `ui.message('P3 joined')` goes to every seat's message strip, including dead seats' death screens.

**F22. Title scene avatars overlap the logo.** The lobby avatars at the island (screenshot) sit under the "BLOCK" letters (a tag overlaps the K). Move the camera or hide avatars on the title (`avatar.setVisible(false)` at `showTitle`).

**F23. Test-harness note for future critics.** `Game.frame` is driven by rAF and stops entirely when the pane is hidden. Other agents' tabs also take the shared pane (`tabs_select` needed). Builder docs should say to patch rAF with `setTimeout` and not trust frame timing.

## Xbox Edge realism

The research claims are mostly consistent with what I found:
- Edge on Xbox has a Browsing mode, where the sticks drive a cursor, and a "Use game controls" mode, entered by holding Menu then picking it. This is reported by the [itch.io threads](https://itch.io/post/7950872) and the [webrcade docs](https://docs.webrcade.com/platforms/xbox/).
- Search results did not confirm "B = Back" for Edge in either mode, and nothing confirms the claim for Chromium-based Edge. The history trap and Escape/BrowserBack guard are cheap and reasonable.
- `requestFullscreen` needs transient activation, per [Microsoft Edge policy docs](https://learn.microsoft.com/en-us/deployedge/microsoft-edge-policies/automaticfullscreenallowedforurls), and nothing found says a gamepad press counts. Old [Xbox Edge fullscreen reports](https://answers.microsoft.com/en-us/microsoftedge/forum/all/xbox-microsoft-edge-stuck-in-full-screen/bb00eae1-051b-4db2-8918-9d60f34b8ecd) say it can get stuck in fullscreen. Treat the fullscreen-on-Play path as unreliable.
- In-game guidance is not clear enough. The only cursor-mode text is a small, conditional lobby note (F10), and there is no fullscreen guidance.

Riskiest real-console failures, in order:
1. Controller stuck in browser mode, so no pad is seen or buttons arrive as "unidentified" (F9, F10).
2. Performance at 1–2 players (above).
3. Menu used for pause/join, colliding with Edge's menu.
4. Unreadable 11–14 px text (F1).
5. Fullscreen not entering (F8).
