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
