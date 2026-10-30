import { it } from 'node:test';
import { expect } from '../../../tests/assertions.ts';
import {
  FakeRendererBackend,
  selectRendererBackend,
  type ICERendererBackend,
} from '../src/index';

it('resolves auto to WebGL2 without probing WebGPU', async () => {
  const webgl2 = backendWithKind('webgl2');
  let webgpuCalls = 0;
  const selected = await selectRendererBackend('auto', {
    createWebGPU: async () => {
      webgpuCalls += 1;
      return backendWithKind('webgpu');
    },
    createWebGL2: () => webgl2,
  });
  expect(selected.backend).toBe(webgl2);
  expect(selected.selection).toMatchObject({
    requested: 'auto',
    selected: 'webgl2',
    fallback: false,
    experimental: false,
  });
  expect(webgpuCalls).toBe(0);
});

it('does not fall back when WebGPU is explicitly requested', async () => {
  await expect(selectRendererBackend('webgpu', {
    createWebGPU: async () => {
      throw Object.assign(new Error('adapter unavailable'), {
        details: { reason: 'adapter-unavailable' },
      });
    },
    createWebGL2: () => backendWithKind('webgl2'),
  })).rejects.toThrowError(/ICE3_WEBGPU_UNAVAILABLE/);
});

it('marks an explicitly requested WebGPU backend as experimental', async () => {
  const webgpu = backendWithKind('webgpu');
  const selected = await selectRendererBackend('webgpu', {
    createWebGPU: async () => webgpu,
    createWebGL2: () => backendWithKind('webgl2'),
  });

  expect(selected.selection).toMatchObject({
    requested: 'webgpu',
    selected: 'webgpu',
    fallback: false,
    experimental: true,
  });
});

it('uses WebGL2 without constructing WebGPU', async () => {
  let webgpuCalls = 0;
  const webgl2 = backendWithKind('webgl2');
  const selected = await selectRendererBackend('webgl2', {
    createWebGPU: async () => {
      webgpuCalls += 1;
      return backendWithKind('webgpu');
    },
    createWebGL2: () => webgl2,
  });
  expect(selected.backend).toBe(webgl2);
  expect(webgpuCalls).toBe(0);
});

function backendWithKind(
  kind: 'webgpu' | 'webgl2',
): ICERendererBackend {
  const backend = new FakeRendererBackend();
  Object.defineProperty(backend, 'capabilities', {
    configurable: true,
    value: {
      backend: kind,
      maxTextureSize: 4096,
      picking: true,
    },
  });
  return backend;
}
