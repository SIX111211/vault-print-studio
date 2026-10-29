import test from 'node:test';
import assert from 'node:assert/strict';
import {createSourceKey,assembledThumbnailKey,ThumbnailQueue} from '../src/navigation.js';

test('thumbnail identity distinguishes same-ID files, variants, colors, configuration and import generations',()=>{
  const source=createSourceKey(),a=new Blob(['a']),b=new Blob(['b']),v1={previewAligned:true},v2={previewAligned:false};
  assert.equal(source('m1',a,v1),source('m1',a,v1));assert.notEqual(source('m1',a,v1),source('m1',b,v1));assert.notEqual(source('m1',a,v1),source('m1',a,v2));
  const u={id:'u',config:{w:'S'},colors:{}},key=assembledThumbnailKey(u,1,[source('m1',a,v1)]);
  for(const candidate of [assembledThumbnailKey({...u,config:{w:'M'}},1,[source('m1',a,v1)]),assembledThumbnailKey({...u,colors:{part:'#ff6600'}},1,[source('m1',a,v1)]),assembledThumbnailKey(u,2,[source('m1',a,v1)]),assembledThumbnailKey(u,1,[source('m1',b,v1)]),assembledThumbnailKey(u,1,[])])assert.notEqual(key,candidate);
});
test('thumbnail work serializes, caches repeats, caps entries and retries failures',async()=>{
  const queue=new ThumbnailQueue(2);let active=0,peak=0,calls=0;
  const render=async()=>{calls++;peak=Math.max(peak,++active);await Promise.resolve();active--;return 'image';};
  const a=queue.get('a',render),same=queue.get('a',render),b=queue.get('b',render);assert.equal(a,same);await Promise.all([a,b]);assert.equal(peak,1);assert.equal(calls,2);
  await queue.get('c',render);assert.equal(queue.cache.size,2);assert.ok(!queue.cache.has('a'));
  await assert.rejects(queue.get('bad',()=>{throw Error('decode');}),/decode/);assert.equal(queue.cache.has('bad'),false);assert.equal(await queue.get('bad',render),'image');
});
test('import invalidation prevents stale active images and queued old work; disconnected cards skip GPU work',async()=>{
  const queue=new ThumbnailQueue();let release,started=0;
  const first=queue.get('active',async()=>{started++;await new Promise(resolve=>release=resolve);return 'old';});
  await Promise.resolve();const second=queue.get('queued',()=>{started++;return 'old';});
  queue.clear();release();await assert.rejects(first,/取消/);await assert.rejects(second,/取消/);assert.equal(started,1);
  await assert.rejects(queue.get('offscreen',()=>{started++;},()=>false),/取消/);assert.equal(started,1);
  assert.equal(await queue.get('new',()=> 'new'),'new');
});
test('rerendered current card may reuse pending image work without inheriting the old DOM lifetime',async()=>{
  const queue=new ThumbnailQueue();let release;
  const first=queue.get('card',async()=>{await new Promise(resolve=>release=resolve);return 'same image';},()=>false);
  const second=queue.get('card',()=>{throw Error('must reuse');},()=>true);
  await Promise.resolve();release();assert.equal(first,second);assert.equal(await second,'same image');
});
