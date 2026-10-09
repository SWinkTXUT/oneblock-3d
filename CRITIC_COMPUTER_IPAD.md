# CRITIC: Computer + iPad + Launcher (Platforms round)

Tested on the code as of this session. Other agents were editing `src/platform.js`, `src/input/*` and `Renderer.js` during my run; Vite HMR reloaded my page twice. Line numbers are approximate. Browser pane only (no real iPad), pointer lock forced, rAF throttled, so I drove `updatePlay` by hand per HANDOFF. For regression comparison I checked out the pre-refactor commit `0a48ae5` into a temp worktree (removed afterwards).

## Verdict

**Computer: no regression found.** The whole early loop works with real keyboard, mouse and Pointer events: break, log, planks, table placed, sticks, pickaxe, sword, furnace smelts with the window closed, chest persists, bed sleep, death and respawn, save and reload. The post-sleep freeze is gone: after waking, WASD, hotbar, mouse look and E all work. A real v1 save from the old game loads and is rewritten as v2. A fake controller moves, looks, mines, opens the inventory, navigates it and crafts. Every node test file passes (5/5). The launcher and every page load under `/oneblock-3d/` with 0 404s and 0 console errors. The only computer-side oddities are cosmetic (the ✕ on desktop windows) or inherited (HUD above the pause dim, default High quality costs about 50 ms/frame in this pane, identical to the old build).

**iPad: the basic controls work, but it is not shippable on real hardware.** Joystick, drag-look, hold-Mine, Use, Jump, Sneak toggle, Inventory, Pause, hotbar tap, tap-craft, furnace, ✕ and the portrait hint all work with synthetic touch. Three problems would hit a real user at once:
- **Sneak is unreachable on 10.2" iPads (1080×810)** because the hotbar sits on top of it. It also overlaps on iPad mini, and has only a 5 px gap at 1180×820.
- **The global `touchmove.preventDefault` almost certainly kills finger-scrolling** in the 60-recipe book (4015 px of content in a 650 px list), the Goals list and the settings sliders. I confirmed the event is default-prevented; I could not confirm the iOS behaviour on a device.
- **The phase panel covers the top-left of the inventory window.** The advertised double-tap quick-move does not work at all.

Mining while looking also needs a third finger, which is a real ergonomics problem. Frame time is fine (iPad about 2 ms on the dev Mac), but iPad rendering is now flat: no shadows, no bloom, no MSAA.

## Acceptance table

| Criterion | Result | Evidence |
|---|---|---|
| SPEC-PLATFORMS §6.1: build emits 5 pages with relative URLs, tests pass, no console errors | **PASS** | `npm run build` OK. Output: index, computer, xbox, ipad and demo html plus 4 assets; all `./assets/...`. All 5 node test files pass: input, world, logic 7, sim 8, multiseat 7. Served from `/private/tmp/claude-501/site/oneblock-3d/`: index, computer, ipad, xbox, demo all return 200 with no console output. |
| §6.2 Computer: plays as before (break → craft → place → sleep → reload) | **PASS** | See the Verdict loop plus the extras: Q drop, wheel, digits 1-9, Ctrl-sprint, double-tap-W sprint, Shift-sneak (stays on the edge), non-sneak falls, J goals freezes the world, Esc-lock-loss opens pause and Resume works, death → Respawn at the bed with controls live. |
| §6.2 Computer: fake controller can move, look, mine, place, navigate the inventory | **PASS** | `navigator.getGamepads` override and `gamepadconnected`; seat input becomes `combined`. LS moves, RS looks, RT starts mining, Y opens the inventory, D-pad focus, A crafted Oak Planks, B closed, LT placed a block, A on the death screen respawned. Glyph reads "RT". |
| §6.7 iPad: joystick, drag-look, hold-Mine, Use, Jump, Sneak | **PASS (synthetic, with caveats)** | `f=1`, sprint on, look dx −0.42 rad, hold Mine broke the block, Use placed a plank, jump +1.4, sneak toggled on/off with the `.on` class. Sneak is unreachable under the hotbar at 1080×810 (P0-1). |
| §6.7 iPad: inventory and crafting usable by tap | **PARTIAL** | Tap-craft, tap pick/place, long-press craft-max and furnace by touch all work. Recipe-list scroll is blocked (P0-2), double-tap quick-move is dead (P1-4), a slow-tap/fast-tap accident crafts max (P1-5). |
| §6.7 iPad: no page scroll or zoom | **PASS (static)** | `scrollHeight` = 820 = innerHeight; viewport meta is `user-scalable=no, maximum-scale=1`; gesture events are prevented; body has `touch-action:none` and `overscroll-behavior:none`. iOS 10+ ignores `user-scalable=no`, but the gesture handlers cover pinch. Unverified on a device. |
| §6.8 Launcher: three cards, links work under a sub-path | **PASS** | Cards link `./computer.html`, `./xbox.html`, `./ipad.html`. Resolved to `localhost:5185/oneblock-3d/*.html`, all 200. Computer UA gets the "Detected" badge and focus. iPad rule is touch>1 and Macintosh/iPad; Xbox rule is "Xbox" in the UA; I read the code but could not test those UAs. |
| SPEC §14.3 Fresh save: punch → logs → planks → table → wooden pickaxe → phase 2 | **PASS** | Via real mouse events; blocksBroken reached 33 and the phase advanced. |
| §14.4 Shift prevents falling; void death → death screen | **PASS** | Sneak held y=1 at the edge; without sneak y=-8, then the death screen appears and Respawn works. |
| §14.5 Place/break updates the mesh; AO; torches | **PARTIAL** | Place and break confirmed in play (table at (0,0,-1)). AO and torch glow not examined. |
| §14.6 Sheep, zombies | **UNVERIFIED** | Not exercised (mobs are covered by the node sim tests that pass). |
| §14.7 Furnace smelts and keeps going closed; chest stores; bed skips night | **PASS** | Iron ore smelted to iron ingot x2 with the window closed and the block lit. Chest held cobble 8 + dirt 19 across close and reopen. At t=420 the bed set time=5 after the fade, `inBed` cleared, WASD/mouse/E all work. |
| §14.8 Wheat, saplings | **UNVERIFIED** | Not exercised. |
| §14.9 Reload restores world, inventory, progress | **PASS** | Inventory string, entities, spawn and blocksBroken identical before and after the reload. v1 to v2 migration confirmed with a real old-game save. |
| §14.10 ≥55 fps with a few thousand blocks | **FAIL here, no regression** | See P1-3 below. |

