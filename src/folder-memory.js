const DB='vault-print-studio-directory', KEY='vault-print-studio-folder-v1';
let pending=Promise.resolve(), epoch=0;
function serialized(fn){const job=pending.then(fn);pending=job.catch(()=>{});return job;}
async function access(mode,operation){
 const db=await new Promise((ok,no)=>{const r=indexedDB.open(DB,1);r.onupgradeneeded=()=>r.result.createObjectStore('library');r.onsuccess=()=>ok(r.result);r.onerror=()=>no(r.error);});
 try{return await new Promise((ok,no)=>{const tx=db.transaction('library',mode),r=operation(tx.objectStore('library'));tx.oncomplete=()=>ok(r.result);tx.onabort=tx.onerror=()=>no(tx.error||Error('目录索引未保存'));});}finally{db.close();}
}
export async function readFolder(){
 const id=localStorage.getItem(KEY);if(!id)return null;
 const record=await access('readonly',s=>s.get('current'));
 return record?.id===id&&record.handle?.kind==='directory'&&record.schema===1&&record.evidence instanceof Map?record:null;
}
export function saveFolder(record){
 const token=epoch;
 return serialized(async()=>{if(token!==epoch)return;await access('readwrite',s=>s.put(record,'current'));if(token===epoch)localStorage.setItem(KEY,record.id);});
}
export function forgetFolder(){
 epoch++;try{localStorage.removeItem(KEY);}catch{}
 return serialized(()=>access('readwrite',s=>s.delete('current'))).catch(()=>{});
}
export function folderManual(matches,evidence){
 return [...matches].filter(([,m])=>m.manual).map(([id,{file,quantityByUnit}])=>({id,path:file.webkitRelativePath,size:file.size,mtime:file.lastModified,signature:evidence.get(file.webkitRelativePath)?.contentSignature||null,quantityByUnit:structuredClone(quantityByUnit||{})}));
}
export function applyFolderManual(entries,files,report,ids,evidence){
 const byPath=new Map(files.map(f=>[f.webkitRelativePath,f]));
 for(const e of entries||[]){const file=byPath.get(e.path);
  if((e.signature&&e.signature!==evidence.get(e.path)?.contentSignature)||!ids.has(e.id)||!file||file.size!==e.size||file.lastModified!==e.mtime||!e.quantityByUnit||typeof e.quantityByUnit!=='object'||report.invalid.some(x=>x.file===file))continue;
  report.matches.set(e.id,{file,method:'人工确认',manual:true,quantityByUnit:e.quantityByUnit});
  report.conflicts=report.conflicts.filter(x=>x.file!==file);report.unmatched=report.unmatched.filter(x=>x.file!==file);
 }
}
