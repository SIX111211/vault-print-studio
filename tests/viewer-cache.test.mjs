import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {createContext,runInContext} from 'node:vm';
import * as THREE from 'three';
import {createSourceKey,assembledThumbnailKey,ThumbnailQueue} from '../src/navigation.js';
import {buildScene} from '../src/assembly.js';
import {moduleConfig} from '../src/planner.js';

// Real THREE geometry/materials and Viewer scene/cache code; no WebGL/browser/server.
async function harness(){
  const context=createContext({THREE,frames:{},buildScene,createSourceKey,assembledThumbnailKey,ThumbnailQueue,Blob,performance,URL,
    matchMedia:()=>({matches:true}),Worker:class{postMessage({key,buffer}){const x=new Uint8Array(buffer)[0]||0;queueMicrotask(()=>this.onmessage({data:{key,resolved:true,parts:[new Float32Array([x,0,0,x+10,0,0,x,20,5])]}}));}}
  });
  let source=await readFile(new URL('../src/viewer.js',import.meta.url),'utf8');
  source=source.replace(/^import .*;\r?\n/gm,'').replaceAll('import.meta.url',"'file:///viewer.js'").replaceAll('export ','');runInContext(source,context);
  runInContext(`function fakeViewer(){const v=Object.create(Viewer.prototype);Object.assign(v,{ticket:0,meshes:[],pinned:[],selectedKeys:new Set(),printStates:{},ghostPrinted:true,mode:'assembled',canvas:{dataset:{},style:{},setAttribute(){}},scene:new THREE.Scene(),group:new THREE.Group(),onStatus(){},camera:new THREE.PerspectiveCamera(35,1.5,.1,100000),controls:{target:new THREE.Vector3(),update(){}},capture(){this.captured=this.meshes.map(m=>({id:m.userData.id,scale:m.scale.toArray(),position:m.position.toArray()}));return 'image';}});v.camera.up.set(0,0,1);viewers.add(v);return v;}
  var part={id:'same',key:'part',copy:0,component:0,cal:{size:[10,20,5],matrix:[[1,0,0],[0,1,0],[0,0,1]],center:[0,0,0],min:[0,0,0]},position:[30,40,50]};`,context);
  return {run:code=>runInContext(code,context),context};
}

test('same-ID geometry versions coexist while pinned; eviction disposes only released geometry',async()=>{
  const h=await harness();await h.run(`var a=fakeViewer(),b=fakeViewer(),fileA=new Blob([new Uint8Array([1])]),fileB=new Blob([new Uint8Array([2])]),variant={previewAligned:true};
    awaitA=a.setScene({parts:[part]},new Map([['same',{file:fileA}]]),{fit:false,animate:false})`);
  await h.run("b.setScene({parts:[part]},new Map([['same',{file:fileB,variant}]]),{fit:false,animate:false})");
  h.run("var ga=a.meshes[0].geometry,gb=b.meshes[0].geometry,disposedA=0,disposedB=0;ga.addEventListener('dispose',()=>disposedA++);gb.addEventListener('dispose',()=>disposedB++)");
  assert.equal(h.run('ga===gb'),false);assert.equal(h.run('ga.attributes.position.array[0]'),1);assert.equal(h.run('gb.attributes.position.array[0]'),2);
  assert.equal(h.run('a.meshes[0].scale.equals(new THREE.Vector3(1,1,1))'),true);assert.deepEqual(Array.from(h.run('a.meshes[0].position.toArray()')),[30,40,50]);
  for(let i=0;i<40;i++)await h.run(`geometryFor('other${i}',new Blob([new Uint8Array([3])]))`);
  h.run('trimCache()');await Promise.resolve();assert.equal(h.run('cache.size'),36);assert.equal(h.run('disposedA+disposedB'),0);
  h.run('a.clear()');await h.run("geometryFor('extra',new Blob([new Uint8Array([4])]))");h.run('trimCache()');await Promise.resolve();
  assert.equal(h.run('disposedA'),1);assert.equal(h.run('disposedB'),0);assert.equal(h.run('pins.size'),1);
  h.run('clearGeometry()');await Promise.resolve();assert.equal(h.run('pins.size'),0);assert.equal(h.run('cache.size'),0);assert.equal(h.run('disposedB'),1);
});

test('assembled thumbnails use available imported parts, report missing meshes and release every pin after capture',async()=>{
  const h=await harness();h.context.config=moduleConfig('drawer','S','3','1F');
  const result=await h.run(`var thumb=fakeViewer();getThumbnailViewer=()=>thumb;var u={id:'unit',config,colors:{}},s=buildScene({...config,id:u.id}),id=s.parts[0].id;
    moduleThumbnail(u,new Map([[id,{file:new Blob([new Uint8Array([1])])}]]))`);
  assert.equal(result.url,'image');assert.ok(result.missing>0);assert.ok(h.run('thumb.captured.length')>0);
  assert.equal(h.run('thumb.captured.every(m=>m.id===id&&m.scale.every(x=>x===1))'),true);assert.equal(h.run('pins.size'),0);assert.equal(h.run('thumb.meshes.length'),0);
  await assert.rejects(h.run('moduleThumbnail(u,new Map())'),/尚未导入/);
});
