import test from 'node:test';
import assert from 'node:assert/strict';
import { collectDirectoryFiles, collectDroppedFiles, canPickDirectory, pickDirectory } from '../src/directory-input.js';
import { scanFiles } from '../src/importer.js';

// Protocol fakes exercise acquisition logic, not Safari/browser compatibility.
const file = (name = 'part.stl', bytes = 'original bytes') => new File([bytes], name, { type: 'application/octet-stream', lastModified: 123 });
const fileEntry = source => ({ name: source.name, isFile: true, file: resolve => queueMicrotask(() => resolve(source)) });
function directoryEntry(name, batches) {
  let readers = 0, reads = 0;
  return {
    name, isDirectory: true,
    get readers() { return readers; }, get reads() { return reads; },
    createReader() {
      readers++;
      let index = 0;
      return { readEntries(resolve, reject) {
        reads++;
        const batch = batches[index++] ?? [];
        queueMicrotask(() => batch instanceof Error ? reject(batch) : resolve(batch));
      } };
    },
  };
}
const fileHandle = source => ({ name: source.name, kind: 'file', getFile: async () => source });
const directoryHandle = (name, children) => ({ name, kind: 'directory', async *values() { yield* children; } });

test('FileList snapshot preserves native paths, File identity and metadata candidates', async () => {
  const model = file('零件.stl');
  Object.defineProperty(model, 'webkitRelativePath', { value: '模型/层/零件.stl' });
  const metadata = file('._零件.stl'), note = file('.DS_Store');
  const list = { 0: model, 1: metadata, 2: note, length: 3 };
  const pending = collectDirectoryFiles(list);
  list.length = 0; delete list[1];
  const result = await pending;
  assert.deepEqual(result, [model, metadata, note]);
  assert.equal(result[0].webkitRelativePath, '模型/层/零件.stl');
});

test('legacy directory drains 100 + 100 + 5 entries and nested batches through final empty batch', async () => {
  const entries = Array.from({ length: 205 }, (_, i) => fileEntry(file(`${i}.stl`)));
  const nested = directoryEntry('子目录', [[fileEntry(file('same.stl'))], [fileEntry(file('last.stl'))], []]);
  const root = directoryEntry('模型', [entries.slice(0, 100), entries.slice(100, 200), [...entries.slice(200), nested], []]);
  const result = await collectDirectoryFiles([root]);
  assert.equal(result.length, 207);
  assert.equal(result[204].webkitRelativePath, '模型/204.stl');
  assert.equal(result[206].webkitRelativePath, '模型/子目录/last.stl');
  assert.equal(root.readers, 1); assert.equal(root.reads, 4);
  assert.equal(nested.readers, 1); assert.equal(nested.reads, 3);
});

test('mixed File, legacy directory and modern handles retain same-name files and original bytes', async () => {
  const original = Object.freeze(file('same.stl'));
  const result = await collectDirectoryFiles([
    original, directoryEntry('A', [[fileEntry(original)]]),
    directoryHandle('B', [directoryHandle('子目录', [fileHandle(original)])]),
  ]);
  assert.equal(result.length, 3);
  assert.equal(result[0], original);
  assert.deepEqual(result.map(f => f.webkitRelativePath || f.name), ['same.stl', 'A/same.stl', 'B/子目录/same.stl']);
  for (const output of result) {
    assert.ok(output instanceof File);
    assert.equal(output.name, original.name); assert.equal(output.type, original.type);
    assert.equal(output.lastModified, original.lastModified);
    assert.deepEqual(await output.arrayBuffer(), await original.arrayBuffer());
    assert.doesNotThrow(() => { const url = URL.createObjectURL(output); URL.revokeObjectURL(url); });
  }
  assert.equal(Object.hasOwn(original, 'webkitRelativePath'), false);
});

test('a supplied entry fullPath stays relative and Unicode paths are not rewritten', async () => {
  const entry = fileEntry(file('e\u0301.stl'));
  entry.fullPath = '/根目录/子目录/e\u0301.stl';
  assert.equal((await collectDirectoryFiles([entry]))[0].webkitRelativePath, '根目录/子目录/e\u0301.stl');
});

