import front from './sustainer-front-data.json' with {type:'json'};
import bodyData from './sustainer-body-data.json' with {type:'json'};

const I=[[1,0,0],[0,1,0],[0,0,1]],TURN=[[-1,0,0],[0,-1,0],[0,0,1]];
const mv=(r,p)=>r.map(row=>row.reduce((s,v,j)=>s+v*p[j],0));
const mm=(a,b)=>a.map(row=>[0,1,2].map(j=>row.reduce((s,v,k)=>s+v*b[k][j],0)));

// Apply rigid transforms to measured source frames; never rescale the STL.
export function placeSustainerPart(p,cal,translation,origin=[0,0,0],rotation=I){
 const corners=[];for(let i=0;i<8;i++)corners.push(mv(rotation,cal.size.map((v,j)=>i&(1<<j)?v:0)));
 const lo=[0,1,2].map(j=>Math.min(...corners.map(q=>q[j]))),hi=[0,1,2].map(j=>Math.max(...corners.map(q=>q[j])));
 const rotatedMin=mv(rotation,cal.min);
 p.cal={...cal,matrix:mm(rotation,cal.matrix),min:rotatedMin.map((v,j)=>v+lo[j]),max:rotatedMin.map((v,j)=>v+hi[j]),size:hi.map((v,j)=>v-lo[j])};
 p.position=translation.map((v,j)=>v+lo[j]+origin[j]);
 p.evidence='inferred';p.fitSustainer={status:'mounting-features-aligned',physicalFitVerified:false};
}

export function fitSustainerFront(scene,c,{origin=[0,0,0],open=0,explode=0}={}){
 const facade=scene.parts.find(p=>p.kind==='facade'),shell=scene.parts.find(p=>p.kind==='shell');
 const f=front.facades[facade?.id];if(!shell||!f)return scene;
 const [W,D]=shell.cal.size;
 const sideZ=Math.min(...f.mountHoles.filter(h=>h[0]<15||h[0]>f.cal.size[0]-15).map(h=>h[1]));
 const facadeZ=scene.sustainerDatums?scene.sustainerDatums.frontSideMountMinZ-sideZ:4.8;
 const facadeX=(W-f.cal.size[0])/2;
 placeSustainerPart(facade,f.cal,[facadeX,D,facadeZ],origin);
 facade.reason='前面板按箱体前端面及固定孔定位。';
 const xs=[...new Set(f.lockHoles.map(p=>Math.round(p[0]*100)/100))].sort((a,b)=>a-b);
 const topZ=Math.max(...f.lockHoles.map(p=>p[1]));
 const centers=[];for(let i=0;i<xs.length;i+=2)centers.push(facadeX+(xs[i]+xs[i+1])/2);
 const unlock=Math.min(1,Math.max(0,open)/.2),angle=unlock*Math.PI/2;
 const add=(p,vector,step)=>{
  p.step=step;p.explodeVector=vector;
  const t=Math.max(0,Math.min(1,step-scene.progress)),enter=t*t*(3-2*t);
  p.move=vector.map(v=>v*(explode+enter));delete p.lidGroup;delete p.hinge;
 };
 for(const p of scene.parts){
  const cal=front.locks[p.id]||(p.id==='m0574'?front.pins[p.component]:null);if(!cal)continue;
  const x=centers[p.copy];
  if(x===undefined){p.position=[W+80+origin[0],p.rowIndex*75+origin[1],origin[2]];p.move=[0,0,0];delete p.hinge;p.evidence='unplaced';p.reason='额外锁扣没有对应面板孔位，保留在待装区。';continue;}
  const small=[x,D+10.2001,facadeZ+topZ-1.8003],big=[x,small[1],small[2]-15.0015];
  const pivot=small.map((v,j)=>v+origin[j]);
  if(p.id==='m0575'){
   placeSustainerPart(p,cal,[x-cal.size[0]/2,D-5.60095,facadeZ+topZ-15.5599],origin);
   add(p,[0,90,10],0);p.reason='锁扣座四孔与面板孔位对齐，UP 朝上，固定板位于面板内侧。';
  }else if(p.id==='m0576'){
   placeSustainerPart(p,cal,[x-cal.size[0]/2,small[1]-4.2996,small[2]-19.3015],origin);
   add(p,[0,135,15],1);p.hinge={pivot,angle};p.reason='锁扣内件以两根短销连接锁扣座，绕共同轴线松扣。';
  }else if(p.id==='m0577'||p.id==='m0578'){
   placeSustainerPart(p,cal,[x-cal.size[0]/2,big[1]-5.2949,big[2]-10.2963],origin);
   add(p,[0,185,20],2);p.hinge={pivot:big.map((v,j)=>v+origin[j]),angle:-angle};
   p.move[1]+=15.0015*Math.sin(angle);p.move[2]+=15.0015*(1-Math.cos(angle));
   p.reason='锁扣外件通过两根长销与内件连接；开盖前向外松开。';
  }else{
   const large=p.component<2,right=p.component%2===1,axis=large?big:small;
   const headY=large?4.315:3.7866,headZ=large?2.48:2.45,half=large?24.9969:19.8;
   placeSustainerPart(p,cal,[x+(right?half-.1:-half+.1),axis[1]+(right?headY:-headY),axis[2]-headZ],origin,right?TURN:I);
   add(p,[right?70:-70,large?185:130,15],large?2:1);
   if(large)p.hinge={pivot,angle};
   p.reason='每套四根销：两短两长，分别从左右装入；保留打印态形状。';
  }
 }
 scene.frontLocks={centers,sets:centers.length,pinsPerSet:4,facadeZ,physicalFitVerified:false};
 return scene;
}

