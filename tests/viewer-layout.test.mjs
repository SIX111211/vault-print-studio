import test from 'node:test';
import assert from 'node:assert/strict';
import {separateRectangles,easeInOut} from '../src/viewer-layout.js';
test('exploded layout separates coincident bodies and long paired rails without scaling',()=>{
  const rects=Array.from({length:25},(_,i)=>({key:String(i),x:i%2*10,y:0,width:i<3?150:160,height:i<3?100:8}));
  const offsets=separateRectangles(rects,12);
  for(let i=0;i<rects.length;i++)for(let j=i+1;j<rects.length;j++){
    const a=rects[i],b=rects[j],x=offsets.get(a.key),y=offsets.get(b.key);
    assert.ok(Math.abs(a.x+x.x-b.x-y.x)>=(a.width+b.width)/2+12-1e-8 || Math.abs(a.y+x.y-b.y-y.y)>=(a.height+b.height)/2+12-1e-8);
  }
  assert.deepEqual(separateRectangles(rects,12),offsets);
  assert.deepEqual(offsets.get('0'),{x:0,y:0});
});
test('nonoverlapping exploded positions stay still, interpolation is monotonic and continuous',()=>{
  assert.deepEqual([...separateRectangles([{key:'a',x:0,y:0,width:10,height:10},{key:'b',x:100,y:0,width:10,height:10}]).values()],[{x:0,y:0},{x:0,y:0}]);
  const points=Array.from({length:101},(_,i)=>easeInOut(i/100));
  assert.equal(points[0],0);assert.equal(points.at(-1),1);assert.ok(points.every((v,i)=>i===0||v>=points[i-1]));
  assert.ok(points[1]<.001&&points.at(-2)>.999);
});
