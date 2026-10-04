import { World } from '../World.js';
import assert from 'node:assert/strict';
const w = new World();
assert.equal(w.getBlock(0,0,0), 1);
assert.equal(w.getBlock(5,5,5), 0);
assert.equal(w.getBlock(0.9,0.2,0.5), 1);
assert.equal(w.getBlock(-0.1,0,0), 0);
assert.equal(w.setBlock(100,0,0,1), false);
assert.equal(w.setBlock(0,96,0,1), false);
assert.equal(w.setBlock(-64,-32,63,6), true);
assert.equal(w.getBlock(-64,-32,63), 6);
let ev=[]; const un = w.onChange((...a)=>ev.push(a));
w.dirty.clear();
w.setBlock(15,15,15,6);
assert.equal(w.dirty.size, 8); // corner touches 8 chunks
w.dirty.clear(); w.setBlock(3,3,3,6); assert.equal(w.dirty.size,1);
assert.deepEqual(ev[0], [15,15,15,0,6]);
un(); w.setBlock(2,2,2,6); assert.equal(ev.length,2);
// solid / water
w.setBlock(1,0,0,14); assert.equal(w.isSolid(1,0,0), false); assert.equal(w.isSolid(0,0,0), true);
// raycast
let h = w.raycast({x:0.5,y:3,z:0.5},{x:0,y:-1,z:0},10);
assert.deepEqual([h.x,h.y,h.z,h.id], [0,0,0,1]); assert.deepEqual(h.normal,{x:0,y:1,z:0}); assert.ok(Math.abs(h.dist-2)<1e-9);
h = w.raycast({x:-3,y:0.5,z:0.5},{x:1,y:0,z:0},10); assert.deepEqual([h.x,h.normal.x], [0,-1]);
h = w.raycast({x:5,y:0.5,z:0.5},{x:-1,y:0,z:0},10); // passes through water at x=1, hits block at 0, normal +x
assert.deepEqual([h.x,h.normal.x], [0,1]);
assert.equal(w.raycast({x:0.5,y:3,z:0.5},{x:0,y:1,z:0},10), null);
assert.equal(w.raycast({x:0.5,y:3,z:0.5},{x:0,y:-1,z:0},1), null);
h = w.raycast({x:0.5,y:0.5,z:0.5},{x:0,y:-1,z:0},5); assert.equal(h, null); // inside the block: own cell ignored
w.setBlock(0,1,0,6); h = w.raycast({x:0.5,y:0.5,z:0.5},{x:0,y:1,z:0},5); assert.deepEqual([h.y,h.normal.y], [1,-1]); w.setBlock(0,1,0,0);
const wb = new World(); wb.deserialize({v:1,chunks:[[0,0,0,[250,4096]]]}); assert.equal(wb.countBlocks(),0);
// torches hittable
w.setBlock(4,0,0,19); h = w.raycast({x:4.5,y:3,z:0.5},{x:0,y:-1,z:0},5); assert.equal(h.id,19);
// collision
w.setBlock(10,0,10,5); w.setBlock(11,0,10,18);
let b = w.getCollisionBoxes(10,0,10,10.5,1,10.5); assert.equal(b.length,1); assert.ok(Math.abs(b[0].maxY-15/16)<1e-9);
b = w.getCollisionBoxes(11.1,0,10.1,11.5,2,10.5); assert.ok(Math.abs(b[0].maxY-9/16)<1e-9);
assert.equal(w.getCollisionBoxes(0.1,1,0.1,0.7,2.8,0.7).length,0); // standing on top, touching only
assert.equal(w.getCollisionBoxes(0.1,0.99,0.1,0.7,2.8,0.7).length,1);
assert.equal(w.getCollisionBoxes(4.1,0,0.1,4.7,1.8,0.7).length,0); // torch not solid
// topSolidY
assert.equal(w.topSolidY(0,0), 0); assert.equal(w.topSolidY(4,0), null); assert.equal(w.topSolidY(3,3), 3);
// serialize
for (let i=0;i<500;i++) w.setBlock((i*7)%50-20,(i*3)%30,(i*11)%40-10, 1+(i%50));
const s = JSON.parse(JSON.stringify(w.serialize()));
const w2 = new World(); w2.deserialize(s);
let n1=0,n2=0; const m=new Map(); w.forEachBlock((x,y,z,id)=>{n1++; m.set(x+','+y+','+z,id)});
w2.forEachBlock((x,y,z,id)=>{n2++; assert.equal(m.get(x+','+y+','+z), id)});
assert.equal(n1,n2); assert.equal(w2.emitters.size, w.emitters.size);
console.log('serialized bytes', JSON.stringify(s).length, 'blocks', n1, 'emitters', w.emitters.size);
// removing all blocks drops chunk
const w3 = new World(); w3.setBlock(0,0,0,0); assert.equal(w3.chunks.size,0);
console.log('World OK');
