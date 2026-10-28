/**
 * Local, bounded-memory STL import. No network or persistent-storage access.
 * Fingerprint = SHA256(UTF8(`${size}:`) + first min(65536,size) bytes
 *                                      + last min(65536,size) bytes).
 * This is a catalogue identity signature, NOT a whole-file integrity hash.
 * Large meshes receive structural + sampled facet validation, not a full audit.
 */
export const MAX_FILE_BYTES = 512 * 1024 * 1024;
export const SAMPLE_BYTES = 65536;

const encoder = new TextEncoder();
const decoder = new TextDecoder('utf-8', { fatal: true });
const numberPattern = '[+-]?(?:\\d+(?:\\.\\d*)?|\\.\\d+)(?:[eE][+-]?\\d+)?';
const triple = `(${numberPattern})\\s+(${numberPattern})\\s+(${numberPattern})`;
const facetPattern = `facet\\s+normal\\s+${triple}\\s+outer\\s+loop\\s+vertex\\s+${triple}\\s+vertex\\s+${triple}\\s+vertex\\s+${triple}\\s+endloop\\s+endfacet`;

class FileIssue extends Error {
  constructor(code, message) { super(message); this.code = code; }
}

function checkAbort(signal) {
  if (signal?.aborted) throw signal.reason ?? new DOMException('Import aborted', 'AbortError');
}

function normalize(value) {
  return String(value ?? '').normalize('NFKC').toLowerCase().replace(/[^\p{L}\p{N}]+/gu, '');
}

function pathOf(file) { return String(file.webkitRelativePath || file.name || '').replace(/\\/g, '/'); }
function basename(value) { return String(value ?? '').replace(/\\/g, '/').split('/').pop().replace(/\.stl$/i, ''); }
function nameKey(value) { return normalize(basename(value)); }
function parents(value) { return String(value ?? '').replace(/\\/g, '/').split('/').slice(0, -1).map(normalize).filter(Boolean); }

function aliases(record) {
  const values = [record.name, record.old, record.zh].filter(v => typeof v === 'string' && v.trim());
  if (record.zh && record.name) values.push(`${basename(record.zh)}__${basename(record.name)}`);
  if (record.zh && record.old) values.push(`${basename(record.zh)}__${basename(record.old)}`);
  return [...new Set(values.map(nameKey).filter(Boolean))];
}

function catalogIndex(catalog) {
  if (!Array.isArray(catalog)) throw new TypeError('catalog must be an array');
  const ids = new Set(), byHash = new Map(), byName = new Map();
  for (const record of catalog) {
    if (!record || typeof record.id !== 'string' || !record.id || ids.has(record.id)) {
      throw new TypeError('Each catalog record must have a unique, non-empty string id');
    }
    ids.add(record.id);
    const fingerprint = String(record.fingerprint ?? '').toLowerCase();
    if (/^[a-f0-9]{64}$/.test(fingerprint)) {
      if (!byHash.has(fingerprint)) byHash.set(fingerprint, []);
      byHash.get(fingerprint).push(record);
    }
    for (const key of aliases(record)) {
      if (!byName.has(key)) byName.set(key, []);
      byName.get(key).push(record);
    }
  }
  return { ids, byHash, byName };
}

async function sampleFile(file, signal) {
  const size = file.size;
  const count = Math.min(SAMPLE_BYTES, size);
  checkAbort(signal);
  const head = new Uint8Array(await file.slice(0, count).arrayBuffer());
  checkAbort(signal);
  // The signature intentionally includes the entire file twice when size <= 64 KiB.
  const tail = size <= SAMPLE_BYTES ? head : new Uint8Array(await file.slice(size - count, size).arrayBuffer());
  if (head.length !== count || tail.length !== count) throw new FileIssue('read-error', 'File changed or returned an incomplete read');
  checkAbort(signal);
  const prefix = encoder.encode(`${size}:`);
  const bytes = new Uint8Array(prefix.length + head.length + tail.length);
  bytes.set(prefix); bytes.set(head, prefix.length); bytes.set(tail, prefix.length + head.length);
  const hash = new Uint8Array(await globalThis.crypto.subtle.digest('SHA-256', bytes));
  const fingerprint = Array.from(hash, byte => byte.toString(16).padStart(2, '0')).join('');
  const read = async (start, end) => {
    checkAbort(signal);
    if (start >= 0 && end <= head.length) return head.subarray(start, end);
    if (start >= size - tail.length && end <= size) return tail.subarray(start - (size - tail.length), end - (size - tail.length));
    const data = new Uint8Array(await file.slice(start, end).arrayBuffer());
    if (data.length !== end - start) throw new FileIssue('read-error', 'Incomplete sample read');
    checkAbort(signal);
    return data;
  };
  return { head, tail, fingerprint, read };
}

