import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import frames from './assembly-data.json' with {type:'json'};

const worker=new Worker(new URL('./mesh-worker.js',import.meta.url),{type:'module'});
const pending=new Map(),cache=new Map(),pins=new Map(),viewers=new Set();let sequence=0,epoch=0,tail=Promise.resolve();
function pin(ids,change){for(const id of ids)pins.set(id,Math.max(0,(pins.get(id)||0)+change));}
function trimCache(){for(const [id,promise]of cache){if(cache.size<=36)break;if(pins.get(id))continue;cache.delete(id);promise.then(v=>v.geometries.forEach(g=>g.dispose())).catch(()=>{});}}
worker.onmessage=({data})=>{const p=pending.get(data.key);if(!p)return;pending.delete(data.key);data.error?p.reject(Error(data.error)):p.resolve(data);};
worker.onerror=()=>{for(const p of pending.values())p.reject(Error('模型解析失败'));pending.clear();};
export function clearGeometry(){epoch++;for(const v of viewers)v.clear();for(const r of cache.values())r.then(v=>v.geometries.forEach(g=>g.dispose())).catch(()=>{});cache.clear();}
export function geometryFor(id,file){
  if(!file)return Promise.reject(Error('请先导入此零件'));
  if(cache.has(id)){const p=cache.get(id);if(p.sourceFile===file){cache.delete(id);cache.set(id,p);return p;}cache.delete(id);p.then(v=>v.geometries.forEach(g=>g.dispose())).catch(()=>{});}
  const currentEpoch=epoch;
  const promise=tail.then(async()=>{
    if(epoch!==currentEpoch)throw Error('模型目录已切换');
    const buffer=await file.arrayBuffer(); const key=++sequence;
    const data=await new Promise((resolve,reject)=>{pending.set(key,{resolve,reject});worker.postMessage({key,buffer,frames:frames[id]||[]},[buffer]);});
    if(epoch!==currentEpoch)throw Error('模型目录已切换');
    const geometries=data.parts.map(p=>{const g=new THREE.BufferGeometry();g.setAttribute('position',new THREE.BufferAttribute(p,3));g.computeVertexNormals();g.computeBoundingBox();g.computeBoundingSphere();return g;});
    return {...data,parts:undefined,geometries};
  });
  promise.sourceFile=file;tail=promise.catch(()=>{});cache.set(id,promise);promise.catch(()=>{if(cache.get(id)===promise)cache.delete(id);});
  return promise;
}
const reduced=matchMedia('(prefers-reduced-motion: reduce)');
function matrixFor(p){
  const {matrix:r,center:c,min}=p.cal;
  const t=p.position.map((v,i)=>v-min[i]-r[i].reduce((a,x,j)=>a+x*c[j],0));
  let m=new THREE.Matrix4().set(r[0][0],r[0][1],r[0][2],t[0],r[1][0],r[1][1],r[1][2],t[1],r[2][0],r[2][1],r[2][2],t[2],0,0,0,1);
  if(p.hinge){const v=p.hinge.pivot;const h=new THREE.Matrix4().makeTranslation(...v).multiply(new THREE.Matrix4().makeRotationX(p.hinge.angle)).multiply(new THREE.Matrix4().makeTranslation(...v.map(n=>-n)));m.premultiply(h);}
  m.premultiply(new THREE.Matrix4().makeTranslation(...(p.move||[0,0,0])));return m;
}
export class Viewer {
  constructor(canvas,{onSelect=()=>{},onStatus=()=>{}}={}){
    this.canvas=canvas;this.onSelect=onSelect;this.onStatus=onStatus;this.meshes=[];this.ticket=0;this.selected=null;this.mode='assembled';this.pinned=[];
    this.renderer=new THREE.WebGLRenderer({canvas,antialias:true,alpha:true,preserveDrawingBuffer:true});
    viewers.add(this);
    this.renderer.setPixelRatio(Math.min(devicePixelRatio,1.75));this.renderer.outputColorSpace=THREE.SRGBColorSpace;this.renderer.toneMapping=THREE.ACESFilmicToneMapping;this.renderer.toneMappingExposure=.85;
    this.scene=new THREE.Scene();this.group=new THREE.Group();this.scene.add(this.group);
    this.scene.add(new THREE.HemisphereLight(0xffedd9,0x424951,1.8));
    for(const [color,intensity,pos] of [[0xffffff,3,[150,-100,350]],[0xff823d,1.3,[-250,200,150]],[0xb5dbff,2,[0,300,250]]]){const l=new THREE.DirectionalLight(color,intensity);l.position.set(...pos);this.scene.add(l);}
    this.camera=new THREE.PerspectiveCamera(35,1,.1,100000);this.camera.up.set(0,0,1);this.camera.position.set(400,500,350);
    this.controls=new OrbitControls(this.camera,canvas);this.controls.enableDamping=true;this.controls.dampingFactor=.09;this.controls.minDistance=5;this.controls.maxDistance=10000;
    this.ray=new THREE.Raycaster();this.pointer=new THREE.Vector2();
    canvas.addEventListener('pointerdown',e=>this.down=[e.clientX,e.clientY]);
    canvas.addEventListener('pointerup',e=>{if(!this.down||Math.hypot(e.clientX-this.down[0],e.clientY-this.down[1])>5)return;const b=canvas.getBoundingClientRect();this.pointer.set((e.clientX-b.left)/b.width*2-1,-(e.clientY-b.top)/b.height*2+1);this.ray.setFromCamera(this.pointer,this.camera);const hit=this.ray.intersectObjects(this.meshes).find(x=>x.object.visible);if(hit){this.select(hit.object.userData.key);this.onSelect(hit.object.userData);}});
    canvas.addEventListener('dblclick',()=>this.fit());
    this.resize=new ResizeObserver(()=>{const b=canvas.getBoundingClientRect();if(!b.width||!b.height)return;this.renderer.setSize(b.width,b.height,false);this.camera.aspect=b.width/b.height;this.camera.updateProjectionMatrix();});this.resize.observe(canvas);
    this.renderer.setAnimationLoop(()=>{if(!canvas.getClientRects().length)return;this.controls.update();for(const m of this.meshes){if(!m.userData.target)continue;const alpha=reduced.matches?1:.16;m.position.lerp(m.userData.target.position,alpha);m.quaternion.slerp(m.userData.target.quaternion,alpha);}this.updateOutline();this.renderer.render(this.scene,this.camera);});
  }
  async setScene(scene,matches,{mode=this.mode,fit=true,colors={}}={}){
    const ticket=++this.ticket;this.mode=mode;this.descriptors=scene.parts||[];
    this.canvas.setAttribute('aria-busy','true');this.canvas.dataset.modelCount='0';
    this.onStatus('正在读取本地模型…');
    const ids=[...new Set(this.descriptors.map(p=>p.id))];pin(this.pinned,-1);this.pinned=ids;pin(ids,1);const loaded=new Map(),warnings=[];
    for(const id of ids){if(ticket!==this.ticket)return;try{if(matches.has(id))loaded.set(id,await geometryFor(id,matches.get(id).file));}catch(e){warnings.push(id+'：'+e.message);}}
    if(ticket!==this.ticket)return;
    this.group.clear();for(const m of this.meshes)m.material.dispose();for(const m of this.rods||[]){m.geometry.dispose();m.material.dispose();}this.rods=[];this.meshes=[];
    const unresolved=new Set();
    for(const p of this.descriptors){
      const data=loaded.get(p.id);if(!data)continue;
      if(!data.resolved&&p.component>0)continue;
      let g=data.geometries[p.component||0]||data.geometries[0];
      const m=new THREE.Mesh(g,new THREE.MeshStandardMaterial({color:new THREE.Color(...(p.color||[.65,.66,.66])),roughness:.43,metalness:.16,side:THREE.DoubleSide}));
      const key=p.key||`${p.id}:${p.copy||0}:${p.component||0}`;
      m.userData={...p,key,unresolved:!data.resolved||!!matches.get(p.id)?.manual,baseColor:colors[key]||colors[`${p.id}:${p.copy||0}:${p.component||0}`]||null};
      if(m.userData.baseColor)m.material.color.set(m.userData.baseColor);
      if(m.userData.unresolved)unresolved.add(p.id);
      this.group.add(m);this.meshes.push(m);
    }
    for(const rod of scene.referenceRods||[]){const start=new THREE.Vector3(...rod.start),end=new THREE.Vector3(...rod.end),direction=end.clone().sub(start);if(!direction.length())continue;const m=new THREE.Mesh(new THREE.CylinderGeometry(rod.radius,rod.radius,direction.length(),16),new THREE.MeshStandardMaterial({color:0x6f7b81,metalness:.6,roughness:.45,transparent:true,opacity:.55}));m.position.copy(start).add(end).multiplyScalar(.5);m.quaternion.setFromUnitVectors(new THREE.Vector3(0,1,0),direction.normalize());this.group.add(m);this.rods.push(m);}
    this.layout(mode,true);this.select(this.selected);if(fit)this.fit();trimCache();
    this.canvas.dataset.modelCount=String(this.meshes.length);this.canvas.setAttribute('aria-busy','false');
    const missing=ids.length-loaded.size,simplified=[...loaded.values()].some(x=>x.simplified);
    this.onStatus(`${this.meshes.length} 个模型实例 · 原尺寸${simplified?' · 密集网格已简化预览':''}${missing?` · 缺 ${missing} 类文件`:''}${unresolved.size?' · '+unresolved.size+' 类位置待核对':''}${warnings.length?' · '+warnings[0]:''}`);
  }
  layout(mode=this.mode,immediate=false){
    for(const rod of this.rods||[])rod.visible=mode!=='flat';
    this.mode=mode;let x=mode==='flat'?0:500,y=0,rowDepth=0;const area=Math.max(220,Math.sqrt(this.meshes.reduce((s,m)=>{const a=m.userData.cal.size;return s+(a[0]+30)*(a[1]+30)},0))*1.35)+(mode==='flat'?0:500);
    for(const m of this.meshes){const p=m.userData;let matrix;
      if(mode==='flat'||p.unresolved){
        const box=m.geometry.boundingBox,s=box.getSize(new THREE.Vector3());if(x+s.x>area&&x){x=mode==='flat'?0:500;y+=rowDepth+35;rowDepth=0;}
        matrix=new THREE.Matrix4().makeTranslation(x-box.min.x,y-box.min.y,-box.min.z);x+=s.x+30;rowDepth=Math.max(rowDepth,s.y);
      }else matrix=matrixFor(p);
      const position=new THREE.Vector3(),quaternion=new THREE.Quaternion(),scale=new THREE.Vector3();matrix.decompose(position,quaternion,scale);m.userData.target={position,quaternion};
      // Rigid transforms only. Never rescale imported meshes.
      if(immediate){m.position.copy(position);m.quaternion.copy(quaternion);}m.updateMatrixWorld();
    }
  }
  update(scene,mode=this.mode){
    const byKey=new Map((scene.parts||[]).map(p=>[p.key||`${p.id}:${p.copy||0}:${p.component||0}`,p]));
    for(const m of this.meshes){const p=byKey.get(m.userData.key);if(p)Object.assign(m.userData,p);}this.layout(mode);
  }
  fit(){if(!this.meshes.length)return;for(const m of this.meshes){m.position.copy(m.userData.target.position);m.quaternion.copy(m.userData.target.quaternion);}this.group.updateMatrixWorld(true);const box=new THREE.Box3().setFromObject(this.group),center=box.getCenter(new THREE.Vector3()),s=box.getSize(new THREE.Vector3());const radius=Math.max(s.x,s.y,s.z,20)*1.6;this.controls.target.copy(center);this.camera.position.copy(center).add(new THREE.Vector3(radius,-radius,radius*.85));this.camera.near=Math.max(.1,radius/1000);this.camera.far=radius*20;this.camera.updateProjectionMatrix();this.controls.update();}
  updateOutline(){if(!this.outline||!this.outlineMesh)return;const m=this.outlineMesh,c=m.userData.cal,r=c.matrix;m.updateMatrixWorld();this.outline.box.makeEmpty();for(let i=0;i<8;i++){const q=[0,1,2].map(a=>i&(1<<a)?c.max[a]:c.min[a]);const p=new THREE.Vector3(...[0,1,2].map(a=>c.center[a]+r.reduce((s,row,j)=>s+row[a]*q[j],0)));this.outline.box.expandByPoint(p.applyMatrix4(m.matrixWorld));}}
  select(key){this.selected=key;if(this.outline){this.scene.remove(this.outline);this.outline.geometry.dispose();this.outline.material.dispose();this.outline=null;}this.outlineMesh=null;for(const m of this.meshes){const selected=m.userData.key===key;m.material.emissive.set(selected?0xff6b20:0x000000);m.material.emissiveIntensity=selected?.65:0;if(selected){this.outlineMesh=m;this.outline=new THREE.Box3Helper(new THREE.Box3(),0xff702e);this.scene.add(this.outline);this.updateOutline();}}this.canvas.style.cursor=key?'pointer':'grab';}
  color(key,color){const m=this.meshes.find(m=>m.userData.key===key);if(m){m.material.color.set(color);m.userData.baseColor=color;}}
  capture(){this.renderer.render(this.scene,this.camera);return this.canvas.toDataURL('image/webp',.75);}
  clear(){this.ticket++;this.select(null);pin(this.pinned,-1);this.pinned=[];for(const m of this.meshes)m.material.dispose();for(const m of this.rods||[]){m.geometry.dispose();m.material.dispose();}this.meshes=[];this.rods=[];this.group.clear();this.canvas.dataset.modelCount='0';this.canvas.setAttribute('aria-busy','false');}
  dispose(){this.clear();viewers.delete(this);this.resize.disconnect();this.renderer.setAnimationLoop(null);this.controls.dispose();this.renderer.dispose();trimCache();}
}

