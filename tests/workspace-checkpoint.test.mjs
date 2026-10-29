import test from 'node:test';
import assert from 'node:assert/strict';
import {workspaceRecovery} from '../src/workspace-checkpoint.js';

const pointer='vault-print-studio-model-checkpoint';
function harness(){
  const saved=new Map([[pointer,'previous'],['vault-print-studio-v1','previous-state']]);
  globalThis.localStorage={getItem:k=>saved.get(k)??null,setItem:(k,v)=>saved.set(k,v),removeItem:k=>saved.delete(k)};
  const file=new File(['model'],'original.stl'),matches=new Map([['part',{file,manual:true,quantityByUnit:{unit:2}}]]);
  let release,started;
  const startedPromise=new Promise(r=>started=r),pending=new Promise(r=>release=r);
  const state={version:1,units:[{id:'unit',progress:{part:{printed:1}}}]};
  const recovery=workspaceRecovery({getState:()=>state,getFiles:()=>[file],getMatches:()=>matches,isImporting:()=>false,restore(){},notify(){},persist:async()=>{started();await pending;}});
  return {recovery,saved,matches,state,release,startedPromise};
}
test('checkpoint rejects a mismatched file list without replacing previous recovery',async()=>{
  const h=harness();h.matches.get('part').file=new File(['other'],'other.stl');
  await assert.rejects(h.recovery.prepare(),/清单与当前模型不一致/);
  assert.equal(h.saved.get(pointer),'previous');assert.equal(h.saved.get('vault-print-studio-v1'),'previous-state');
});
test('manual quantities changed during save keep the old recovery and require retry',async()=>{
  const h=harness(),saving=h.recovery.prepare();await h.startedPromise;h.matches.get('part').quantityByUnit.unit=1;h.release();
  await assert.rejects(saving,/人工匹配或打印份数发生变化/);
  assert.equal(h.saved.get(pointer),'previous');assert.equal(h.saved.get('vault-print-studio-v1'),'previous-state');
});
test('model invalidation during save prevents publishing a stale checkpoint',async()=>{
  const h=harness(),saving=h.recovery.prepare();await h.startedPromise;h.recovery.invalidate();h.release();
  await assert.rejects(saving,/模型目录发生变化/);assert.equal(h.saved.has(pointer),false);
  assert.equal(h.saved.get('vault-print-studio-v1'),'previous-state');
});
test('progress edited during blob saving is saved in its latest form',async()=>{
  const h=harness(),saving=h.recovery.prepare();await h.startedPromise;h.state.units[0].progress.part.printed=2;h.release();await saving;
  assert.notEqual(h.saved.get(pointer),'previous');assert.equal(JSON.parse(h.saved.get('vault-print-studio-v1')).units[0].progress.part.printed,2);
});
