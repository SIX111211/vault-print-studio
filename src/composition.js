import {buildScene} from './assembly.js';
import datums from './stacking-data.json' with {type:'json'};
import {tierColumns} from './drawer-layout.js';

const transform=(p,v)=>p.cal.matrix.map((row,j)=>row.reduce((n,r,k)=>n+r*(v[k]-p.cal.center[k]),0)-p.cal.min[j]+p.position[j]);

// Broad mating faces, not the extremities of the interlocking feet and lugs.
// The source interlock seats leave 5.2 mm between these two faces.
export function matingPlanes(scene){
 const body=scene.parts.find(p=>p.role==='body'),bottom=datums[body?.id]?.bottom;
 const tops=scene.parts.filter(p=>datums[p.id]?.top&&(p.role==='body'||p.role==='roof'));
 if(!body||!bottom||!tops.length)throw new Error('此模块的堆叠接合面尚未确认。');
 // Some old source frames used the opposite vertical direction. Determine the
 // two outside faces after the final rigid calibration, not from their names.
 const bodyFaces=[bottom,...(datums[body.id].top?[datums[body.id].top]:[])].map(v=>transform(body,v)[2]);
 const upper=tops.map(p=>p===body?Math.max(...bodyFaces):transform(p,datums[p.id].top)[2]);
 return {bottom:Math.min(...bodyFaces),top:Math.max(...upper),width:body.cal.size[0],depth:body.cal.size[1]};
}

export function buildComposition(plan,units){
 const combined={parts:[],size:[0,0,0],layers:[],warnings:[]},lookup=new Map(units.map(u=>[u.id,u]));
 let base=0;
 for(const tier of plan.tiers){
  let x=0,top=base;const layer=[];
  const columnTops=[];
  for(const column of tierColumns(tier)){
   let z=base,width=0;
   for(const id of column){
   const unit=lookup.get(id);if(!unit)throw new Error('组合中的模块不存在。');
   const config={...unit.config,id:unit.id,colors:unit.colors},local=buildScene(config),faces=matingPlanes(local);
   const origin=[x,0,z-faces.bottom],scene=buildScene(config,{origin});
   combined.parts.push(...scene.parts);
   layer.push({id,origin,bottom:z,top:faces.top+origin[2]});
   width=faces.width;top=Math.max(top,faces.top+origin[2]);z=faces.top+origin[2]+5.2;
   combined.size[1]=Math.max(combined.size[1],faces.depth);
   combined.size[2]=Math.max(combined.size[2],origin[2]+scene.size[2],top);
   }
   x+=width;columnTops.push(z-5.2);
  }
  const difference=Math.max(...columnTops)-Math.min(...columnTops);
  if(difference>.5)combined.warnings.push(`左右列实际上沿相差 ${difference.toFixed(2)} mm；保持原模型尺寸，尚不能在其上跨列叠放。`);
  combined.layers.push(layer);combined.size[0]=Math.max(combined.size[0],x);base=top+5.2;
 }
 return combined;
}
export function compositionProblem(plan,units){
 if(!plan?.tiers?.length)return '';
 const lookup=new Map(units.map(u=>[u.id,u]));
 for(let i=0;i<plan.tiers.length-1;i++){
  const tops=tierColumns(plan.tiers[i]).map(col=>col.reduce((z,id)=>{const u=lookup.get(id),f=matingPlanes(buildScene(u.config));return z+f.top-f.bottom+5.2;},0));
  if(Math.max(...tops)-Math.min(...tops)>.5)return `第 ${i+1} 组左右上沿不齐，请先调齐列高或改用同高外框，不能跨列悬空叠放。`;
 }
 return '';
}
