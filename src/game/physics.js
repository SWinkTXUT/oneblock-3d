// Axis-separated AABB sweep against World.getCollisionBoxes. Entities: { x, y, z (feet centre), hw (half width), h }.
const EPS = 1e-4;

/** Move entity by (dx,dy,dz). Returns { hitX, hitY, hitZ, onGround }. `guard(e)` (optional) may veto horizontal moves (sneak edge guard). */
export function moveEntity(world, e, dx, dy, dz, guard) {
  const hw = e.hw, h = e.h;
  const res = { hitX: false, hitY: false, hitZ: false, onGround: false };
  const boxes = world.getCollisionBoxes(
    e.x - hw + Math.min(dx, 0) - 0.01, e.y + Math.min(dy, 0) - 0.01, e.z - hw + Math.min(dz, 0) - 0.01,
    e.x + hw + Math.max(dx, 0) + 0.01, e.y + h + Math.max(dy, 0) + 0.01, e.z + hw + Math.max(dz, 0) + 0.01);

  // Y
  if (dy !== 0) {
    const o = dy;
    for (const b of boxes) {
      if (e.x + hw <= b.minX + EPS || e.x - hw >= b.maxX - EPS || e.z + hw <= b.minZ + EPS || e.z - hw >= b.maxZ - EPS) continue;
      if (dy < 0 && b.maxY <= e.y + EPS) dy = Math.max(dy, b.maxY - e.y);
      else if (dy > 0 && b.minY >= e.y + h - EPS) dy = Math.min(dy, b.minY - (e.y + h));
    }
    e.y += dy;
    if (dy !== o) { res.hitY = true; if (o < 0) res.onGround = true; }
  }
  // X
  const axis = (isX) => {
    let d = isX ? dx : dz; if (d === 0) return;
    const o = d;
    for (const b of boxes) {
      if (e.y + h <= b.minY + EPS || e.y >= b.maxY - EPS) continue;
      if (isX) {
        if (e.z + hw <= b.minZ + EPS || e.z - hw >= b.maxZ - EPS) continue;
        if (d > 0 && b.minX >= e.x + hw - EPS) d = Math.min(d, b.minX - (e.x + hw));
        else if (d < 0 && b.maxX <= e.x - hw + EPS) d = Math.max(d, b.maxX - (e.x - hw));
      } else {
        if (e.x + hw <= b.minX + EPS || e.x - hw >= b.maxX - EPS) continue;
        if (d > 0 && b.minZ >= e.z + hw - EPS) d = Math.min(d, b.minZ - (e.z + hw));
        else if (d < 0 && b.maxZ <= e.z - hw + EPS) d = Math.max(d, b.maxZ - (e.z - hw));
      }
    }
    if (guard) {
      const px = e.x, pz = e.z;
      if (isX) e.x += d; else e.z += d;
      if (!guard(e)) { e.x = px; e.z = pz; d = 0; }
    } else if (isX) e.x += d; else e.z += d;
    if (d !== o) { if (isX) res.hitX = true; else res.hitZ = true; }
  };
  axis(true);
  axis(false);
  return res;
}

/** Does the entity's AABB overlap block cell (bx,by,bz)? */
export function overlapsCell(e, bx, by, bz) {
  return e.x + e.hw > bx && e.x - e.hw < bx + 1 && e.y + e.h > by && e.y < by + 1 && e.z + e.hw > bz && e.z - e.hw < bz + 1;
}

/** Ray vs AABB (slab). Returns distance or -1. */
export function rayAabb(o, d, minX, minY, minZ, maxX, maxY, maxZ, maxDist) {
  let tmin = 0, tmax = maxDist;
  const mins = [minX, minY, minZ], maxs = [maxX, maxY, maxZ], os = [o.x, o.y, o.z], ds = [d.x, d.y, d.z];
  for (let i = 0; i < 3; i++) {
    if (Math.abs(ds[i]) < 1e-9) { if (os[i] < mins[i] || os[i] > maxs[i]) return -1; continue; }
    let t1 = (mins[i] - os[i]) / ds[i], t2 = (maxs[i] - os[i]) / ds[i];
    if (t1 > t2) [t1, t2] = [t2, t1];
    tmin = Math.max(tmin, t1); tmax = Math.min(tmax, t2);
    if (tmin > tmax) return -1;
  }
  return tmin;
}
