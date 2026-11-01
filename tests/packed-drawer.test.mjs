import test from 'node:test';
import assert from 'node:assert/strict';
import {buildBOM} from '../src/rules.js';
import {buildScene,componentFrames} from '../src/assembly.js';
import {drawerLayouts,frameRoles} from '../src/drawer-layout.js';
import datums from '../src/drawer-slot-data.json' with {type:'json'};
import {unitBOM,printedState,effectiveProgress} from '../src/planner.js';
import {sanitizeState,setPrinted} from '../src/state.js';
const config=(w='S',d=3,h='4F',drawers=['1F','1F','2F'])=>({kind:'drawer',w,d,h,drawers,roof:'none'});

test('internal slot metadata is a finite feature table, with 48 mm pitch and no mesh payload',()=>{
 assert.equal(Object.keys(datums).length,50);
 for(const [id,d]of Object.entries(datums)){
  assert.match(id,/^(?:XL|[SML])[3-7]-(?:1F|2F|4F)$/);assert.deepEqual(Object.keys(d).sort(),['axisZ','frontContactY','midX','slotAxes'].sort());
  assert.equal(d.slotAxes.length,parseInt(id.split('-')[1]));assert.ok([d.midX,d.frontContactY,d.axisZ,...d.slotAxes].every(Number.isFinite));
  assert.ok(Math.abs(d.axisZ-d.slotAxes[0])<1e-7);for(let i=1;i<d.slotAxes.length;i++)assert.ok(Math.abs(d.slotAxes[i]-d.slotAxes[i-1]-48)<.001);
 }
});
test('all catalog-backed packed drawer layouts contain one frame and complete source-file quantities',()=>{
 for(const w of ['S','M','L'])for(const d of [3,4,5,6,7])for(const h of ['2F','4F'])for(const parts of drawerLayouts(h)){
  const c=config(w,d,h,parts),b=buildBOM(c),s=buildScene(c);
  assert.deepEqual(b.errors,[]);assert.deepEqual(b.missing,[]);assert.equal(s.quantityComplete,true,JSON.stringify(c));assert.equal(s.parts.filter(p=>p.role==='body').length,1);
  assert.equal(new Set(s.parts.map(p=>p.key)).size,s.parts.length);
  for(const r of b.rows)assert.equal(s.parts.filter(p=>p.id===r.id).length,r.qty*componentFrames(r.id).length);
  const ordinary=buildScene({...c,drawers:undefined});assert.deepEqual(s.size,ordinary.size);
  for(const p of s.parts){assert.ok(p.position.every(Number.isFinite));const m=p.cal.matrix,det=m[0][0]*(m[1][1]*m[2][2]-m[1][2]*m[2][1])-m[0][1]*(m[1][0]*m[2][2]-m[1][2]*m[2][0])+m[0][2]*(m[1][0]*m[2][1]-m[1][1]*m[2][0]);assert.ok(Math.abs(det-1)<1e-6);}
 }
});
test('four 1F drawers share shell and latch, each has rails, springs, guides and stoppers',()=>{
 const c=config('S',3,'4F',Array(4).fill('1F')),b=buildBOM(c),qty=role=>b.rows.filter(r=>r.role===role).reduce((s,r)=>s+r.qty,0);
 assert.equal(qty('body'),1);assert.equal(qty('latch'),1);for(const role of ['box','facade','key','springs','geared-rails'])assert.equal(qty(role),4);for(const role of ['runner-guide','runner-slide','runner-stopper'])assert.equal(qty(role),8);
 assert.equal(buildScene(c).parts.filter(p=>p.role==='springs').length,8);
 assert.ok(buildBOM(config('S',3,'2F',['2F','1F'])).errors.length);assert.ok(buildBOM(config('XL',3,'1F',['1F','1F'])).errors.length);assert.ok(buildBOM(config('S',3,'4F',[])).errors.length);
});
test('packed drawer moving parts follow measured datums; guides and stoppers follow host source poses',()=>{
 const c=config(),s=buildScene(c),host=buildScene({...c,drawers:undefined}),target=datums['S3-4F'];let slot=0;
 for(const [index,h]of c.drawers.entries()){
  const source=buildScene({...c,h,drawers:undefined}),donor=datums[`S3-${h}`],dz=target.slotAxes[slot]-donor.axisZ;
  const box=s.parts.find(p=>p.role==='box'&&p.drawerSlot===index),old=source.parts.find(p=>p.role==='box');assert.ok(Math.abs(box.position[2]-old.position[2]-dz)<1e-8);assert.deepEqual(box.cal,old.cal);
  const guide=s.parts.find(p=>p.role==='runner-guide'&&p.drawerSlot===index),oldGuide=host.parts.find(p=>p.role==='runner-guide');assert.ok(Math.abs(guide.position[2]-oldGuide.position[2]-target.slotAxes[slot]+target.axisZ)<1e-8);assert.deepEqual(guide.cal,oldGuide.cal);assert.equal(guide.operates,false);
  slot+=parseInt(h);
 }
 const open=buildScene(c,{open:1,origin:[900,-120,60]});for(let i=0;i<s.parts.length;i++){assert.deepEqual(open.parts[i].position,s.parts[i].position.map((v,j)=>v+[900,-120,60][j]));if(['body','latch','runner-guide','runner-stopper'].includes(s.parts[i].role))assert.deepEqual(open.parts[i].move,s.parts[i].move);}
});
test('packed file progress marks only completed copies, undo and restore retain records and colors',()=>{
 const u={id:'packed',name:'多抽屉',config:config('S',3,'4F',['1F','1F','1F','1F']),progress:{},colors:{}},scene=buildScene({...u.config,id:u.id}),row=unitBOM(u).rows.find(r=>r.role==='springs');
 setPrinted(u,row.id,1,2);const status=printedState(scene,[u]);assert.equal(scene.parts.filter(p=>p.id===row.id&&status[p.key].done).length,2);assert.equal(effectiveProgress(u,row).printed,1);
 const key=scene.parts.find(p=>p.id===row.id&&p.copy===2).key;u.colors[key]='#aabbcc';const saved=structuredClone(u),s={version:1,units:[u],activeUnit:u.id,plans:[]};assert.deepEqual(sanitizeState(s,new Set(unitBOM(u).rows.map(r=>r.id))).units[0],saved);
 setPrinted(u,row.id,0,2);assert.ok(scene.parts.filter(p=>p.id===row.id).every(p=>!printedState(scene,[u])[p.key].done));assert.deepEqual(u.colors,saved.colors);
});
test('single-drawer configurations and explicit matching layouts preserve all original poses and keys',()=>{
 for(const w of ['S','M','L','XL']){const c={kind:'drawer',w,d:3,h:'1F'},a=buildScene(c),b=buildScene({...c,drawers:['1F']});assert.deepEqual(b.parts,a.parts);}
});
