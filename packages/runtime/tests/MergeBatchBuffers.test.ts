import { expect, test } from 'node-test';
import { mergeBatchBuffers } from '../src/batching/mergeBatchBuffers.js';
import type { ICEBatchWorkerSource } from '../src/batching/ICEBatchWorkerProtocol.js';

const source = (
  id: string,
  semantic: number,
  materialKey = 'material:0',
): ICEBatchWorkerSource => ({
  id,
  materialKey,
  positions: new Float32Array([
    0, 0, 0,
    1, 0, 0,
    0, 1, 0,
  ]).buffer,
  indices: new Uint32Array([0, 1, 2]).buffer,
  semanticIndices: new Uint32Array([0, 0, 0]).buffer,
  semanticIds: [`semantic:${semantic}`],
  semanticNodeIds: [`node:${semantic}`],
  semanticSelectionIds: [`device:${semantic}`],
});

test('merges compatible batch buffers deterministically', () => {
  const merged = mergeBatchBuffers([
    source('batch:1', 1),
    source('batch:0', 0),
  ]);

  expect(merged).toHaveLength(1);
  expect([...merged[0]!.indices]).toEqual([0, 1, 2, 3, 4, 5]);
  expect([...merged[0]!.semanticIndices]).toEqual([0, 0, 0, 1, 1, 1]);
  expect(merged[0]!.semanticSelectionIds).toEqual(['device:0', 'device:1']);
  expect(merged[0]!.triangleCount).toBe(2);
});

test('splits merged geometry by triangle and byte limits', () => {
  const merged = mergeBatchBuffers(
    [source('batch:0', 0), source('batch:1', 1)],
    { maxTrianglesPerBatch: 1, maxBytesPerBatch: 1024 },
  );

  expect(merged).toHaveLength(2);
  expect(merged.map((batch) => batch.triangleCount)).toEqual([1, 1]);
});

test('rejects sources from different materials', () => {
  expect(() => mergeBatchBuffers([
    source('batch:0', 0, 'material:0'),
    source('batch:1', 1, 'material:1'),
  ])).toThrow(/ICE3_RENDER_BATCH_WORKER_INVALID/);
});

test('returns no batches for empty input', () => {
  expect(mergeBatchBuffers([])).toEqual([]);
});

test('rejects invalid index ranges', () => {
  const invalid: ICEBatchWorkerSource = {
    ...source('batch:0', 0),
    indices: new Uint32Array([0, 1, 9]).buffer,
  };

  expect(() => mergeBatchBuffers([invalid]))
    .toThrow(/ICE3_RENDER_BATCH_WORKER_INVALID/);
});
