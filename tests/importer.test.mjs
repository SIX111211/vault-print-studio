import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { scanFiles, contentSignature, MAX_FILE_BYTES, SAMPLE_BYTES } from '../src/importer.js';
import { analyzeSTLGeometry } from '../src/geometry-signature.js';

function binary({ triangles = 1, shift = 0, solidHeader = false, badFloat = false } = {}) {
  const bytes = new Uint8Array(84 + triangles * 50);
  if (solidHeader) bytes.set(new TextEncoder().encode('solid binary header'));
  const view = new DataView(bytes.buffer);
  view.setUint32(80, triangles, true);
  for (let t = 0; t < triangles; t++) {
    const values = [0, 0, 1, shift, 0, 0, shift + 1, 0, 0, shift, 1, 0];
    values.forEach((value, i) => view.setFloat32(84 + t * 50 + i * 4, value, true));
  }
  if (badFloat) view.setFloat32(84 + 12, Infinity, true);
  return bytes;
}

function ascii(triangles = 1) {
  const facet = 'facet normal 0 0 1\n outer loop\n  vertex 0 0 0\n  vertex 1 0 0\n  vertex 0 1 0\n endloop\nendfacet\n';
  return new TextEncoder().encode(`solid test\n${facet.repeat(triangles)}endsolid test\n`);
}

function file(bytes, name = 'Part.stl', path = name) {
  const result = new File([bytes], name);
  Object.defineProperty(result, 'webkitRelativePath', { value: path });
  return result;
}

function fingerprint(bytes) {
  return createHash('sha256').update(`${bytes.length}:`).update(bytes.subarray(0, Math.min(SAMPLE_BYTES, bytes.length))).update(bytes.subarray(Math.max(0, bytes.length - SAMPLE_BYTES))).digest('hex');
}

function record(bytes, extra = {}) {
  return { id: 'part', name: 'Part.stl', zh: '零件', old: '01. DRAWERS/Universal/Part.stl', system: 'drawer', size: bytes.length, triangles: 1, bbox: [[0, 0, 0], [1, 1, 0]], fingerprint: fingerprint(bytes), ...extra };
}

test('fingerprint is independent of English/Chinese/renamed folders and filename case', async () => {
  const bytes = binary({ solidHeader: true });
  for (const path of ['English renamed/New name.STL', '新目录/任意改名.stl', 'renamed/嵌套/另一个名称.StL']) {
    const input = file(bytes, path.split('/').pop(), path);
    const result = await scanFiles([input], [record(bytes)]);
    assert.equal(result.matches.get('part').file, input);
    assert.equal(result.matches.get('part').method, 'fingerprint');
    assert.equal(result.matches.get('part').validation.format, 'binary');
    assert.deepEqual(result.missing, []);
    assert.equal(result.conflicts.length + result.invalid.length, 0);
  }
});

test('small file fingerprint includes two copies, and zero read outside bounded slices', async () => {
  const bytes = binary();
  const input = file(bytes);
  input.arrayBuffer = () => { throw new Error('Do not read the entire File directly'); };
  const result = await scanFiles([input], [record(bytes)]);
  assert.equal(result.matches.get('part').fingerprint, fingerprint(bytes));
});

test('same signature and size matches all geometry aliases; duplicate input is reported', async () => {
  const bytes = binary();
  const first = file(bytes, 'A.stl', '英文/A.stl'), second = file(bytes, 'B.stl', '中文/B.stl');
  const result = await scanFiles([first, second], [record(bytes), record(bytes, { id: 'alias', name: 'Alias.stl' })]);
  assert.equal(result.matches.size, 2);
  assert.deepEqual(result.matches.get('part').aliases, ['part', 'alias']);
  assert.deepEqual(result.matches.get('alias').duplicateFiles, [second]);
  assert.equal(result.duplicates.length, 1);
  assert.equal(result.duplicates[0].duplicateOf.file, first);
  assert.equal(result.matches.get('part').file, first);
  assert.deepEqual(result.missing, []);
});

test('unknown fingerprint exact English, Chinese, bilingual and normalized names need confirmation', async () => {
  const bytes = binary();
  const catalog = [record(bytes, { fingerprint: 'a'.repeat(64) })];
  for (const name of ['Part.STL', '零件.stl', '零件__Part.stl', 'ＰＡＲＴ.stl']) {
    const result = await scanFiles([file(bytes, name)], catalog);
    assert.equal(result.matches.size, 0);
    assert.equal(result.conflicts[0].reason, 'name-only');
    assert.equal(result.conflicts[0].requiresConfirmation, true);
    assert.deepEqual(result.conflicts[0].candidateIds, ['part']);
    assert.equal(result.conflicts[0].candidates[0].boundsMatch, true);
    assert.deepEqual(result.missing, ['part']);
  }
});

