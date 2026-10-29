import books from './manual-library.json' with {type:'json'};

export {books};
// The release contains these ten documents only. Never use a user-supplied URL.
export async function bundledManual(bookId,language,{signal,baseURL=document.baseURI,fetchFile=fetch}={}){
  const book=books.find(b=>b.id===bookId),record=book?.files[language];
  if(!record)throw Error('手册不存在');
  const url=new URL(record.path,baseURL);
  const response=await fetchFile(url,{signal,credentials:'same-origin',cache:'default'});
  if(!response.ok)throw Error(`手册读取失败（${response.status}），可重试或选择本地 PDF`);
  const bytes=await response.arrayBuffer();
  if(signal?.aborted)throw new DOMException('已切换手册','AbortError');
  if(bytes.byteLength!==record.size||new TextDecoder().decode(bytes.slice(0,5))!=='%PDF-')throw Error('手册文件不完整，请刷新重试');
  const hash=[...new Uint8Array(await crypto.subtle.digest('SHA-256',bytes))].map(n=>n.toString(16).padStart(2,'0')).join('');
  if(hash!==record.sha256)throw Error('手册校验未通过，请刷新重试');
  if(signal?.aborted)throw new DOMException('已切换手册','AbortError');
  return new File([bytes],`${book.englishTitle}-${language}.pdf`,{type:'application/pdf'});
}