test('empty FileList, empty directory and empty drop resolve empty arrays', async () => {
  assert.deepEqual(await collectDirectoryFiles({ length: 0 }), []);
  assert.deepEqual(await collectDirectoryFiles([directoryEntry('empty', [[]])]), []);
  assert.deepEqual(await collectDroppedFiles({ items: [], files: [] }), []);
});

test('a later readEntries async error rejects the entire selection with its cause and path', async () => {
  const cause = new DOMException('No permission', 'NotAllowedError');
  const root = directoryEntry('root', [[fileEntry(file())], cause]);
  await assert.rejects(collectDirectoryFiles([root]), error => {
    assert.equal(error.name, 'DirectoryReadError'); assert.equal(error.path, 'root');
    assert.equal(error.cause, cause); assert.match(error.message, /权限/); return true;
  });
});

test('asynchronous entry.file failure retains the failing child path', async () => {
  const cause = new DOMException('File disappeared', 'NotFoundError');
  const bad = { name: 'gone.stl', isFile: true, file: (_, reject) => queueMicrotask(() => reject(cause)) };
  await assert.rejects(collectDirectoryFiles([directoryEntry('root', [[bad]])]), error => {
    assert.equal(error.path, 'root/gone.stl'); assert.equal(error.cause, cause); return true;
  });
});

test('synchronous entry reader exceptions reject without returning earlier files', async () => {
  const cause = new Error('reader failed');
  await assert.rejects(collectDirectoryFiles([file(), { name: 'bad', isDirectory: true, createReader() { throw cause; } }]),
    error => error.cause === cause && error.path === 'bad');
});

test('drop captures all items synchronously before drag data becomes protected', async () => {
  let readable = true, calls = 0;
  const entry = directoryEntry('folder', [[fileEntry(file('inside.stl'))]]);
  const loose = file('loose.stl');
  const capture = value => { assert.ok(readable); calls++; return value; };
  const transfer = { items: [
    { kind: 'string', getAsFile() { assert.fail('text must be ignored'); } },
    { kind: 'file', webkitGetAsEntry() { assert.equal(this.kind, 'file'); return capture(entry); }, getAsFile() { assert.fail('directory must use entry'); } },
    { kind: 'file', webkitGetAsEntry: () => capture(null), getAsFile: () => capture(loose) },
  ], files: [file('folder', '')] };
  const pending = collectDroppedFiles(transfer);
  readable = false; transfer.items = []; transfer.files = [];
  const result = await pending;
  assert.equal(calls, 3);
  assert.deepEqual(result.map(f => f.webkitRelativePath || f.name), ['folder/inside.stl', 'loose.stl']);
});

test('drop supports unprefixed getAsEntry and excludes duplicate dataTransfer.files exposure', async () => {
  const original = file();
  const result = await collectDroppedFiles({ items: [{ kind: 'file', getAsEntry: () => fileEntry(original) }], files: [original] });
  assert.equal(result.length, 1);
});

test('file-only drop fallback works without items, without entry APIs and with null/throwing entry APIs', async () => {
  const original = file();
  assert.deepEqual(await collectDroppedFiles({ files: { 0: original, length: 1 } }), [original]);
  for (const getEntry of [undefined, () => null, () => { throw new Error('entry unavailable'); }]) {
    assert.deepEqual(await collectDroppedFiles({ items: [{ kind: 'file', webkitGetAsEntry: getEntry, getAsFile: () => original }] }), [original]);
  }
});

test('an unreadable drop item rejects instead of silently losing part of a mixed drop', async () => {
  await assert.rejects(collectDroppedFiles({ items: [
    { kind: 'file', getAsFile: () => file() },
    { kind: 'file', webkitGetAsEntry: () => null, getAsFile: () => null },
  ] }), { code: 'directory-read-error' });
});

