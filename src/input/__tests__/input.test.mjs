import assert from 'node:assert/strict';
import { SprintLatch, applyDeadzone, lookCurve, lookAccel, MenuRepeater, EdgeSet, stickToDirs } from '../pure.js';
import { GamepadSource, BTN } from '../GamepadSource.js';
import { CombinedSource } from '../InputSource.js';

const near = (a, b, e = 1e-9) => assert.ok(Math.abs(a - b) < e, `${a} !~ ${b}`);
// deadzone
assert.deepEqual(applyDeadzone(0.1, 0.1, 0.2), { x: 0, y: 0, mag: 0 });
near(applyDeadzone(1, 0, 0.2).x, 1); near(applyDeadzone(0.6, 0, 0.2).x, 0.5);
const d = applyDeadzone(0.7, 0.7, 0.2); near(Math.hypot(d.x, d.y), d.mag); assert.ok(d.mag <= 1);
near(applyDeadzone(-0.6, 0, 0.2).x, -0.5);
// curve monotonic, 0..1, slow near zero
let last = -1; for (let m = 0; m <= 1.0001; m += 0.05) { const c = lookCurve(m); assert.ok(c >= last); last = c; }
near(lookCurve(0), 0); near(lookCurve(1), 1); assert.ok(lookCurve(0.3) < 0.15);
near(lookAccel(0), 1); near(lookAccel(10), 1.55);
// edges: consumed on read, expire
const e = new EdgeSet(0.25); e.add('a'); assert.ok(e.take('a')); assert.ok(!e.take('a'));
e.add('b'); e.age(0.2); assert.ok(e.has('b')); e.age(0.1); assert.ok(!e.take('b'));
// menu repeat timing: fire at 0, 0.35, then every 0.11
const r = new MenuRepeater(0.35, 0.11); const fired = []; let t = 0;
for (let i = 0; i < 100; i++) { for (const a of r.update(0.01, { ui_down: true })) fired.push(+t.toFixed(2)); t += 0.01; }
assert.equal(fired[0], 0); assert.ok(Math.abs(fired[1] - 0.35) < 0.021, fired.join()); assert.ok(Math.abs(fired[2] - fired[1] - 0.11) < 0.021);
assert.deepEqual(r.update(0.01, { ui_down: false }), []); assert.equal(r.update(0.01, { ui_down: true }).length, 1); // released -> fires immediately again
assert.deepEqual(stickToDirs(0.9, -0.1), { ui_left: false, ui_right: true, ui_up: false, ui_down: false });
// gamepad source
const pad = (o = {}) => ({ buttons: Array.from({ length: 17 }, (_, i) => ({ pressed: !!(o.b || []).includes(i), value: (o.v && o.v[i]) || ((o.b || []).includes(i) ? 1 : 0) })), axes: o.axes || [0, 0, 0, 0] });
const g = new GamepadSource(0);
g.update(0.016, pad()); g.update(0.016, pad({ b: [BTN.A] }));
assert.ok(g.pressed('jump')); assert.ok(!g.pressed('jump'));
g.update(0.016, pad({ v: { [BTN.RT]: 0.8 } })); assert.ok(g.down('primary')); assert.ok(g.pressed('primary'));
g.update(0.016, pad({ v: { [BTN.RT]: 0.4 } })); assert.ok(g.down('primary'), 'hysteresis keeps it held at 0.4');
g.update(0.016, pad({ v: { [BTN.RT]: 0.1 } })); assert.ok(!g.down('primary'));
g.update(0.016, pad({ axes: [0, -1, 0, 0] })); assert.deepEqual([g.move().f, g.move().r], [1, 0]);
g.update(0.016, pad({ axes: [0.1, 0.1, 0, 0] })); assert.equal(g.move().f, 0);
g.update(0.016, pad({ axes: [0, 0, 1, 0] })); const lk = g.look(); assert.ok(lk.dyaw < 0); assert.deepEqual(g.look(), { dyaw: 0, dpitch: 0 });
// B tap vs hold
const g2 = new GamepadSource(1); g2.update(0.016, pad());
g2.update(0.016, pad({ b: [BTN.B] })); g2.update(0.1, pad()); assert.ok(g2.pressed('drop')); assert.ok(!g2.pressed('dropStack'));
g2.update(0.016, pad({ b: [BTN.B] })); for (let i = 0; i < 45; i++) g2.update(0.016, pad({ b: [BTN.B] }));
assert.ok(g2.pressed('dropStack')); g2.update(0.016, pad()); assert.ok(!g2.pressed('drop'), 'no extra drop after stack');
// sneak toggle + sprint latch
g2.update(0.016, pad({ b: [BTN.RS] })); assert.ok(g2.move().sneak); g2.update(0.016, pad()); g2.update(0.016, pad({ b: [BTN.RS] })); assert.ok(!g2.move().sneak);
g2.update(0.016, pad()); g2.update(0.016, pad({ b: [BTN.LS], axes: [0, -1, 0, 0] })); assert.ok(g2.move().sprint);
g2.update(0.016, pad()); assert.ok(!g2.move().sprint);
// menu mode
const g3 = new GamepadSource(2); g3.setMode('menu'); g3.update(0.016, pad());
g3.update(0.016, pad({ b: [BTN.A] })); assert.ok(g3.pressed('ui_accept')); assert.ok(!g3.pressed('jump'));
g3.update(0.016, pad({ b: [BTN.DOWN] })); assert.ok(g3.pressed('ui_down'));
g3.update(0.2, pad({ b: [BTN.DOWN] })); assert.ok(!g3.pressed('ui_down')); g3.update(0.2, pad({ b: [BTN.DOWN] })); assert.ok(g3.pressed('ui_down'), 'repeat after 350 ms');
assert.deepEqual(g3.look(), { dyaw: 0, dpitch: 0 });
// join press recorded in any mode
const g4 = new GamepadSource(3); g4.update(0.016, pad()); g4.update(0.016, pad({ b: [BTN.MENU] })); assert.ok(g4.consumeJoinPress()); assert.ok(!g4.consumeJoinPress());
// combined
const k = new GamepadSource(5); const c = new CombinedSource(k, g); k.update(0.016, pad()); k.update(0.016, pad({ b: [BTN.Y] }));
assert.ok(c.pressed('inventory')); assert.ok(!c.pressed('inventory'));
// glyphs: plain tokens, badge html
assert.equal(g.glyph('jump'), 'A'); assert.equal(g.glyph('dropStack'), 'Hold B'); assert.ok(!/[\u24b6-\u24e9]/.test(JSON.stringify(['jump','inventory','goals','drop','ui_accept'].map((a) => g.glyph(a)))));
assert.equal(g.glyphHtml('dropStack'), 'Hold <span class="btn-glyph btn-b">B</span>'); assert.ok(g.glyphHtml('primary').includes('btn-trigger'));
// join: View or A (when joinOnA)
const j = new GamepadSource(7); j.update(0.016, pad()); j.update(0.016, pad({ b: [BTN.VIEW] })); assert.ok(j.consumeJoinPress());
j.update(0.016, pad()); j.update(0.016, pad({ b: [BTN.A] })); assert.ok(!j.consumeJoinPress()); j.joinOnA = true; j.update(0.016, pad()); j.update(0.016, pad({ b: [BTN.A] })); assert.ok(j.consumeJoinPress());
// joystick sprint latch: needs >= 95 % held for 0.25 s, releases below 50 %
const sl = new SprintLatch(); for (let i = 0; i < 10; i++) assert.ok(!sl.update(0.016, 0.9)); // firm but not full push: never sprints
for (let i = 0; i < 10; i++) sl.update(0.016, 1); assert.ok(!sl.on, '0.16 s is not enough'); for (let i = 0; i < 8; i++) sl.update(0.016, 1); assert.ok(sl.on);
sl.update(0.016, 0.7); assert.ok(sl.on, 'stays on until below 50 %'); sl.update(0.016, 0.3); assert.ok(!sl.on);
sl.update(0.1, 1); sl.update(0.1, 0.8); sl.update(0.1, 1); assert.ok(!sl.on, 'timer resets when the push relaxes');
console.log('input tests OK');
