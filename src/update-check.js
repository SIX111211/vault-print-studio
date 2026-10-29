export const UPDATE_URL='https://six111211.github.io/vault-print-studio/version.json';
export const PROJECT_URL='https://github.com/SIX111211/vault-print-studio';
export function validateVersion(value){
  if(!value||!/^\d+\.\d+\.\d+$/.test(value.version)||!(/^[a-f0-9]{40}$/.test(value.commit))||!Number.isFinite(Date.parse(value.builtAt)))throw Error('更新信息格式异常');
  return {version:value.version,commit:value.commit,builtAt:value.builtAt,committedAt:Number.isFinite(Date.parse(value.committedAt))?value.committedAt:null,notes:Array.isArray(value.notes)?value.notes.filter(x=>typeof x==='string').slice(0,8).map(x=>x.slice(0,160)):[]};
}
export function newerVersion(local,remote){
  const a=String(local.version).split('.').map(Number),b=remote.version.split('.').map(Number);
  for(let i=0;i<3;i++){if(b[i]>a[i])return true;if(b[i]<a[i])return false;}
  return local.commit!==remote.commit&&Date.parse(remote.committedAt||remote.builtAt)>Date.parse(local.committedAt||local.builtAt);
}
export async function checkVersion(local,{fetchFile=fetch,timeout=8000}={}){
  const abort=new AbortController(),timer=setTimeout(()=>abort.abort(),timeout);
  try{
    const response=await fetchFile(UPDATE_URL+'?check='+Date.now(),{signal:abort.signal,cache:'no-store',credentials:'omit'});
    if(!response.ok)throw Error('暂时无法连接更新服务');
    const text=await response.text();if(text.length>10000)throw Error('更新信息过大');
    const latest=validateVersion(JSON.parse(text));return {latest,available:newerVersion(local,latest)};
  }finally{clearTimeout(timer);}
}