function boundsTracker() {
  const min = [Infinity, Infinity, Infinity], max = [-Infinity, -Infinity, -Infinity];
  return {
    add(values) {
      for (let i = 0; i < values.length; i++) {
        if (!Number.isFinite(values[i])) throw new FileIssue('non-finite-coordinate', 'STL contains a non-finite coordinate or normal');
        if (i >= 3) { const axis = (i - 3) % 3; min[axis] = Math.min(min[axis], values[i]); max[axis] = Math.max(max[axis], values[i]); }
      }
    },
    bbox: () => [min, max],
  };
}

async function validateBinary(file, samples, triangles) {
  if (!triangles) throw new FileIssue('empty-stl', 'STL has no triangles');
  const tracker = boundsTracker();
  const complete = file.size <= SAMPLE_BYTES;
  let inspected = 0;
  const ranges = [];
  if (complete) ranges.push([0, triangles]);
  else {
    // Up to eight evenly distributed blocks; <= 6.4 KiB beyond head/tail.
    const width = Math.min(16, triangles);
    const starts = new Set(Array.from({ length: 8 }, (_, i) => Math.floor((triangles - width) * i / 7)));
    for (const start of starts) ranges.push([start, Math.min(start + width, triangles)]);
  }
  for (const [first, last] of ranges) {
    const bytes = await samples.read(84 + first * 50, 84 + last * 50);
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    for (let offset = 0; offset < bytes.length; offset += 50) {
      tracker.add(Array.from({ length: 12 }, (_, i) => view.getFloat32(offset + i * 4, true)));
      inspected++;
    }
  }
  return { format: 'binary', scope: complete ? 'complete' : 'sampled', triangles, inspectedTriangles: inspected, bbox: tracker.bbox(), boundsComplete: complete };
}

function parseFacets(text, tracker) {
  const facet = new RegExp(facetPattern, 'gy');
  let position = 0, count = 0;
  while (position < text.length) {
    while (/\s/.test(text[position] ?? '') && position < text.length) position++;
    if (position === text.length) break;
    facet.lastIndex = position;
    const match = facet.exec(text);
    if (!match || (facet.lastIndex < text.length && !/\s/.test(text[facet.lastIndex]))) {
      throw new FileIssue('invalid-ascii', 'Malformed ASCII STL facet');
    }
    tracker.add(match.slice(1).map(Number));
    count++; position = facet.lastIndex;
  }
  return count;
}

async function validateASCII(file, samples) {
  let head, tail;
  try { head = decoder.decode(samples.head); tail = decoder.decode(samples.tail); }
  catch { throw new FileIssue('invalid-stl', 'File is neither a structurally valid binary STL nor UTF-8 ASCII STL'); }
  if (head.includes('\0') || tail.includes('\0')) throw new FileIssue('invalid-stl', 'Unexpected NUL in ASCII STL');
  const opening = /^\uFEFF?\s*solid(?:[ \t]+[^\r\n]*)?\r?\n/i.exec(head);
  const closing = /(?:^|\r?\n)[ \t]*endsolid(?:[ \t]+[^\r\n]*)?[\r\n\t ]*$/i.exec(tail);
  if (!opening || !closing) throw new FileIssue('invalid-stl', 'Missing ASCII STL solid/endsolid boundary or incorrect binary length');
  const tracker = boundsTracker();
  let inspected = 0;
  const complete = file.size <= SAMPLE_BYTES;
  if (complete) {
    const body = head.slice(opening[0].length, closing.index);
    inspected = parseFacets(body, tracker);
  } else {
    const midpoint = Math.floor(file.size / 2);
    let middle;
    try { middle = decoder.decode(await samples.read(Math.max(0, midpoint - 8192), Math.min(file.size, midpoint + 8192))); }
    catch (error) { if (error instanceof TypeError) throw new FileIssue('invalid-ascii', 'Invalid text in ASCII sample'); throw error; }
    // Keep only complete facet records at slice boundaries; interior gaps are errors.
    const chunks = [head.slice(opening[0].length), middle, tail.slice(0, closing.index)];
    for (let i = 0; i < chunks.length; i++) {
      const chunk = chunks[i];
      const first = /(?:^|\s)facet\s+normal\b/.exec(chunk);
      const last = chunk.lastIndexOf('endfacet');
      if (!first || last < first.index) throw new FileIssue('invalid-ascii', 'No complete facet in ASCII sample');
      const start = first.index + first[0].indexOf('facet');
      if (i === 0 && chunk.slice(0, start).trim()) throw new FileIssue('invalid-ascii', 'Unexpected ASCII STL preamble');
      if (i === 2 && chunk.slice(last + 8).trim()) throw new FileIssue('invalid-ascii', 'Unexpected ASCII STL ending');
      inspected += parseFacets(chunk.slice(start, last + 8), tracker);
    }
  }
  if (!inspected) throw new FileIssue('empty-stl', 'STL has no triangles');
  return { format: 'ascii', scope: complete ? 'complete' : 'sampled', triangles: complete ? inspected : null, inspectedTriangles: inspected, bbox: tracker.bbox(), boundsComplete: complete };
}

