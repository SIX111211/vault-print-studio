import test from 'node:test';
import assert from 'node:assert/strict';
import {checkVersion,newerVersion,validateVersion,UPDATE_URL} from '../src/update-check.js';
const local={version:'0.2.0',commit:'a'.repeat(40),builtAt:'2026-10-29T01:00:00Z'};
test('update comparison never treats an older release or a rebuild of the same commit as an upgrade',()=>{
  assert.equal(newerVersion(local,{...local,builtAt:'2026-10-30T00:00:00Z'}),false);
  assert.equal(newerVersion(local,{...local,version:'0.1.0',commit:'b'.repeat(40),builtAt:'2026-10-30T00:00:00Z'}),false);
  assert.equal(newerVersion(local,{...local,commit:'b'.repeat(40),builtAt:'2026-10-30T00:00:00Z'}),true);
  assert.equal(newerVersion(local,{...local,version:'0.3.0'}),true);
  assert.equal(newerVersion({...local,builtAt:'2026-11-02T00:00:00Z',committedAt:'2026-10-28T00:00:00Z'},{...local,commit:'b'.repeat(40),committedAt:'2026-10-29T00:00:00Z'}),true);
  assert.throws(()=>validateVersion({...local,commit:'javascript:alert(1)'}));
});
test('update request only reads a fixed public endpoint without credentials or workspace data',async()=>{
  const result=await checkVersion(local,{fetchFile:async(url,options)=>{
    assert.ok(url.startsWith(UPDATE_URL+'?check='));assert.equal(options.credentials,'omit');assert.equal(options.body,undefined);
    return new Response(JSON.stringify({...local,version:'0.3.0',notes:['新功能']}));
  }});assert.equal(result.available,true);assert.deepEqual(result.latest.notes,['新功能']);
  await assert.rejects(checkVersion(local,{fetchFile:async()=>new Response('{}')}),/格式/);
  await assert.rejects(checkVersion(local,{fetchFile:async()=>new Response('',{status:503})}),/连接/);
});
