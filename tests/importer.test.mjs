import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { scanFiles, MAX_FILE_BYTES, SAMPLE_BYTES } from '../src/importer.js';

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
