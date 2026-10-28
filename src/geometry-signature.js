/**
 * Content identity for STL triangle multisets, version f32-multiset-v1.
 *
 * API: analyzeSTLGeometry(Blob-like, {signal?, onProgress?}) -> Promise<{
 *   signature: lowercase SHA-256 hex, triangles, bbox: [minXYZ, maxXYZ],
 *   surfaceArea, format: 'binary' | 'ascii'
 * }>.
 * onProgress receives {bytesRead, totalBytes, triangles, format}; bytesRead is
 * the consumed file offset, not cumulative I/O. Callbacks are synchronous;
 * exceptions propagate. AbortSignal.reason is propagated (AbortError by default).
 *
 * Only vertices contribute to identity: Number -> Float32, with -0 -> +0.
 * Absolute position, scale, orientation and duplicate multiplicity are retained.
 * Vertices within each triangle are sorted by their unsigned Float32 bit triples.
 * Eight seeded Murmur3-style 32-bit lanes hash those nine words; the resulting
 * 256-bit integers are summed modulo 2^256, then SHA-256 hashes a version domain,
 * triangle count and sum. This is a fast accidental-match catalogue signature,
 * NOT an adversarial integrity guarantee. SHA-256 cannot repair inner collisions.
 * Retriangulation changes identity even if the represented surface is identical.
 *
 * Binary count/length equality wins even for a header beginning with 'solid'.
 * All binary normal bits (including NaN/Infinity), attributes and header are
 * ignored. ASCII uses the complete solid/facet/normal/outer-loop/three-vertex/
 * endloop/endfacet/endsolid grammar. Keywords are case-insensitive; body tokens
 * can span lines. Opening/closing solid labels extend to CR/LF and are ignored,
 * need not match, and are never retained. One solid only, no trailing content.
 * ASCII normals accept decimal numbers and signed NaN/Inf/Infinity, including
 * overflow, because normals are not geometry. Vertices must be decimal numbers
 * finite both before and after Float32 conversion. An initial UTF-8 BOM is
 * accepted; body tokens must be 7-bit ASCII with standard ASCII whitespace.
 * Ignored solid labels may contain non-ASCII bytes (e.g. UTF-8 Chinese names),
 * but reject NUL and ASCII controls other than tab and their CR/LF terminator.
 * Tokens are limited to 256 bytes; solid-label length is unlimited and streamed.
 * Empty meshes are rejected; finite degenerate triangles are permitted.
 *
 * Max file size: 512 MiB. Reads are <= 1 MiB; memory is O(1) in facet count
 * (one slice, one triangle and fixed hash state, no retained mesh/token arrays).
 * Work yields to the host around every 12 ms, checked every 2,048 binary facets
 * or 16 KiB of ASCII, plus an initial yield. A pending slice read cannot itself
 * be interrupted; cancellation is checked before/after reads, yields and digest.
 * bbox and compensated surfaceArea use the same Float32-normalized vertices;
 * area is in source-units squared and may differ by floating-point roundoff
 * between triangle orders. No manifoldness, watertightness or topology claims.
 */

const MAX_BYTES = 512 * 1024 * 1024;
const SLICE_BYTES = 1024 * 1024;
const BINARY_BATCH = 2048;
const ASCII_BATCH = 16384;
const YIELD_MS = 12;
const NUMBER = /^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?$/;
const SPECIAL_NORMAL = /^[+-]?(?:nan|inf(?:inity)?)$/i;
const DOMAIN = new TextEncoder().encode('vault-print-studio:stl-geometry:f32-multiset-v1\0');
const SEEDS = new Uint32Array([
  0x243f6a88, 0x85a308d3, 0x13198a2e, 0x03707344,
  0xa4093822, 0x299f31d0, 0x082efa98, 0xec4e6c89,
]);
// null = ignored normal, axis index = vertex coordinate.
const FACET = [
  'normal', null, null, null, 'outer', 'loop',
  'vertex', 0, 1, 2, 'vertex', 3, 4, 5, 'vertex', 6, 7, 8,
  'endloop', 'endfacet',
];

function issue(code, message) {
  const error = new Error(message);
  error.code = code;
  return error;
}

function checkAbort(signal) {
  if (signal?.aborted) {
    throw signal.reason === undefined ? new DOMException('STL analysis aborted', 'AbortError') : signal.reason;
  }
}

const hostYield = () => new Promise(resolve => setTimeout(resolve, 0));

