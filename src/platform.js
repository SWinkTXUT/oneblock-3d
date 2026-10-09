// SHARED CONTRACT — owned by the lead (see SPEC-PLATFORMS.md). Builders may ADD fields with a HANDOFF note; never rename.
//
// One codebase, three versions. Each entry page sets <body data-platform="computer|xbox|ipad">.

export const PLATFORMS = {
  computer: {
    key: 'computer', label: 'Computer',
    maxSeats: 1,
    inputs: ['kbm', 'gamepad'],      // keyboard+mouse (pointer lock) AND/OR one controller drive seat 0
    uiScale: 1,
    safeArea: 0,                     // fraction of screen kept clear at each edge (TV overscan)
    saveKey: 'oneblock3d.save.v1',   // unchanged so existing computer saves keep working
    settingsKey: 'oneblock3d.settings',
    pointerLock: true,
    fullscreenOnPlay: false,
  },
  xbox: {
    key: 'xbox', label: 'Xbox',
    maxSeats: 4,                     // couch co-op, split screen, drop-in with Start/Menu
    inputs: ['gamepad'],
    uiScale: 1.5,                    // read from the couch
    safeArea: 0.05,
    saveKey: 'oneblock3d.xbox.save.v2',
    settingsKey: 'oneblock3d.xbox.settings',
    pointerLock: false,
    fullscreenOnPlay: true,
  },
  ipad: {
    key: 'ipad', label: 'iPad',
    maxSeats: 1,
    inputs: ['touch'],
    uiScale: 1.25,
    safeArea: 0,                     // use CSS env(safe-area-inset-*) instead
    saveKey: 'oneblock3d.ipad.save.v2',
    settingsKey: 'oneblock3d.ipad.settings',
    pointerLock: false,
    fullscreenOnPlay: false,
  },
};

export function currentPlatform() {
  const key = (typeof document !== 'undefined' && document.body && document.body.dataset.platform) || 'computer';
  return PLATFORMS[key] || PLATFORMS.computer;
}

// Seat identity: colour used for the outfit, the viewport border and the name tag.
export const SEATS = [
  { index: 0, name: 'P1', color: '#3b82f6' }, // blue
  { index: 1, name: 'P2', color: '#ef4444' }, // red
  { index: 2, name: 'P3', color: '#22c55e' }, // green
  { index: 3, name: 'P4', color: '#eab308' }, // yellow
];

/**
 * Split-screen layout. Rects are normalized to the drawable area (after safe-area insets),
 * origin TOP-LEFT, {x, y, w, h} in 0..1. Renderer and UI MUST both use this so HUDs line up with views.
 *  1 → full screen
 *  2 → top / bottom halves (Minecraft-style horizontal split)
 *  3 → P1 top half full width, P2 bottom-left, P3 bottom-right
 *  4 → quadrants: P1 TL, P2 TR, P3 BL, P4 BR
 */
export function viewportRects(n) {
  switch (n) {
    case 1: return [{ x: 0, y: 0, w: 1, h: 1 }];
    case 2: return [{ x: 0, y: 0, w: 1, h: 0.5 }, { x: 0, y: 0.5, w: 1, h: 0.5 }];
    case 3: return [{ x: 0, y: 0, w: 1, h: 0.5 }, { x: 0, y: 0.5, w: 0.5, h: 0.5 }, { x: 0.5, y: 0.5, w: 0.5, h: 0.5 }];
    case 4: return [
      { x: 0, y: 0, w: 0.5, h: 0.5 }, { x: 0.5, y: 0, w: 0.5, h: 0.5 },
      { x: 0, y: 0.5, w: 0.5, h: 0.5 }, { x: 0.5, y: 0.5, w: 0.5, h: 0.5 },
    ];
    default: throw new Error('viewportRects: n must be 1..4');
  }
}

/** Performance budget per active view count ("smoothness first", user decision). Renderer applies it. */
export function qualityBudget(nViews, platformKey) {
  const xbox = platformKey === 'xbox', ipad = platformKey === 'ipad';
  if (nViews <= 1) return { shadows: !xbox && !ipad ? true : xbox, bloom: !ipad, pixelRatioMax: ipad ? 1.25 : xbox ? 1 : 1.5, viewDistance: 96, pointLights: 8 };
  if (nViews === 2) return { shadows: true, bloom: false, pixelRatioMax: 1, viewDistance: 64, pointLights: 4 };
  return { shadows: false, bloom: false, pixelRatioMax: 1, viewDistance: 48, pointLights: 2 };
}