let thumbnailViewer,thumbTail=Promise.resolve(),thumbGeneration=0;const thumbnails=new Map();
export function clearThumbnails(){thumbGeneration++;thumbnails.clear();}
export function thumbnail(id,file){
  if(thumbnails.has(id)&&thumbnails.get(id).sourceFile===file)return thumbnails.get(id);
  const generation=thumbGeneration;
  const p=thumbTail.then(async()=>{
    if(generation!==thumbGeneration)throw Error('缩略图任务已取消');
    if(!thumbnailViewer){const canvas=document.createElement('canvas');canvas.width=300;canvas.height=200;thumbnailViewer=new Viewer(canvas);thumbnailViewer.resize.disconnect();thumbnailViewer.renderer.setSize(300,200,false);thumbnailViewer.camera.aspect=1.5;thumbnailViewer.camera.updateProjectionMatrix();}
    const data=await geometryFor(id,file);if(generation!==thumbGeneration)throw Error('缩略图任务已取消');const box=new THREE.Box3();data.geometries.forEach(g=>box.union(g.boundingBox));const min=box.min.toArray(),max=box.max.toArray();const parts=data.geometries.map((g,component)=>({id,component,copy:0,key:`${id}:${component}`,cal:{matrix:[[1,0,0],[0,1,0],[0,0,1]],center:[0,0,0],min,max,size:max.map((v,i)=>v-min[i])},position:[0,0,0],color:[.76,.78,.79]}));
    await thumbnailViewer.setScene({parts},new Map([[id,{file}]]),{mode:'assembled'});if(generation!==thumbGeneration)throw Error('缩略图任务已取消');return thumbnailViewer.capture();
  });p.sourceFile=file;thumbTail=p.catch(()=>{});thumbnails.set(id,p);return p;
}
