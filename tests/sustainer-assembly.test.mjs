import test from 'node:test';
import assert from 'node:assert/strict';
import {buildScene} from '../src/assembly.js';
import {sustainerOptions} from '../src/rules.js';
import data from '../src/sustainer-front-data.json' with {type:'json'};
import bodyData from '../src/sustainer-body-data.json' with {type:'json'};
import connectorData from '../src/sustainer-connector-data.json' with {type:'json'};

const close=(a,b,tolerance=.02)=>assert.ok(Math.abs(a-b)<tolerance,`${a} vs ${b}`);
const determinant=r=>r[0][0]*(r[1][1]*r[2][2]-r[1][2]*r[2][1])-r[0][1]*(r[1][0]*r[2][2]-r[1][2]*r[2][0])+r[0][2]*(r[1][0]*r[2][1]-r[1][1]*r[2][0]);

test('split connectors occupy measured roof pockets and follow its phased hinge without changing requested quantity',()=>{
 let plans=0;
 for(const opt of sustainerOptions.filter(o=>o.d>=6)){
  const base={kind:'sustainer',optionId:opt.id,roof:'split',splitRoofConnectorQty:1};
  const first=buildScene(base).parts.find(p=>p.role==='split-roof-connector'),record=connectorData[first.id];
  assert.ok(record);plans++;
  for(const open of [0,.1,.2,.6,1]){
   const origin=[17,23,41],s=buildScene({...base,splitRoofConnectorQty:record.sites.length},{origin,open});
   const roof=s.parts.find(p=>p.id===record.roofPart1Id),connectors=s.parts.filter(p=>p.role==='split-roof-connector');
   assert.equal(connectors.length,record.sites.length);
   for(const p of connectors){
    assert.deepEqual(p.hinge,roof.hinge);assert.equal(p.lidGroup,true);assert.equal(p.evidence,'inferred');
    assert.equal(p.fitSustainer.physicalFitVerified,false);
    for(let j=0;j<3;j++)close(p.position[j]-roof.position[j],record.sites[p.copy][j],.00001);
    close(p.hinge.angle,Math.max(0,(open-.2)/.8)*Math.PI*.55,.00001);
   }
  }
  const extra=buildScene({...base,splitRoofConnectorQty:record.sites.length+1});
  const pending=extra.parts.filter(p=>p.role==='split-roof-connector'&&p.evidence==='unplaced');
  assert.equal(pending.length,1);assert.equal(pending[0].hinge,undefined);
  assert.equal(buildScene(base).parts.filter(p=>p.role==='split-roof-connector').length,1);
 }
 assert.equal(plans,36);
});

test('all stock sustainer sizes include every closure solid, including paired and four-pin files',()=>{
 for(const opt of sustainerOptions){
  const scene=buildScene({kind:'sustainer',optionId:opt.id}),sets=['S','M'].includes(opt.w)?1:2;
  assert.equal(scene.quantityComplete,true,opt.id);
  for(const role of ['lock-holder','lock-inner','lock-outer'])assert.equal(scene.parts.filter(p=>p.role===role).length,sets);
  assert.equal(scene.parts.filter(p=>p.role==='lock-pins').length,sets*4);
  assert.equal(scene.parts.filter(p=>p.role==='hinge-bottom').length,2);
  assert.equal(scene.parts.filter(p=>p.role==='hinge-rods').length,2);
  for(const p of scene.parts){assert.ok(p.position.every(Number.isFinite));close(determinant(p.cal.matrix),1,.0001);}
 }
});

test('facades and lock holders align all four mounting holes, with UP at the top',()=>{
 for(const opt of sustainerOptions)for(const facade of opt.w==='XL'?['family']:['family','universal']){
  const s=buildScene({kind:'sustainer',optionId:opt.id,facade}),f=s.parts.find(p=>p.role==='facade'),datum=data.facades[f.id];
  assert.ok(Math.min(...datum.lockHoles.map(h=>h[1]))>f.cal.size[2]/2);
  for(const p of s.parts.filter(p=>p.role==='lock-holder')){
   for(const x of [6.56,67.96])for(const z of [6.5599,15.5599]){
    const world=[p.position[0]+x,p.position[2]+z];
    assert.ok(datum.lockHoles.some(h=>Math.hypot(world[0]-f.position[0]-h[0],world[1]-f.position[2]-h[1])<.025),opt.id);
   }
   close(p.position[1]+5.60095,f.position[1]);
  }
 }
});

test('lock opening keeps the short-pin axis fixed and moves the outer pivot with the inner link',()=>{
 const s=buildScene({kind:'sustainer',w:'S'},{open:1,origin:[20,30,40]});
 const inner=s.parts.find(p=>p.role==='lock-inner'),outer=s.parts.find(p=>p.role==='lock-outer');
 close(inner.hinge.angle,Math.PI/2);close(outer.hinge.angle,-Math.PI/2);
 close(outer.hinge.pivot[2]+outer.move[2],inner.hinge.pivot[2]);
 close(outer.hinge.pivot[1]+outer.move[1]-inner.hinge.pivot[1],15.0015);
 const pins=s.parts.filter(p=>p.role==='lock-pins');
 assert.equal(pins.filter(p=>p.hinge).length,2);
 for(const p of pins.filter(p=>p.hinge))assert.deepEqual(p.hinge.pivot,inner.hinge.pivot);
});

