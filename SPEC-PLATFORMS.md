# OneBlock 3D — Platforms Spec (Computer · Xbox 4-player split screen · iPad)

Builds on SPEC.md, which still governs everything not changed here. Shared contract: `src/platform.js` (lead-owned):
PLATFORMS, SEATS, viewportRects(n) and qualityBudget(n, platform). **Use it; don't duplicate it.**

## 1. Decisions locked with the user
- **One project, three versions.** A separate entry page per device, all sharing world/blocks/mobs/crafting code. Each version
  has its own controls and screen layout.
- **Computer** (`computer.html`): today's game, unchanged for mouse/keyboard, **plus** an Xbox controller can drive the same
  single player (either input works at any time).
- **Xbox** (`xbox.html`, Edge browser on Xbox Series X): **up to 4 players, split screen on one TV**, one controller each.
  - **Seats:** drop-in (an unassigned controller presses Menu/Start), drop-out. Layout auto-reflows 1→2→3→4 per `viewportRects`.
  - **Shared:** one island, One Block, phases, time, mobs, drops, furnaces/chests, team goals.
  - **Per player:** own inventory/armor, hearts, hunger, spawn point (bed), hotbar, held item.
  - **Mobs:** zombies chase the **nearest** living player.
  - **Night skip** needs **every living player in a bed**: message "P2 is sleeping (1/3)".
  - **Identity:** coloured outfits (`SEATS[i].color`) with a matching viewport border and floating name tags (P1..P4) in other players' views.
  - **Performance: smoothness first.** Apply `qualityBudget(nViews, 'xbox')` (no bloom/shadows when 3–4 views, pixel ratio 1,
    shorter view distance). Target ≥30 fps at 4 players.
- **iPad** (`ipad.html`, Safari): **1 player, touch controls**, finger-sized menus.
- **Launcher** (`index.html`): three big cards (Computer / Xbox / iPad), auto-highlighting the detected device
  (Xbox UA contains "Xbox"; iPad = touch + "Macintosh"/"iPad" UA with maxTouchPoints > 1). Same visual style as the title screen.
- **Hosting:** GitHub Pages (lead handles deploy). Therefore **all asset/page URLs must be relative** (`vite base: './'`, lead set it).
  Xbox needs https to read controllers, which Pages provides.
- Saves are per platform (`PLATFORMS[x].saveKey`). The computer keeps the old key and must still load an existing v1 save
  (migrate in memory; write v2).

## 2. File ownership (edit only your files; requests go in HANDOFF.md)
| Owner | Files |
|---|---|
| Lead | `src/platform.js`, `src/data/blocks.js`, `src/data/items.js`, `vite.config.js`, `SPEC*.md`, `.github/**` |
| **Builder A — Engine, Views & Input** | `src/render/**`, `src/world/**`, **`src/input/**` (new)**, `demo.html`, `src/demo.js` |
| **Builder B — Game, UI & Pages** | `index.html`, `computer.html`, `xbox.html`, `ipad.html`, `src/main.js`, `src/styles.css`, `src/game/**`, `src/ui/**`, `src/audio/**`, `src/data/recipes.js`, `src/data/phases.js` |

`src/game/Input.js` is replaced by `src/input/**`. Builder A writes the new input layer (port the existing keyboard/mouse
behaviour faithfully: double-tap-W sprint, wheel hotbar, digit keys, E/J/Q, pointer lock). Builder B switches Game to it and deletes `src/game/Input.js`.

## 3. Builder A APIs (exact; Builder B codes against these)

### 3a. Multi-view rendering — `src/render/Renderer.js`
```js
renderer.setPlatform(platformKey)          // remember platform for qualityBudget
renderer.setSafeArea(frac)                 // inset all views by frac of width/height on each side (TV overscan)
renderer.createView(seatIndex) -> View     // does not show it yet
renderer.setViews(views)                   // views in seat order; laid out with viewportRects(views.length) inside safe area;
                                           // applies qualityBudget(views.length, platform); [] or single view = today's full-screen path
renderer.views                             // current array
renderer.getViewRect(view) -> {x,y,w,h}    // CSS pixels relative to the container (UI uses it to place HUDs)

View {
  seatIndex, camera                        // THREE.PerspectiveCamera, rotation.order 'YXZ'; Builder B sets position/rotation/fov
  setHighlight(pos|null); setBreakProgress(pos|null, p); setHeldItem(itemKey|null); swingHand();
  setViewmodelVisible(bool); setUnderwater(bool); setDamageFlash(); setFov(deg)
}
renderer.createPlayerAvatar(seatIndex) -> Avatar
Avatar { object3d, update(dt, { x, y, z, yaw, pitch, moving, sneaking, swinging, heldItemKey, hurt, dead }), setVisible(bool), dispose() }
   // Minecraft-proportioned box player (head/body/arms/legs, walk + swing anim, held item in hand), shirt/pants tinted
   // SEATS[i].color, floating name-tag sprite "P1".."P4" (always faces camera, readable at distance).
   // A seat's own avatar is NEVER drawn in its own view (use camera layers); it IS drawn in other views.
```
- **Back-compat:** every existing single-view method/property (`camera`, `setHighlight`, `setHeldItem`, `swingHand`,
  `setViewmodelVisible`, `setUnderwater`, `setDamageFlash`, …) keeps working and targets the first view
  (an implicit default view). So the computer game and the title screen keep working before B migrates.
