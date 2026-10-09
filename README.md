# One Block 3D

A 3D, first-person take on Minecraft's "One Block" skyblock challenge: you stand on one magic block in the sky. Every time you break it, it comes back as something new, moving through seven phases, from Plains to the Skylands.

**Play:** https://swinktxut.github.io/oneblock-3d/

| Version | Link | Controls |
|---|---|---|
| Computer | [computer.html](https://swinktxut.github.io/oneblock-3d/computer.html) | Mouse + keyboard, or an Xbox controller |
| Xbox | [xbox.html](https://swinktxut.github.io/oneblock-3d/xbox.html) | 1–4 players, split screen, one controller each |
| iPad | [ipad.html](https://swinktxut.github.io/oneblock-3d/ipad.html) | Touch |

**Xbox tip:** in the Edge browser, hold the **Menu (≡)** button and choose **"Use game controls"** so the controller drives the game instead of a mouse pointer. Press **A** to join.

## Develop

```bash
npm install
npm run dev     # http://localhost:5173
npm run build   # static site in dist/
```

Built with Vite and Three.js. All textures are drawn in code and all sounds are synthesized, so there are no asset files. The live site is the built `dist/` folder published to the `gh-pages` branch.
