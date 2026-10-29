import test from 'node:test';
import assert from 'node:assert/strict';
import {freshState,sanitizeState,setPrinted} from '../src/state.js';
import {queueUnits,reconcileQueue,selectQueue,selectQueueUnit,nextIncomplete,deleteIndependent,deleteIndependents,deletionBatch,undoIndependentDelete} from '../src/queue.js';
import {moduleConfig,unitBOM,printProgress,changePlan} from '../src/planner.js';
import catalog from '../src/catalog.json' with {type:'json'};

const ids=new Set(catalog.map(p=>p.id));

test('noncontiguous batch deletion and reload undo restore order and records without rolling back other edits',()=>{
  const state=fixture();selectQueueUnit(state,'u9');
  for(const u of state.units){u.progress.m0010={printed:2,piecesPerFile:2,downloadedAt:'2026-10-29'};u.colors[u.id+':part']='#376680';}
  const before=structuredClone(state),selected=['u5','u9','u21'];
  assert.deepEqual(deleteIndependents(state,selected).map(u=>u.id),selected);assert.equal(state.activeUnit,'u10');assert.deepEqual(state.plans,before.plans);
  assert.deepEqual(state.units,before.units.filter(u=>!selected.includes(u.id)));
  state.units.find(u=>u.id==='u8').progress.m0010.printed=7;
  const restored=sanitizeState(JSON.parse(JSON.stringify(state)),ids);assert.equal(deletionBatch(restored).entries.length,3);undoIndependentDelete(restored);
  assert.deepEqual(restored.units.map(u=>u.id),before.units.map(u=>u.id));assert.equal(restored.activeUnit,'u9');assert.equal(restored.units.find(u=>u.id==='u8').progress.m0010.printed,7);
  for(const id of selected)assert.deepEqual(restored.units.find(u=>u.id===id),before.units.find(u=>u.id===id));assert.equal(deletionBatch(restored),null);
});
test('batch deletion rejects mixed plan or stale IDs atomically and keeps the previous undo',()=>{
  const state=fixture();selectQueueUnit(state,'u5');deleteIndependents(state,['u6','u7']);const before=structuredClone(state);
  for(const selection of [[],['u5','u0'],['u5','missing']]){assert.equal(deleteIndependents(state,selection),null);assert.deepEqual(state,before);}
  state.queuePlan='p1';const planState=structuredClone(state);assert.equal(deleteIndependents(state,['u5']),null);assert.deepEqual(state,planState);
});
test('batch undo never partially restores when capacity or duplicate IDs conflict',()=>{
  const state=fixture();selectQueueUnit(state,'u5');deleteIndependents(state,['u6','u7']);const removed=structuredClone(state.deletedBatch);
  const template=state.units[0];while(state.units.length<199)state.units.push({...structuredClone(template),id:'extra'+state.units.length});const before=structuredClone(state);
  assert.equal(undoIndependentDelete(state),null);assert.deepEqual(state,before);
  state.units=state.units.slice(0,20);state.units.push(structuredClone(removed.entries[0].unit));const collision=structuredClone(state);assert.equal(undoIndependentDelete(state),null);assert.deepEqual(state,collision);
});
test('select-all removes only independent modules and legacy single undo migrates',()=>{
  const state=fixture();selectQueueUnit(state,'u20');const original=structuredClone(state);
  deleteIndependents(state,queueUnits(state,null).map(u=>u.id));assert.deepEqual(state.units.map(u=>u.id),['u0','u1','u2','u3','u4']);assert.equal(state.activeUnit,null);
  const restored=sanitizeState(JSON.parse(JSON.stringify(state)),ids);undoIndependentDelete(restored);assert.deepEqual(restored.units,original.units);
  const legacy=freshState(moduleConfig('drawer','S',3,'1F')),u=structuredClone(legacy.units[0]);legacy.units=[];legacy.activeUnit=null;legacy.deletedUnit={unit:u,index:0};
  const migrated=sanitizeState(legacy,ids);assert.equal(migrated.deletedUnit,undefined);assert.equal(migrated.deletedBatch.entries.length,1);assert.deepEqual(undoIndependentDelete(migrated),u);
});

test('independent deletion selects a neighbour and undo survives reload with exact print records',()=>{
  const state=fixture();selectQueueUnit(state,'u20');state.units[20].progress.m0010={printed:1,piecesPerFile:2,downloadedAt:'2026-10-29'};state.units[20].colors.test='#ff6b24';
  const before=structuredClone(state.units),plans=structuredClone(state.plans);deleteIndependent(state,'u20');assert.equal(state.activeUnit,'u21');assert.deepEqual(state.units,before.filter(u=>u.id!=='u20'));assert.deepEqual(state.plans,plans);
  const restored=sanitizeState(JSON.parse(JSON.stringify(state)),ids);const u=undoIndependentDelete(restored);assert.deepEqual(u,before[20]);assert.deepEqual(restored.units,before);assert.equal(restored.activeUnit,'u20');assert.equal(restored.deletedUnit,undefined);
  selectQueue(restored,'p1');assert.equal(deleteIndependent(restored,'u0'),null);assert.deepEqual(restored.plans,plans);
});
test('last independent module can be deleted, remain empty on reload, and be restored',()=>{
  let state=freshState(moduleConfig('drawer','S',3,'1F'));const original=structuredClone(state.units[0]);deleteIndependent(state,original.id);
  assert.equal(state.units.length,0);assert.equal(state.activeUnit,null);assert.deepEqual(queueUnits(state),[]);
  state=sanitizeState(JSON.parse(JSON.stringify(state)),ids);assert.equal(state.units.length,0);assert.deepEqual(undoIndependentDelete(state),original);assert.equal(state.units.length,1);
});
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