- Split rendering: one render per view with scissor/viewport. Post-processing (bloom) only when the budget allows. One shared
  shadow map centered on the centroid of active cameras (when budget allows). Viewmodel, highlight, crack overlay,
  underwater and damage tint are **per view**. Particles, sky and world are shared.
- 1px dark separator lines between views. B draws the coloured viewport borders in the DOM.

### 3b. Input layer — `src/input/**`
```js
import { InputHub } from './input/InputHub.js';
const hub = new InputHub({ platform, canvas, container, settings,
  onPointerLockChange(locked), onPointerLockError() });     // pointer lock only when platform.pointerLock
hub.poll(dt)                       // once per frame, before game logic
hub.keyboardMouse                  // InputSource | null   (computer)
hub.touch                          // TouchSource | null   (ipad) — also owns the on-screen controls overlay
hub.gamepads                       // GamepadSource[] currently connected (standard mapping)
hub.unassignedJoinPresses()        // -> GamepadSource[] that pressed Menu/Start (or A on the lobby) since last call and aren't assigned
hub.assign(source, seatIndex); hub.unassign(source)
hub.onDisconnect(cb(source))
hub.combine(a, b) -> InputSource   // merged source (computer: keyboardMouse + first gamepad)
hub.setSettings(settings)
hub.requestPointerLock(); hub.exitPointerLock(); hub.pointerLocked

InputSource {
  kind: 'kbm'|'gamepad'|'touch'|'combined', id, connected, seatIndex
  move() -> { f, r, jump, sneak, sprint }      // f,r analog −1..1 (deadzoned); sneak = held or toggled state
  look() -> { dyaw, dpitch }                   // radians to ADD this frame; sensitivity, invertY, stick accel curve applied
  down(action) -> bool                         // 'primary' (mine/attack), 'secondary' (use/place/eat)
  pressed(action) -> bool                      // edge, consumed on read:
     // play: primary secondary jump inventory pause drop dropStack hotbarNext hotbarPrev hotbar1..hotbar9 goals
     // menu: ui_up ui_down ui_left ui_right ui_accept ui_back ui_alt ui_split ui_tabNext ui_tabPrev
  setMode('play'|'menu')                       // menu mode: sticks/d-pad generate ui_* repeats (initial 350 ms, then 110 ms)
  glyph(action) -> string                      // label for hints: 'LMB', 'E', 'RT', 'Ⓐ', 'Ⓨ', 'Hold ⛏' ...
  rumble(intensity, ms)                        // no-op if unsupported
}
```
**Controller layout** (Minecraft Bedrock-like):
- Left stick: move. Right stick: look. RT: mine/attack. LT: use/place/eat.
- A: jump. B: drop (hold 0.6 s = drop stack). Y: inventory. X: goals.
- LB/RB: hotbar prev/next. D-pad left/right: hotbar too.
- L-stick click: sprint. R-stick click: sneak (toggle). Menu: pause / join. View: goals.
- **In menus:** D-pad/left stick move focus, A accept (pick/put), X quick-move (shift-click), Y split/place one, B back/close,
  LB/RB switch tabs.

**Touch layout (iPad)**, crosshair-centred like Bedrock "crosshair mode":
- Left third: dynamic virtual joystick (appears where the thumb lands); pushing past ~90% sprints.
- Drag anywhere else not on a button: look.
- Buttons, bottom-right cluster, ≥64 px:
  - **Mine/Attack** (hold).
  - **Use/Place** (tap; hold to keep eating/placing).
  - **Jump**.
  - **Sneak** (toggle, lit when on).
- Top-right: **Inventory** and **Pause** buttons. Hotbar slots are tappable; that's B's HUD element calling
  `game.selectSlot(seat, i)`.
- Use **Pointer Events** with `pointerType === 'touch'` (synthetic events must work, for testing). `touch-action: none` on the
  canvas/overlay. The overlay hides in menu mode.

**Xbox Edge controller quirks: research these (WebSearch).**
- Does Edge on Xbox deliver the Gamepad API to pages, and how does a page stop the controller acting as a mouse cursor?
  Known techniques include fullscreen, `navigator.gamepadInputEmulation = 'gamepad'` (legacy Edge), and the View-button
  cursor toggle.
- Does the B button trigger browser Back?
- Implement what's needed and document it in HANDOFF.md.

## 4. Builder B responsibilities
- **Platform boot:**
  - `main.js` reads `currentPlatform()`.
  - Creates World, Renderer (`setPlatform`, `setSafeArea`), InputHub.
  - Applies `uiScale` (CSS var `--ui-scale`) and `safeArea`.
  - Entry pages `computer.html`, `xbox.html`, `ipad.html` each set `<body data-platform>` and load `src/main.js`.
  - iPad: no-zoom viewport, `apple-mobile-web-app-capable`, prevent scroll/bounce, "rotate to landscape" hint in portrait.
  - Xbox: fullscreen on Play, hide cursor, guard history so B/Back never leaves the page.
