import test from 'node:test';
import assert from 'node:assert/strict';
import {freshState,sanitizeState,setPrinted} from '../src/state.js';
import {queueUnits,reconcileQueue,selectQueue,selectQueueUnit,nextIncomplete} from '../src/queue.js';
import {moduleConfig,unitBOM,printProgress,changePlan} from '../src/planner.js';
import catalog from '../src/catalog.json' with {type:'json'};

const ids=new Set(catalog.map(p=>p.id));
const complete=u=>printProgress(u,unitBOM(u).rows).done;
function fixture(){
  const state=freshState(moduleConfig('drawer','S','3','1F'));
  state.units=Array.from({length:22},(_,i)=>({id:'u'+i,name:'模块 '+i,config:moduleConfig('drawer','S','3','1F'),progress:{},colors:{}}));
  state.plans=[{id:'p1',name:'第一组',tiers:[{pattern:'SS',ids:['u0','u1']},{pattern:'SS',ids:['u2','u3']}]},{id:'p2',name:'第二组',tiers:[{pattern:'single',ids:['u4']}]}];
  state.activeUnit='u0';state.activePlan='p2';state.queuePlan='p1';return state;
}
test('plan queues follow tier order and independent collection preserves all legacy accumulated units',()=>{
  const state=fixture(),before=structuredClone(state.units);
  assert.deepEqual(queueUnits(state).map(u=>u.id),['u0','u1','u2','u3']);
  assert.deepEqual(queueUnits(state,'p2').map(u=>u.id),['u4']);
  assert.deepEqual(queueUnits(state,null).map(u=>u.id),state.units.slice(5).map(u=>u.id));
  assert.deepEqual(state.units,before);
  delete state.queuePlan;const restored=sanitizeState(state,ids);
  assert.equal(restored.queuePlan,'p1');assert.equal(restored.activePlan,'p2');assert.equal(restored.units.length,22);
  state.activeUnit='u21';assert.equal(sanitizeState(state,ids).queuePlan,null);
});
test('explicit finish selection chooses first incomplete and next wraps only within this plan; undo never navigates',()=>{
  const state=fixture();for(const row of unitBOM(state.units[0]).rows)setPrinted(state.units[0],row.id,row.qty,row.piecesPerFile);
  assert.equal(complete(state.units[0]),true);selectQueue(state,'p1',complete);assert.equal(state.activeUnit,'u1');assert.equal(state.activePlan,'p2');
  state.activeUnit='u3';assert.equal(nextIncomplete(state,complete).id,'u1');
  setPrinted(state.units[0],unitBOM(state.units[0]).rows[0].id,0);assert.equal(state.activeUnit,'u3');assert.equal(nextIncomplete(state,complete).id,'u0');
  for(const u of queueUnits(state))for(const row of unitBOM(u).rows)setPrinted(u,row.id,row.qty,row.piecesPerFile);
  assert.equal(nextIncomplete(state,complete),null);selectQueue(state,'p1',complete);assert.equal(state.activeUnit,'u0');
});
test('deleting a layer or plan moves former members to independent without dropping progress or colors',()=>{
  const state=fixture(),u=state.units[0];u.progress.m0010={printed:3};u.colors['m0010:0:0']='#ff7a36';const prior=structuredClone(u);
  const changed=changePlan(state.plans[0],state.units,{type:'remove',index:0});assert.ok(!changed.error);state.plans[0]=changed.plan;state.units=changed.units;reconcileQueue(state);
  assert.equal(state.activeUnit,'u2');assert.deepEqual(queueUnits(state).map(u=>u.id),['u2','u3']);assert.deepEqual(queueUnits(state,null).find(x=>x.id==='u0'),prior);
  state.plans=state.plans.filter(p=>p.id!=='p1');reconcileQueue(state);assert.equal(state.queuePlan,null);assert.equal(state.activeUnit,'u2');assert.equal(state.units.length,22);
});
test('restoration retains separate config queue and combination editor selection, rejects stale selection, handles empty groups',()=>{
  const state=fixture();state.activeUnit='u3';let restored=sanitizeState(JSON.parse(JSON.stringify(state)),ids);
  assert.equal(restored.queuePlan,'p1');assert.equal(restored.activePlan,'p2');assert.equal(restored.activeUnit,'u3');
  state.queuePlan='deleted';restored=sanitizeState(state,ids);assert.equal(restored.queuePlan,'p1');assert.equal(restored.activeUnit,'u3');
  state.plans.push({id:'empty',name:'空方案',tiers:[]});selectQueue(state,'empty');assert.deepEqual(queueUnits(state),[]);assert.equal(nextIncomplete(state,complete),null);
  restored=sanitizeState(state,ids);assert.equal(restored.queuePlan,'empty');assert.deepEqual(queueUnits(restored),[]);
  assert.equal(selectQueueUnit(restored,'missing'),false);assert.equal(selectQueueUnit(restored,'u4'),true);assert.equal(restored.queuePlan,'p2');
});
