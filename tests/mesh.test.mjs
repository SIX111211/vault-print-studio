import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readBinaryPreview} from '../src/binary-mesh.js';
function file(vertices){const b=new ArrayBuffer(134),v=new DataView(b);v.setUint32(80,1,true);vertices.forEach((x,i)=>v.setFloat32(96+4*i,x,true));return b;}
test('small binary meshes preserve source coordinates exactly',()=>{const b=file([0,0,0,10,0,0,0,10,0]),r=readBinaryPreview(b);assert.deepEqual([...r.raw],[0,0,0,10,0,0,0,10,0]);assert.equal(r.simplified,false);assert.equal(new DataView(b).getFloat32(108,true),10);});
test('dense preview clustering bounds coordinate displacement and never changes source buffer',()=>{const vertices=[.019,.031,0,10.01,0,0,0,10.01,0],b=file(vertices),before=new Uint8Array(b).slice(),r=readBinaryPreview(b,{threshold:0,cell:.12});assert.ok(r.simplified);r.raw.forEach((v,i)=>assert.ok(Math.abs(v-vertices[i])<=.061));assert.deepEqual(new Uint8Array(b),before);assert.equal(r.originalTriangles,1);});
test('binary nonfinite vertex rejected',()=>{assert.throws(()=>readBinaryPreview(file([NaN,0,0,1,0,0,0,1,0])),/无效/);});
