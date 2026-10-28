import test from 'node:test';
import assert from 'node:assert/strict';
import {partitionMesh} from '../src/partition-mesh.js';

// Procedural test primitives only; no source-model coordinates or geometry.
const I = [[1, 0, 0], [0, 1, 0], [0, 0, 1]];
function tetra(center = [0, 0, 0], scale = 1, transform = p => p) {
  const vertices = [[1, 1, 1], [1, -1, -1], [-1, 1, -1], [-1, -1, 1]]
    .map(p => transform(p.map(x => x * scale)).map((x, a) => x + center[a]));
  return new Float32Array([[0, 2, 1], [0, 1, 3], [0, 3, 2], [1, 2, 3]]
    .flatMap(face => face.flatMap(i => vertices[i])));
}
const join = (...arrays) => new Float32Array(arrays.flatMap(a => [...a]));
function frame(raw, rotation = I) {
  const lo = [Infinity, Infinity, Infinity], hi = [-Infinity, -Infinity, -Infinity];
  for (let i = 0; i < raw.length; i++) { const a = i % 3; lo[a] = Math.min(lo[a], raw[i]); hi[a] = Math.max(hi[a], raw[i]); }
  const origin = lo.map((x, a) => (x + hi[a]) / 2);
  const min = [Infinity, Infinity, Infinity], max = [-Infinity, -Infinity, -Infinity];
  for (let i = 0; i < raw.length; i += 3) for (let a = 0; a < 3; a++) {
    const q = rotation[a].reduce((s, x, j) => s + x * (raw[i + j] - origin[j]), 0);
    min[a] = Math.min(min[a], q); max[a] = Math.max(max[a], q);
  }
  return {rotation: structuredClone(rotation), origin, min, max};
}
function triangleMultiset(parts) {
  const map = new Map();
  for (const p of parts) for (let i = 0; i < p.length; i += 9) {
    const key = Buffer.from(p.buffer, p.byteOffset + i * 4, 36).toString('hex');
    map.set(key, (map.get(key) || 0) + 1);
  }
  return [...map].sort(([a], [b]) => a.localeCompare(b));
}
function intact(raw, result) {
  assert.deepEqual(triangleMultiset(result.parts), triangleMultiset([raw]));
  assert.equal(result.diagnostic.returnedTriangles, raw.length / 9);
  if (!result.resolved) { assert.equal(result.parts.length, 1); assert.equal(result.parts[0], raw); }
}

test('paired objects map to frame order, not triangle traversal order', () => {
  const a = tetra(), b = tetra([7, 0, 0]);
  const raw = join(b, a), frames = [frame(a), frame(b)];
  const snapshot = new Uint8Array(raw.buffer).slice(), frameSnapshot = structuredClone(frames);
  const result = partitionMesh(raw, frames);
  assert.equal(result.resolved, true); assert.equal(result.diagnostic.componentCount, 2);
  assert.deepEqual(result.parts[0], a); assert.deepEqual(result.parts[1], b);
  assert.deepEqual(new Uint8Array(raw.buffer), snapshot); assert.deepEqual(frames, frameSnapshot);
  intact(raw, result);
});

test('interleaved triangles and duplicate faces are neither lost nor duplicated', () => {
  const a = tetra(), b = tetra([7, 0, 0]);
  const triangles = [];
  for (let i = 3; i >= 0; i--) triangles.push(a.subarray(i * 9, i * 9 + 9), b.subarray(i * 9, i * 9 + 9));
  const raw = join(...triangles, a.subarray(0, 9));
  const result = partitionMesh(raw, [frame(b), frame(a)]);
  assert.equal(result.resolved, true); assert.deepEqual(result.parts.map(p => p.length / 9), [4, 5]);
  intact(raw, result);
});

test('four slots use confident one-to-one assignments', () => {
  const pieces = [[0, 0, 0], [8, 0, 0], [0, 8, 0], [8, 8, 0]].map(c => tetra(c));
  const raw = join(pieces[3], pieces[0], pieces[2], pieces[1]);
  const result = partitionMesh(raw, pieces.map(p => frame(p)));
  assert.equal(result.resolved, true); result.parts.forEach((p, i) => assert.deepEqual(p, pieces[i]));
  assert.deepEqual(result.diagnostic.assignment.map(x => x.frame), [0, 1, 2, 3]);
  intact(raw, result);
});

