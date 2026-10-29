// null is the independent collection; activePlan belongs to the combination editor.
export function planUnitIds(plan){return [...new Set(plan?.tiers.flatMap(t=>t.ids)||[])];}
export function queueUnits(state,planId=state.queuePlan){
  const ids=new Set(planId===null?state.plans.flatMap(planUnitIds):planUnitIds(state.plans.find(p=>p.id===planId)));
  if(planId===null)return state.units.filter(u=>!ids.has(u.id));
  const byId=new Map(state.units.map(u=>[u.id,u]));return [...ids].map(id=>byId.get(id)).filter(Boolean);
}
export function groupForUnit(state,id){
  return [state.plans.find(p=>p.id===state.queuePlan),state.plans.find(p=>p.id===state.activePlan),...state.plans].find(p=>planUnitIds(p).includes(id))?.id??null;
}
export function reconcileQueue(state){
  if(state.queuePlan!==null&&!state.plans.some(p=>p.id===state.queuePlan))state.queuePlan=groupForUnit(state,state.activeUnit);
  const units=queueUnits(state);
  if(units.length&&!units.some(u=>u.id===state.activeUnit))state.activeUnit=units[0].id;
  return units;
}
export function selectQueue(state,planId,isComplete=()=>false){
  if(planId!==null&&!state.plans.some(p=>p.id===planId))return false;
  state.queuePlan=planId;const units=queueUnits(state);
  const first=units.find(u=>!isComplete(u))||units[0];if(first)state.activeUnit=first.id;
  return true;
}
export function selectQueueUnit(state,id){
  if(!state.units.some(u=>u.id===id))return false;
  state.queuePlan=groupForUnit(state,id);state.activeUnit=id;return true;
}
export function nextIncomplete(state,isComplete){
  const units=queueUnits(state),index=units.findIndex(u=>u.id===state.activeUnit);
  return [...units.slice(index+1),...units.slice(0,Math.max(0,index))].find(u=>!isComplete(u))||null;
}

export function deleteIndependent(state,id){
  return deleteIndependents(state,[id])?.[0]??null;
}
export function deletionBatch(state){
  return state.deletedBatch||(state.deletedUnit?{entries:[state.deletedUnit],activeUnit:state.deletedUnit.unit.id}:null);
}
export function deleteIndependents(state,requested){
  const units=queueUnits(state,null),ids=new Set(requested),allowed=new Set(units.map(u=>u.id));
  // A stale or foreign selection must never partially delete a batch.
  if(state.queuePlan!==null||!ids.size||[...ids].some(id=>!allowed.has(id)))return null;
  const entries=state.units.flatMap((unit,index)=>ids.has(unit.id)?[{unit:structuredClone(unit),index}]:[]);
  const active=state.activeUnit,index=units.findIndex(u=>u.id===active);
  state.deletedBatch={entries,activeUnit:active};delete state.deletedUnit;
  state.units=state.units.filter(u=>!ids.has(u.id));
  if(ids.has(active))state.activeUnit=([...units.slice(index+1),...units.slice(0,index).reverse()].find(u=>!ids.has(u.id)))?.id??null;
  return entries.map(entry=>entry.unit);
}
export function undoIndependentDelete(state){
  const batch=deletionBatch(state);if(!batch||state.units.length+batch.entries.length>200)return null;
  const ids=new Set(batch.entries.map(e=>e.unit.id));if(ids.size!==batch.entries.length||state.units.some(u=>ids.has(u.id)))return null;
  const units=[...state.units];for(const entry of [...batch.entries].sort((a,b)=>a.index-b.index))units.splice(Math.min(units.length,entry.index),0,entry.unit);
  state.units=units;state.queuePlan=null;
  state.activeUnit=queueUnits(state,null).some(u=>u.id===batch.activeUnit)?batch.activeUnit:batch.entries[0].unit.id;
  delete state.deletedBatch;delete state.deletedUnit;return state.units.find(u=>u.id===state.activeUnit);
}
