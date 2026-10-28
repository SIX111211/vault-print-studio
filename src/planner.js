import {buildBOM,defaults,configurationOptions} from './rules.js';
import {validateTiers} from './state.js';
import frameData from './assembly-data.json' with {type:'json'};

export const patterns=[['S',['S']],['M',['M']],['L',['L']],['XL',['XL']],['SS',['S','S']],['SM',['S','M']]];
export function moduleConfig(kind,w,d,h){
  const c={...defaults(kind),w,d:String(d),h};
  if(kind==='drawer')c.roof='none';
  if(kind==='sustainer'){c.interior=['S','M'].includes(w)?'standard':'flat';c.lockCount=w==='L'?2:undefined;}
  return c;
}
export function configProblem(config){
  const b=buildBOM(config);
  return [...b.errors,...b.missing][0]||(!b.rows.length?'目录中没有此配置':'');
}
export function layerConfigs({kind,pattern,d,h}){
  const ws=patterns.find(([id])=>id===pattern)?.[1];
  if(!ws||!['drawer','sustainer'].includes(kind))return [];
  const cs=ws.map(w=>moduleConfig(kind,w,d,h));
  return cs.some(configProblem)?[]:cs;
}
export function layerChoices(kind,pattern){
  return [3,4,5,6,7].flatMap(d=>['1F','2F','4F'].filter(h=>layerConfigs({kind,pattern,d,h}).length).map(h=>({d:String(d),h})));
}
// All operations return new containers; rejected changes never touch progress or the plan.
export function changePlan(plan,units,operation){
  const tiers=plan.tiers.map(t=>({...t,ids:[...t.ids]}));let nextUnits=units.slice();
  const i=operation.index;
  if(operation.type==='insert'){
    if(!Number.isInteger(i)||i<0||i>tiers.length)return {error:'插入位置无效'};
    nextUnits.push(...operation.units);tiers.splice(i,0,operation.tier);
  }else{
    if(!Number.isInteger(i)||!tiers[i])return {error:'请先选择一层'};
    if(operation.type==='remove')tiers.splice(i,1);
    else if(operation.type==='move'){
      if(!Number.isInteger(operation.to)||operation.to<0||operation.to>=tiers.length)return {error:'已到达组合边界'};
      const [tier]=tiers.splice(i,1);tiers.splice(operation.to,0,tier);
    }else if(operation.type==='edit'){
      nextUnits=nextUnits.map(u=>tiers[i].ids.includes(u.id)?{...u,config:{...u.config,...operation.patch}}:u);
    }else return {error:'未知层操作'};
  }
  if(tiers.length>30||nextUnits.length>200)return {error:'最多保存 30 层、200 个模块'};
  const error=validateTiers(tiers,nextUnits)||tiers.flatMap(t=>t.ids).map(id=>configProblem(nextUnits.find(u=>u.id===id).config)).find(Boolean);
  return error?{error}:{plan:{...plan,tiers},units:nextUnits};
}

