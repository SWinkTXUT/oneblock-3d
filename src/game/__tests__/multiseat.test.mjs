// Run: node src/game/__tests__/multiseat.test.mjs   (pure shared-world rules; no DOM/three)
import assert from 'node:assert/strict';
import { Player } from '../Player.js';
import { Inventory, makeStack } from '../Inventory.js';
import { nearestSeat, sleepStatus, pickupSeat, seatSaveData, livingSeats } from '../team.js';
import { encode, decode, migrate } from '../Save.js';
import { PLATFORMS, viewportRects } from '../../platform.js';

let pass = 0;
const t = (n, f) => { f(); pass++; console.log('ok  -', n); };
const mkSeat = (i, x, y = 1, z = 0.5) => {
  const player = new Player(); player.reset(x, y, z);
  return { index: i, active: true, player, inv: new Inventory(), sel: 0, spawn: null, inBed: null, disconnected: false,
    serialize() { return { player: this.player.serialize(), inv: this.inv.serialize(), sel: this.sel, spawn: this.spawn }; } };
};

t('zombies target the NEAREST living seat', () => {
  const a = mkSeat(0, 0.5), b = mkSeat(1, 10.5), c = mkSeat(2, -20.5);
  const seats = [a, b, c];
  assert.equal(nearestSeat(seats, 9, 1, 0.5), b);
  assert.equal(nearestSeat(seats, -5, 1, 0.5), a);
  assert.equal(nearestSeat(seats, -19, 1, 0.5), c);
  b.player.dead = true; // dead seats are never targeted
  assert.equal(nearestSeat(seats, 9, 1, 0.5), a);
  assert.equal(nearestSeat(seats, 9, 1, 0.5, 3), null); // beyond maxDist
  c.active = false;
  assert.equal(nearestSeat(seats, -19, 1, 0.5), a);
  assert.deepEqual(livingSeats(seats).map((s) => s.index), [0]);
});

t('night skips only when every living seat is in a bed', () => {
  const s = [mkSeat(0, 0), mkSeat(1, 3), mkSeat(2, 6)];
  assert.deepEqual(sleepStatus(s), { total: 3, sleeping: 0, all: false });
  s[1].inBed = { x: 0, y: 0, z: 0 };
  assert.deepEqual(sleepStatus(s), { total: 3, sleeping: 1, all: false });
  s[0].inBed = {}; assert.equal(sleepStatus(s).all, false);
  s[2].player.dead = true; // a dead player does not block the night
  assert.deepEqual(sleepStatus(s), { total: 2, sleeping: 2, all: true });
  s[2].player.dead = false; assert.equal(sleepStatus(s).all, false);
  s[2].inBed = {}; assert.equal(sleepStatus(s).all, true);
  assert.equal(sleepStatus([mkSeat(0, 0)]).all, false); // lone seat not yet in bed
  const solo = [mkSeat(0, 0)]; solo[0].inBed = {}; assert.deepEqual(sleepStatus(solo), { total: 1, sleeping: 1, all: true });
  assert.equal(sleepStatus([]).all, false);
});

t('death is per seat: others unaffected, the dead seat saves respawned with its drops gone', () => {
  const a = mkSeat(0, 0.5), b = mkSeat(1, 5.5);
  a.inv.add('diamond', 3); b.inv.add('iron_ingot', 4);
  let died = 0;
  b.player.hurt(100, 'Slain by Zombie', { force: true }, { die: () => died++ });
  assert.equal(died, 1); assert.equal(b.player.dead, true);
  assert.equal(a.player.dead, false); assert.equal(a.player.health, 20);
  b.inv.clear(); // Seat.onDeath spills + clears
  const spawn = { x: 0.5, y: 1, z: 0.5 };
  const ser = (x) => x.serialize();
  const da = seatSaveData(a, spawn, ser), db = seatSaveData(b, spawn, ser);
  assert.equal(da.inv.slots.filter(Boolean).length, 1);                       // alive seat keeps items
  assert.equal(db.player.health, 20); assert.equal(db.player.x, 0.5);         // dead seat: respawn state, never the corpse
  assert.equal(db.inv.slots.filter(Boolean).length, 0);
  // a seat falling in the void saves its last good state instead
  const c = mkSeat(2, 0.5); c.inv.add('coal', 2);
  const good = seatSaveData(c, spawn, ser); assert.equal(c.lastGood, good);
  c.player.y = -35; c.inv.clear();
  assert.equal(seatSaveData(c, spawn, ser), good);
});

