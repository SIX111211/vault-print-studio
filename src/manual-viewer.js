import {getDocument,GlobalWorkerOptions} from 'pdfjs-dist';
import pdfWorkerURL from 'pdfjs-dist/build/pdf.worker.min.mjs?url';
import {validateManualPDF} from './planner.js';

GlobalWorkerOptions.workerSrc=pdfWorkerURL;
const MAX_PIXELS=8_000_000;

// Bytes come from a selected local File or a hash-verified bundled manual.
// PDF.js assets use the bundled same-origin worker.
export class LocalManualViewer{
  constructor({container,iframe,onChange=()=>{}}){
    this.container=container;this.iframe=iframe;this.onChange=onChange;
    this.doc=null;this.loadingTask=null;this.renderTask=null;this.renderQueue=Promise.resolve();
    this.selection=0;this.revision=0;this.requestedPage=1;this.page=0;this.loading=false;this.rendering=false;this.error='';this.disposed=false;
    iframe.src='about:blank';iframe.hidden=true;iframe.style.display='none';
    container.style.overflow='auto';container.style.scrollbarGutter='stable';
    this.empty=container.querySelector('.manual-empty');
    this.canvas=document.createElement('canvas');this.canvas.className='manual-canvas';
    Object.assign(this.canvas.style,{width:'100%',height:'auto',display:'none',background:'#fff'});
    this.canvas.setAttribute('role','img');this.canvas.setAttribute('aria-label','本地 PDF 页面');container.appendChild(this.canvas);
    this.lastWidth=0;
    this.resizeObserver=new ResizeObserver(()=>{
      const width=container.clientWidth;if(width===this.lastWidth)return;this.lastWidth=width;
      clearTimeout(this.resizeTimer);this.resizeTimer=setTimeout(()=>{if(this.doc&&!this.disposed)this.refresh();},120);
    });this.resizeObserver.observe(container);
  }
  snapshot(){return {pages:this.doc?.numPages||0,page:this.page,requestedPage:this.requestedPage,loading:this.loading,rendering:this.rendering,error:this.error};}
  notify(){if(!this.disposed)this.onChange(this.snapshot());}
  cancelRender(){this.revision++;this.renderTask?.cancel();}
  async releaseDocument(){
    this.cancelRender();const doc=this.doc,task=this.loadingTask;
    this.doc=null;this.loadingTask=null;this.page=0;
    if(doc)await doc.destroy();else if(task)await task.destroy();
  }
  async reset(){
    this.selection++;this.loading=false;this.rendering=false;this.error='';
    await this.releaseDocument();this.canvas.style.display='none';this.canvas.setAttribute('aria-busy','false');
    if(this.empty){this.empty.hidden=false;this.empty.style.display='flex';}
    this.notify();
  }
  async load(file,requestedPage=this.requestedPage){
    const selection=++this.selection;
    try{
      await validateManualPDF(file);if(selection!==this.selection||this.disposed)return false;
      this.loading=true;this.error='';this.canvas.style.display='none';this.notify();
      await this.releaseDocument();if(selection!==this.selection||this.disposed)return false;
      const data=new Uint8Array(await file.arrayBuffer());if(selection!==this.selection||this.disposed)return false;
      // No document URL, remote CMap, font URL, or WASM asset is supplied.
      const task=getDocument({data,isEvalSupported:false,useWasm:false,useSystemFonts:true,useWorkerFetch:false});
      this.loadingTask=task;const doc=await task.promise;
      if(selection!==this.selection||this.disposed)return false;
      this.doc=doc;this.loading=false;this.error='';
      if(this.empty){this.empty.hidden=true;this.empty.style.display='none';}
      this.iframe.closest('.manual-document')?.classList.add('is-loaded');
      await this.setPage(requestedPage);return selection===this.selection&&!this.disposed;
    }catch(error){
      if(selection!==this.selection||this.disposed)return false;
      if(!this.doc){await this.releaseDocument().catch(()=>{});if(this.empty){this.empty.hidden=false;this.empty.style.display='flex';}}
      this.loading=false;this.error='PDF 加载失败：'+(error?.message||String(error));this.notify();
      return false;
    }
  }
  setPage(page){
    this.requestedPage=Number.isSafeInteger(page)&&page>0?page:1;
    return this.refresh();
  }
  refresh(){
    if(!this.doc||this.disposed){this.notify();return Promise.resolve();}
    this.cancelRender();const revision=this.revision,doc=this.doc;
    const pageNumber=Math.min(doc.numPages,Math.max(1,this.requestedPage));
    this.page=pageNumber;this.error='';this.rendering=true;this.notify();
    // A cancelled render must settle before another render uses the same canvas.
    this.renderQueue=this.renderQueue.catch(()=>{}).then(async()=>{
      if(revision!==this.revision||doc!==this.doc||this.disposed)return;
      try{
        const page=await doc.getPage(pageNumber);
        if(revision!==this.revision||doc!==this.doc||this.disposed)return;
        const width=this.container.clientWidth;
        if(width<=0){this.rendering=false;this.notify();return;} // Hidden tab; ResizeObserver renders when shown.
        const base=page.getViewport({scale:1}),scale=width/base.width;
        const viewport=page.getViewport({scale});
        const ratio=Math.min(2,Math.max(1,window.devicePixelRatio||1),Math.sqrt(MAX_PIXELS/(viewport.width*viewport.height)));
        const pixelWidth=Math.max(1,Math.floor(viewport.width*ratio));
        const pixelHeight=Math.max(1,Math.min(Math.floor(viewport.height*ratio),Math.floor(MAX_PIXELS/pixelWidth)));
        this.canvas.width=pixelWidth;this.canvas.height=pixelHeight;
        this.canvas.style.display='block';this.canvas.style.width='100%';this.canvas.style.height='auto';
        this.canvas.setAttribute('aria-label',`本地 PDF 第 ${pageNumber} 页，共 ${doc.numPages} 页`);
        this.canvas.dataset.page=String(pageNumber);this.canvas.dataset.pages=String(doc.numPages);
        this.canvas.setAttribute('aria-busy','true');
        const task=page.render({canvas:this.canvas,viewport,transform:[pixelWidth/viewport.width,0,0,pixelHeight/viewport.height,0,0],background:'#fff'});
        this.renderTask=task;
        try{await task.promise;}finally{if(this.renderTask===task)this.renderTask=null;}
        if(revision!==this.revision||doc!==this.doc||this.disposed)return;
        this.rendering=false;this.canvas.setAttribute('aria-busy','false');this.notify();
      }catch(error){
        if(revision!==this.revision||doc!==this.doc||this.disposed)return;
        this.rendering=false;this.canvas.setAttribute('aria-busy','false');
        if(error?.name!=='RenderingCancelledException')this.error='PDF 页面显示失败：'+(error?.message||String(error));
        this.notify();
      }
    });return this.renderQueue;
  }
  async destroy(){
    if(this.disposed)return;this.disposed=true;this.selection++;clearTimeout(this.resizeTimer);this.resizeObserver.disconnect();
    await this.releaseDocument();await this.renderQueue.catch(()=>{});this.canvas.width=0;this.canvas.height=0;
  }
}
