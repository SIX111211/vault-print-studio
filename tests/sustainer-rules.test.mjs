import test from 'node:test';
import assert from 'node:assert/strict';
import catalog from '../src/catalog.json' with {type:'json'};
import {buildBOM, normalizeConfig, sustainerOptions} from '../src/rules.js';

const byId = Object.fromEntries(catalog.map(item => [item.id, item]));
const lockRoles = ['lock-holder', 'lock-inner', 'lock-outer', 'lock-pins'];
const rowsFor = (bom, role) => bom.rows.filter(row => row.role === role);
const one = (bom, role) => {
 const rows = rowsFor(bom, role);
 assert.equal(rows.length, 1, role);
 return rows[0];
};

// Sustainers Assembly pp. 1-5: facade + holder/inner/outer + one pin set per lock.
// All 19 actual facade STLs: S/M have one seat; L/XL have two.
test('all 90 sustainer bodies include the complete front lock assembly by default', () => {
 for (const opt of sustainerOptions) {
  for (const facade of opt.w === 'XL' ? ['family'] : ['family', 'universal']) {
   const config = {kind:'sustainer', optionId:opt.id, facade};
   const bom = buildBOM(config), locks = ['S','M'].includes(opt.w) ? 1 : 2;
   assert.equal(bom.complete, true, `${opt.id}/${facade}: ${bom.errors}`);
   assert.equal(normalizeConfig(config).lockCount, locks);
   for (const role of ['body','roof','facade','hinge-bottom','hinge-top','hinge-rods', ...lockRoles]) {
    const row = one(bom, role);
    assert.equal(row.required, true, role);
    assert.equal(row.qty, lockRoles.includes(role) ? locks : 1, role);
   }
   assert.equal(byId[one(bom,'lock-outer').id].name, `LOCK OUTER PART ${opt.h === '1F' ? '1F' : '2-4F'}.stl`);
   assert.equal(byId[one(bom,'lock-pins').id].name, '1 SET OF PINS FOR 1 LOCK.stl');
   assert.equal(rowsFor(bom,'label').length, 0);
   assert.equal(rowsFor(bom,'divider').length, 0);
   assert.equal(rowsFor(bom,'baseplate').length, 0);
  }
 }
});

test('dimensions resolve lock defaults without inheriting the L default', () => {
 for (const [w, locks] of [['S',1], ['M',1], ['L',2], ['XL',2]]) {
  const config = {kind:'sustainer',w,d:3,h:'1F'};
  assert.equal(normalizeConfig(config).lockCount, locks);
  const bom = buildBOM(config);
  assert.equal(bom.complete, true);
  for (const role of lockRoles) assert.equal(one(bom,role).qty, locks);
 }
});

test('explicit lock quantities are preserved and invalid quantities stay unresolved', () => {
 const config = {kind:'sustainer',w:'S',d:3,h:'1F'};
 for (const lockCount of [1,2,'2']) {
  const bom = buildBOM({...config,lockCount});
  assert.equal(bom.complete,true);
  for (const role of lockRoles) assert.equal(one(bom,role).qty, Number(lockCount));
 }
 for (const lockCount of [null,0,-1,1.5,'',false]) {
  const bom = buildBOM({...config,lockCount});
  assert.equal(bom.complete,false);
  assert.ok(bom.needsInput.some(item => item.field === 'lockCount'));
  for (const role of lockRoles) assert.equal(one(bom,role).qty,null);
  assert.equal(one(bom,'facade').qty,1);
 }
});

test('hinges and rods count full STL files for each width and height', () => {
 for (const w of ['S','M','L','XL']) for (const h of w === 'XL' ? ['1F'] : ['1F','2F','4F']) {
  const bom = buildBOM({kind:'sustainer',w,d:3,h});
  const bottom = ['L','XL'].includes(w) ? (h === '1F' ? 'L-XL 1F' : 'L 2-4F') : (h === '1F' ? 'S-M 1F' : 'S-M 2-4F');
  const top = ['L','XL'].includes(w) ? 'L-XL' : w;
  const rods = ['L','XL'].includes(w) ? 'L-XL' : 'S-M';
  assert.equal(byId[one(bom,'hinge-bottom').id].name, `${bottom} Hinge.stl`);
  assert.equal(byId[one(bom,'hinge-top').id].name, `${top} Hinge Top.stl`);
  assert.equal(byId[one(bom,'hinge-rods').id].name, `${rods} Rods.stl`);
  for (const role of ['hinge-bottom','hinge-top','hinge-rods']) assert.equal(one(bom,role).qty,1);
 }
});

test('split lids retain both required halves and require an explicit connector quantity', () => {
 for (const opt of sustainerOptions.filter(item => item.d >= 6)) {
  const config = {kind:'sustainer',optionId:opt.id,roof:'split'};
  const unresolved = buildBOM(config);
  assert.equal(unresolved.complete,false);
  assert.equal(rowsFor(unresolved,'roof').length,2);
  assert.equal(one(unresolved,'split-roof-connector').qty,null);
  assert.ok(unresolved.needsInput.some(item => item.field === 'splitRoofConnectorQty'));
  const bom = buildBOM({...config,splitRoofConnectorQty:1});
  assert.equal(bom.complete,true, opt.id);
  assert.equal(one(bom,'split-roof-connector').required,true);
  for (const row of rowsFor(bom,'roof')) {assert.equal(row.qty,1);assert.equal(row.required,true);}
  assert.equal(one(bom,'facade').qty,1);
 }
 assert.equal(buildBOM({kind:'sustainer',w:'S',d:3,roof:'split'}).complete,false);
 assert.equal(buildBOM({kind:'sustainer',w:'XL',facade:'universal'}).complete,false);
 assert.equal(buildBOM({kind:'sustainer',w:'XL',h:'2F'}).complete,false);
});

// Assembly p. 5 and Instructions p. 12 show one facade label, independent of locks.
test('labels and baseplates remain optional and do not multiply with lock count', () => {
 for (const [label, count] of [['none',0],['sustainer',1],['drawer',1],['both',2]]) {
  const bom = buildBOM({kind:'sustainer',w:'L',label,baseplate:true});
  assert.equal(bom.complete,true);
  assert.equal(rowsFor(bom,'label').length,count);
  for (const row of [...rowsFor(bom,'label'),...rowsFor(bom,'baseplate')]) {
   assert.equal(row.required,false);assert.equal(row.qty,1);
  }
  assert.ok(rowsFor(bom,'baseplate').length);
 }
});

// Assembly pp. 6-7: dividers depend on the desired layout, not on closure hardware.
test('every supported divider interior retains the requested file quantities', () => {
 for (const opt of sustainerOptions) {
  const dividers = opt.type === 'standard' ? {width:2} : opt.type === 'dividers' ? {width:2,depth:3} : opt.type === 'sealed' ? (opt.w === 'XL' ? {sealCenter:1,sealSides:2} : {seal:2}) : {};
  const bom = buildBOM({kind:'sustainer',optionId:opt.id,dividerLayout:'custom',dividers});
  assert.equal(bom.complete,true,`${opt.id}: ${bom.errors}`);
  const rows = rowsFor(bom,'divider');
  assert.equal(rows.length,Object.keys(dividers).length);
  assert.deepEqual(rows.map(row=>row.qty).sort(),Object.values(dividers).sort());
  assert.ok(rows.every(row=>row.required === false));
 }
});
