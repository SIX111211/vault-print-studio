import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import catalog from '../src/catalog.json' with {type:'json'};
import frames from '../src/assembly-data.json' with {type:'json'};
import {buildBOM,defaults,normalizeConfig,configurationOptions,sustainerOptions,modificationOptions} from '../src/rules.js';
import {buildScene,componentFrames} from '../src/assembly.js';

const trolley={kind:'mods',family:'trolley',w:'L',d:3,towerLayers:3,stopperOuterDiameter:30,boltLength:80,backboneFastenerQty:12,lockMountQty:4,lockMountBoltLength:20,rodLength:500,lockBoltThread:'M6'};
const near=(a,b)=>assert.ok(Math.abs(a-b)<1e-7,`${a} != ${b}`);
const byId=Object.fromEntries(catalog.map(p=>[p.id,p]));
function checkScene(scene){
 assert.equal(scene.physicalFitVerified,false);
 assert.equal(new Set(scene.parts.map(p=>p.key)).size,scene.parts.length);
 for(const p of scene.parts){
  assert.ok(byId[p.id]);assert.ok(['inferred','unplaced'].includes(p.evidence));
  for(const v of [p.cal.matrix,p.cal.center,p.cal.min,p.cal.max,p.position,p.move].flat(Infinity))assert.ok(Number.isFinite(v));
  assert.deepEqual(p.matrix,p.cal.matrix);
 }
}

test('S3 standard key defaults include a single optional paired rail file',()=>{
 const b=buildBOM(defaults());assert.equal(b.complete,true);assert.equal(b.rows.length,14);
 assert.equal(b.rows.reduce((n,r)=>n+r.qty,0),17);
 assert.deepEqual(b.rows.find(r=>r.id==='m0280'),{id:'m0280',qty:1,required:false,role:'geared-rails',reason:'一份 STL 含一对齿条，建议用于齿轮传动。'});
 assert.equal(b.rows.find(r=>r.id==='m0010').qty,1);
 assert.equal(b.hardware.find(h=>h.spec==='M4 × 14 mm').qty,4);
 for(const r of b.rows)assert.deepEqual(Object.keys(r).sort(),['id','qty','reason','required','role']);
 const s=buildScene(defaults());checkScene(s);assert.equal(s.parts.length,19);assert.equal(s.quantityComplete,true);assert.equal(s.fitV6.applied,true);assert.equal(s.fitV6.physicalFitVerified,false);
});

test('rails may be explicitly omitted and hidden-key parts remain represented',()=>{
 const b=buildBOM({rails:false});assert.equal(b.complete,true);assert.ok(!b.rows.some(r=>r.role==='geared-rails'));assert.match(b.warnings.join(' '),/建议/);
 assert.equal(buildScene({rails:false}).parts.length,17);
 const hidden=buildBOM({key:'hidden'});assert.equal(hidden.complete,true);assert.equal(hidden.rows.filter(r=>r.role==='key').length,2);assert.ok(!hidden.rows.some(r=>r.role==='geared-rails'));
 const s=buildScene({key:'hidden'});assert.ok(s.parts.some(p=>p.evidence==='unplaced'));checkScene(s);
});

test('scene options preserve reference frames and apply origin/open/explode',()=>{
 const c=defaults(),before=structuredClone(c),base=buildScene(c),shifted=buildScene(c,{origin:[11,22,33]}),opened=buildScene(c,{open:.5}),exploded=buildScene(c,{explode:.5,progress:0});
 assert.deepEqual(c,before);
 base.parts.forEach((p,i)=>{assert.deepEqual(p.cal,shifted.parts[i].cal);p.position.forEach((v,j)=>near(shifted.parts[i].position[j]-v,[11,22,33][j]));});
 const guide=s=>s.parts.find(p=>p.id==='m0300'&&p.copy===0),slide=s=>s.parts.find(p=>p.id==='m0301'&&p.copy===0);
 assert.deepEqual(guide(base).move,guide(opened).move);near(slide(opened).move[1]-slide(base).move[1],base.size[1]*.72*.5);
 assert.ok(exploded.parts.some((p,i)=>p.move.some((v,j)=>v!==base.parts[i].move[j])));checkScene(exploded);
 assert.throws(()=>buildScene(c,{origin:[NaN,0,0]}),TypeError);
});