export function fitSustainer(scene,c,options={}){
 const {origin=[0,0,0],open=0,explode=0}=options;
 const body=scene.parts.find(p=>p.kind==='shell'),plan=bodyData.plans[body?.id+':'+c.roof];
 if(!plan)return fitSustainerFront(scene,c,options);
 const measured=bodyData.frames[body.id];scene.size=measured.cal.size.slice();scene.pitch=scene.size[2];
 scene.sustainerDatums={frontSideMountMinZ:measured.frontSideMountMinZ,pivot:plan.hinge.pivot,status:plan.status};
 for(const p of scene.parts){
  const pose=plan.parts.find(q=>q.id===p.id&&q.component===p.component);if(!pose)continue;
  const record=bodyData.frames[p.id],rec=Array.isArray(record)?record[p.component]:record;
  placeSustainerPart(p,rec.cal,pose.position,origin);delete p.hinge;delete p.lidGroup;
  const enter=Math.max(0,Math.min(1,p.step-scene.progress)),ease=enter*enter*(3-2*enter);
  p.move=p.explodeVector.map(v=>v*(explode+ease));
  if(pose.lidGroup){
   p.lidGroup=true;p.hinge={pivot:plan.hinge.pivot.map((v,j)=>v+origin[j]),angle:Math.max(0,(open-.2)/.8)*Math.PI*.55};
   p.move[2]+=Math.max(0,Math.min(1,7-scene.progress))*70;
  }
  p.fitSustainer={...p.fitSustainer,mountMaxResidual:pose.mountMaxResidual??null};
  p.reason=pose.role==='body'?'箱体保持源模型尺寸。':pose.role==='roof'?'顶盖与上铰链按安装孔固定，共用后部转轴。':pose.role==='hinge-rods'?'两根铰链销轴按轴孔定位，保留原始打印形状。':'铰链叶片按箱体和顶盖的安装孔定位。';
 }
 scene.fitWarnings=[];
 if(plan.status==='source-interface-mismatch'){
  const residual=Math.max(...plan.parts.map(p=>p.mountMaxResidual||0));
  scene.fitWarnings.push(c.w==='M'?`当前 M 系列源模型的铰链孔位偏差约 ${residual.toFixed(2)} mm，轴节端部也有约 0.13 mm 重叠。预览保持原尺寸，请先核对实物配合。`:`当前 XL4 源模型的后铰链孔距不一致，刚性定位仍有约 ${residual.toFixed(2)} mm 偏差。预览保持原尺寸，此规格装配需核对。`);
 }
 scene.unknowns=[...(scene.unknowns||[]),...scene.fitWarnings];
 scene.precision='按源模型安装孔、接触面与转轴定位；保持原尺寸。';
 return fitSustainerFront(scene,c,options);
}