Performance numbers (the dev Mac is retina, DPR 2; GPU-synced with readPixels; 4106 blocks):
- Computer 1920×1080 High: median 49.8-59.8 ms, p90 68 ms. The old commit `0a48ae5` measured median 62.8 ms in the same conditions, so there is no regression.
- Computer Low: 1.4 ms.
- iPad 1180×820 (PR 1.25, no composer or shadows): median 2.3 ms, p90 7.6 ms.

## Findings

### P0

**P0-1. Sneak button is hidden behind the hotbar on most iPads.**
- Files: `src/input/TouchSource.js:58` (`sneak: ... right:calc(inset + 190px) ... bottom:inset + 4px`); the hotbar is in `src/ui/SeatUI.js`, `.hotbar` / `.bottom` is centred in `src/styles.css:80`.
- Repro: iPad.html at 1080×810. `elementFromPoint` at the Sneak centre returns `slot hb`. Sneak spans x 800-868, the hotbar spans x 225-855, so tapping Sneak selects slot 9 and sneak can never be toggled. It also overlaps at 1133×744 (iPad mini) and leaves only a 5 px gap at 1180×820.
- Why it matters: Sneak is the only way to avoid walking off the one-block island.
- Fix: put Sneak in the right-hand cluster, for example above Jump. For example `bottom:calc(inset+250px); right:calc(inset+4px)`, or make the touch-layer buttons occupy the right 260 px and cap the hotbar width, for example `max-width: calc(100vw - 2*300px)` with slots shrinking. Also make the hotbar `pointer-events:none` outside its slots.

**P0-2. Finger scrolling is globally disabled, so the recipe book, goals and settings can't scroll.**
- File: `src/main.js:12` (`document.addEventListener('touchmove', e => e.preventDefault(), {passive:false})`).
- Repro: ipad.html, open the inventory. `.booklist` has 60 recipes (`scrollHeight` 4015 vs `clientHeight` 650). A synthetic cancelable `touchmove` on it returns `defaultPrevented === true`. On iOS Safari a `preventDefault` on `touchmove` anywhere on the path blocks inner `overflow:auto` scrolling, so only the first ~9 recipes are reachable (Stone Pickaxe, Furnace, Chest and Bed are further down); the "Craftable" chip is the only workaround.
- Confidence: I verified the event is prevented; the iOS effect is by platform behaviour and is unverified on a device.
- Fix: delete that listener. `touch-action:none` on the canvas container, `overscroll-behavior:none` and `position:fixed` on the body already stop page scroll. If a guard is wanted, only prevent when `!e.target.closest('.booklist,.goallist,.screen')`. Set `touch-action: pan-y` on `.booklist` and `.goallist`.

### P1

