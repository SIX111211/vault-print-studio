/**
 * Local, bounded-memory STL import. No network or persistent-storage access.
 * Fingerprint = SHA256(UTF8(`${size}:`) + first min(65536,size) bytes
 *                                      + last min(65536,size) bytes).
 * This legacy sample signature is only authoritative for legacy catalogues.
 * Production catalogues use complete content signatures then full geometry.
 * Large meshes receive structural + sampled facet validation, not a full audit.
 */
import { analyzeSTLGeometry } from './geometry-signature.js';

export const MAX_FILE_BYTES = 512 * 1024 * 1024;
export const SAMPLE_BYTES = 65536;
const CONTENT_CHUNK_BYTES = 1024 * 1024;

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

// Every byte participates. Chunk digests keep native WebCrypto fast without
// allocating an entire large STL. This v1 signature includes size and order.
export async function contentSignature(file, {signal, onProgress} = {}) {
  const prefix = encoder.encode(`vault:stl-content:v1:${file.size}:`);
  const combined = new Uint8Array(prefix.length + Math.ceil(file.size / CONTENT_CHUNK_BYTES) * 32);
  combined.set(prefix);
  const batchBytes=CONTENT_CHUNK_BYTES*8;
  for (let start = 0; start < file.size; start += batchBytes) {
    checkAbort(signal);
    const offsets=Array.from({length:Math.min(8,Math.ceil((file.size-start)/CONTENT_CHUNK_BYTES))},(_,i)=>start+i*CONTENT_CHUNK_BYTES);
    const digests=await Promise.all(offsets.map(async offset=>{
      const end=Math.min(file.size,offset+CONTENT_CHUNK_BYTES),bytes=await file.slice(offset,end).arrayBuffer();
      if(bytes.byteLength!==end-offset)throw new FileIssue('read-error','Incomplete content read');
      checkAbort(signal);return new Uint8Array(await crypto.subtle.digest('SHA-256',bytes));
    }));
    digests.forEach((digest,i)=>combined.set(digest,prefix.length+(start/CONTENT_CHUNK_BYTES+i)*32));
    checkAbort(signal);onProgress?.(Math.min(file.size,start+batchBytes)/file.size);
  }
  const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', combined));
  checkAbort(signal);
  return [...digest].map(byte => byte.toString(16).padStart(2, '0')).join('');
}
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
  const ids = new Set(), byHash = new Map(), byName = new Map(), byGeometry = new Map(), byContent = new Map();
  for (const record of catalog) {
    if (!record || typeof record.id !== 'string' || !record.id || ids.has(record.id)) {
      throw new TypeError('Each catalog record must have a unique, non-empty string id');
    }
    ids.add(record.id);
    for(const version of [record,...(record.variants||[]).map(variant=>({...record,...variant,variant}))]){
      if (/^[a-f0-9]{64}$/.test(version.contentSignature ?? '')) {
        if (!byContent.has(version.contentSignature)) byContent.set(version.contentSignature, []);
        byContent.get(version.contentSignature).push(version);
      }
      if (/^[a-f0-9]{64}$/.test(version.geometrySignature ?? '')) {
        if (!byGeometry.has(version.geometrySignature)) byGeometry.set(version.geometrySignature, []);
        byGeometry.get(version.geometrySignature).push(version);
      }
    }
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
  return { ids, byHash, byName, byGeometry, byContent, records: catalog };
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

// Bounds locate possible versions, never establish identity. Full geometry is
// needed even when filename, dimensions and triangle count all happen to agree.
function geometryCandidates(index, geometry) {
  const extent = geometry.bbox[1].map((n, i) => n - geometry.bbox[0][i]);
  return index.records.flatMap(record => {
    const bbox = catalogBounds(record);
    if (!bbox) return [];
    const expected = bbox[1].map((n, i) => n - bbox[0][i]);
    if (!extent.every((n, i) => Math.abs(n - expected[i]) <= Math.max(.05, expected[i] * .001))) return [];
    const boundsMatch = compareBounds({bbox: geometry.bbox, boundsComplete: true}, record);
    const area = record.geometryArea;
    const areaDifference = area > 0 ? Math.abs(geometry.surfaceArea - area) / area : null;
    return [{id:record.id, name:record.name ?? '', zh:record.zh ?? '', boundsMatch,
      trianglesMatch: geometry.triangles === record.triangles, areaDifference,
      sizeMatch:null, contextScore:0, evidence:'dimensions-only'}];
  }).sort((a,b) => Number(b.boundsMatch) - Number(a.boundsMatch) ||
    (a.areaDifference ?? Infinity) - (b.areaDifference ?? Infinity) || a.id.localeCompare(b.id));
}

/**
 * @param {Iterable<File>} files FileList or File[]; directories are metadata only.
 * @param {Array<{id:string,old?:string,name?:string,zh?:string,size?:number,fingerprint?:string,bbox?:number[][],triangles?:number}>} catalog
 * @param {{onProgress?:(event:object)=>void,maxFileBytes?:number,signal?:AbortSignal}} options
 * @returns {Promise<{matches:Map,unmatched:Array,conflicts:Array,invalid:Array,duplicates:Array,missing:string[]}>}
 *
 * matches values: {file,path,method:'content'|'geometry'|'fingerprint',fingerprint,validation,aliases,duplicateFiles}.
 * conflicts: {file,path,fingerprint,validation,files,reason,candidates,candidateIds,requiresConfirmation:true}.
 * Candidates never become automatic matches, even if names/bounds/context agree.
 * unmatched: {file,path,reason,...}; invalid: {file,path,reason,message}.
 * duplicates: {file,path,fingerprint,duplicateOf:{file,path},catalogIds,reason:'same-fingerprint'}.
 * missing is every catalog id without an automatic content/geometry match, in catalog order.
 * onProgress({processed,total,fileName,path,status,matched,conflicts,invalid}) runs initially
 * and after every input; callbacks and abort errors propagate. File failures are isolated.
 */
export async function scanFiles(files, catalog, { onProgress, maxFileBytes = MAX_FILE_BYTES, signal } = {}) {
  if (!globalThis.crypto?.subtle) throw new Error('WebCrypto is required; use localhost or HTTPS');
  if (!Number.isSafeInteger(maxFileBytes) || maxFileBytes <= 0) throw new TypeError('maxFileBytes must be a positive safe integer');
  const index = catalogIndex(catalog);
  const inputs = Array.from(files);
  const matches = new Map(), unmatched = [], conflicts = [], invalid = [], duplicates = [];
  const seen = new Map(), seenGeometry = new Map();
  let processed = 0, progressError;
  const report = (file, status, extra = {}) => {
    try { onProgress?.({ processed, total: inputs.length, fileName: file?.name ?? '', path: file ? pathOf(file) : '', status, matched: matches.size, conflicts: conflicts.length, invalid: invalid.length, ...extra }); }
    catch (error) { progressError = error; throw error; }
  };
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
      if (/\.stl$/i.test(file.name) && file.size > maxFileBytes) throw new FileIssue('file-too-large', `File exceeds the ${maxFileBytes}-byte import limit`);
      const metadataHint = file.name.startsWith('._') || path.split('/').includes('__MACOSX');
      const prefix = metadataHint && file.size >= 4 ? new Uint8Array(await file.slice(0, 4).arrayBuffer()) : [];
      const appleMetadata = prefix.length === 4 && prefix[0] === 0 && prefix[1] === 5 && prefix[2] === 22 && (prefix[3] === 7 || prefix[3] === 0);
      if (appleMetadata) {
        unmatched.push({file, path, reason:'system-metadata'}); status = 'skipped';
      } else if (!/\.stl$/i.test(file.name)) {
        unmatched.push({ file, path, reason: 'unsupported-extension' }); status = 'skipped';
      } else {
        if (file.size > maxFileBytes) throw new FileIssue('file-too-large', `File exceeds the ${maxFileBytes}-byte import limit`);
        if (!file.size) throw new FileIssue('empty-file', 'File is empty');
        const samples = await sampleFile(file, signal);
        const content = index.byContent.size ? await contentSignature(file, {signal,onProgress:fraction=>report(file,'content',{fileProgress:fraction})}) : null;
        const contentVersions=content?(index.byContent.get(content)||[]).filter(record=>record.size===file.size):[];
        const reviewVersions=contentVersions.filter(record=>record.variant?.requiresConfirmation);
        const fullKnown = contentVersions.filter(record=>!record.variant?.requiresConfirmation);
        const legacy = !index.byGeometry.size && !index.byContent.size;
        // A complete byte identity inherits the audited geometry metadata; normal
        // encodings and ASCII case must not reintroduce legacy parser restrictions.
        let validation = fullKnown.length&&catalogBounds(fullKnown[0]) ? {
          format:file.size>=84&&84+new DataView(samples.head.buffer,samples.head.byteOffset,samples.head.byteLength).getUint32(80,true)*50===file.size?'binary':'ascii',
          bbox:catalogBounds(fullKnown[0]),triangles:fullKnown[0].triangles,
          inspectedTriangles:0,boundsComplete:true,scope:'catalog-content-verified'
        } : legacy ? await validateSTL(file,samples) : null;
        const { fingerprint } = samples;
        const key = content ? `content:${content}` : legacy ? `${file.size}:${fingerprint}` : file;
        const previous = seen.get(key);
        if (previous) {
          validation = previous.validation;
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
          let verified = fullKnown.length ? fullKnown : legacy ? hashed.filter(record => record.size === file.size) : [];
          let geometry = null;
          if (!verified.length && !legacy) {
            report(file, 'geometry', {fileProgress:0});
            geometry = await analyzeSTLGeometry(file, {signal, onProgress:p => {
              const fraction = typeof p === 'number' ? p : p.fraction ?? (p.totalBytes ? p.bytesRead / p.totalBytes : p.total ? p.processed / p.total : 0);
              report(file, 'geometry', {fileProgress:Math.max(0, Math.min(1, fraction || 0))});
            }});
            validation = {...validation, format:geometry.format, bbox:geometry.bbox,
              triangles:geometry.triangles, inspectedTriangles:geometry.triangles,
              boundsComplete:true, scope:'complete'};
            const geometryVersions=(index.byGeometry.get(geometry.signature) ?? []).filter(record => record.triangles === geometry.triangles && compareBounds(validation, record) === true);
            verified = geometryVersions.filter(record=>!record.variant?.requiresConfirmation);
            reviewVersions.push(...geometryVersions.filter(record=>record.variant?.requiresConfirmation));
          }
          if (verified.length && verified[0].geometrySignature) {
            const first = verified[0], bounds = JSON.stringify(catalogBounds(first));
            verified = (index.byGeometry.get(first.geometrySignature) ?? verified).filter(record =>
              !record.variant?.requiresConfirmation&&record.triangles === first.triangles && JSON.stringify(catalogBounds(record)) === bounds);
          }
          const catalogIds = verified.map(record => record.id);
          entry.validation = validation;
          if (geometry) entry.geometry = geometry;
          seen.set(key, { ...entry, catalogIds });
          if (verified.length) {
            const identity = geometry?.signature || verified[0].geometrySignature;
            const duplicate = identity && seenGeometry.get(identity);
            if (duplicate) {
              duplicates.push({file,path,fingerprint,duplicateOf:{file:duplicate.file,path:duplicate.path},catalogIds,reason:'same-geometry'});
              for (const id of catalogIds) matches.get(id)?.duplicateFiles.push(file);
            } else {
              for (const version of verified) {
                const id=version.id,existing=matches.get(id);
                // Prefer the baseline when a folder contains both exports of one part.
                if(existing&&!existing.variant&&version.variant)continue;
                matches.set(id, { file, path, method: geometry ? 'geometry' : content ? 'content' : 'fingerprint', fingerprint, validation, variant:version.variant||null, geometrySignature:identity, aliases: catalogIds.slice(), duplicateFiles: [] });
              }
              if (identity) seenGeometry.set(identity,{file,path});
            }
            status = 'matched';
          } else {
            const shaped = geometry ? geometryCandidates(index, geometry) : [];
            const named = nameCandidates(file, path, index, validation);
            const reviewed=reviewVersions.map(r=>({id:r.id,name:r.name,zh:r.zh,boundsMatch:false,trianglesMatch:false,contextScore:0,evidence:'unverified-version'}));
            const candidates = [...new Map([...shaped, ...named,...reviewed].map(c => [c.id, c])).values()];
            if (hashed.length || candidates.length) {
              const reason = shaped.length||reviewed.length ? 'geometry-version' : hashed.length ? 'catalog-size-mismatch' : candidates.length > 1 ? 'ambiguous-name' : candidates[0].boundsMatch === false || candidates[0].trianglesMatch === false ? 'geometry-mismatch' : 'name-only';
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
      if (error === progressError) throw error;
      checkAbort(signal);
      invalid.push({ file, path, reason: error.code || 'read-error', message: String(error?.message ?? error) }); status = 'invalid';
    }
    processed++; report(file, status);
    // Allow repaint, cancellation and progress updates between files. No bulk reads.
    await new Promise(resolve => setTimeout(resolve, 0));
  }
  checkAbort(signal);
  const metadataCount = unmatched.filter(x => x.reason === 'system-metadata').length;
  const stlCount = inputs.filter(file => /\.stl$/i.test(file?.name || '')).length - unmatched.filter(x => x.reason === 'system-metadata' && /\.stl$/i.test(x.file.name)).length;
  const archiveCount = inputs.filter(file => /\.(?:zip|rar|7z)$/i.test(file?.name || '')).length;
  return { matches, unmatched, conflicts, invalid, duplicates, missing: [...index.ids].filter(id => !matches.has(id)),
    diagnostics:{total:inputs.length, stlCount, metadataCount, archiveCount,
      emptyReason:stlCount ? null : metadataCount ? 'macos-metadata' : archiveCount ? 'archive-only' : 'no-stl'} };
}
