import test from 'node:test';
import assert from 'node:assert/strict';
import {buildComposition,matingPlanes} from '../src/composition.js';
import {buildScene} from '../src/assembly.js';
import {layerConfigs} from '../src/planner.js';

const close=(a,b,t=.02)=>assert.ok(Math.abs(a-b)<t,`${a} != ${b}`);
const unit=(id,config)=>({id,name:id,config,progress:{m0009:{printed:1,downloadedAt:'2026-10-01'}},colors:{'m0009:0:0':'#123456'}});

test('mixed stacks use the closed lid mating plane and preserve independent module records',()=>{
 for(const w of ['S','M','L','XL'])for(const d of [3,4,5,6,7])for(const h of w==='XL'?['1F']:['1F','2F','4F']){
  for(const bottomKind of ['drawer','sustainer']){
   const other=bottomKind==='drawer'?'sustainer':'drawer';
   const units=[unit('bottom',{kind:bottomKind,w,d,h,...(bottomKind==='drawer'?{roof:'none'}:{})}),unit('top',{kind:other,w,d,h,...(other==='drawer'?{roof:'none'}:{})})],before=structuredClone(units);
   const scene=buildComposition({tiers:[{ids:['bottom']},{ids:['top']}]},units),[lower,upper]=scene.layers.map(l=>l[0]);
   close(upper.bottom-lower.top,5.2,.000001);assert.deepEqual(units,before);
   for(const u of units){const original=buildScene({...u.config,id:u.id,colors:u.colors});
    const parts=scene.parts.filter(p=>p.instance===u.id);assert.equal(parts.length,original.parts.length);
    assert.deepEqual(parts.map(p=>p.key),original.parts.map(p=>p.key));
    for(let i=0;i<parts.length;i++)assert.deepEqual(parts[i].cal,original.parts[i].cal);
   }
  }
 }
});

test('same S3 drawer stack retains its measured 52.2 mm seated pitch',()=>{
 const units=['a','b','c'].map(id=>unit(id,{kind:'drawer',w:'S',d:3,h:'1F'}));
 const scene=buildComposition({tiers:units.map(u=>({ids:[u.id]}))},units);
 close(scene.layers[1][0].origin[2]-scene.layers[0][0].origin[2],52.2);
 close(scene.layers[2][0].origin[2]-scene.layers[1][0].origin[2],52.2);
});

test('SS and SM rows align bottom mating faces and place the next row above both modules',()=>{
 for(const [pattern,w]of [['SS','L'],['SM','XL']]){
  const configs=layerConfigs({kind:'sustainer',pattern,d:3,h:'1F'}),units=configs.map((c,i)=>unit('lower'+i,c));
  units.push(unit('upper',{kind:'drawer',w,d:3,h:'1F'}));
  const scene=buildComposition({tiers:[{ids:['lower0','lower1']},{ids:['upper']}]},units);
  const [a,b]=scene.layers[0];close(a.bottom,b.bottom);close(scene.layers[1][0].bottom,Math.max(a.top,b.top)+5.2);
  close(b.origin[0],matingPlanes(buildScene(configs[0])).width);
 }
});
