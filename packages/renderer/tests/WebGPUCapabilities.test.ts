import { it } from 'node:test';
import { expect } from '../../../tests/assertions.ts';
import { detectWebGPUAcceleration } from '../src/WebGPUCapabilities';
import { fakeWebGPUDevice } from './fake-webgpu';

it('starts at baseline without storage limits', () => {
  const fake = fakeWebGPUDevice();
  expect(detectWebGPUAcceleration(fake.device)).toMatchObject({
    tier: 'baseline',
    storage: false,
  });
});

it('enables storage when vertex storage limits are sufficient', () => {
  const fake = fakeWebGPUDevice({
    limits: {
      maxStorageBuffersPerShaderStage: 8,
      maxStorageBufferBindingSize: 128 * 1024 * 1024,
      maxBufferSize: 256 * 1024 * 1024,
      minStorageBufferOffsetAlignment: 256,
    },
  });
  expect(detectWebGPUAcceleration(fake.device)).toMatchObject({
    tier: 'storage',
    storage: true,
  });
});
