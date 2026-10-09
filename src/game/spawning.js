// Pure spawn-planning helpers (no DOM/three) so the P0 "zombie on the player" rule is unit-testable.
export const zombieCap = (surface) => Math.max(0, Math.min(6, Math.floor(surface / 25)));
export const MIN_SURFACE_FOR_ZOMBIES = 12;

/** Number of walkable surface blocks: solid block with 2 non-solid cells above. */
export function countSurface(world) {
  let n = 0;
  world.forEachBlock((x, y, z) => {
    if (world.isSolid(x, y, z) && !world.isSolid(x, y + 1, z) && !world.isSolid(x, y + 2, z)) n++;
  });
  return n;
}

/** Candidate cells within 4 blocks of the One Block, >= 1.5 from the player, never in the player's column. */
export function phaseSpawnSpots(world, players, waterId) {
  const ps = Array.isArray(players) ? players : [players];
  const spots = [];
  for (let dx = -4; dx <= 4; dx++) for (let dz = -4; dz <= 4; dz++) {
    const y = world.topSolidY(dx, dz);
    if (y === null || y === undefined) continue;
    if (world.isSolid(dx, y + 1, dz) || world.isSolid(dx, y + 2, dz)) continue;
    if (world.getBlock(dx, y + 1, dz) === waterId) continue;
    const cx = dx + 0.5, cz = dz + 0.5;
    if (ps.some((p) => Math.hypot(cx - p.x, cz - p.z) < 1.5 || (Math.floor(p.x) === dx && Math.floor(p.z) === dz))) continue;
    spots.push({ x: cx, y: y + 1, z: cz });
  }
  return spots;
}

/** Decide what a One Block mob roll actually spawns. Returns { kind, x, y, z } or null. Zombies never spawn without room. */
export function planPhaseSpawn(world, player, kind, waterId, rng = Math.random, surface) {
  const spots = phaseSpawnSpots(world, player, waterId);
  if (!spots.length) return null;
  const s = surface === undefined ? countSurface(world) : surface;
  const k = kind === 'zombie' && s < MIN_SURFACE_FOR_ZOMBIES ? 'sheep' : kind;
  const spot = spots[Math.floor(rng() * spots.length)];
  return { kind: k, ...spot };
}
