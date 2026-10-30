import {buildScene} from './assembly.js';
import datums from './stacking-data.json' with {type:'json'};

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
 const combined={parts:[],size:[0,0,0],layers:[]},lookup=new Map(units.map(u=>[u.id,u]));
 let base=0;
 for(const tier of plan.tiers){
  let x=0,top=base;const layer=[];
  for(const id of tier.ids){
   const unit=lookup.get(id);if(!unit)throw new Error('组合中的模块不存在。');
   const config={...unit.config,id:unit.id,colors:unit.colors},local=buildScene(config),faces=matingPlanes(local);
   const origin=[x,0,base-faces.bottom],scene=buildScene(config,{origin});
   combined.parts.push(...scene.parts);
   layer.push({id,origin,bottom:base,top:faces.top+origin[2]});
   x+=faces.width;top=Math.max(top,faces.top+origin[2]);
   combined.size[1]=Math.max(combined.size[1],faces.depth);
   combined.size[2]=Math.max(combined.size[2],origin[2]+scene.size[2],top);
  }
  combined.layers.push(layer);combined.size[0]=Math.max(combined.size[0],x);base=top+5.2;
 }
 return combined;
}
