import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import {frameCorners,interpolateRigid} from '../src/rigid-preview.js';

test('preview rotation remains centered for STLs exported far from the origin',()=>{
 const anchor=new THREE.Vector3(7500,1900,35),from={position:anchor.clone().negate(),quaternion:new THREE.Quaternion()};
 const rotation=new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1,0,0),Math.PI/2);
 const end=new THREE.Vector3(20,30,40),to={position:end.clone().sub(anchor.clone().applyQuaternion(rotation)),quaternion:rotation};
 for(let i=0;i<=20;i++){
  const t=i/20,position=new THREE.Vector3(),quaternion=new THREE.Quaternion();
  interpolateRigid(from,to,anchor,t,position,quaternion);
  assert.ok(anchor.clone().applyQuaternion(quaternion).add(position).distanceTo(end.clone().multiplyScalar(t))<1e-8);
  assert.ok(Math.abs(quaternion.length()-1)<1e-10);
 }
});

test('selection and camera bounds use the calibrated frame rather than the rotated source AABB',()=>{
 const a=Math.PI/4,r=[[Math.cos(a),Math.sin(a),0],[-Math.sin(a),Math.cos(a),0],[0,0,1]];
 const cal={matrix:r,center:[5000,1000,20],min:[-80,-70,-5],max:[80,70,5]};
 const matrix=new THREE.Matrix3().set(...r.flat()),corners=frameCorners(cal);
 const box=new THREE.Box3().setFromPoints(corners.map(v=>v.sub(new THREE.Vector3(...cal.center)).applyMatrix3(matrix)));
 assert.ok(box.getSize(new THREE.Vector3()).distanceTo(new THREE.Vector3(160,140,10))<1e-8);
});
