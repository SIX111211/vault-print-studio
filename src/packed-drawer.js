import datums from './drawer-slot-data.json' with {type:'json'};
import {frameRoles,drawerHeight} from './drawer-layout.js';

// Only rigid translation of source-calibrated parts. Slot axes are measured
// source features, distinct from the outside stacking planes of a whole frame.
export function packedDrawerScene(config,bom,options,build,framesForId){
 const {origin=[0,0,0]}=options,base={...config};delete base.drawers;
 const localOptions={...options,origin:[0,0,0]},host=build(base,localOptions);
 if(config.drawers.length===1&&config.drawers[0]===config.h){
  const scene=build(base,options);scene.bom=bom;scene.hardware=bom.hardware;return scene;
 }
 const datum=datums[`${config.w}${config.d}-${config.h}`];
 if(!datum)throw Error('此外框尚无可靠的内部槽位基准');
 const parts=[],copies=new Map(),warnings=new Set(host.fitWarnings||[]);
 const append=(source,copy,delta,slot=null)=>{
  const p={...source,copy,position:source.position.map((v,j)=>v+delta[j]+origin[j]),move:source.move.slice()};
  p.key=`${config.id||'current'}:${p.id}:${p.copy}:${p.component}`;
  p.instance=config.id||'current';p.rowIndex=bom.rows.findIndex(r=>r.id===p.id);
  if(slot!==null)p.drawerSlot=slot;
  const saved=config.colors?.[p.key]||config.colors?.[`${p.id}:${p.copy}:${p.component}`];
  if(/^#[0-9a-f]{6}$/i.test(saved||''))p.color=[1,3,5].map(i=>parseInt(saved.slice(i,i+2),16)/255);
  parts.push(p);
 };
 for(const p of host.parts)if(frameRoles.has(p.role))append(p,p.copy,[0,0,0]);
 for(const p of parts)copies.set(p.id,Math.max(copies.get(p.id)||0,p.copy+1));
 let start=0;
 for(const [index,h]of config.drawers.entries()){
  const child=build({...base,h,roof:'none',handle:false},localOptions),donor=datums[`${config.w}${config.d}-${h}`];
  if(!donor||datum.slotAxes[start]===undefined)throw Error('此抽屉缺少匹配的内部安装槽位');
  const axis=datum.slotAxes[start],translation=[datum.midX-donor.midX,datum.frontContactY-donor.frontContactY,axis-donor.axisZ],offsets=new Map(copies);
  for(const p of child.parts){
   if(frameRoles.has(p.role))continue;
   const runner=['runner-guide','runner-slide','runner-stopper'].includes(p.role),reference=runner?host.parts.find(q=>q.id===p.id&&q.copy===p.copy&&q.component===p.component):p;
   if(!reference)throw Error('外框缺少配套导轨或止挡的源定位');
   const copy=(offsets.get(p.id)||0)+p.copy;
   append(reference,copy,runner?[0,0,axis-datum.axisZ]:translation,index);
  }
  for(const row of child.bom.rows)if(!frameRoles.has(row.role))copies.set(row.id,(offsets.get(row.id)||0)+row.qty);
  for(const warning of child.fitWarnings||[])warnings.add(warning);
  start+=drawerHeight(h);
 }
 const audit=bom.rows.map(row=>{
  const ps=parts.filter(p=>p.id===row.id),perFile=framesForId(row.id).length;
  return {id:row.id,copies:row.qty,componentsPerFile:perFile,expected:row.qty*perFile,represented:ps.length,inferred:ps.filter(p=>p.evidence==='inferred').length,unplaced:ps.filter(p=>p.evidence==='unplaced').length,verified:0};
 });
 if(!config.rails&&config.drawers.length>1)warnings.add('多盒共用一个 2F/4F 框时，原手册建议每个抽屉配齐齿条；当前已关闭，请核对。');
 warnings.add('框内抽屉按实测 48 mm 槽阵列定位，保持原尺寸；五金及实体配合请按原手册和源孔位核对。');
 return {...host,parts,bom,hardware:bom.hardware,audit,fitWarnings:[...warnings],warnings:[...new Set([...bom.warnings,...warnings])],unplaced:bom.rows.filter(r=>parts.some(p=>p.id===r.id&&p.evidence==='unplaced')),unknowns:[...warnings],quantityComplete:bom.complete&&audit.every(a=>a.expected===a.represented),physicalFitVerified:false,fitDrawer:{...host.fitDrawer,packed:true,drawerCount:config.drawers.length,slotPitch:48},errors:bom.errors,needsInput:bom.needsInput};
}
