const DATABASE='vault-print-studio-model-recovery',STORE='workspace',KEY='current';
function openDatabase(){return new Promise((resolve,reject)=>{
  if(!globalThis.indexedDB){reject(Error('浏览器不支持模型本地保存，当前工作台将保持打开'));return;}
  const request=indexedDB.open(DATABASE,1);
  request.onupgradeneeded=()=>{request.result.createObjectStore(STORE);};
  request.onsuccess=()=>resolve(request.result);request.onerror=()=>reject(request.error);
});}
export function validCheckpoint(data){
  return !!data&&data.schema===1&&typeof data.id==='string'&&data.id.length<100&&Array.isArray(data.files)&&data.files.length<=2000&&data.files.every(file=>file instanceof Blob&&typeof file.name==='string')&&Array.isArray(data.manual)&&data.manual.length<=1000&&data.state?.version===1;
}
export async function saveCheckpoint(data){
  if(!validCheckpoint(data))throw Error('本地恢复数据不完整，已取消更新');
  const db=await openDatabase();
  try{await new Promise((resolve,reject)=>{
    const transaction=db.transaction(STORE,'readwrite');
    transaction.objectStore(STORE).put(data,data.id);
    transaction.oncomplete=()=>resolve();transaction.onerror=()=>reject(transaction.error);transaction.onabort=()=>reject(transaction.error||Error('模型保存被中断'));
  });}catch(error){throw Error(error?.name==='QuotaExceededError'?'浏览器存储空间不足，当前模型和打印记录保持不变；请继续使用当前版本':'保存模型失败，当前工作台保持打开：'+(error?.message||error));}finally{db.close();}
}
export async function readCheckpoint(id=KEY){
  const db=await openDatabase();try{return await new Promise((resolve,reject)=>{
    const request=db.transaction(STORE,'readonly').objectStore(STORE).get(id);
    request.onsuccess=()=>resolve(validCheckpoint(request.result)?request.result:null);request.onerror=()=>reject(request.error);
  });}finally{db.close();}
}
export async function clearCheckpoint(){
  const db=await openDatabase();try{await new Promise((resolve,reject)=>{const transaction=db.transaction(STORE,'readwrite');transaction.objectStore(STORE).clear();transaction.oncomplete=()=>resolve();transaction.onabort=()=>reject(transaction.error);transaction.onerror=()=>reject(transaction.error);});}finally{db.close();}
}
async function pruneCheckpoints(id){const db=await openDatabase();try{await new Promise((resolve,reject)=>{const transaction=db.transaction(STORE,'readwrite'),store=transaction.objectStore(STORE),cursor=store.openKeyCursor();cursor.onsuccess=()=>{const c=cursor.result;if(c){if(c.key!==id)store.delete(c.key);c.continue();}};transaction.oncomplete=resolve;transaction.onabort=()=>reject(transaction.error);transaction.onerror=()=>reject(transaction.error);});}finally{db.close();}}
const POINTER='vault-print-studio-model-checkpoint';
export function workspaceRecovery({getState,getFiles,getMatches,isImporting,restore,notify,persist=saveCheckpoint,read=readCheckpoint}){
  let epoch=0;
  function invalidate({remove=false}={}){epoch++;try{localStorage.removeItem(POINTER);}catch{}if(remove)clearCheckpoint().catch(()=>{});}
  async function prepare(onProgress=()=>{}){
    if(isImporting())throw Error('模型仍在导入，请等待导入完成后更新');
    const token=epoch,files=[...new Set(getFiles())],indices=new Map(files.map((f,i)=>[f,i])),id=crypto.randomUUID();
    // Keep the last committed recovery until the new one has been saved successfully.
    try{await pruneCheckpoints(localStorage.getItem(POINTER));}catch{}
    if([...getMatches().values()].some(m=>!indices.has(m.file)))throw Error('模型恢复清单与当前模型不一致，已取消更新；请重新选择当前模型目录');
    const manualNow=()=>[...getMatches()].filter(([,m])=>m.manual&&indices.has(m.file)).map(([part,m])=>({id:part,index:indices.get(m.file),quantityByUnit:structuredClone(m.quantityByUnit||{})}));
    const manual=manualNow(),manualSignature=JSON.stringify(manual);
    onProgress(`正在保存 ${files.length} 个本地模型（${Math.ceil(files.reduce((n,f)=>n+f.size,0)/1048576)} MB）与打印记录…`);
    await persist({schema:1,id,createdAt:new Date().toISOString(),files,manual,state:structuredClone(getState())});
    if(token!==epoch||isImporting())throw Error('保存期间模型目录发生变化，请完成导入后重新更新');
    if(JSON.stringify(manualNow())!==manualSignature)throw Error('保存期间人工匹配或打印份数发生变化，请重新点击更新以保存最新配置');
    // Capture the latest progress, including marks made while the large blobs were saving.
    const serialized=JSON.stringify(getState());
    try{localStorage.setItem('vault-print-studio-v1',serialized);if(localStorage.getItem('vault-print-studio-v1')!==serialized)throw Error();localStorage.setItem(POINTER,id);if(localStorage.getItem(POINTER)!==id)throw Error();}
    catch{throw Error('打印记录未能安全保存，已取消更新；当前页面保持打开');}
    onProgress('模型、组合和打印记录已在本机保存。');
  }
  async function resume(){
    let pointer;try{pointer=localStorage.getItem(POINTER);}catch{return;}if(!pointer)return;
    const token=epoch;
    try{const data=await read(pointer);if(token!==epoch||isImporting()||getMatches().size)return;
      if(!data||data.id!==pointer){notify('没有找到更新恢复数据，打印记录仍保留，请重新选择模型目录');return;}
      notify(`正在恢复 ${data.files.length} 个本地模型与打印记录…`);await restore(data);
    }catch(error){notify('模型自动恢复暂未完成，打印记录仍保留：'+error.message);}
  }
  return {prepare,resume,invalidate};
}
