import {reconcileQueue} from './queue.js';
export const STORAGE_KEY='vault-print-studio-v1';
export const uid=()=>crypto.randomUUID();
export const clone=value=>structuredClone(value);
export function freshState(config){const unit={id:uid(),name:'我的第一个模块',config:clone(config),progress:{},colors:{}};return {version:1,activeUnit:unit.id,units:[unit],plans:[],activePlan:null,queuePlan:null,sound:false,printedGhost:true};}
export function setPrinted(unit,id,qty,piecesPerFile){if(!Number.isInteger(qty)||qty<0||qty>10000)throw Error('打印份数无效');if(piecesPerFile!==undefined&&piecesPerFile!==null&&(!Number.isSafeInteger(piecesPerFile)||piecesPerFile<1||piecesPerFile>10000))throw Error('每份文件的实体数无效');unit.progress[id]={...unit.progress[id],printed:qty,...(piecesPerFile!==undefined?{piecesPerFile}:{})};}
export function downloaded(unit,id){unit.progress[id]={...unit.progress[id],downloadedAt:new Date().toISOString()};}
export function sanitizeState(raw,ids){
  if(!raw||raw.version!==1||!Array.isArray(raw.units)||raw.units.length>200)throw Error('不支持的工作台文件');
  const cleanUnit=u=>{
    if(typeof u.id!=='string'||!/^[a-zA-Z0-9_-]{1,100}$/.test(u.id)||!u.config||!['drawer','sustainer','mods'].includes(u.config.kind))throw Error('模块配置无效');
    const progress={},colors={};for(const [id,p]of Object.entries(u.progress||{})){if(!ids.has(id))continue;if(!p||!Number.isInteger(p.printed??0)||p.printed<0||p.printed>10000)throw Error('打印记录数量无效');if(Object.hasOwn(p,'piecesPerFile')&&p.piecesPerFile!==null&&(!Number.isSafeInteger(p.piecesPerFile)||p.piecesPerFile<1||p.piecesPerFile>10000))throw Error('打印记录实体数无效');progress[id]={printed:p.printed||0,...(Object.hasOwn(p,'piecesPerFile')?{piecesPerFile:p.piecesPerFile}:{}),...(typeof p.downloadedAt==='string'?{downloadedAt:p.downloadedAt.slice(0,30)}:{})};}
    for(const [key,color]of Object.entries(u.colors||{})){if(key.length<200&&/^#[0-9a-f]{6}$/i.test(color))colors[key]=color;}
    const serialized=JSON.stringify(u.config);if(serialized.length>10000||/__proto__|constructor|prototype/.test(serialized))throw Error('配置字段无效');
    return {id:u.id,name:String(u.name||'模块').slice(0,100),config:JSON.parse(serialized),progress,colors};
  };
  const units=raw.units.map(cleanUnit);
  const unitIds=new Set(units.map(u=>u.id));if(unitIds.size!==units.length)throw Error('模块标识重复');
  const plans=(Array.isArray(raw.plans)?raw.plans:[]).slice(0,30).map(p=>{if(!p||typeof p.id!=='string'||!/^[a-zA-Z0-9_-]{1,100}$/.test(p.id))throw Error('组合标识无效');if(!Array.isArray(p.tiers)||p.tiers.length>30)throw Error('组合层配置无效');return {id:p.id,name:String(p.name||'组合').slice(0,100),tiers:p.tiers.map(t=>{if(!t||!['single','SS','SM'].includes(t.pattern)||!Array.isArray(t.ids)||t.ids.some(id=>!unitIds.has(id)))throw Error('组合层配置无效');return {pattern:t.pattern,ids:[...t.ids]};})};});
  if(new Set(plans.map(p=>p.id)).size!==plans.length)throw Error('组合标识重复');
  for(const plan of plans){const problem=validateTiers(plan.tiers,units);if(problem)throw Error(problem);}
  const state={version:1,units,activeUnit:unitIds.has(raw.activeUnit)?raw.activeUnit:raw.activeUnit===null?null:units[0]?.id??null,plans,activePlan:plans.some(p=>p.id===raw.activePlan)?raw.activePlan:plans[0]?.id||null,queuePlan:raw.queuePlan===null?null:plans.some(p=>p.id===raw.queuePlan)?raw.queuePlan:undefined,sound:raw.sound===true,printedGhost:raw.printedGhost!==false};
  const deletion=raw.deletedBatch||(raw.deletedUnit?{entries:[raw.deletedUnit],activeUnit:raw.deletedUnit.unit?.id}:null);
  if(deletion){
    if(!Array.isArray(deletion.entries)||!deletion.entries.length||deletion.entries.length>200)throw Error('删除记录无效');
    const entries=deletion.entries.map(e=>({unit:cleanUnit(e.unit),index:Number.isInteger(e.index)?Math.max(0,Math.min(200,e.index)):units.length}));
    const removedIds=new Set(entries.map(e=>e.unit.id));if(removedIds.size!==entries.length||entries.some(e=>unitIds.has(e.unit.id)))throw Error('删除记录模块标识重复');
    state.deletedBatch={entries,activeUnit:unitIds.has(deletion.activeUnit)||removedIds.has(deletion.activeUnit)?deletion.activeUnit:entries[0].unit.id};
  }
  reconcileQueue(state);return state;
}
export function validateTiers(tiers,units){
  if(!Array.isArray(tiers)||!Array.isArray(units))return '组合层配置无效';
  const byId=new Map(units.map(u=>[u.id,u])),used=new Set();let prev=null;
  for(let i=0;i<tiers.length;i++){
    const t=tiers[i];if(!t||!['single','SS','SM'].includes(t.pattern)||!Array.isArray(t.ids))return '组合层配置无效';
    const us=t.ids.map(id=>byId.get(id));if(us.length!==(t.pattern==='single'?1:2)||us.some(u=>!u?.config))return `第 ${i+1} 层尚未放满`;
    if(new Set(t.ids).size!==t.ids.length||us.some(u=>u.config.kind==='mods'||used.has(u.id)))return '改装件不能作为堆叠层，同一模块不能重复放置';us.forEach(u=>used.add(u.id));
    if(us.some(({config:c})=>!['drawer','sustainer'].includes(c.kind)||!['S','M','L','XL'].includes(c.w)||!['3','4','5','6','7'].includes(String(c.d))||!['1F','2F','4F'].includes(c.h)||(c.w==='XL'&&c.h!=='1F')))return '不支持此模块尺寸组合';
    const cs=us.map(u=>u.config),c=cs[0];if(cs.some(x=>x.kind!==c.kind||x.h!==c.h||String(x.d)!==String(c.d)))return '并排模块须保持相同类型、深度和层高';
    if(t.pattern==='SS'&&cs.some(x=>x.w!=='S')||t.pattern==='SM'&&(cs[0].w!=='S'||cs[1].w!=='M'))return '并排只支持 S＋S 或 S＋M';
    const w=t.pattern==='SS'?'L':t.pattern==='SM'?'XL':c.w;
    if(prev&&(w!==prev.w||String(c.d)!==String(prev.d)))return '上下层须同宽同深；支持 L＝S＋S、XL＝S＋M';
    if(prev?.cs.some(x=>x.kind==='drawer'&&x.roof!=='none'))return '下层抽屉需设为无顶盖才能继续堆叠';prev={w,d:c.d,cs};
  }return '';
}