test('same basename differing geometry stays in conflicts, never trusted', async () => {
  const base = binary();
  const result = await scanFiles([file(binary({ shift: 100 }))], [record(base)]);
  assert.equal(result.matches.size, 0);
  assert.equal(result.conflicts[0].reason, 'geometry-mismatch');
  assert.equal(result.conflicts[0].candidates[0].boundsMatch, false);
});

test('different unknown files with duplicate basename remain separate explicit conflicts', async () => {
  const base = binary();
  const result = await scanFiles([file(binary({ shift: 1 }), 'Part.stl', 'A/Part.stl'), file(binary({ shift: 2 }), 'Part.stl', 'B/Part.stl')], [record(base)]);
  assert.equal(result.matches.size, 0);
  assert.equal(result.conflicts.length, 2);
  assert.equal(result.duplicates.length, 0);
});

test('ambiguous catalog names retain every candidate; context only changes ranking', async () => {
  const bytes = binary();
  const catalog = [record(bytes, { id: 'one', fingerprint: 'a'.repeat(64), old: 'Drawers/A/Part.stl' }), record(bytes, { id: 'two', fingerprint: 'b'.repeat(64), old: 'Drawers/B/Part.stl' })];
  const result = await scanFiles([file(bytes, 'Part.stl', 'Renamed/Drawers/B/Part.stl')], catalog);
  assert.equal(result.matches.size, 0);
  assert.equal(result.conflicts[0].reason, 'ambiguous-name');
  assert.deepEqual(result.conflicts[0].candidateIds, ['two', 'one']);
  assert.ok(result.conflicts[0].candidates[0].contextScore > result.conflicts[0].candidates[1].contextScore);
  assert.deepEqual(result.missing, ['one', 'two']);
});

test('duplicate unknown input is reported and attached to pending conflict', async () => {
  const bytes = binary();
  const first = file(bytes), second = file(bytes, 'Part.STL', '移动目录/Part.STL');
  const result = await scanFiles([first, second], [record(bytes, { fingerprint: 'f'.repeat(64) })]);
  assert.equal(result.conflicts.length, 1);
  assert.deepEqual(result.conflicts[0].files, [first, second]);
  assert.equal(result.duplicates.length, 1);
  assert.equal(result.matches.size, 0);
});

test('unknown duplicate with informative filename retains candidates regardless of input ordering', async () => {
  const bytes = binary();
  const renamed = file(bytes, 'Arbitrary.stl'), localized = file(bytes, '零件.stl');
  for (const files of [[renamed, localized], [localized, renamed]]) {
    const result = await scanFiles(files, [record(bytes, { fingerprint: 'd'.repeat(64) })]);
    assert.equal(result.matches.size, 0);
    assert.equal(result.duplicates.length, 1);
    assert.deepEqual(result.conflicts[0].candidateIds, ['part']);
  }
});

test('hash match with incompatible catalog size cannot be automatically accepted', async () => {
  const bytes = binary();
  const result = await scanFiles([file(bytes)], [record(bytes, { size: bytes.length + 1 })]);
  assert.equal(result.matches.size, 0);
  assert.equal(result.conflicts[0].reason, 'catalog-size-mismatch');
  assert.deepEqual(result.missing, ['part']);
});

test('valid ASCII imports with complete structural validation and true bounds', async () => {
  const bytes = ascii();
  const result = await scanFiles([file(bytes)], [record(bytes)]);
  const validation = result.matches.get('part').validation;
  assert.equal(validation.format, 'ascii');
  assert.equal(validation.scope, 'complete');
  assert.deepEqual(validation.bbox, [[0, 0, 0], [1, 1, 0]]);
  assert.equal(validation.triangles, 1);
});

test('corrupt, truncated, non-finite, empty and non-STL inputs do not stop remaining files', async () => {
  const valid = binary();
  const badASCII = new TextEncoder().encode('solid bad\nfacet normal 0 0 1\nvertex 0 0 0\nendsolid bad\n');
  const inputs = [file(valid.slice(0, -1)), file(binary({ badFloat: true })), file(new Uint8Array()), file(badASCII), file(new TextEncoder().encode('not an STL')), file(new Uint8Array(84)), file(valid, 'manual.pdf'), file(valid)];
  const result = await scanFiles(inputs, [record(valid)]);
  assert.equal(result.invalid.length, 6);
  assert.equal(result.unmatched[0].reason, 'unsupported-extension');
  assert.equal(result.matches.size, 1);
});