t('save v2 round-trips 3 seats; empty slots stay null; P3 gets its inventory back', () => {
  const s = [mkSeat(0, 0.5), mkSeat(1, 1.5), mkSeat(2, 2.5)];
  s[2].inv.add('diamond', 5); s[2].inv.slots[3] = makeStack('iron_pickaxe', 1, 77); s[2].spawn = { x: 3, y: 1, z: 3 }; s[2].sel = 3;
  s[1].inv.armor[0] = makeStack('iron_helmet', 1, 150);
  const data = { world: { c: [1] }, state: { blocksBroken: 321, forced: ['oak_log'], time: 250 }, entities: {}, drops: [['diamond', 2, -1, 1, 1, 1]], goals: { wood: true },
    seats: [...s.map((x) => x.serialize()), null] };
  const out = decode(encode(data));
  assert.equal(out.v, 2); assert.equal(out.seats.length, 4); assert.equal(out.seats[3], null);
  assert.equal(out.state.blocksBroken, 321); assert.deepEqual(out.drops, data.drops);
  const p3 = new Inventory().deserialize(out.seats[2].inv);
  assert.equal(p3.count('diamond'), 5); assert.equal(p3.slots[3].dur, 77); assert.equal(out.seats[2].sel, 3);
  assert.deepEqual(out.seats[2].spawn, { x: 3, y: 1, z: 3 });
  assert.equal(new Inventory().deserialize(out.seats[1].inv).armor[0].key, 'iron_helmet');
  const p3p = new Player(); p3p.deserialize(out.seats[2].player); assert.ok(Math.abs(p3p.x - 2.5) < 1e-9);
});

t('v1 saves migrate in memory (spawn moves into seat 0)', () => {
  const inv = new Inventory(); inv.add('oak_log', 7);
  const v1 = JSON.stringify({ v: 1, t: 1, world: { c: [] }, player: new Player().serialize(), inv: inv.serialize(), entities: {}, state: { blocksBroken: 12, time: 99, spawn: { x: 2, y: 1, z: 2 } }, goals: { wood: true }, sel: 4, drops: [] });
  const d = decode(v1);
  assert.equal(d.v, 2); assert.equal(d.seats.length, 4); assert.equal(d.seats[1], null);
  assert.equal(new Inventory().deserialize(d.seats[0].inv).count('oak_log'), 7);
  assert.equal(d.seats[0].sel, 4); assert.deepEqual(d.seats[0].spawn, { x: 2, y: 1, z: 2 });
  assert.equal(d.state.spawn, undefined); assert.equal(d.state.blocksBroken, 12); assert.deepEqual(d.goals, { wood: true });
  assert.equal(decode(JSON.stringify({ v: 3, world: {} })), null);
  assert.equal(migrate({ v: 2, seats: [1] }).seats[0], 1);
});

t('dropped items go to the nearest seat with room', () => {
  const a = mkSeat(0, 0.5), b = mkSeat(1, 2.0);
  const drop = { key: 'dirt', x: 1.6, y: 1, z: 0.5 };
  assert.equal(pickupSeat([a, b], drop), b); // b is nearer
  for (let i = 0; i < 36; i++) b.inv.slots[i] = makeStack('stone', 64);
  const far = { key: 'dirt', x: 3.0, y: 1, z: 0.5 };
  assert.equal(pickupSeat([a, b], far, 1.5), null); // b full, a out of reach
  const near = { key: 'dirt', x: 1.0, y: 1, z: 0.5 };
  assert.equal(pickupSeat([a, b], near), a);          // falls through to the seat that has room
  b.inv.slots[0] = makeStack('dirt', 10);
  assert.equal(pickupSeat([a, b], far), b);           // room in an existing stack counts
  b.player.dead = true; assert.equal(pickupSeat([a, b], far), null);
  assert.equal(pickupSeat([a, b], { key: 'dirt', x: 40, y: 1, z: 40 }), null);
});

t('platform contract sanity: seat counts and layouts', () => {
  assert.equal(PLATFORMS.xbox.maxSeats, 4); assert.equal(PLATFORMS.computer.saveKey, 'oneblock3d.save.v1');
  for (let n = 1; n <= 4; n++) assert.equal(viewportRects(n).length, n);
});

console.log(`\n${pass} multiseat tests passed`);
