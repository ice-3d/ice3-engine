import { it } from 'node:test';
import { expect } from '../../tests/assertions.ts';
import { benchmarkScene } from './scenarios';

it('builds the declared fixed workload sizes', () => {
  expect(benchmarkScene('unique-meshes').meshCount).toBe(2000);
  expect(benchmarkScene('instanced-grid').instanceCount).toBe(10000);
  expect(benchmarkScene('static-batches').batchCount).toBe(64);
  expect(benchmarkScene('static-batches').trianglesPerBatch).toBe(10000);
  expect(benchmarkScene('selection').selection.length)
    .toBe(500);
  expect(benchmarkScene('picking').pickCount).toBe(100);
});

it('produces deterministic scene identities', () => {
  expect(
    benchmarkScene('unique-meshes').scene.children.map((node) => node.id),
  ).toEqual(
    benchmarkScene('unique-meshes').scene.children.map((node) => node.id),
  );
});