async function validateSTL(file, samples) {
  if (file.size >= 84) {
    const view = new DataView(samples.head.buffer, samples.head.byteOffset, samples.head.byteLength);
    const triangles = view.getUint32(80, true);
    // Binary headers may start with "solid". Exact binary length takes priority.
    if (84 + triangles * 50 === file.size) return validateBinary(file, samples, triangles);
  }
  return validateASCII(file, samples);
}

function catalogBounds(record) {
  const bbox = record.bbox;
  const result = Array.isArray(bbox) && bbox.length === 2 ? bbox : bbox?.min && bbox?.max ? [bbox.min, bbox.max] : null;
  return result && result.every(row => Array.isArray(row) && row.length === 3 && row.every(Number.isFinite)) ? result : null;
}

function compareBounds(validation, record) {
  const expected = catalogBounds(record);
  if (!expected) return null;
  const actual = validation.bbox;
  for (let axis = 0; axis < 3; axis++) {
    // 0.01 model units or 0.001% of extent, whichever is larger.
    const tolerance = Math.max(.01, Math.abs(expected[1][axis] - expected[0][axis]) * .00001);
    if (actual[0][axis] < expected[0][axis] - tolerance || actual[1][axis] > expected[1][axis] + tolerance) return false;
    if (validation.boundsComplete && (Math.abs(actual[0][axis] - expected[0][axis]) > tolerance || Math.abs(actual[1][axis] - expected[1][axis]) > tolerance)) return false;
  }
  return validation.boundsComplete ? true : null;
}

function contextScore(path, record) {
  const actual = parents(path), expected = parents(record.old);
  let score = 0;
  for (let i = 1; i <= Math.min(actual.length, expected.length); i++) {
    if (actual.at(-i) !== expected.at(-i)) break;
    score += 2;
  }
  if (normalize(path) === normalize(record.old)) score += 10;
  return score;
}

function nameCandidates(file, path, index, validation) {
  const key = nameKey(file.name);
  let records = index.byName.get(key) ?? [];
  if (!records.length && basename(file.name).includes('__')) {
    // Recognize the common Chinese__English localization, without fuzzy guessing.
    const components = basename(file.name).split('__').map(normalize).filter(Boolean);
    const groups = components.map(part => index.byName.get(part) ?? []);
    const intersection = groups.reduce((a, b) => a.filter(item => b.some(other => other.id === item.id)));
    records = intersection.length ? intersection : [...new Map(groups.flat().map(record => [record.id, record])).values()];
  }
  return records.map(record => ({
    id: record.id, name: record.name ?? '', zh: record.zh ?? '',
    contextScore: contextScore(path, record), boundsMatch: compareBounds(validation, record),
    trianglesMatch: validation.triangles == null || !Number.isFinite(record.triangles) ? null : validation.triangles === record.triangles,
    sizeMatch: file.size === record.size,
  })).sort((a, b) => b.contextScore - a.contextScore || a.id.localeCompare(b.id));
}

/**
 * @param {Iterable<File>} files FileList or File[]; directories are metadata only.
 * @param {Array<{id:string,old?:string,name?:string,zh?:string,size?:number,fingerprint?:string,bbox?:number[][],triangles?:number}>} catalog
 * @param {{onProgress?:(event:object)=>void,maxFileBytes?:number,signal?:AbortSignal}} options
 * @returns {Promise<{matches:Map,unmatched:Array,conflicts:Array,invalid:Array,duplicates:Array,missing:string[]}>}
 *
 * matches values: {file,path,method:'fingerprint',fingerprint,validation,aliases,duplicateFiles}.
 * conflicts: {file,path,fingerprint,validation,files,reason,candidates,candidateIds,requiresConfirmation:true}.
 * Candidates never become automatic matches, even if names/bounds/context agree.
 * unmatched: {file,path,reason,...}; invalid: {file,path,reason,message}.
 * duplicates: {file,path,fingerprint,duplicateOf:{file,path},catalogIds,reason:'same-fingerprint'}.
 * missing is every catalog id without an automatic fingerprint match, in catalog order.
 * onProgress({processed,total,fileName,path,status,matched,conflicts,invalid}) runs initially
 * and after every input; callbacks and abort errors propagate. File failures are isolated.
 */
