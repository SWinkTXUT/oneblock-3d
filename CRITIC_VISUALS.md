# CRITIC_VISUALS — Builder A engine & visuals review

Method: Vite on :5181, built-in browser pane for `demo.html` and the game, `window.__demo` / `window.__game` for scripted views, node scripts for World API edge cases. The pane is hidden and throttled (rAF ran at about 10-15 fps), so I forced frames by calling `renderer.render()` in a loop, timed them with a `readPixels` GPU sync, and grabbed `toDataURL` frames. Console is clean in both pages (only Vite debug lines).

## Verdict

The look is already well above "programmer art". Textures are distinct and tasteful, AO and the grass-side fringe read well, noon sky and clouds are lovely, and the void below the island is a smooth blue haze, not a black hole. Midnight is moody but playable, and the item icons (all 104 keys) are crisp at 32 px with tier-coloured tools. I found no P0: no console errors, no black faces, no inverted normals, no z-fighting and no shadow acne in what I looked at. The World API matches SPEC §4, the edge cases I tried passed, and I saw no geometry leak across 200 remeshes. What hurts beauty most:

1. **The dusk/dawn lighting trough.** At t≈0.5 and t≈0.0 the island is a near-black silhouette against a glowing sky, darker than midnight.
2. **Torch and glow lights are overbright in daylight.** They burn pale blobs into grass, and a held glowstone is a textureless white blob.
3. **The first-person arm** is a featureless tan slab.
4. **The first impression is grey.** A new world and the title screen start at the dawn keyframe, which reads dingy beige-grey.
5. **High quality defaults to a very expensive pixel ratio.** On Retina the adaptive logic then drops to a blurry 0.8.

Fix those five and the game will look like the "Minecraft with shaders" the user asked for.

## P0 (broken / blocks play)

None found. I could not test real pointer lock in the pane. Play click falls back to the pause screen, which is Builder B's designed fallback.

## P1 (clearly hurts quality or beauty)

1. **Dusk and dawn: the island goes dark exactly when the sky is brightest.**
   - Where: `src/render/sky.js:55-56` (`sunI = base * smooth(-0.06, 0.12, sunDir.y)`), keyframes `sky.js:10-16`, and `Renderer.js:529-536`.
   - Evidence: I ran `computeSky` over 0..1. At t=0.50 the directional light is 0.39 (sun), at t=0.525 it is 0.16 (moon) and at t=0.975 it is 0.17, against 2.7 at t=0.45 and 0.77 at midnight. Hemisphere light also dips to 0.9 while the sky is orange. Screenshots at t=0.52 and t=0.0 in the game and demo show tree, grass and dirt nearly black, with only the torch and glass visible, against a glowing orange-pink sky. This is darker than midnight, which is readable. In-game, the sunset transition (game seconds 300-360 map to t=0.42-0.58) is about a minute of this.
   - Fix: golden hour should have the warmest, strongest side-light, not the weakest. Don't fade `sunI` to 0 at elevation 0. Use something like `sunI = base * (0.35 + 0.65*smooth(-0.1,0.25,y))` until the sun is about 8 degrees below the horizon, and cross-fade sun and moon intensities and directions over about 0.05 of the day instead of the hard `useSun` switch at `Renderer.js:533`. Floor `hemiI` at about 1.0 and lift `hemiGround` at keyframes 0.50 and 0.94 (`#4e3c42` / `#2a2438` are nearly black). Check t=0.5 and t=0.0 against t=0.75 so dusk is never darker than night.

2. **Torch, glowstone and magma point lights burn out in daylight, and the bloom halo is huge.**
   - Where: `Renderer.js:610-614` (`l.intensity = def.light * 0.72 * flick * lightCur * night`, no daylight scaling), `Renderer.js:152` (`emissiveIntensity: 1`), and the bloom setup at `Renderer.js:259`.
   - Evidence: in the game and demo at noon, the grass within about 3 blocks of a torch turns a pale yellow-white blotch. The torch stick turns olive-green, and a giant white halo sits on its tip. In the demo museum, glowstone is washed out to a flat white-gold with its texture lost (screenshots at noon).
   - Fix: scale light intensity by `lerp(0.25, 1, 1 - dayFactor)`, with a small floor so torches still read. Reduce distance (`8 + light*0.85`). Cap emissive-texture output (for example multiply the emissive atlas by 0.6) so ACES does not clip it. Lower the bloom radius or strength when `dayFactor > 0.8`.