test('ASCII facet garbage and non-finite scientific values are invalid', async () => {
  const source = new TextDecoder().decode(ascii());
  for (const text of [source.replace('endloop', 'gibberish endloop'), source.replace('vertex 1', 'vertex 1e999'), source.replace('endfacet', 'endfacetjunk'), source.replace('endsolid test', '')]) {
    const result = await scanFiles([file(new TextEncoder().encode(text))], []);
    assert.equal(result.invalid.length, 1);
  }
});

test('unknown valid renamed input is unmatched and missing lists every absent catalog ID', async () => {
  const bytes = binary();
  const result = await scanFiles([file(bytes, 'Totally unrelated.stl')], [record(bytes, { fingerprint: 'a'.repeat(64) }), record(bytes, { id: 'second', name: 'Second.stl', fingerprint: 'b'.repeat(64) })]);
  assert.equal(result.unmatched[0].reason, 'no-candidate');
  assert.deepEqual(result.missing, ['part', 'second']);
});

test('512 MiB limit rejects a file before reading; processing continues', async () => {
  const bytes = binary();
  const tooLarge = { name: 'huge.stl', size: MAX_FILE_BYTES + 1, slice() { throw new Error('must not read'); } };
  const result = await scanFiles([tooLarge, file(bytes)], [record(bytes)]);
  assert.equal(result.invalid[0].reason, 'file-too-large');
  assert.equal(result.matches.size, 1);
});

test('individual read failure is isolated', async () => {
  const broken = { name: 'broken.stl', size: 150, slice() { throw new DOMException('permission revoked', 'NotReadableError'); } };
  const result = await scanFiles([broken, file(binary())], []);
  assert.equal(result.invalid[0].reason, 'read-error');
  assert.equal(result.unmatched.length, 1);
});

test('large binary is fingerprinted and sampled with bounded reads', async () => {
  const bytes = binary({ triangles: 30000 });
  const input = file(bytes);
  let total = 0, largest = 0;
  const slice = input.slice.bind(input);
  input.slice = (start, end) => { total += end - start; largest = Math.max(largest, end - start); return slice(start, end); };
  input.arrayBuffer = () => { throw new Error('whole-file read prohibited'); };
  const result = await scanFiles([input], [record(bytes, { triangles: 30000 })]);
  assert.equal(result.matches.get('part').validation.scope, 'sampled');
  assert.equal(result.matches.get('part').validation.triangles, 30000);
  assert.equal(result.matches.get('part').validation.boundsComplete, false);
  assert.ok(total <= 2 * SAMPLE_BYTES + 6400, `${total} bytes read`);
  assert.ok(largest <= SAMPLE_BYTES);
});

test('large ASCII uses bounded samples and never claims complete triangle count or bounds', async () => {
  const bytes = ascii(2000);
  const input = file(bytes);
  let total = 0;
  const slice = input.slice.bind(input);
  input.slice = (start, end) => { total += end - start; return slice(start, end); };
  const result = await scanFiles([input], [record(bytes, { triangles: 2000 })]);
  assert.equal(result.invalid.length, 0);
  const validation = result.matches.get('part').validation;
  assert.equal(validation.scope, 'sampled');
  assert.equal(validation.triangles, null);
  assert.equal(validation.boundsComplete, false);
  assert.ok(total <= 2 * SAMPLE_BYTES + 16384);
});

test('progress is ordered, yields between files and ends at the full input count', async () => {
  const events = []; let timerRan = false;
  setTimeout(() => { timerRan = true; }, 0);
  await scanFiles([file(binary()), file(ascii(), 'Other.stl')], [], { onProgress(event) { events.push(event); if (event.processed === 2) assert.equal(timerRan, true); } });
  assert.deepEqual(events.map(event => event.processed), [0, 1, 2]);
  assert.ok(events.every(event => event.total === 2));
  assert.equal(events.at(-1).status, 'unmatched');
});

test('empty input preserves all missing IDs and reports initial progress', async () => {
  const events = [];
  const result = await scanFiles([], [record(binary())], { onProgress: event => events.push(event) });
  assert.deepEqual(result.missing, ['part']);
  assert.equal(events[0].total, 0);
});