test('overlapping component boxes do not merge disconnected geometry', () => {
  const skew = ([x, y, z]) => [10 * x + .1 * y, 10 * x - .1 * y, .1 * z];
  const a = tetra([0, 0, 0], 1, skew), b = tetra([0, 3, 0], 1, skew);
  const result = partitionMesh(join(a, b), [frame(a), frame(b)]);
  assert.equal(result.resolved, true); assert.deepEqual(result.parts, [a, b]);
});

test('rotated frames and small reference-bound differences preserve original coordinates', () => {
  const a = tetra(), b = tetra([8, 0, 0]);
  const rotation = [[0, -1, 0], [1, 0, 0], [0, 0, 1]];
  const frames = [frame(a, rotation), frame(b, rotation)];
  frames[0].origin[0] += .2; frames[1].max[0] += .3;
  const raw = join(b, a), result = partitionMesh(raw, frames);
  assert.equal(result.resolved, true); assert.deepEqual(result.parts, [a, b]); intact(raw, result);
});

test('extra tiny shells cause intact fallback instead of deletion or guessed grouping', () => {
  const a = tetra(), b = tetra([8, 0, 0]), tiny = tetra([20, 0, 0], .001);
  const raw = join(a, b, tiny), result = partitionMesh(raw, [frame(a), frame(b)]);
  assert.equal(result.resolved, false); assert.equal(result.diagnostic.reason, 'component-count-mismatch');
  assert.equal(result.diagnostic.componentCount, 3); intact(raw, result);
});

test('shared exact vertices connect, while nearly coincident vertices are not welded', () => {
  const a = tetra(), touching = tetra([2, 2, 0]), separate = tetra([2, 2, .00001]);
  const raw = join(a, touching), result = partitionMesh(raw, [frame(a), frame(touching)]);
  assert.equal(result.resolved, false); assert.equal(result.diagnostic.componentCount, 1); intact(raw, result);
  const separatedRaw = join(a, separate), split = partitionMesh(separatedRaw, [frame(a), frame(separate)]);
  assert.equal(split.resolved, true); intact(separatedRaw, split);
});

test('ambiguous frames never receive a forced permutation', () => {
  const a = tetra([-.2, 0, 0], .05), b = tetra([.2, 0, 0], .05);
  const f = {rotation: I, origin: [0, 0, 0], min: [-.3, -.3, -.3], max: [.3, .3, .3]};
  const raw = join(a, b), result = partitionMesh(raw, [f, structuredClone(f)]);
  assert.equal(result.resolved, false); assert.equal(result.diagnostic.reason, 'ambiguous-frame'); intact(raw, result);
});

test('same centers with wrong bounds, and shifted source geometry, fail signature checks', () => {
  const a = tetra(), b = tetra([8, 0, 0]), raw = join(a, b), frames = [frame(a), frame(b)];
  frames[0].min[0] -= 2;
  const wrongBounds = partitionMesh(raw, frames);
  assert.equal(wrongBounds.resolved, false); assert.equal(wrongBounds.diagnostic.reason, 'frame-signature-mismatch'); intact(raw, wrongBounds);
  const shifted = join(tetra([20, 0, 0]), tetra([28, 0, 0]));
  const moved = partitionMesh(shifted, [frame(a), frame(b)]);
  assert.equal(moved.resolved, false); intact(shifted, moved);
});

test('single frames still enforce component counts; degenerate input is retained', () => {
  const a = tetra(); assert.equal(partitionMesh(a, [frame(a)]).resolved, true);
  const raw = join(a, tetra([8, 0, 0])), mismatch = partitionMesh(raw, [frame(a)]);
  assert.equal(mismatch.resolved, false); intact(raw, mismatch);
  const zero = new Float32Array(9), degenerate = partitionMesh(zero, [frame(zero)]);
  assert.equal(degenerate.resolved, false); assert.equal(degenerate.diagnostic.reason, 'degenerate-component'); intact(zero, degenerate);
});

test('invalid frames and resource bounds return the original file; malformed raw input throws', () => {
  const raw = tetra(), bad = frame(raw); bad.rotation[0][0] = 2;
  for (const frames of [[], null, [bad], Array.from({length: 33}, () => frame(raw))]) {
    const result = partitionMesh(raw, frames); assert.equal(result.resolved, false); intact(raw, result);
  }
  for (const value of [[], new Float32Array(0), new Float32Array(8), new Float32Array([NaN, ...Array(8).fill(0)])]) {
    assert.throws(() => partitionMesh(value, []), TypeError);
  }
});
