import { it } from 'node:test';
import { expect } from '../../../tests/assertions.ts';
import {
  ICEBasicMaterial,
  ICEBoxGeometry,
} from '@ice3/core';
import { WebGPUInstanceCache } from '../src/index';
import { fakeWebGPUDevice } from './fake-webgpu';

it('writes aligned instance matrices and semantic indices', () => {
  const { device, writes } = fakeWebGPUDevice();
  const cache = new WebGPUInstanceCache(device);
  const batch = {
    id: 'instance:pump',
    geometry: new ICEBoxGeometry({ width: 1, height: 1, depth: 1 }),
    material: new ICEBasicMaterial({ color: '#ffffff' }),
    instanceMatrices: new Float32Array(32),
    semanticIds: ['pump-a', 'pump-b'],
    semanticIndices: new Uint32Array([0, 1]),
    meshIds: ['a', 'b'],
    materialKey: '#ffffff:',
  };

  const entry = cache.retain(batch);

  expect(entry.instanceCount).toBe(2);
  expect(writes.map((write) => write.size)).toEqual([128, 8]);
  cache.dispose();
  expect(entry.matrixBuffer.destroyed).toBe(true);
  expect(entry.semanticBuffer.destroyed).toBe(true);
});

it('updates the instance count when a reused batch shrinks', () => {
  const { device } = fakeWebGPUDevice();
  const cache = new WebGPUInstanceCache(device);
  const geometry = new ICEBoxGeometry({ width: 1, height: 1, depth: 1 });
  const material = new ICEBasicMaterial({ color: '#ffffff' });
  cache.retain({
    id: 'instance:pump',
    geometry,
    material,
    instanceMatrices: new Float32Array(32),
    semanticIds: ['pump-a', 'pump-b'],
    semanticIndices: new Uint32Array([0, 1]),
    meshIds: ['a', 'b'],
    materialKey: '#ffffff:',
  });

  const entry = cache.retain({
    id: 'instance:pump',
    geometry,
    material,
    instanceMatrices: new Float32Array(16),
    semanticIds: ['pump-a'],
    semanticIndices: new Uint32Array([0]),
    meshIds: ['a'],
    materialKey: '#ffffff:',
  });

  expect(entry.instanceCount).toBe(1);
});

it('does not rewrite unchanged instance arrays', () => {
  const { device, writes } = fakeWebGPUDevice();
  const cache = new WebGPUInstanceCache(device);
  const batch = instanceBatch();
  cache.retain(batch);
  const initialWrites = writes.length;

  cache.retain(batch);

  expect(writes).toHaveLength(initialWrites);
});

it('rewrites matrices without rewriting unchanged semantics', () => {
  const { device, writes } = fakeWebGPUDevice();
  const cache = new WebGPUInstanceCache(device);
  const batch = instanceBatch();
  cache.retain(batch);
  const before = writes.length;

  cache.retain({
    ...batch,
    instanceMatrices: new Float32Array(batch.instanceMatrices.length),
  });

  expect(writes.slice(before).map((write) => write.size)).toEqual([128]);
});

function instanceBatch() {
  const instanceMatrices = new Float32Array(32);
  instanceMatrices[0] = 1;
  instanceMatrices[5] = 1;
  instanceMatrices[10] = 1;
  instanceMatrices[15] = 1;
  instanceMatrices[16] = 1;
  instanceMatrices[21] = 1;
  instanceMatrices[26] = 1;
  instanceMatrices[31] = 1;
  return {
    id: 'instance:incremental',
    geometry: new ICEBoxGeometry({ width: 1, height: 1, depth: 1 }),
    material: new ICEBasicMaterial({ color: '#ffffff' }),
    instanceMatrices,
    semanticIds: ['pump-a', 'pump-b'],
    semanticIndices: new Uint32Array([0, 1]),
    meshIds: ['a', 'b'],
    materialKey: '#ffffff:',
  };
}