function variantPieces(match){
  const v=match?.variant;
  return Number.isSafeInteger(v?.piecesPerFile)&&v.piecesPerFile>0&&Number.isSafeInteger(v.referencePiecesPerFile)&&v.referencePiecesPerFile>0?v:null;
}
const baselinePieces=id=>frameData[id]?.length||1;
export function piecesPerFile(id,match){
  if(match?.variant)return Number.isSafeInteger(match.variant.piecesPerFile)&&match.variant.piecesPerFile>0?match.variant.piecesPerFile:null;
  return match?.manual?null:baselinePieces(id);
}
export function unitBOM(unit,matches=new Map()){
  const bom=buildBOM(unit.config),configKey=JSON.stringify(unit.config);
  return {...bom,rows:bom.rows.map(row=>{
    const match=matches.get(row.id),variant=variantPieces(match),perFile=piecesPerFile(row.id,match),referencePiecesPerFile=variant?.referencePiecesPerFile||baselinePieces(row.id);
    row={...row,piecesPerFile:perFile,referencePiecesPerFile,physicalRequired:Number.isInteger(row.qty)?row.qty*referencePiecesPerFile:null};
    if(variant){
      const referenceQty=row.qty,physicalRequired=Number.isInteger(referenceQty)?referenceQty*variant.referencePiecesPerFile:null;
      row={...row,referenceQty,qty:physicalRequired===null?null:Math.ceil(physicalRequired/variant.piecesPerFile),reason:`此版本每份 STL 含 ${variant.piecesPerFile} 个实体，当前配置需要 ${physicalRequired??'待确认数量的'} 个实体。 ${row.reason}`};
    }
    if(match?.variant)row={...row,referenceQty:row.referenceQty??row.qty,reason:row.reason+' 版本说明：采样对齐仅用于预览，不代表机械配合已验证。'+(typeof match.variant.note==='string'?' '+match.variant.note:'')};
    if(!match?.manual)return row;
    const confirmation=match.quantityByUnit?.[unit.id];
    const qty=confirmation?.configKey===configKey?confirmation.qty:null;
    return {...row,qty,physicalRequired:Number.isInteger(qty)&&perFile?qty*perFile:null,reason:'不同版本：请先核对原文件内的实体和所需 STL 份数。 '+row.reason};
  })};
}
// Counts are never rewritten during import. Legacy records refer to baseline STL files.
export function effectiveProgress(unit,row,matches=new Map()){
  const record=unit.progress[row.id]||{},recorded=Number.isInteger(record.printed)?Math.max(0,record.printed):0;
  const sourcePieces=Object.hasOwn(record,'piecesPerFile')?record.piecesPerFile:baselinePieces(row.id);
  const currentPieces=Object.hasOwn(row,'piecesPerFile')?row.piecesPerFile:piecesPerFile(row.id,matches.get(row.id));
  const required=Number.isInteger(row.qty)&&row.qty>0?row.qty:0;
  const physicalDone=sourcePieces?recorded*sourcePieces:null;
  const physicalRequired=Object.hasOwn(row,'physicalRequired')?row.physicalRequired:currentPieces&&required?required*currentPieces:null;
  const convertible=currentPieces!==null&&physicalDone!==null,confirmedUnknown=currentPieces===null&&sourcePieces===null;
  const wholeFiles=convertible?Math.floor(physicalDone/currentPieces):confirmedUnknown?recorded:0;
  const printed=Math.min(required,wholeFiles),remainder=convertible?physicalDone%currentPieces:0;
  const done=required>0&&(convertible&&physicalRequired>0?physicalDone>=physicalRequired:confirmedUnknown&&printed>=required);
  const pending=!required||recorded>0&&!convertible&&!confirmedUnknown;
  const note=remainder?`已完成 ${physicalDone}/${physicalRequired??'?'} 个实体；折合当前版本 ${wholeFiles} 整份，另有 ${remainder} 个实体不足一整份（每份 ${currentPieces} 个实体）`:
    recorded>0&&!convertible&&!confirmedUnknown?`原打印记录 ${recorded} 份已保留；实体数待确认，暂不能换算当前版本进度`:'';
  return {printed,required,done,pending,remainder,physicalDone,physicalRequired,piecesPerFile:currentPieces,note};
}
export function printProgress(unit,rows){
  let printed=0,required=0,pending=false,done=rows.length>0;
  for(const row of rows){const progress=effectiveProgress(unit,row);required+=progress.required;printed+=progress.printed;pending ||= progress.pending;done &&= progress.done;}
  return {printed,required,pending,done:required>0&&!pending&&done};
}
export function printedState(scene,units,matches=new Map()){
  const lookup=new Map(units.map(u=>[u.id,{unit:u,rows:new Map(unitBOM(u,matches).rows.map(r=>[r.id,r]))}])),status={};
  for(const p of scene?.parts||[]){
    const info=lookup.get(p.instance),row=info?.rows.get(p.id),progress=row?effectiveProgress(info.unit,row):null;
    const required=progress?.required||0,printed=progress?.printed||0;
    const physicalIndex=p.copy*(row?.referencePiecesPerFile||baselinePieces(p.id))+(p.component||0);
    const done=required>0&&(progress.done||progress.piecesPerFile!==null&&progress.physicalDone!==null&&Number.isInteger(p.copy)&&physicalIndex<progress.physicalDone);
    status[p.key]={done,partial:required>0&&!progress.done&&(progress.physicalDone>0||printed>0),printed,required};
  }
  return status;
}

// Union actual BOM identities, including universal parts. Never infer compatibility from names.
export function libraryRows(config,includeOptional=false){
  const base=buildBOM(config),rows=new Map(base.rows.map(r=>[r.id,{...r,selected:true}]));
  if(!includeOptional||config.kind==='mods')return [...rows.values()];
  const add=(candidate,purpose)=>{
    const b=buildBOM(candidate);if(b.errors.length||b.missing.length)return;
    for(const row of b.rows)if(!rows.has(row.id))rows.set(row.id,{...row,required:false,selected:false,optionalPurpose:purpose,reason:purpose+' · '+row.reason});
  };
  if(config.kind==='drawer'){
    for(const input of configurationOptions.drawer.inputs){
      if(['w','d','h'].includes(input.key))continue;
      for(const value of input.type==='boolean'?[true]:input.choices||[])add({...config,[input.key]:value},input.purpose||input.label);
    }
  }else if(config.kind==='sustainer'){
    const variants=configurationOptions.sustainer.variants.filter(v=>v.w===config.w&&String(v.d)===String(config.d)&&v.h===config.h);
    for(const v of variants){
      const c={...config,interior:v.interior,dividers:{},dividerLayout:'none'};delete c.optionId;delete c.type;
      add(c,'选择'+v.title);
      for(const roof of ['whole','split'])for(const facade of ['family','universal']){
        const option={...c,roof,facade};add(option,'顶盖或面板替换方案');
        add({...option,label:'both'},'翻盖箱或抽屉标签');
        add({...option,baseplate:true},'Gridfinity 底板');
        for(const key of ['width','depth','seal','sealCenter','sealSides'])add({...option,dividerLayout:'custom',dividers:{[key]:1}},'内腔配套分隔板');
      }
    }
  }
  return [...rows.values()];
}

export async function validateManualPDF(file){
  if(!file||file.size>100*1024*1024||file.size<5)throw Error('请选择不超过 100 MB 的 PDF 文件');
  const bytes=new Uint8Array(await file.slice(0,5).arrayBuffer());
  if(String.fromCharCode(...bytes)!=='%PDF-')throw Error('文件内容不是有效的 PDF');
  return file;
}