function geometryTracker() {
  const vertices = new Float32Array(9);
  const words = new Uint32Array(vertices.buffer);
  const lanes = new Uint32Array(8);
  const sum = new Uint32Array(8);
  const min = [Infinity, Infinity, Infinity];
  const max = [-Infinity, -Infinity, -Infinity];
  let triangles = 0, surfaceArea = 0, compensation = 0;

  function sortPair(a, b) {
    let compare = 0;
    for (let axis = 0; axis < 3; axis++) {
      if (words[a + axis] !== words[b + axis]) {
        compare = words[a + axis] > words[b + axis] ? 1 : -1;
        break;
      }
    }
    if (compare > 0) {
      for (let axis = 0; axis < 3; axis++) {
        const temp = words[a + axis];
        words[a + axis] = words[b + axis];
        words[b + axis] = temp;
      }
    }
  }

  function add() {
    for (let i = 0; i < 9; i++) {
      const value = vertices[i];
      if (!Number.isFinite(value)) {
        throw issue('non-finite-coordinate', 'STL vertex is non-finite after Float32 conversion');
      }
      if (value === 0) words[i] = 0;
      const axis = i % 3;
      const coordinate = vertices[i];
      if (coordinate < min[axis]) min[axis] = coordinate;
      if (coordinate > max[axis]) max[axis] = coordinate;
    }
    sortPair(0, 3); sortPair(3, 6); sortPair(0, 3);

    const ax = vertices[3] - vertices[0], ay = vertices[4] - vertices[1], az = vertices[5] - vertices[2];
    const bx = vertices[6] - vertices[0], by = vertices[7] - vertices[1], bz = vertices[8] - vertices[2];
    const area = Math.hypot(ay * bz - az * by, az * bx - ax * bz, ax * by - ay * bx) / 2;
    const corrected = area - compensation;
    const next = surfaceArea + corrected;
    compensation = (next - surfaceArea) - corrected;
    surfaceArea = next;

    lanes.set(SEEDS);
    for (let i = 0; i < 9; i++) {
      let k = Math.imul(words[i], 0xcc9e2d51);
      k = (k << 15) | (k >>> 17);
      k = Math.imul(k, 0x1b873593);
      for (let lane = 0; lane < 8; lane++) {
        let h = lanes[lane] ^ k;
        h = (h << 13) | (h >>> 19);
        lanes[lane] = (Math.imul(h, 5) + 0xe6546b64) >>> 0;
      }
    }
    let carry = 0;
    for (let lane = 0; lane < 8; lane++) {
      let h = lanes[lane] ^ 36;
      h ^= h >>> 16;
      h = Math.imul(h, 0x85ebca6b);
      h ^= h >>> 13;
      h = Math.imul(h, 0xc2b2ae35);
      h ^= h >>> 16;
      const total = sum[lane] + (h >>> 0) + carry;
      sum[lane] = total >>> 0;
      carry = total >= 0x100000000 ? 1 : 0;
    }
    triangles++;
  }

  return {
    vertices, add,
    get triangles() { return triangles; },
    result() { return {triangles, bbox: [min, max], surfaceArea}; },
    digestInput() {
      const bytes = new Uint8Array(DOMAIN.length + 4 + 32);
      bytes.set(DOMAIN);
      const view = new DataView(bytes.buffer);
      view.setUint32(DOMAIN.length, triangles, true);
      for (let i = 0; i < 8; i++) view.setUint32(DOMAIN.length + 4 + 4 * i, sum[i], true);
      return bytes;
    },
  };
}

function asciiParser(tracker) {
  let state = 'opening', token = '', step = 0;
  const invalid = message => { throw issue('invalid-ascii', message); };

  function accept(value) {
    if (state === 'opening') {
      if (value.toLowerCase() !== 'solid') invalid('Expected ASCII STL solid header (or binary length is incorrect)');
      state = 'opening-label';
    } else if (state === 'between') {
      const keyword = value.toLowerCase();
      if (keyword === 'facet') { state = 'facet'; step = 0; }
      else if (keyword === 'endsolid') state = 'closing-label';
      else invalid('Expected facet or endsolid');
    } else if (state === 'facet') {
      const expected = FACET[step];
      if (typeof expected === 'string') {
        if (value.toLowerCase() !== expected) invalid(`Expected ${expected} in ASCII STL facet`);
      } else if (expected === null) {
        if (!NUMBER.test(value) && !SPECIAL_NORMAL.test(value)) invalid('Invalid ASCII STL normal number');
      } else {
        if (!NUMBER.test(value)) invalid('Invalid ASCII STL vertex number');
        const number = Number(value);
        if (!Number.isFinite(number)) throw issue('non-finite-coordinate', 'STL vertex is non-finite');
        tracker.vertices[expected] = number;
      }
      if (++step === FACET.length) { tracker.add(); state = 'between'; }
    } else invalid('Unexpected content after endsolid');
  }

  return {
    consume(bytes, start, end) {
      for (let i = start; i < end; i++) {
        const code = bytes[i];
        const newline = code === 10 || code === 13;
        const whitespace = code === 32 || (code >= 9 && code <= 13);
        if (state === 'opening-label' || state === 'closing-label') {
          if (newline) state = state === 'opening-label' ? 'between' : 'done';
          else if ((code < 32 && code !== 9) || code === 127) invalid('Invalid control byte in ASCII STL label');
          continue;
        }
        if (code > 126 || (code < 32 && !whitespace)) invalid('Invalid byte in ASCII STL');
        if (whitespace) {
          if (token) { accept(token); token = ''; }
          if (newline && state === 'opening-label') state = 'between';
          else if (newline && state === 'closing-label') state = 'done';
          else if ((state === 'opening-label' || state === 'closing-label') && (code === 11 || code === 12)) {
            invalid('Invalid control byte in ASCII STL label');
          }
        } else {
          if (state === 'done') invalid('Unexpected content after endsolid');
          if (token.length >= 256) invalid('ASCII STL token exceeds 256 bytes');
          token += String.fromCharCode(code);
        }
      }
    },
    finish() {
      if (token) accept(token);
      if (state !== 'done' && state !== 'closing-label') invalid('Truncated ASCII STL or missing endsolid');
    },
  };
}