test('all supported basic drawer sizes generate complete finite descriptors',()=>{
 for(const w of ['S','M','L','XL'])for(const d of [3,4,5,6,7])for(const h of w==='XL'?['1F']:['1F','2F','4F']){
  const c={w,d,h},b=buildBOM(c);assert.equal(b.complete,true,`${w}${d}/${h}: ${b.missing}`);const s=buildScene(c);checkScene(s);assert.equal(s.quantityComplete,true);
 }
 const xl=buildBOM({w:'XL',d:6});assert.equal(xl.rows.filter(r=>r.role==='box').length,2);
 assert.equal(buildBOM({w:'XL',h:'2F'}).complete,false);
});

test('sustainer quantities count paired STL files and hinge motion uses supplied origin',()=>{
 const c=defaults('sustainer'),b=buildBOM(c);assert.equal(b.complete,true);assert.ok(!b.rows.some(r=>r.role==='geared-rails'));
 assert.equal(b.rows.find(r=>r.role==='hinge-bottom').qty,1);assert.equal(b.rows.find(r=>r.role==='hinge-rods').qty,1);assert.equal(b.rows.find(r=>r.role==='lock-pins').qty,2);
 const s=buildScene(c),moving=buildScene(c,{origin:[7,8,9],open:.4});checkScene(s);checkScene(moving);assert.equal(s.parts.length,23);
 const lid=moving.parts.find(p=>p.lidGroup);assert.ok(lid.hinge);near(lid.hinge.angle,(.4-.2)/.8*Math.PI*.55);assert.equal(s.parts.filter(p=>p.id===b.rows.find(r=>r.role==='lock-pins').id).length,8);
 const single=buildBOM({kind:'sustainer',w:'S',d:3,h:'1F'});assert.equal(single.complete,true);assert.ok(!single.needsInput.some(n=>n.field==='lockCount'));assert.equal(single.rows.find(r=>r.role==='lock-holder').qty,1);
 const optional=buildBOM({...c,label:'sustainer',baseplate:true});assert.equal(optional.rows.find(r=>r.role==='label').required,false);assert.ok(optional.rows.filter(r=>r.role==='baseplate').every(r=>!r.required));
});

test('all 90 catalog sustainer options build without DOM or missing parts',()=>{
 assert.equal(sustainerOptions.length,90);
 for(const opt of sustainerOptions){const c={kind:'sustainer',optionId:opt.id,lockCount:2};const b=buildBOM(c);assert.equal(b.complete,true,`${opt.id}: ${b.errors} ${b.missing}`);checkScene(buildScene(c));}
});

test('trolley reuses host BOM and counts hardware once',()=>{
 const b=buildBOM(trolley),s=buildScene(trolley);assert.equal(b.complete,true);assert.equal(b.hostModules.length,3);assert.equal(b.hostBOMs.length,3);assert.equal(b.rows.length,25);
 assert.equal(b.rows.find(r=>r.id==='m0278').qty,3);assert.equal(b.rows.find(r=>r.id==='m0278').required,false);
 assert.equal(b.rows.find(r=>r.id==='m0010').qty,3);
 assert.equal(b.hardware.filter(h=>h.spec==='M4 × 14 mm').reduce((n,h)=>n+h.qty,0),18);
 assert.equal(s.parts.length,74);assert.equal(s.auditMatchesBOM,true);assert.equal(s.quantityComplete,true);assert.equal(s.pitch,96);checkScene(s);
 assert.equal(s.referenceRods.length,3);assert.equal(s.referenceRods.find(r=>r.kind==='base-axle').length,414);
 const shifted=buildScene(trolley,{origin:[1,2,3]});s.referenceRods.forEach((r,i)=>r.start.forEach((v,j)=>near(shifted.referenceRods[i].start[j]-v,j+1)));
});

test('unconfirmed trolley inputs and S lock parts stay unresolved',()=>{
 const unresolved=buildBOM(defaults('mods'));assert.equal(unresolved.complete,false);assert.ok(unresolved.needsInput.some(n=>n.field==='lockMountQty'));assert.ok(unresolved.hardware.some(h=>h.qty===null));
 const sConfig={...trolley,w:'S',sLockPart2Qty:2},b=buildBOM(sConfig),s=buildScene(sConfig);assert.equal(b.complete,true);assert.equal(b.rows.find(r=>r.id==='m0645').qty,2);
 assert.ok(s.parts.filter(p=>['m0645','m0637','m0638'].includes(p.id)).every(p=>p.evidence==='unplaced'));checkScene(s);
 const bad=buildBOM({...trolley,lockBoltThread:'M4'});assert.equal(bad.complete,false);assert.ok(bad.needsInput.some(n=>n.field==='threadsVerified'));
 assert.equal(buildBOM({...trolley,lockBoltThread:'M4',threadsVerified:true}).complete,true);
});

