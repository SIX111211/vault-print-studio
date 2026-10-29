import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {books,bundledManual} from '../src/manual-library.js';

test('all bundled pairs preserve matching page counts and verified exact PDF bytes',async()=>{
  assert.equal(books.length,5);
  for(const book of books){
    assert.equal(book.files.en.pages,book.files.zh.pages);
    for(const language of ['en','zh']){
      const file=await bundledManual(book.id,language,{baseURL:'https://example.test/vault-print-studio/',fetchFile:async url=>{
        assert.equal(url.origin,'https://example.test');
        assert.ok(url.pathname.startsWith('/vault-print-studio/manuals/'));
        return new Response(await readFile(new URL('../public/'+book.files[language].path,import.meta.url)));
      }});
      assert.equal(file.type,'application/pdf');assert.equal(file.size,book.files[language].size);
    }
  }
});

test('missing, corrupt, unknown or cancelled bundled manuals cannot replace the selected book',async()=>{
  const baseURL='https://example.test/vault-print-studio/';
  await assert.rejects(bundledManual('unknown','en',{baseURL}),/不存在/);
  await assert.rejects(bundledManual('drawer','en',{baseURL,fetchFile:async()=>new Response('',{status:404})}),/404/);
  const bytes=await readFile(new URL('../public/manuals/drawer-en.pdf',import.meta.url));
  const bad=Buffer.from(bytes);bad[100]^=1;
  await assert.rejects(bundledManual('drawer','en',{baseURL,fetchFile:async()=>new Response(bad)}),/校验/);
  await assert.rejects(bundledManual('drawer','en',{baseURL,fetchFile:async()=>new Response(bytes.subarray(0,-1))}),/不完整/);
  const controller=new AbortController();controller.abort();
  await assert.rejects(bundledManual('drawer','en',{baseURL,signal:controller.signal,fetchFile:async()=>new Response(bytes)}),{name:'AbortError'});
});
