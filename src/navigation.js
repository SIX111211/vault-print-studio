// Object identity distinguishes re-imported files and alignment variants with the same model ID.
export function createSourceKey(){
  const identities=new WeakMap();let sequence=0;
  const identity=value=>{if(!value||typeof value!=='object')return String(value??'');if(!identities.has(value))identities.set(value,++sequence);return identities.get(value);};
  return (id,file,variant)=>JSON.stringify([id,identity(file),identity(variant)]);
}
export function assembledThumbnailKey(unit,generation,sources){
  return JSON.stringify([generation,unit.id,unit.config,unit.colors,sources]);
}
// Serial jobs, bounded settled images, stale generation cancellation, and retry after failure.
export class ThumbnailQueue {
  constructor(limit=48){this.limit=limit;this.generation=0;this.cache=new Map();this.tail=Promise.resolve();}
  clear(){this.generation++;this.cache.clear();}
  get(key,render,isCurrent=()=>true){
    if(this.cache.has(key)){const p=this.cache.get(key);p.owner.isCurrent=isCurrent;this.cache.delete(key);this.cache.set(key,p);return p;}
    const generation=this.generation;
    const owner={isCurrent},valid=()=>generation===this.generation&&owner.isCurrent();
    const p=this.tail.then(async()=>{if(!valid())throw Error('缩略图任务已取消');const result=await render(valid);if(!valid())throw Error('缩略图任务已取消');return result;});
    p.owner=owner;this.tail=p.catch(()=>{});this.cache.set(key,p);
    while(this.cache.size>this.limit)this.cache.delete(this.cache.keys().next().value);
    p.catch(()=>{if(this.cache.get(key)===p)this.cache.delete(key);});return p;
  }
}