**P1-1. Inventory window is covered by the phase/goal panel on iPad.**
- Files: `src/styles.css:283` (`.ghud .phase` z-index 4), `src/ui/SeatUI.js` (window scaled 1.25 to fill the screen).
- Repro: open the inventory at 1180×820. The phase panel sits over the "Inventory" title and the four armor slots (screenshot confirmed). On the computer at 1440 there is no overlap.
- Fix: hide `.ghud` (phase, clock) while any seat window or pause menu is open, i.e. `#ui:has(.seathud.windowopen) .ghud{display:none}`, or add an `.ghud` fade class in `SeatUI.open/close`.

**P1-2. Mining requires a third finger to steer.**
- File: `src/input/TouchSource.js:_move`, which only feeds look from `lookId`.
- Repro: left thumb on the joystick, right thumb on Mine. Looking needs a drag from some other finger, so you can't sweep across blocks while mining. Aiming means lifting a thumb.
- Fix: while a pointer holds Mine or Use, also feed that pointer's `pointermove` deltas into `dyaw`/`dpitch`. The hold-and-drag is what Bedrock does. Optionally add a tap-and-hold on the screen centre to mine.

**P1-3. Computer default High quality is about 50 ms per frame at 1080p on a retina Mac (inherited).**
- File: `src/platform.js` `qualityBudget` (computer: bloom + composer + shadows, `pixelRatioMax` 1.5). 2880×1620 HDR+MSAA+bloom+shadows.
- Repro: computer.html at 1920×1080, 4106 blocks, `renderer.render` plus `readPixels`: High 50-60 ms, Low 1.4 ms. The old build is the same (62.8 ms), so not a regression, but SPEC §14.10 (≥55 fps) is not met by defaults on this machine.
- Fix: `pixelRatioMax: 1.25` or an adaptive quality governor (drop to Low after 30 frames > 25 ms), and default bloom off.

**P1-4. Double-tap quick-move on touch never works.**
- File: `src/ui/Windows.js:16-40` (`pressable`, `lastTap` / `dbl`).
- Repro: wait 1 s, tap an occupied slot twice. Tap 1 picks the stack up onto the cursor. Tap 2 (`shift=true`) hits the now-empty slot, `slotClick` falls to the left-click branch and puts it back. Net result: nothing moves. The documented "double-tap = quick move" is dead, and touch has no shift-click, so moving stacks into the furnace or chest always costs a pick-up tap plus a drop tap.
- Fix: on touch, decide shift at `pointerdown`, with no cursor item: delay the pick-up by 320 ms to see whether a second tap follows; or give the window an on-screen "Quick move" toggle chip; or auto-route taps on items to the other container when a furnace or chest is open.

**P1-5. Two quick taps on two different recipes craft the maximum.**
- File: `src/ui/Windows.js:30`. `lastTap` is per `pressable` node, and the book list is one node for all 60 rows.
- Repro: tap "Oak Planks" and then "Stick" within 320 ms. The second counts as a double-tap, so `craftMax` fired (sticks 4 → 32, planks 15 → 1).
- Fix: track `lastTapTarget` and only treat a double-tap when it is the same row.

**P1-6. Settings sliders are not finger-sized and probably won't drag.**
- Files: `src/styles.css:153-154` (150×10 px track, 14×20 px thumb), `src/main.js:12`.
- Repro: ipad Settings screen; the slider box is 150×10 and the same touchmove prevention applies.
- Fix: on iPad make the slider ≥44 px tall with a ≥36 px thumb, and fix P0-2. Rename "Mouse / stick sensitivity" to "Look sensitivity" on iPad, and include a touch-sensitivity default tied to `settings.sens`.

**P1-7. Joystick sprints on any firm push, and the knob leaves the ring.**
- File: `src/input/TouchSource.js:124-131` (`R = 60`, sprint at 0.9 → 54 px of travel; the ring is 140 px so the radius is 70).
- Repro: push 60 px up: `f=1, sprint=true`. A natural "forward" thumb push is already past 54 px, so you sprint constantly, with +9° FOV, on a one-block island. The knob (64 px) travels 60 px from the centre and so pokes out of the 140 px ring.
- Fix: `R = 80` (or 0.5 × ring), sprint only past `1.25 * R` or by double-tap-push, and clamp the knob inside the ring.

**P1-8. No explanation of the held-cursor inventory model.**
- Files: `src/ui/Windows.js`, `src/ui/UI.js:271`.
- On touch the player taps a stack, which then floats under their last touch point, and taps the destination. Nothing says so. Long-press as "split" and double-tap as "quick-move" are not shown anywhere.
- Fix: show a one-line hint at the bottom of windows on iPad: "Tap a stack, then tap where to put it · Hold to split".

### P2

**P2-1. ✕ close button now appears on computer windows.**
- Files: `src/styles.css:301-303` (hidden only for xbox), `src/ui/Windows.js:94`.
- It hangs off the top-right corner of the recipe book in the 1-seat computer game and overlaps the book's scrollbar. Polish regression vs the old UI. Fix: `body[data-platform="computer"] .winclose{display:none}` (Esc and E already close).