test('all 126 whole/split configurations keep every hinge and both rods on one measured axis',()=>{
 for(const [key,plan]of Object.entries(bodyData.plans)){
  const [bodyId,roof]=key.split(':'),c={kind:'sustainer',optionId:bodyId,roof,splitRoofConnectorQty:1};
  const scene=buildScene(c,{open:1,origin:[17,23,41]}),pivot=scene.sustainerDatums.pivot;
  assert.equal(scene.quantityComplete,true,key);
  for(const p of scene.parts.filter(p=>/^hinge-/.test(p.role))){
   const entry=bodyData.frames[p.id],f=Array.isArray(entry)?entry[p.component]:entry;
   if(f.barrelCenter){
    close(p.position[1]+f.barrelCenter[1],pivot[1]+23,.001);
    close(p.position[2]+f.barrelCenter[2],pivot[2]+41,.001);
   }else{
    close(p.position[1]+f.axisLocalYZ[0],pivot[1]+23,.001);
    close(p.position[2]+f.axisLocalYZ[1],pivot[2]+41,.001);
   }
   if(p.role==='hinge-top'){assert.deepEqual(p.hinge.pivot,pivot.map((v,j)=>v+[17,23,41][j]));close(p.hinge.angle,Math.PI*.55);}
   else assert.equal(p.hinge,undefined);
  }
  assert.equal(!!scene.fitWarnings.length,plan.status==='source-interface-mismatch',key);
 }
});

test('roof and upper hinge mounting holes coincide while the front remains against the body',()=>{
 for(const opt of sustainerOptions){
  const scene=buildScene({kind:'sustainer',optionId:opt.id});
  const roof=scene.parts.find(p=>p.role==='roof'),rf=bodyData.frames[roof.id];
  const targets=rf.mountHoles.map(h=>h.map((v,j)=>v+roof.position[j]));
  for(const p of scene.parts.filter(p=>p.role==='hinge-top')){
   const f=bodyData.frames[p.id],rec=Array.isArray(f)?f[p.component]:f;
   for(const h of rec.mountHoles){const world=h.map((v,j)=>v+p.position[j]);assert.ok(targets.some(t=>Math.hypot(...t.map((v,j)=>v-world[j]))<.001),opt.id);}
  }
  const body=scene.parts.find(p=>p.role==='body'),facade=scene.parts.find(p=>p.role==='facade');
  close(facade.position[1],body.cal.size[1],.001);
  assert.equal(roof.hinge.angle,0);
 }
});

test('every catalog roof uses the roof assembly step and explode displacement regardless of folder spelling',()=>{
 const expected=new Set();
 for(const opt of sustainerOptions){
  for(const roof of ['whole',...(opt.d>=6?['split']:[])]){
   const s=buildScene({kind:'sustainer',optionId:opt.id,roof,splitRoofConnectorQty:1},{explode:1});
   assert.ok(bodyData.plans[opt.id+':'+roof],opt.id+':'+roof);
   expected.add(opt.id+':'+roof);
   for(const p of s.parts.filter(p=>p.role==='roof')){
    assert.equal(p.kind,'roof',p.id);assert.equal(p.step,5,p.id);assert.ok(p.move[2]>=120,p.id);
    assert.equal(p.evidence,'inferred',p.id);
    assert.ok(!s.unplaced.some(r=>r.id===p.id),p.id);
    assert.equal(s.audit.find(a=>a.id===p.id).unplaced,0,p.id);
   }
  }
 }
 assert.equal(expected.size,126);assert.equal(Object.keys(bodyData.plans).length,expected.size);
});

test('extra lock sets keep all solids, report pending placement and occupy separate positions',()=>{
 for(const w of ['S','L']){
  const s=buildScene({kind:'sustainer',w,d:3,h:'1F',lockCount:4},{origin:[13,29,41]});
  const pending=s.parts.filter(p=>p.evidence==='unplaced'),n=(4-(w==='S'?1:2))*7;
  assert.equal(pending.length,n);assert.equal(s.audit.reduce((n,a)=>n+a.unplaced,0),n);
  assert.equal(s.unplaced.length,4);assert.ok(s.fitWarnings.some(x=>x.includes('待装区')));
  assert.equal(s.quantityComplete,true);
  for(let i=0;i<pending.length;i++)for(let j=i+1;j<pending.length;j++){
   const a=pending[i],b=pending[j];
   assert.ok([0,1].some(k=>a.position[k]+a.cal.size[k]<=b.position[k]||b.position[k]+b.cal.size[k]<=a.position[k]),a.key+' / '+b.key);
  }
  assert.ok(pending.every(p=>!p.hinge&&!p.lidGroup));
 }
});
