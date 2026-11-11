import test from 'node:test';
import assert from 'node:assert/strict';
import {applyFolderManual,folderManual} from '../src/folder-memory.js';

test('manual assignments rebind fresh File objects and keep confirmed per-module quantities',()=>{
 const file=()=>({webkitRelativePath:'fixture/part.stl',size:25,lastModified:11});
 const old=file(), fresh=file(),id='m0001',q={unit:{qty:2,configKey:'chosen'}},ev=new Map([[old.webkitRelativePath,{contentSignature:'content-A'}]]);
 const saved=folderManual(new Map([[id,{file:old,manual:true,quantityByUnit:q}]]),ev);
 const report={matches:new Map(),conflicts:[{file:fresh}],unmatched:[],invalid:[]};
 applyFolderManual(saved,[fresh],report,new Set([id]),ev);assert.equal(report.matches.get(id).file,fresh);assert.deepEqual(report.matches.get(id).quantityByUnit,q);assert.equal(report.conflicts.length,0);
 for(const [files,cache] of [[[],ev],[[{...fresh,lastModified:12}],ev],[[fresh],new Map([[fresh.webkitRelativePath,{contentSignature:'content-B'}]])]]){
  const r={matches:new Map(),conflicts:[{file:fresh}],unmatched:[],invalid:[]};applyFolderManual(saved,files,r,new Set([id]),cache);assert.equal(r.matches.size,0);assert.equal(r.conflicts.length,1);
 }
});
