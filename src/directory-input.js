/**
 * Read-only directory acquisition. No network, storage, filtering or STL parsing.
 * Pass returned File[] directly to importFiles/scanFiles. Metadata filtering stays
 * in importer.js, so its empty-folder/AppleDouble diagnostics remain available.
 */

const isFile = value => value && typeof value.name === 'string' && typeof value.slice === 'function';
const relative = path => String(path).replace(/\\/g, '/').replace(/^\/+/, '');

function withPath(file, path) {
  if (!isFile(file)) throw new TypeError('Expected a readable File');
  if (!path || path === file.webkitRelativePath) return file;
  // Keep a real File (Blob URLs and checkpointing require one), never a proxy or
  // a plain wrapper. Blob parts preserve bytes without reading an STL into JS.
  // Do not mutate the original File, even if its path property is configurable.
  const result = new File([file], file.name, { type: file.type, lastModified: file.lastModified });
  Object.defineProperty(result, 'webkitRelativePath', { value: path, enumerable: true });
  return result;
}

function readError(path, cause) {
  if (cause?.code === 'directory-read-error') return cause;
  const error = new Error(`无法读取“${path || '所选目录'}”，请检查访问权限后重选文件夹，或选择其中的 STL 文件。`, { cause });
  error.name = 'DirectoryReadError';
  error.code = 'directory-read-error';
  error.path = path;
  return error;
}

async function collect(source, parent, files) {
  const path = parent ? `${parent}/${source.name}` : relative(source.fullPath || source.name || '');
  try {
    if (isFile(source)) {
      files.push(withPath(source, parent ? path : source.webkitRelativePath));
    } else if (source.isDirectory) {
      const reader = source.createReader();
      // One reader per directory; every nonempty batch requires another call.
      for (;;) {
        const batch = await new Promise((resolve, reject) => reader.readEntries(resolve, reject));
        if (!batch.length) break;
        for (const child of batch) await collect(child, path, files);
      }
    } else if (source.isFile) {
      const file = await new Promise((resolve, reject) => source.file(resolve, reject));
      files.push(withPath(file, path));
    } else if (source.kind === 'directory') {
      for await (const child of source.values()) await collect(child, path, files);
    } else if (source.kind === 'file') {
      files.push(withPath(await source.getFile(), path));
    } else {
      throw new TypeError('Expected a File, FileSystemEntry or FileSystemHandle');
    }
  } catch (cause) {
    // Never return a successful partial directory or disguise a read AbortError
    // as picker cancellation. The caller can keep its previous model selection.
    throw readError(path, cause);
  }
}

/**
 * FileList or iterable of Files, legacy entries and/or modern handles -> File[].
 * Input FileLists are snapshotted before awaiting; safe to reset input.value
 * immediately after calling. Includes the selected root in generated paths.
 * No deduplication by name: different directories may contain identical names.
 * Empty input/directory resolves []; any traversal error rejects the whole call
 * with DirectoryReadError {code:'directory-read-error', path, cause}.
 */
export async function collectDirectoryFiles(sources) {
  const snapshot = Array.from(sources);
  const files = [];
  for (const source of snapshot) await collect(source, '', files);
  return files;
}

// Custom File properties are not retained by IndexedDB structured cloning.
// Restore the optional, separately saved relative paths without changing bytes.
export function restoreDirectoryPaths(files, paths) {
  if (paths === undefined) return files;
  if (!Array.isArray(paths) || paths.length !== files.length || Array.from(paths).some(p => typeof p !== 'string' || p.length > 4096)) throw new Error('本地模型目录恢复信息无效');
  return files.map((file, i) => withPath(file, paths[i]));
}

/**
 * Call INSIDE the drop handler, BEFORE any await. Captures ALL entries/files
 * synchronously while the drag data store is readable, then traverses them.
 * Prefers entries; without entry support only exposed files can be recovered.
 * String items are ignored. Inaccessible file items reject instead of silently
 * importing an incomplete selection. dataTransfer.files is the legacy fallback.
 */
export async function collectDroppedFiles(dataTransfer) {
  const items = Array.from(dataTransfer?.items || []).filter(item => item.kind === 'file');
  if (!items.length) return collectDirectoryFiles(Array.from(dataTransfer?.files || []));
  const sources = items.map(item => {
    let entryError;
    try {
      const getEntry = item.getAsEntry || item.webkitGetAsEntry;
      const entry = getEntry?.call(item);
      if (entry) return entry;
    } catch (error) { entryError = error; }
    try {
      const file = item.getAsFile?.();
      if (file) return file;
    } catch (error) { throw readError('', error); }
    throw readError('', entryError || new Error('Dropped file is unavailable'));
  });
  return collectDirectoryFiles(sources);
}

/** Capability detection, not browser/OS sniffing. */
export function canPickDirectory(environment = globalThis) {
  return environment.isSecureContext === true && typeof environment.showDirectoryPicker === 'function';
}

/**
 * Invoke directly from a user gesture; do not await other work before calling.
 * selected:  {status:'selected', files:File[]} (possibly empty).
 * cancelled: {status:'cancelled', files:[]} only for opening-picker AbortError.
 * fallback:  {status:'fallback', files:[], reason, message}; reason is
 *            'unsupported', 'insecure-context', 'permission-denied' or 'security'.
 * No automatic fallback click after a rejected picker: activation may be lost.
 * Show message and a clickable input/label for a fresh user gesture instead.
 * Use canPickDirectory() to click a webkitdirectory input synchronously when
 * native picking is unavailable. Unexpected picker and ALL read errors reject.
 * environment is injectable for unit tests; it defaults to the browser global.
 */
export async function pickDirectory({ environment = globalThis } = {}) {
  const fallback = (reason, message) => ({ status: 'fallback', files: [], reason, message });
  if (!canPickDirectory(environment)) {
    return fallback(environment.isSecureContext === true ? 'unsupported' : 'insecure-context',
      '请使用普通文件夹选择入口，或选择 STL 文件。');
  }
  let directory;
  try {
    directory = await environment.showDirectoryPicker({ mode: 'read' });
  } catch (error) {
    if (error?.name === 'AbortError') return { status: 'cancelled', files: [] };
    if (error?.name === 'NotAllowedError' || error?.name === 'SecurityError') {
      return fallback(error.name === 'NotAllowedError' ? 'permission-denied' : 'security',
        '浏览器未允许直接读取目录。请点击普通文件夹选择入口，或选择 STL 文件。');
    }
    throw error;
  }
  return { status: 'selected', files: await collectDirectoryFiles([directory]) };
}