test('all attachment families retain available BOM instances even when incomplete',()=>{
 assert.equal(modificationOptions.length,14);
 for(const option of modificationOptions){const config=defaults(option.id),b=buildBOM(config),s=buildScene(config);assert.ok(Array.isArray(b.rows));checkScene(s);}
});

test('unknown quantities, divider choices and independent results are preserved',()=>{
 assert.equal(buildBOM({kind:'mods',family:'base',d:6,form:'split'}).complete,false);
 const div=buildBOM({kind:'sustainer',w:'L',d:3,h:'1F',interior:'dividers',dividerLayout:'custom',dividers:{width:2}});
 assert.equal(div.complete,true);assert.equal(div.rows.find(r=>r.role==='divider').qty,2);assert.equal(div.rows.find(r=>r.role==='divider').required,false);
 const a=buildBOM(),b=buildBOM();a.rows[0].qty=999;assert.equal(b.rows[0].qty,1);
 const f=componentFrames('m0280');assert.equal(f.length,2);f[0].origin[0]=0;assert.notEqual(componentFrames('m0280')[0].origin[0],0);
 assert.equal(componentFrames('unknown').length,0);
});

test('public options expose typed inputs and factual frames contain no topology',async()=>{
 assert.equal(configurationOptions.mods.variants.length,14);assert.ok(configurationOptions.drawer.inputs.some(f=>f.key==='rails'&&f.default===true));
 for(const option of modificationOptions)for(const field of option.inputs){assert.equal(typeof field.key,'string');assert.equal(typeof field.type,'string');assert.equal(typeof field.label,'string');}
 assert.equal(Object.keys(frames).length,136);assert.equal(Object.values(frames).flat().length,151);
 for(const group of Object.values(frames))for(const f of group){assert.deepEqual(Object.keys(f).filter(k=>/selector|triangles|vertices|b64/i.test(k)),[]);assert.equal(f.rotation.length,3);}
 for(const name of ['rules.js','assembly.js','assembly-data.json','orientation.json']){const text=await readFile(new URL('../src/'+name,import.meta.url),'utf8');assert.doesNotMatch(text,/(?:[A-Z]:[\\/]|\.pdf\b|\.png\b|\.jpg\b|VAULT_MESH|globalThis|document\.|window\.|localStorage)/);}
});


test('Chinese UI labels, purposes and fixed step indices',()=>{
 const chinese=/[\u3400-\u9fff]/;
 for(const group of [configurationOptions.drawer.inputs,configurationOptions.sustainer.inputs,...modificationOptions.map(o=>o.inputs)])for(const input of group){assert.match(input.label,chinese);assert.match(input.purpose,chinese);}
 for(const option of modificationOptions){assert.match(option.title,chinese);assert.match(option.purpose,chinese);}
 assert.equal(configurationOptions.mods.variants.find(o=>o.id==='pullOutHandle').title,'伸缩拉手');
 const drawer=buildScene(),sustainer=buildScene(defaults('sustainer')),mods=buildScene(trolley);
 assert.deepEqual([drawer.steps.length,sustainer.steps.length,mods.steps.length],[14,13,16]);
 assert.equal(drawer.steps[5][0],'齿条');assert.equal(sustainer.steps[8][0],'销轴');assert.equal(mods.steps[14][0],'握把');
 for(const scene of [drawer,sustainer,mods]){scene.steps.forEach(([label])=>assert.match(label,chinese));scene.parts.forEach(p=>assert.match(p.reason,chinese));assert.equal(scene.physicalFitVerified,false);}
 for(const config of [{kind:'mods',family:'trolley'},{kind:'sustainer',w:'S'},{rails:false}]){const b=buildBOM(config);b.warnings.forEach(w=>assert.match(w,chinese));b.needsInput.forEach(n=>assert.match(n.reason,chinese));}
 const bad=buildBOM({w:'invalid'});bad.errors.forEach(e=>assert.match(e,chinese));
});

test('unknown configuration types do not inherit unrelated drawer controls',()=>{
 assert.throws(()=>defaults('unknown'),/未知配置类型/);
 assert.equal(buildBOM({kind:'unknown'}).complete,false);
 const unknown=normalizeConfig({kind:'mods',family:'unknown'});assert.equal(unknown.roof,undefined);assert.equal(unknown.key,undefined);assert.equal(unknown.rails,undefined);assert.equal(buildBOM(unknown).complete,false);
 assert.equal(normalizeConfig({kind:'mods',family:'drawer'}).roof,undefined);
 assert.equal(defaults('drawer').baseplate,false);
 const casters=buildBOM({kind:'mods',family:'casters',casterBoltLength:25});assert.equal(casters.hardware.find(h=>h.spec==='M8 外购脚轮').qty,4);
});