test('abort and caller callback errors propagate, duplicate catalog IDs reject', async () => {
  const controller = new AbortController(); controller.abort();
  await assert.rejects(scanFiles([file(binary())], [], { signal: controller.signal }), { name: 'AbortError' });
  await assert.rejects(scanFiles([], [], { onProgress() { throw new Error('caller error'); } }), /caller error/);
  const r = record(binary());
  await assert.rejects(scanFiles([], [r, r]), /unique/);
  await assert.rejects(scanFiles([], [], { maxFileBytes: -1 }), /maxFileBytes/);
});

async function geometryRecord(bytes, extra = {}) {
  const geometry = await analyzeSTLGeometry(file(bytes));
  return record(bytes, {geometrySignature:geometry.signature, geometryArea:geometry.surfaceArea,
    bbox:geometry.bbox, triangles:geometry.triangles, ...extra});
}

test('re-exported English/Chinese/arbitrary names match complete geometry, ignoring header, normals and attributes', async () => {
  const base=binary(), catalog=[await geometryRecord(base)];
  const changed=base.slice(); changed.set(new TextEncoder().encode('exported by another tool'));
  const view=new DataView(changed.buffer);view.setFloat32(84,NaN,true);view.setUint16(132,255,true);
  for(const name of ['Original English.stl','中文版.stl','opaque123.STL']){
    const result=await scanFiles([file(changed,name)],catalog);
    assert.equal(result.matches.get('part').method,'geometry');
    assert.equal(result.matches.get('part').validation.scope,'complete');
    assert.deepEqual(result.missing,[]);
  }
});

test('ASCII export with changed labels, case and normals matches a binary catalogue without any name hint', async () => {
  const base=binary(), catalog=[await geometryRecord(base)];
  const source=new TextDecoder().decode(ascii()).toUpperCase().replace('NORMAL 0 0 1','NORMAL NaN 0 0');
  const result=await scanFiles([file(new TextEncoder().encode(source),'unrelated.STL')],catalog);
  assert.equal(result.matches.get('part').method,'geometry');
  assert.equal(result.matches.get('part').validation.format,'ascii');
});

test('same count and complete bounds with different surface is a version candidate, never automatic', async () => {
  const base=binary({triangles:2}), catalog=[await geometryRecord(base)];
  const changed=base.slice();new DataView(changed.buffer).setFloat32(84+24,.5,true);
  const result=await scanFiles([file(changed,'random-new-version.stl')],catalog);
  assert.equal(result.matches.size,0);
  assert.equal(result.conflicts[0].reason,'geometry-version');
  assert.equal(result.conflicts[0].candidates[0].boundsMatch,true);
  assert.equal(result.conflicts[0].candidates[0].trianglesMatch,true);
  assert.deepEqual(result.missing,['part']);
});

test('geometry aliases and mixed-format duplicate files remain one imported identity', async () => {
  const base=binary();const one=await geometryRecord(base),two={...one,id:'other',name:'Another.stl'};
  for(const inputs of [[file(ascii(),'converted.stl'),file(base,'original.stl')],[file(base,'original.stl'),file(ascii(),'converted.stl')]]){
    const result=await scanFiles(inputs,[one,two]);
    assert.equal(result.matches.size,2);assert.equal(result.duplicates.length,1);
    assert.equal(result.duplicates[0].reason,'same-geometry');
    assert.equal(result.matches.get('part').file,inputs[0]);
    assert.deepEqual(result.matches.get('other').duplicateFiles,[inputs[1]]);
  }
});

test('AppleDouble is identified by its content; real STL in similarly named folders still imports', async () => {
  const apple=new Uint8Array(212);apple.set([0,5,22,7]);
  const result=await scanFiles([file(apple,'._Part.stl','__MACOSX/._Part.stl')],[record(binary())]);
  assert.equal(result.invalid.length,0);assert.equal(result.diagnostics.metadataCount,1);
  assert.equal(result.diagnostics.stlCount,0);assert.equal(result.diagnostics.emptyReason,'macos-metadata');
  const real=await scanFiles([file(binary(),'._real.stl','__MACOSX/._real.stl')],[record(binary())]);
  assert.equal(real.matches.size,1);assert.equal(real.diagnostics.stlCount,1);
});

test('manual-only and archive-only folders report why they cannot provide models', async () => {
  const pdf=await scanFiles([file(new Uint8Array([1]),'manual.pdf')],[]);
  assert.equal(pdf.diagnostics.emptyReason,'no-stl');
  const zip=await scanFiles([file(new Uint8Array([1]),'original.zip')],[]);
  assert.equal(zip.diagnostics.emptyReason,'archive-only');
});

