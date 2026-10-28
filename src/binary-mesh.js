// Preview-only vertex clustering for exceptionally dense binary STL files.
// Each coordinate moves at most cell/2; downloads always use the original File.
export function readBinaryPreview(buffer,{threshold=1000000,cell=.12}={}){
  const view=new DataView(buffer);if(buffer.byteLength<84)return null;
  const count=view.getUint32(80,true);if(84+count*50!==buffer.byteLength)return null;
  if(!count)throw Error('STL 没有三角面');
  const simplified=count>threshold;
  let result=new Float32Array(Math.min(count*9,9000000)),used=0;
  const min=[Infinity,Infinity,Infinity],max=[-Infinity,-Infinity,-Infinity],tri=new Float64Array(9);
  for(let i=0;i<count;i++){
    const offset=84+i*50+12;
    for(let j=0;j<9;j++){const v=view.getFloat32(offset+j*4,true),a=j%3;if(!Number.isFinite(v))throw Error('STL 含无效顶点');min[a]=Math.min(min[a],v);max[a]=Math.max(max[a],v);tri[j]=simplified?Math.round(v/cell)*cell:v;}
    if(simplified){const ax=tri[3]-tri[0],ay=tri[4]-tri[1],az=tri[5]-tri[2],bx=tri[6]-tri[0],by=tri[7]-tri[1],bz=tri[8]-tri[2];if(Math.abs(ay*bz-az*by)+Math.abs(az*bx-ax*bz)+Math.abs(ax*by-ay*bx)<1e-10)continue;}
    if(used+9>result.length){const next=new Float32Array(Math.min(count*9,Math.ceil(result.length*1.5)));next.set(result);result=next;}
    result.set(tri,used);used+=9;
  }
  if(!used)throw Error('模型预览简化失败');
  return {raw:result.subarray(0,used),bbox:[min,max],originalTriangles:count,simplified,cell:simplified?cell:0};
}