- **Seats:** introduce `Seat` = `{ index, info: SEATS[i], player, inv, sel, input, view, ui, avatar, spawn, mining state,
  cooldowns, tutorial state }`.
  - Everything per-player moves off Game onto Seat: interaction, mining, held item, eating, camera sync, pev callbacks,
    death/respawn, tutorial.
  - `game.player` / `game.inv` remain as getters for seat 0 (existing tests keep passing).
- **Shared-world rules:**
  - Mobs target and spawn relative to the nearest living seat.
  - Phase spawns avoid every seat's column.
  - Drops are picked up by the nearest seat with room.
  - Furnace/chest UIs stay live when two seats view the same entity.
  - Goals are team-wide.
  - Sleep needs all living seats in bed.
  - Death is per seat; others keep playing.
- **Split-screen UI:**
  - Each seat gets a HUD inside its view rect (`renderer.getViewRect`): crosshair, hotbar, hearts/hunger/armor, hint bar,
    and a seat-coloured border with "P1".
  - Inventory/recipe book/furnace/chest windows open **inside that seat's rect**, scaled to fit. In small rects
    (quadrants), inventory and recipe book become tabs switched with LB/RB.
  - All windows are fully controller-navigable via `ui_*` actions (visible focus ring, grid navigation, recipe list
    scrolling) as well as mouse/touch.
  - With more than one seat, windows do **not** pause the game. The global pause menu (Menu/Esc) pauses everything and
    has "Leave game (Pn)".
  - The phase/goal panel is shown once (top-centre) in multi-seat mode.
- **Xbox lobby:** the title screen shows 4 seat cards ("Press Ⓐ to join"). Any joined player can start.
  - **In-game drop-in:** an unassigned controller presses Menu and a new seat spawns at the world spawn; the layout reflows.
  - **Controller disconnect:** that seat freezes and shows "Reconnect controller" in its rect.
- **Hints use `input.glyph(action)`** so text matches the device: "Hold RT to break the block", "Press Ⓨ for inventory",
  "Hold ⛏ to break the block".
- **Save v2:**
  - Format: `{ v: 2, world, state, entities, drops, seats: [{ player, inv, sel, spawn } | null] × maxSeats }`.
  - Seat slot data persists, so P3 rejoining gets P3's inventory back.
  - v1 → v2 migration for the computer.
  - Keys: per platform `saveKey`/`settingsKey`.
- **Launcher `index.html`.**
- **Tests:** existing logic and sim tests must still pass. Add multi-seat tests for:
  - nearest-player mob targeting
  - all-in-bed sleep
  - per-seat death
  - save v2 round-trip with 3 seats
  - v1 migration
  - drop pickup by nearest seat

## 5. How to test without an Xbox or iPad (both builders and critics)
- Built-in browser pane, `npx vite --port <yours>`.
- **Fake controllers:** override `navigator.getGamepads` with scripted
  `{ index, id: 'Xbox Controller (STANDARD GAMEPAD)', mapping: 'standard', connected: true, buttons: [{pressed, value}×17], axes: [4] }`
  objects and dispatch `gamepadconnected`.
- **Xbox screen:** `resize_window` 1920×1080.
- **iPad:** `resize_window` 1180×820 and dispatch synthetic `PointerEvent`s with `pointerType: 'touch'`.
- Pointer lock does not work in the pane. Drive `window.__game` directly where needed (`updatePlay` / `renderer.render`).
  Screenshots lag one frame.

## 6. Acceptance criteria
1. `npm run build` passes and emits `index.html`, `computer.html`, `xbox.html`, `ipad.html`, `demo.html` with relative asset
   URLs. All existing and new node tests pass. No console errors on any page.
2. **Computer:** plays exactly as before with keyboard and mouse (regression check: break → craft → place → sleep → reload).
   A fake controller can also move, look, mine, place and navigate the inventory.
3. **Xbox:** with 4 fake controllers, the lobby joins 4 seats → 4 quadrant views with coloured borders, own HUDs and own
   hotbars.
   - Each player can independently move, look, mine and place, and open their own inventory inside their quadrant and craft
     with the controller only.
   - Players see each other's coloured avatars and name tags.
4. **Xbox drop-in/out:** P3 joins mid-game (layout 2→3) and leaves (3→2) without errors. Their inventory persists in the save.
5. **Xbox shared rules:**
   - zombies chase the nearest player
   - night skips only when all living players are in beds
   - one player dying doesn't affect the others
6. **Xbox performance:** at 1920×1080 with 4 views and ~3000 blocks, frame time ≤ 33 ms on the dev Mac at the xbox budget
   (best available proxy). Report the measured numbers.
7. **iPad** at 1180×820 with synthetic touch:
   - joystick moves, drag looks, hold Mine breaks, Use places, and Jump and Sneak work
   - inventory and crafting are usable by tap
   - no page scroll or zoom
8. **Launcher** shows three cards and links work under a sub-path (as on GitHub Pages:
   `https://<user>.github.io/oneblock-3d/xbox.html`).
