import * as THREE from 'three';

export function frameCorners(cal){
 const inverse=new THREE.Matrix3().set(...cal.matrix.flat()).transpose(),center=new THREE.Vector3(...cal.center);
 return Array.from({length:8},(_,i)=>new THREE.Vector3(...cal.min.map((v,j)=>i&(1<<j)?(cal.max?.[j]??v+cal.size[j]):v)).applyMatrix3(inverse).add(center));
}

export function interpolateRigid(from,to,anchor,amount,position,quaternion){
 quaternion.slerpQuaternions(from.quaternion,to.quaternion,amount);
 const a=anchor.clone().applyQuaternion(from.quaternion).add(from.position);
 const b=anchor.clone().applyQuaternion(to.quaternion).add(to.position);
 position.lerpVectors(a,b,amount).sub(anchor.clone().applyQuaternion(quaternion));
}
