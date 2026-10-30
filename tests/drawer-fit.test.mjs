import test from 'node:test';
import assert from 'node:assert/strict';
import {buildScene} from '../src/assembly.js';
import {buildBOM} from '../src/rules.js';
import {Matrix3} from 'three';

const configs=['S','M','L','XL'].flatMap(w=>[3,4,5,6,7].flatMap(d=>(w==='XL'?['1F']:['1F','2F','4F']).map(h=>({kind:'drawer',w,d,h,roof:'none',rails:true,label:true}))));
test('all 50 drawer sizes retain the complete BOM and rigid native part frames',()=>{
 assert.equal(configs.length,50);
 for(const c of configs){
  const s=buildScene(c),b=buildBOM(c);assert.equal(s.quantityComplete,true,JSON.stringify(c));
  for(const row of b.rows)assert.ok(s.parts.some(p=>p.id===row.id),row.id);
  for(const p of s.parts){
   const r=new Matrix3().set(...p.cal.matrix.flat()),rt=r.clone().transpose().multiply(r);
   assert.ok(Math.abs(r.determinant()-1)<1e-6,p.id);
   assert.ok(rt.elements.every((v,i)=>Math.abs(v-([0,4,8].includes(i)?1:0))<1e-6),p.id);
   assert.ok([...p.position,...p.cal.min,...p.cal.max].every(Number.isFinite),p.id);
  }
  if(c.w==='S'&&c.d===3&&c.h==='1F'){assert.equal(s.fitV6.applied,true);continue;}
  const body=s.parts.find(p=>p.role==='body');assert.ok(Math.abs(body.cal.size[2]-(48*Number(c.h[0])+9.0095))<.04,body.id);
  const expectedDepth=body.id==='m0036'?188.05:42*c.d+20.1; // S4 4F source has a 0.05 mm shorter rear face.
  assert.ok(Math.abs(body.cal.size[1]-expectedDepth)<.04,body.id);
  assert.equal(s.parts.filter(p=>p.role==='box').length,c.w==='XL'&&c.d>=6?2:1);
  for(const p of s.parts.filter(p=>['body','box','facade','runner-guide','runner-slide','key','key-cap','springs','facade-cap','label','geared-rails'].includes(p.role)))assert.equal(p.fitDrawer?.status,'source-features-aligned',`${c.w}${c.d}${c.h} ${p.id}`);
 }
});

test('all drawer guides stay fixed during opening while slides and the box move together',()=>{
 for(const c of configs){
  const closed=buildScene(c),open=buildScene(c,{open:1}),offset=buildScene(c,{origin:[19,31,47]});
  for(let i=0;i<closed.parts.length;i++){
   const a=closed.parts[i],b=open.parts[i],o=offset.parts[i];assert.equal(a.key,b.key);assert.equal(a.key,o.key);
   for(let j=0;j<3;j++)assert.ok(Math.abs(o.position[j]-a.position[j]-[19,31,47][j])<1e-6,a.id);
   if(a.role==='runner-guide')assert.deepEqual(b.move,a.move,a.id);
   if(['runner-slide','box','facade'].includes(a.role)){
    assert.ok(b.move[1]-a.move[1]>80,a.id);assert.equal(b.move[0],a.move[0]);assert.equal(b.move[2],a.move[2]);
   }
  }
 }
});

test('XL short drawers include their required rear panel; split long boxes retain both original files',()=>{
 for(const [d,id]of [[3,'m0221'],[4,'m0231'],[5,'m0241']]){
  const c={kind:'drawer',w:'XL',d,h:'1F',roof:'none'},bom=buildBOM(c),row=bom.rows.find(r=>r.id===id);
  assert.equal(row.role,'back-panel');assert.equal(row.qty,1);assert.equal(row.required,true);
  const s=buildScene(c),p=s.parts.find(p=>p.id===id);assert.equal(p.operates,true);assert.equal(p.fitDrawer.physicalFitVerified,false);
  assert.ok(s.fitWarnings.some(w=>w.includes('后面板')&&w.includes('干涉')));
 }
 for(const d of [6,7]){
  const b=buildBOM({kind:'drawer',w:'XL',d,h:'1F',roof:'none'});
  assert.equal(b.rows.filter(r=>r.role==='box').length,2);assert.equal(b.rows.filter(r=>r.role==='back-panel').length,0);
 }
});

test('standard drawer roofs use native frames, keep source identity and stay fixed while opening',()=>{
 for(const c of configs){
  const config={...c,roof:'Grid Roof'},closed=buildScene(config),opened=buildScene(config,{open:1}),offset=buildScene(config,{origin:[7,11,13]});
  const roof=closed.parts.find(p=>p.role==='roof'),openRoof=opened.parts.find(p=>p.key===roof.key),offsetRoof=offset.parts.find(p=>p.key===roof.key);
  assert.ok(roof);assert.equal(roof.operates,false);assert.deepEqual(roof.move,openRoof.move);
  assert.deepEqual(roof.cal,openRoof.cal);assert.equal(roof.id,buildBOM(config).rows.find(r=>r.role==='roof').id);
  for(let j=0;j<3;j++)assert.ok(Math.abs(offsetRoof.position[j]-roof.position[j]-[7,11,13][j])<1e-7);
  if(c.w==='S'&&c.d===3&&c.h==='1F'){assert.ok(roof.fitV6);continue;}
  assert.equal(roof.fitDrawer.status,'source-features-aligned');assert.equal(roof.fitDrawer.physicalFitVerified,false);
  assert.ok(roof.cal.size[2]>14&&roof.cal.size[2]<16,'roof must not use tilted PCA bounds');
  assert.ok(closed.fitWarnings.some(w=>w.includes('标准顶盖')));
 }
});
