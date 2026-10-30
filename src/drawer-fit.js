import data from './drawer-fit-data.json' with {type:'json'};

// Positions are paired with their own native frames. Never reuse an old PCA
// minimum with a measured pose, or rebuild the identity of a source component.
export function fitDrawer(scene,c,{origin=[0,0,0],open=0,explode=0}={}){
 const plan=data.plans[`${c.w}${c.d}-${c.h}`];if(!plan)return scene;
 const lookup=new Map(plan.parts.map(p=>[`${p.id}:${p.copy}:${p.component}`,p]));
 const bodyPose=plan.parts.find(q=>q.id===scene.parts.find(p=>p.role==='body')?.id),depth=bodyPose?data.frames[bodyPose.frame].size[1]:scene.size[1];
 for(const p of scene.parts){
  const pose=lookup.get(`${p.id}:${p.copy}:${p.component}`);if(!pose)continue;
  p.cal=data.frames[pose.frame];p.position=pose.position.map((x,j)=>x+origin[j]);p.operates=pose.operates;
  delete p.hinge;delete p.lidGroup;
  const role=p.role,side=p.copy?1:-1;
  const vectors={body:[-80,-35,10],box:[0,55,45],facade:[0,140,0],'runner-guide':[side*100,0,0],'runner-slide':[side*55,55,45],'runner-stopper':[side*95,0,0],latch:[0,-55,-95],'back-panel':[0,-100,0],key:[0,190,0],'key-cap':[0,235,0],'geared-rails':[p.component?100:-100,55,45],springs:[p.component?-55:55,105,35],label:[100,160,0],'facade-cap':[-100,160,0]};
  p.explodeVector=vectors[role]||p.explodeVector;
  const enter=Math.max(0,Math.min(1,p.step-scene.progress)),ease=enter*enter*(3-2*enter);
  p.move=p.explodeVector.map(v=>v*(explode+ease));
  if(p.operates)p.move[1]+=open*depth*.72;
  if(p.frontGroup)p.move[1]+=Math.max(0,Math.min(1,7-scene.progress))*70;
  if((p.operates||role==='runner-guide')&&p.step<10)p.move[1]+=Math.max(0,Math.min(1,10-scene.progress))*depth*.85;
  p.evidence='inferred';p.fitDrawer={status:'source-features-aligned',physicalFitVerified:false};
  p.reason=role==='runner-guide'?'导向件固定在外壳侧槽，抽拉时保持不动。':role==='runner-slide'?'滑动件按抽屉盒侧槽定位，随抽屉运动。':'按原模型安装孔、接触面或配套接口定位，保持原尺寸。';
 }
 const body=scene.parts.find(p=>p.role==='body');if(body)scene.size=body.cal.size.slice();
 scene.fitDrawer={applied:true,physicalFitVerified:false,axisZ:plan.axisZ};
 scene.fitWarnings=[...(scene.fitWarnings||[]),...(plan.warnings||[])];
 if(scene.parts.some(p=>p.role==='roof'&&p.fitDrawer))scene.fitWarnings.push('标准顶盖按源槽位、前缘及 S3 参考接合面定位；卡止、打印支撑与实物配合仍需核对。');
 scene.unknowns=[...(scene.unknowns||[]),...(plan.warnings||[])];
 scene.precision='按源模型孔位、侧槽与接触面定位；保持原尺寸。';
 return scene;
}