test('full-content analysis progress is reported and callback failures propagate', async () => {
  const base=binary(), catalog=[await geometryRecord(base)];
  const changed=base.slice();changed[0]=42;
  const events=[];
  await scanFiles([file(changed)],catalog,{onProgress:p=>events.push(p)});
  assert.ok(events.some(p=>p.status==='geometry'&&p.fileProgress===1));
  await assert.rejects(scanFiles([file(changed)],catalog,{onProgress:p=>{if(p.status==='geometry')throw Error('stop progress');}}),/stop progress/);
});

test('changed middle facets cannot hide behind matching head/tail bytes and file length', async () => {
  const base=binary({triangles:4000}), changed=base.slice();
  new DataView(changed.buffer).setFloat32(84+2000*50+24,.5,true);
  assert.equal(fingerprint(base),fingerprint(changed),'fixture must retain old sampled signature');
  const reference=await geometryRecord(base,{contentSignature:await contentSignature(file(base))});
  assert.notEqual(await contentSignature(file(changed)),reference.contentSignature);
  const result=await scanFiles([file(changed,'same-name.stl')],[reference]);
  assert.equal(result.matches.size,0);assert.equal(result.conflicts[0].reason,'geometry-version');
  const known=await scanFiles([file(base,'original English.stl')],[reference]);
  assert.equal(known.matches.get('part').method,'content');
});

test('full-content fast path expands only equivalent geometry aliases across export formats', async () => {
  const base=binary(), text=ascii();
  const one=await geometryRecord(base,{contentSignature:await contentSignature(file(base))});
  const two=await geometryRecord(text,{id:'other',contentSignature:await contentSignature(file(text))});
  const result=await scanFiles([file(base),file(text,'other.stl')],[one,two]);
  assert.equal(result.matches.size,2);assert.deepEqual(result.missing,[]);
  assert.equal(result.duplicates.length,1);
});

test('registered paired export matches by content, preserves quantity metadata and prefers baseline',async()=>{
  const bytes=binary(),other=binary({triangles:2,shift:5}),base=await geometryRecord(bytes,{contentSignature:await contentSignature(file(bytes))}),v=await geometryRecord(other,{contentSignature:await contentSignature(file(other))});
  base.variants=[{...v,piecesPerFile:2,referencePiecesPerFile:1}];
  const alternate=file(other,'完全改名.STL');let result=await scanFiles([alternate],[base]);
  assert.equal(result.matches.get('part').variant.piecesPerFile,2);assert.equal(result.matches.get('part').file,alternate);
  const original=file(bytes,'original.stl');
  for(const inputs of [[alternate,original],[original,alternate]]){result=await scanFiles(inputs,[base]);assert.equal(result.matches.get('part').file,original);assert.equal(result.matches.get('part').variant,null);}
  const reexport=other.slice();reexport[0]=33;result=await scanFiles([file(reexport,'different-header.stl')],[base]);
  assert.equal(result.matches.get('part').method,'geometry');assert.equal(result.matches.get('part').variant.piecesPerFile,2);
});

test('known complete content accepts ignored nonfinite normals and unknown content-only catalogues still inspect every facet',async()=>{
 const bytes=binary();new DataView(bytes.buffer).setFloat32(84,NaN,true);
 const known=await geometryRecord(bytes,{contentSignature:await contentSignature(file(bytes))});
 const result=await scanFiles([file(bytes)],[known]);assert.equal(result.matches.size,1);assert.equal(result.invalid.length,0);
 const large=binary({triangles:5000});new DataView(large.buffer).setFloat32(84+2345*50+12,Infinity,true);
 const reference=record(binary(),{contentSignature:await contentSignature(file(binary()))});
 const unknown=await scanFiles([file(large,'unknown.stl')],[reference]);assert.equal(unknown.invalid.length,1);assert.equal(unknown.matches.size,0);
});

test('registered but uncertain composite version remains an explicit candidate after renaming or re-export',async()=>{
 const bytes=binary(),different=binary({shift:15,triangles:3}),base=await geometryRecord(bytes,{contentSignature:await contentSignature(file(bytes))}),v=await geometryRecord(different,{contentSignature:await contentSignature(file(different))});base.variants=[{...v,requiresConfirmation:true}];
 for(const header of [0,33]){const altered=different.slice();altered[0]=header;const result=await scanFiles([file(altered,'anything.stl')],[base]);assert.equal(result.matches.size,0);assert.equal(result.conflicts.length,1);assert.deepEqual(result.conflicts[0].candidateIds,['part']);}
});