test('picker requires both a callable API and a secure context; unavailable paths never open a dialog', async () => {
  for (const environment of [{}, { isSecureContext: true }, { isSecureContext: true, showDirectoryPicker: {} },
    { isSecureContext: false, showDirectoryPicker() { assert.fail('insecure picker'); } },
    { showDirectoryPicker() { assert.fail('unknown context'); } }]) {
    assert.equal(canPickDirectory(environment), false);
    const result = await pickDirectory({ environment });
    assert.equal(result.status, 'fallback'); assert.deepEqual(result.files, []);
    assert.equal(result.reason, environment.isSecureContext === true ? 'unsupported' : 'insecure-context');
  }
});

test('native picker opens before any async boundary, binds receiver and requests read only', async () => {
  let opened = false;
  const environment = { isSecureContext: true, showDirectoryPicker(options) {
    assert.equal(this, environment); assert.deepEqual(options, { mode: 'read' });
    opened = true; return Promise.resolve(directoryHandle('root', [fileHandle(file())]));
  } };
  assert.equal(canPickDirectory(environment), true);
  const pending = pickDirectory({ environment });
  assert.equal(opened, true);
  const result = await pending;
  assert.equal(result.status, 'selected'); assert.equal(result.files[0].webkitRelativePath, 'root/part.stl');
});

test('opening-picker cancellation is silent and never starts another picker', async () => {
  let calls = 0;
  const result = await pickDirectory({ environment: { isSecureContext: true, showDirectoryPicker() {
    calls++; return Promise.reject(new DOMException('User cancelled', 'AbortError'));
  } } });
  assert.deepEqual(result, { status: 'cancelled', files: [] }); assert.equal(calls, 1);
});

test('permission and security rejection return actionable fallback without auto-clicking', async () => {
  for (const [name, reason] of [['NotAllowedError', 'permission-denied'], ['SecurityError', 'security']]) {
    const result = await pickDirectory({ environment: { isSecureContext: true, showDirectoryPicker() { throw new DOMException('blocked', name); } } });
    assert.equal(result.status, 'fallback'); assert.equal(result.reason, reason);
    assert.match(result.message, /点击普通文件夹/); assert.deepEqual(result.files, []);
  }
});

test('unexpected picker error rejects unchanged', async () => {
  const cause = new Error('platform failure');
  await assert.rejects(pickDirectory({ environment: { isSecureContext: true, showDirectoryPicker() { throw cause; } } }), error => error === cause);
});

test('read AbortError after choosing a directory is not treated as user cancellation', async () => {
  const cause = new DOMException('Read interrupted', 'AbortError');
  const handle = { kind: 'file', name: 'bad.stl', async getFile() { throw cause; } };
  await assert.rejects(pickDirectory({ environment: { isSecureContext: true, showDirectoryPicker: async () => directoryHandle('root', [handle]) } }),
    error => error.code === 'directory-read-error' && error.path === 'root/bad.stl' && error.cause === cause);
});

test('native directory iterator failure rejects and empty native selection remains selected', async () => {
  const cause = new DOMException('Lost access', 'NotAllowedError');
  const directory = { kind: 'directory', name: 'root', async *values() { yield fileHandle(file()); throw cause; } };
  await assert.rejects(collectDirectoryFiles([directory]), error => error.cause === cause && error.path === 'root');
  assert.deepEqual(await pickDirectory({ environment: { isSecureContext: true, showDirectoryPicker: async () => directoryHandle('empty', []) } }),
    { status: 'selected', files: [] });
});

test('importer receives all metadata candidates and keeps its existing AppleDouble diagnostics', async () => {
  const sidecar = file('._part.stl', new Uint8Array([0, 5, 22, 7, 0, 0, 0, 0]));
  const result = await collectDirectoryFiles([directoryEntry('__MACOSX', [[fileEntry(sidecar)]])]);
  assert.equal(result.length, 1);
  const report = await scanFiles(result, []);
  assert.equal(report.unmatched[0].reason, 'system-metadata');
  assert.equal(report.unmatched[0].path, '__MACOSX/._part.stl');
  assert.equal(report.diagnostics.emptyReason, 'macos-metadata');
});
