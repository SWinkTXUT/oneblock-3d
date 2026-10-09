// Pure shared-world rules for multiple seats (no DOM/three) so they are unit-testable.
// A "seat" here only needs: { index, active, player:{x,y,z,dead}, inv:{canAdd(key,n)}, inBed, disconnected }.

export const isLiving = (s) => !!s && s.active !== false && !(s.player && s.player.dead);

export function livingSeats(seats) { return seats.filter(isLiving); }

/** Nearest living seat to a point, or null. maxDist optional. */
export function nearestSeat(seats, x, y, z, maxDist = Infinity) {
  let best = null, bd = maxDist * maxDist;
  for (const s of seats) {
    if (!isLiving(s)) continue;
    const p = s.player, d = (p.x - x) ** 2 + (p.y - y) ** 2 + (p.z - z) ** 2;
    if (d <= bd) { bd = d; best = s; }
  }
  return best;
}

/** Sleep status: night only skips when every living seat is in a bed. */
export function sleepStatus(seats) {
  const living = livingSeats(seats);
  const sleeping = living.filter((s) => s.inBed);
  return { total: living.length, sleeping: sleeping.length, all: living.length > 0 && sleeping.length === living.length };
}

/** Nearest living seat within reach of the drop that has room for at least one item. */
export function pickupSeat(seats, d, reach = 1.5) {
  let best = null, bd = reach * reach;
  for (const s of seats) {
    if (!isLiving(s) || s.disconnected) continue;
    const p = s.player, dx = p.x - d.x, dy = p.y + 0.9 - (d.y + 0.1), dz = p.z - d.z, dist2 = dx * dx + dy * dy + dz * dz;
    if (dist2 <= bd && s.inv.canAdd(d.key, 1)) { bd = dist2; best = s; }
  }
  return best;
}

/** Seat data to persist: a dead or void-falling seat writes its respawn/last good state, never the corpse. */
export function seatSaveData(seat, spawnPos, serializeSeat) {
  const p = seat.player;
  if (p.dead) {
    const d = serializeSeat(seat);
    d.player = { x: spawnPos.x, y: spawnPos.y, z: spawnPos.z, yaw: 0, pitch: 0, health: 20, hunger: 20, sat: 5 };
    return d;
  }
  if (p.y < -30 && seat.lastGood) return seat.lastGood;
  const d = serializeSeat(seat);
  if (p.y >= -30) seat.lastGood = d;
  return d;
}