export async function scanFiles(files, catalog, { onProgress, maxFileBytes = MAX_FILE_BYTES, signal } = {}) {
  if (!globalThis.crypto?.subtle) throw new Error('WebCrypto is required; use localhost or HTTPS');
  if (!Number.isSafeInteger(maxFileBytes) || maxFileBytes <= 0) throw new TypeError('maxFileBytes must be a positive safe integer');
  const index = catalogIndex(catalog);
  const inputs = Array.from(files);
  const matches = new Map(), unmatched = [], conflicts = [], invalid = [], duplicates = [];
  const seen = new Map();
  let processed = 0;
  const report = (file, status) => onProgress?.({ processed, total: inputs.length, fileName: file?.name ?? '', path: file ? pathOf(file) : '', status, matched: matches.size, conflicts: conflicts.length, invalid: invalid.length });
  checkAbort(signal);
  report(null, 'scanning');
  for (const file of inputs) {
    checkAbort(signal);
    const path = pathOf(file ?? {});
    let status;
    try {
      if (!file || typeof file.name !== 'string' || typeof file.slice !== 'function' || !Number.isSafeInteger(file.size) || file.size < 0) {
        throw new FileIssue('invalid-file', 'Expected a File with a readable size and slice method');
      }
      if (!/\.stl$/i.test(file.name)) {
        unmatched.push({ file, path, reason: 'unsupported-extension' }); status = 'skipped';
      } else {
        if (file.size > maxFileBytes) throw new FileIssue('file-too-large', `File exceeds the ${maxFileBytes}-byte import limit`);
        if (!file.size) throw new FileIssue('empty-file', 'File is empty');
        const samples = await sampleFile(file, signal);
        const validation = await validateSTL(file, samples);
        const { fingerprint } = samples;
        const key = `${file.size}:${fingerprint}`;
        const previous = seen.get(key);
        if (previous) {
          previous.files.push(file);
          duplicates.push({ file, path, fingerprint, duplicateOf: { file: previous.file, path: previous.path }, catalogIds: previous.catalogIds.slice(), reason: 'same-fingerprint' });
          for (const id of previous.catalogIds) matches.get(id)?.duplicateFiles.push(file);
          status = 'duplicate';
          // An unknown duplicate can have a more informative localized filename.
          // Do not discard newly discovered candidates just because an arbitrary
          // renamed copy happened to occur first. This still grants no identity.
          if (!previous.catalogIds.length) {
            const candidates = nameCandidates(file, path, index, validation);
            const pending = conflicts.filter(item => item.fingerprint === fingerprint);
            const uncovered = candidates.some(candidate => !pending.some(item => item.candidateIds.includes(candidate.id)));
            if (uncovered) {
              const reason = candidates.length > 1 ? 'ambiguous-name' : candidates[0].boundsMatch === false || candidates[0].trianglesMatch === false ? 'geometry-mismatch' : 'name-only';
              conflicts.push({ file, path, fingerprint, validation, files: [file], reason, candidates, candidateIds: candidates.map(candidate => candidate.id), requiresConfirmation: true });
              status = 'conflict';
            }
          }
        } else {
          const entry = { file, path, fingerprint, validation, files: [file] };
          const hashed = index.byHash.get(fingerprint) ?? [];
          const verified = hashed.filter(record => record.size === file.size);
          const catalogIds = verified.map(record => record.id);
          seen.set(key, { ...entry, catalogIds });
          if (verified.length) {
            for (const id of catalogIds) matches.set(id, { file, path, method: 'fingerprint', fingerprint, validation, aliases: catalogIds.slice(), duplicateFiles: [] });
            status = 'matched';
          } else {
            const candidates = nameCandidates(file, path, index, validation);
            if (hashed.length || candidates.length) {
              const reason = hashed.length ? 'catalog-size-mismatch' : candidates.length > 1 ? 'ambiguous-name' : candidates[0].boundsMatch === false || candidates[0].trianglesMatch === false ? 'geometry-mismatch' : 'name-only';
              const candidateIds = hashed.length ? hashed.map(record => record.id) : candidates.map(candidate => candidate.id);
              conflicts.push({ ...entry, reason, candidates, candidateIds, requiresConfirmation: true });
              status = 'conflict';
            } else {
              unmatched.push({ ...entry, reason: 'no-candidate' }); status = 'unmatched';
            }
          }
        }
      }
    } catch (error) {
      checkAbort(signal);
      invalid.push({ file, path, reason: error instanceof FileIssue ? error.code : 'read-error', message: String(error?.message ?? error) }); status = 'invalid';
    }
    processed++; report(file, status);
    // Allow repaint, cancellation and progress updates between files. No bulk reads.
    await new Promise(resolve => setTimeout(resolve, 0));
  }
  checkAbort(signal);
  return { matches, unmatched, conflicts, invalid, duplicates, missing: [...index.ids].filter(id => !matches.has(id)) };
}
