import test from 'node:test';
import assert from 'node:assert/strict';
import {validateTiers,sanitizeState} from '../src/state.js';
import {changePlan,moduleConfig} from '../src/planner.js';
import {buildComposition,compositionProblem} from '../src/composition.js';
const unit=(id,h='1F')=>({id,name:id,config:moduleConfig('drawer','S',3,h),progress:{m0010:{printed:1}},colors:{'saved':'#123456'}});
test('left two 1F modules and right one 2F have independent positions and retain source-size mismatch',()=>{
 const units=[unit('a'),unit('b'),unit('c','2F')],tier={pattern:'SS',ids:['a','b','c'],columns:[['a','b'],['c']]},plan={id:'p',tiers:[tier]},before=structuredClone(units);
 assert.equal(validateTiers(plan.tiers,units),'');const s=buildComposition(plan,units),a=s.layers[0].find(p=>p.id==='a'),b=s.layers[0].find(p=>p.id==='b'),c=s.layers[0].find(p=>p.id==='c');assert.equal(a.origin[0],b.origin[0]);assert.ok(c.origin[0]>0);assert.ok(b.origin[2]>a.origin[2]);assert.equal(a.bottom,c.bottom);assert.match(s.warnings[0],/4\.20/);assert.deepEqual(units,before);
 const next={...plan,tiers:[tier,{pattern:'single',ids:['l']}]},l={...unit('l'),config:moduleConfig('drawer','L',3,'1F')};assert.match(compositionProblem(next,[...units,l]),/上沿不齐/);
 const restored=sanitizeState({version:1,units,plans:[plan],activeUnit:'b',activePlan:'p',queuePlan:'p'},new Set(['m0010']));assert.deepEqual(restored.plans[0].tiers[0],tier);assert.deepEqual(restored.units,units);
});
test('same 2F frames with independent inside layouts have level tops and can support an L layer',()=>{
 const a=unit('a','2F'),b=unit('b','2F'),l={...unit('l'),config:moduleConfig('drawer','L',3,'1F')};a.config.drawers=['1F','1F'];b.config.drawers=['2F'];const plan={tiers:[{pattern:'SS',ids:['a','b']},{pattern:'single',ids:['l']}]};assert.equal(validateTiers(plan.tiers,[a,b,l]),'');assert.equal(compositionProblem(plan,[a,b,l]),'');const s=buildComposition(plan,[a,b,l]);assert.equal(s.layers[0][0].top,s.layers[0][1].top);
});
test('column insert, selected-unit edit and remove are transactional and isolate other records',()=>{
 const units=[unit('a'),unit('b','2F')],plan={tiers:[{pattern:'SS',ids:['a','b']}]},copy=structuredClone(units),c=unit('c');const added=changePlan(plan,units,{type:'insert-column',index:0,column:0,at:1,unit:c});assert.equal(added.error,undefined);assert.deepEqual(added.plan.tiers[0].columns,[['a','c'],['b']]);assert.deepEqual(units,copy);
 const edited=changePlan(added.plan,added.units,{type:'edit-unit',index:0,id:'b',patch:{drawers:['1F','1F']}});assert.equal(edited.error,undefined);assert.deepEqual(edited.units[0],units[0]);assert.deepEqual(edited.units[1].progress,units[1].progress);
 const removed=changePlan(edited.plan,edited.units,{type:'remove-unit',index:0,id:'c'});assert.equal(removed.error,undefined);assert.deepEqual(removed.plan.tiers[0].columns,[['a'],['b']]);assert.ok(removed.units.some(u=>u.id==='c'));assert.ok(changePlan(plan,units,{type:'remove-unit',index:0,id:'a'}).error);
});
test('malformed or repeated column membership is rejected without touching the original',()=>{
 const units=[unit('a'),unit('b')];for(const columns of [[],[['a'],['a']],[['a','b']],['a','b'],[[],['a','b']]])assert.ok(validateTiers([{pattern:'SS',ids:['a','b'],columns}],units));
});
