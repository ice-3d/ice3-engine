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
