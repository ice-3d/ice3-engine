import { it } from 'node:test';
import { expect } from '../../../tests/assertions.ts';
import { WebGPUInstanceStorage } from '../src/WebGPUInstanceStorage';
import { fakeWebGPUDevice } from './fake-webgpu';

it('splits records by storage binding and alignment limits', () => {
  const fake = fakeWebGPUDevice();
  const storage = new WebGPUInstanceStorage(fake.device, {
    maxBindingBytes: 256,
    minOffsetAlignment: 256,
  });
  const pages = storage.plan(10, 96);
  expect(pages).toEqual([
    { firstInstance: 0, instanceCount: 2 },
    { firstInstance: 2, instanceCount: 2 },
    { firstInstance: 4, instanceCount: 2 },
    { firstInstance: 6, instanceCount: 2 },
    { firstInstance: 8, instanceCount: 2 },
  ]);
});
