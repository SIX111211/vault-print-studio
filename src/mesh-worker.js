import { STLLoader } from 'three/addons/loaders/STLLoader.js';
import { readBinaryPreview } from './binary-mesh.js';
import { partitionMesh } from './partition-mesh.js';

// Original coordinates are retained. This worker never rewrites a download.
self.onmessage = ({data:{key,buffer,frames=[]}}) => {
  try {
    const binary=readBinaryPreview(buffer,frames.length>1?{threshold:Infinity}:{});
    const raw=binary?.raw||new STLLoader().parse(buffer).getAttribute('position').array;
    if (!raw.length || raw.length%9 || !raw.every(Number.isFinite)) throw new Error('STL 顶点数据无效');
    const min=[Infinity,Infinity,Infinity],max=[-Infinity,-Infinity,-Infinity];
    for(let i=0;i<raw.length;i++) {const a=i%3;min[a]=Math.min(min[a],raw[i]);max[a]=Math.max(max[a],raw[i]);}
    const {parts,resolved}=frames.length>1?partitionMesh(raw,frames):{parts:[raw],resolved:true};
    self.postMessage({key,parts,bbox:binary?.bbox||[min,max],resolved,triangles:raw.length/9,simplified:!!binary?.simplified,originalTriangles:binary?.originalTriangles||raw.length/9},parts.map(p=>p.buffer));
  } catch(error) {self.postMessage({key,error:error.message});}
};