**P2-2. HUD draws above the pause menu's dim, and the hint bar overlaps the menu buttons.**
- Files: `src/styles.css:236` (`.hintbar`, bottom 168 px), DOM order: `.seathud` is created after the global `.screen`.
- Repro: pause on iPad (1180×820). The hearts, the hotbar and the "Press 🎒 to open your inventory…" bar sit bright above the dim, and the bar covers "New World…" and "Autosaves". The old game had the same DOM order, so this is inherited, but it is much worse on iPad where the menu is taller.
- Fix: z-index the global `.screen` above the seat HUD, and clear the hint text when the global pause opens.

**P2-3. Title screen controls hint is wrong and tiny on iPad.**
- File: `src/ui/UI.js:271`.
- It says "Tap ▣ place/use" but the button is ✋ Use, and "Bag inventory" while the icon is a backpack emoji; at 11 px it is unreadable at arm's length.
- Fix: use the same glyphs as the touch buttons; raise the font to ≥16 px.

**P2-4. Hint wording is off on touch.**
- File: `src/game/Seat.js` `hintText`.
- "Press 🎒" (the emoji rendered as a tiny red blob in the screenshot) and "Hold the Sneak button to sneak" (it is a toggle).
- Fix: "Tap 🎒…" and "Tap Sneak to crouch".

**P2-5. Hotbar sits where the iPad home-indicator swipe lives, and ignores safe-area insets.**
- File: `src/styles.css:80` (`.bottom` bottom 12 px).
- Fix: `bottom:max(12px, env(safe-area-inset-bottom))` on iPad.

**P2-6. iPad meta tags incomplete for iOS.**
- File: `ipad.html:3-8`.
- It has `viewport-fit=cover`, `apple-mobile-web-app-capable` and a black-translucent status bar. Missing: `apple-mobile-web-app-title`, `apple-touch-icon`, `theme-color`, and a manifest. No favicon either.
- Fix: add these, plus a one-line "Add to Home Screen for full screen" hint on the launcher's iPad card.

**P2-7. Audio unlock is correct at title, fragile later.**
- Files: `src/ui/UI.js:btn` (click → `sound.resume`), `src/input/TouchSource.js:_down` (`onUserGesture` on `pointerdown`).
- The title Play button (a `click`) unlocks audio on iOS. If iOS suspends the context after a backgrounding, the `pointerdown`-based resume may not count as an unlock gesture on iOS; the context could stay muted until a click.
- Fix: also call `resume()` from `pointerup`, and on `visibilitychange` back to visible on the next touch.

**P2-8. Portrait rotates behind a black overlay but the game keeps simulating.**
- File: `src/styles.css:284` (`::after`).
- The text is only 14 px and the world keeps running (zombies can kill an unseen player).
- Fix: open the pause menu on `orientationchange` to portrait; enlarge the text and add a rotating icon.

**P2-9. iPad now renders with no shadows, no bloom, no MSAA** (`platform.js` composer:false), so edges are jagged at PR 1.25 and the island looks flatter than the computer version. This is a deliberate speed trade, but should be an option.
- Fix: a "Graphics" setting for iPad (shadows only, then MSAA on iPad Pro).

**P2-10. Launcher gaps.**
- File: `index.html`.
- There is no link or button back to the launcher from the game pages (title or pause). iPad detection requires `maxTouchPoints > 1` plus "Macintosh"; an iPhone or Android tablet is shown as Computer. Cards have no `aria-label`.
- Fix: add a "Switch device" link on each title screen; show the iPad card for any touch-only device.

**P2-11. Double `sleepFade` can fire if game-time outruns real time.**
- File: `src/game/Game.js:updateWorld` sleeper block / `checkSleep`.
- Driving the sim faster than real time (the HMR/test harness did) re-triggered `checkSleep(null)` once `sleepT` reached 0 before the 1.3 s fade callback, producing a second `sleepFade`. Not reachable at normal frame rates (dt is clamped to 0.05), but cheap to guard with `if (this._sleepPending) return`.

**P2-12. Recipe Book header wraps to two lines on iPad** (`.bookhead` with larger chips); minor visual.

## Not verified

- A real iPad or Safari (audio unlock, safe-area values, momentum scroll, long-press callouts, slider drags).
- Real Xbox-UA or iPad-UA launcher detection.
- AO and torch lighting, sheep and zombies, farming (not in my brief to exercise).
- Looking with the mouse while pointer-locked (I injected `movementX` events; it works, but real lock was not available).

## Cleanup

My Vite (5184), the http.server (5185) and the old-commit Vite (5186) are stopped, and the temp git worktree is removed. Scratch site copy: `/private/tmp/claude-501/site/`.