3. **The first-person viewmodel is ugly in two modes.**
   - Where: `Renderer.js:222-236` (`_buildArm`) and `Renderer.js:181` (`matItem = matCutout`, which carries the emissive map).
   - Evidence: the empty hand is a single smooth tan prism with no skin texture, no visible sleeve and no pixel detail. It dominates the lower-right of the spawn screenshot and looks like a plank. A held glowstone is a blown-out white blob with no visible texture (demo `setHeldItem('glowstone')` frame). Held logs, torches, swords and bread look good.
   - Fix: give the arm a small 4x12 px skin canvas with a sleeve (or at least two colours and a visible cuff) and make the hand smaller or rotated so the sleeve is visible. Give the viewmodel its own material set with `emissiveIntensity` of about 0.3.

4. **Dawn is the first impression, and it is grey.**
   - Where: new worlds start at `state.time = 0`, which `Game.renderTime()` maps to t=0.02 (`src/game/Game.js:179-186`, Builder B's file). The title screen is held at `time = 20` (`Game.js:updateTitle`). The sky keyframes are `sky.js:7` and `sky.js:16`.
   - Evidence: the title and spawn screenshots are a muddy beige-to-lilac gradient, with a grey void and a barely lit horizon. This is the user's first look at the game, and it is far duller than the demo's noon.
   - Fix: this is a Builder B change plus a Builder A keyframe tweak. Start new worlds and the title at about game second 40-60 (t≈0.10, full sun). In `sky.js` raise horizon saturation at t=0.00 and 0.06 (`#ffa874` and `#ffd8a8` mix toward grey against zenith `#46629f`). Make the t=0.0 zenith bluer (`#4f78c0`).

5. **High quality is fill-rate bound by default, and the adaptive fallback ends up blurry.**
   - Where: `Renderer.js:53` (max pixel ratio 1.75), `Renderer.js:251` (4x MSAA on a HalfFloat target), `Renderer.js:259` (bloom), and `Renderer.js:639-656` (`_adaptResolution`, floor 0.8).
   - Evidence: in a 1024x768 pane (canvas 1792x1344, 5769 blocks, 71 draw calls, 23k tris), high quality took **18-32 ms/frame** at ratio 1.75 and 7.6 ms at 1.0. Low took 1.4 ms. Bloom is about 4 ms of the 18. On a Retina MacBook in full screen, ratio 1.75 is about 4M pixels, so the adaptive code will settle at 0.8-1.0. I saw the game sitting at `pixelRatio = 0.8` after frames were throttled, which looks soft and smeary for crisp pixel art. `_adaptResolution` only ignores dt > 0.25 s, so a backgrounded tab or a slow load can push it down permanently, and recovery is slow (the `calm` counter).
   - Fix:
     - Default `maxPixelRatio` to about 1.25-1.5 and floor adaptation at 1.0. Prefer dropping the bloom resolution, shadow map size or MSAA samples before going below 1.0.
     - Ignore frames when `document.hidden` or the first 60 frames after a resize or quality change.
     - Stop the adaptive resize reallocating the MSAA target on every 0.15 step. `composer.setSize` rebuilds both render targets (`Renderer.js:655` calls `resize`, which calls `composer.setSize`), so it hitches.

6. **Side faces and undersides go too dark. Oak bark is nearly black.**
   - Where: `Renderer.js:81` (hemisphere ground colour), `sky.js` `hg` values (`#6e6656` at noon, `#161a34` at night), and the log tile in `tiles.js`.
   - Evidence: in the noon game shot, the oak trunk side is almost black-brown with low-contrast bark. At night the dirt and stone sides of the island are black, while only top faces and a few fringe pixels show.
   - Fix: raise `hemiGround` (about 0.45-0.5 luminance at noon, 0.25 at night) and lighten the log bark palette (mid-brown `#6b4f2d` base, with darker streaks rather than near-black). Add a small ambient floor on vertical faces. Cheap trick: `AO_BRIGHT` min 0.5 is fine, but multiply side faces by 1.05.

7. **Phase ambiences are uneven. Underground looks like Plains and desert is grey.**
   - Where: `Renderer.js:19-27` (`PHASE_TINTS`) and `_applyTint` (`Renderer.js:495-500`), which preserves luminance and only lerps hue.
   - Evidence: I rendered all six non-plains phases at noon in one contact sheet. Underground is essentially the same blue sky as Plains (barely any change), and snow is only a touch paler. Desert ("Sunlit Dunes", `#ffc97a`) came out grey-lavender and dingy, not golden. Ember is a candy pink sky rather than a hellish red, and skylands is a flat lilac. Only caverns (purple) reads as intended.
   - Fix: let tints change luminance as well as hue.
     - Underground: darken the zenith and fog, and set exposure to about 0.85 plus a cool fog near 40.
     - Desert: warm the whole horizon (hue-shift toward `#ffd89a` and lower saturation loss).
     - Ember: darker red zenith, near-black clouds and warm fog.
     - Drive the effect from `tint.s` multiplied by both hue and a brightness factor.

## P2 (polish)

8. **No mipmaps or anisotropy on the atlas, so distant terrain will shimmer.**
   - Where: `src/render/textures.js:66-74` (`NearestFilter`, `generateMipmaps = false`).
   - Evidence: this is predicted from the code, not observed in my static captures. Pixel-crisp `NearestFilter` with minification at 1.0 pixel ratio and fog at 140 blocks will alias on grass and leaves while the player moves.
   - Fix: use `NearestMipmapLinearFilter` with `generateMipmaps = true` and `anisotropy` of 4. The 2 px padding is only safe for mip level 1, so set `texture.minFilter = NearestMipmapNearestFilter` and clamp the max level (or shrink LOD with `textureLodBias`). Test for bleeding.

9. **Unknown block ids in a save crash the renderer every frame.**
   - Where: `World.js:211-214` (`deserialize` does no id validation) and `mesher.js:128` (`UV[id]` is null for ids with no definition).
   - Evidence: `deserialize({v:1,chunks:[[0,0,0,[250,4096]]]})` loads 4096 blocks of id 250 and `countBlocks()` returns 4096. Meshing then throws a TypeError on `uvs[2]`, which would loop forever because `render()` has no try/catch around `_rebuildDirty`.
   - Fix: in `deserialize`, replace ids where `!BLOCKS[id]` with 0 (and skip count for them). In the mesher, `if (!uvs) continue`.

10. **Transparency ordering: water is always drawn before glass.**
    - Where: `Renderer.js:445` (`orders = [0, 0, 3, 2]`; water order 2, translucent order 3 across all chunks) and `mesher.js:25` (`SAMECULL`).
    - Evidence: glass or ice behind a water surface blends on top of the water undimmed. I did not see a bad case in the demo hut or pond, since they don't overlap. Within one translucent mesh, triangles are not sorted either.
    - Fix: acceptable at this scope. If it shows up, render water after glass with `depthTest` on, and sort per chunk by camera distance.

11. **Water leaves a visible gap under solid ceilings.**
    - Where: `mesher.js:171` (`h = 14/16` whenever the block above is not water, including solids).
    - Evidence: from reading the code, a water block under stone shows a 2/16 air gap along its top face.
    - Fix: use full height when the block above is `OCCL`.

12. **Leaves emit interior faces and get no AO between leaves.**
    - Where: `mesher.js:106-111` (`faceVisible`; `OCCL` is only true for opaque cubes) and `mesher.js:19`.
    - Evidence: the canopy underside in the noon game shot shows dark speckle where holes expose shadowed leaves (the HANDOFF "known issue", confirmed). A dense tree emits all 6 faces for every inner leaf.
    - Fix: for cutout/leaf-to-leaf neighbours, cull the shared face unless the neighbour's texel is transparent at that position (keep it simple: cull leaf-leaf faces and rely on the hole texture). Alternatively treat leaves as `OCCL` for AO.

13. **Per-frame allocations and uploads in hot loops.**
    - Where:
      - `Renderer.js:540-543` allocates 3 `Vector3` per frame.
      - `Renderer.js:570-598` allocates `best`, a `Set` and a `slots.filter` array every frame, and iterates the whole emitter Map.
      - `Renderer.js:481-483` spreads the dirty Set into arrays.
      - `particles.js:152-170` loops all 1000 particles and flags five attributes for upload every frame even when none are alive.
      - `AmbientMotes.update` runs 180 motes of trig every frame.
    - Fix: hoist the Vector3s to module scope. Skip `Particles.update` and the uploads when `activeCount == 0`. Throttle emitter selection to about 10 Hz. A hundred glowstone or magma blocks in the ember phase is where the emitter scan would start to matter.

14. **Light behaviour: torch light leaks through walls and the 8-light cap is visible.**
    - Where: `Renderer.js:564-615` (PointLights, no shadows) and `Renderer.js:32` (`NUM_LIGHTS = 8`).
    - Evidence: this follows from the design. Slots fade in and out over about 0.12 s, so the pop is hidden, but distant torches show only their emissive tip.
    - Fix: acceptable. If a bunker interior looks wrongly lit, cap `light.distance` lower in enclosed areas. Not worth shadows on point lights.

15. **Sun to moon handover snaps the shadow direction.**
    - Where: `Renderer.js:533-536` (`useSun = sunI >= moonI`).
    - Evidence: at t≈0.515 the key light jumps from the setting sun to the moon's direction. Intensities are low there (about 0.1) so it is subtle today, but fixing P1 #1 will raise them and make the pop visible.
    - Fix: lerp the direction and colour over 0.03 of the day.

16. **Shadow coverage is only +-30 blocks, and low-angle shadows clip at the frustum edge.**
    - Where: `Renderer.js:86-88` (R = 30).
    - Fix: fine for a one-block island. Fade shadow strength out near the frustum edge if the player builds big at dawn or dusk.

17. **`raycast` from inside a block returns a zero normal, and `Game.js` places using it.**
    - Where: `World.js:143` (returns `dist: 0` with `normal` 0,0,0 at start) and `Game.js:509` (`c = hit + normal`, which would be the hit block itself).
    - Evidence: confirmed with `raycast({0.5,0.5,0.5},{0,1,0},5)`, which returns the block itself with a zero normal. The other cases I tried passed: negative coords (`-1,-1`), exact integer boundaries, origin on a boundary moving -x, the farmland box (0.9375), the bed box (0.5625), water skipped and torch hit.
    - Fix: Builder B should ignore hits with `dist === 0` for placing. Low risk since the player's eye is rarely inside a block.

18. **Moon and ore art are slightly weak.**
    - Evidence: the moon is a small pale disc in the demo night shot (scale 90 at 430 units), easy to miss. Coal and iron ore read as grey blobs on pale stone, and iron's peach dots are low-contrast.
    - Fix: moon scale about 130. Make ore flecks darker (coal) and a stronger orange-pink (iron).

19. **API tidy-ups between A and B.**
    - Where: `Game.js:90` writes `renderer.hand.visible` directly, but `setViewmodelVisible(bool)` exists (`Renderer.js:369`). `getMobTexture` is unused.
    - Fix: switch B to the public method.

20. **Phase and key art checks that were fine.**
    - Recorded for completeness: `getItemIcon` returns an icon for every one of the 104 `ITEMS` keys. Dropped and held geometry is shared and cached, with no leak. Chunk geometry is disposed on remesh (`info.memory.geometries` went 20 -> 18 -> 20 across 200 rebuilds), and remeshed chunks are removed when empty. Serialize and deserialize round-trip is exact (12 blocks, 3 emitters, 208 bytes JSON). Chunk-border dirtying covers all 8 neighbours including diagonals at 15 and -1.

## Performance summary (measured with GPU sync, 1024x768 pane, DPR 2, hidden pane)

| Config | Frame time |
|---|---|
| High, ratio 1.75 (1792x1344), 2769 blocks | 18-20 ms |
| High, ratio 1.75, 5769 blocks / 71 calls / 23k tris | 32 ms |
| High, ratio 1.0, 5769 blocks | 7.6 ms |
| Low, 5769 blocks | 1.5 ms |
| Bloom off (2769 blocks, ratio 1.75) | 13.9 ms, down from 18.2 |
| Shadows off | about 1 ms saved |

The cost is fill-rate (MSAA + bloom + pixel ratio), not geometry. The full initial mesh and single-chunk remesh costs are fine. Pane throttling meant real-time fps could not be measured.
