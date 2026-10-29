import { it } from 'node:test';
import { expect } from '../../../tests/assertions.ts';
import { WebGPUBundleCache } from '../src/WebGPUBundleCache';
import { fakeWebGPUDevice } from './fake-webgpu';

it('reuses a bundle for the same key', () => {
  const fake = fakeWebGPUDevice();
  const cache = new WebGPUBundleCache(fake.device, 'bgra8unorm');
  const first = cache.get('scene:1', () => undefined);
  const second = cache.get('scene:1', () => {
    throw new Error('must not record twice');
  });
  expect(second).toBe(first);
  expect(cache.bundleRecreations).toBe(1);
});

it('invalidates on a new key and on resize', () => {
  const fake = fakeWebGPUDevice();
  const cache = new WebGPUBundleCache(fake.device, 'bgra8unorm');
  cache.get('scene:1', () => undefined);
  cache.get('scene:2', () => undefined);
  expect(cache.bundleRecreations).toBe(2);
  cache.invalidate();
  expect(cache.current).toBeNull();
});