export async function analyzeSTLGeometry(file, {signal, onProgress} = {}) {
  checkAbort(signal);
  const size = file?.size;
  if (!Number.isSafeInteger(size) || size < 0 || typeof file?.slice !== 'function') {
    throw new TypeError('Expected a Blob-like STL file with integer size and slice().arrayBuffer()');
  }
  if (size > MAX_BYTES) throw issue('file-too-large', 'STL exceeds the 512 MiB limit');
  if (size === 0) throw issue('empty-stl', 'STL has no triangles');
  if (onProgress !== undefined && typeof onProgress !== 'function') throw new TypeError('onProgress must be a function');
  const read = async (start, end) => {
    checkAbort(signal);
    const buffer = await file.slice(start, end).arrayBuffer();
    checkAbort(signal);
    if (!(buffer instanceof ArrayBuffer) || buffer.byteLength !== end - start) {
      throw issue('read-error', 'Incomplete STL slice read');
    }
    return new Uint8Array(buffer);
  };

  const header = await read(0, Math.min(84, size));
  const count = size >= 84 ? new DataView(header.buffer).getUint32(80, true) : 0;
  const format = size >= 84 && 84 + count * 50 === size ? 'binary' : 'ascii';
  if (format === 'binary' && !count) throw issue('empty-stl', 'STL has no triangles');
  const tracker = geometryTracker();
  const progress = bytesRead => {
    checkAbort(signal);
    onProgress?.({bytesRead, totalBytes: size, triangles: tracker.triangles, format});
    checkAbort(signal);
  };
  let yieldedAt = performance.now();
  async function checkpoint(bytesRead) {
    checkAbort(signal);
    if (performance.now() - yieldedAt >= YIELD_MS) {
      progress(bytesRead);
      await hostYield();
      checkAbort(signal);
      yieldedAt = performance.now();
    }
  }
  progress(0);
  await hostYield();
  checkAbort(signal);
  yieldedAt = performance.now();

  if (format === 'binary') {
    const facetsPerSlice = Math.floor(SLICE_BYTES / 50);
    for (let first = 0; first < count; first += facetsPerSlice) {
      const last = Math.min(count, first + facetsPerSlice);
      const offset = 84 + first * 50;
      const bytes = await read(offset, 84 + last * 50);
      const view = new DataView(bytes.buffer);
      for (let batch = 0; batch < last - first; batch += BINARY_BATCH) {
        const end = Math.min(last - first, batch + BINARY_BATCH);
        for (let i = batch; i < end; i++) {
          for (let axis = 0; axis < 9; axis++) tracker.vertices[axis] = view.getFloat32(i * 50 + 12 + axis * 4, true);
          tracker.add();
        }
        await checkpoint(offset + end * 50);
      }
      progress(84 + last * 50);
    }
  } else {
    const parser = asciiParser(tracker);
    const bom = header[0] === 0xef && header[1] === 0xbb && header[2] === 0xbf;
    for (let offset = bom ? 3 : 0; offset < size; offset += SLICE_BYTES) {
      const bytes = await read(offset, Math.min(size, offset + SLICE_BYTES));
      for (let batch = 0; batch < bytes.length; batch += ASCII_BATCH) {
        const end = Math.min(bytes.length, batch + ASCII_BATCH);
        parser.consume(bytes, batch, end);
        await checkpoint(offset + end);
      }
      progress(offset + bytes.length);
    }
    parser.finish();
  }
  if (!tracker.triangles) throw issue('empty-stl', 'STL has no triangles');
  checkAbort(signal);
  if (!globalThis.crypto?.subtle) throw new Error('Web Crypto SHA-256 is unavailable');
  const digest = await globalThis.crypto.subtle.digest('SHA-256', tracker.digestInput());
  checkAbort(signal);
  const signature = Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, '0')).join('');
  progress(size);
  return {signature, ...tracker.result(), format};
}
