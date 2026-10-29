import { it } from 'node:test';
import { expect } from '../../../tests/assertions.ts';
import {
  FakeRendererBackend,
  selectRendererBackend,
  type ICERendererBackend,
} from '../src/index';

it('uses WebGPU for auto when the WebGPU factory succeeds', async () => {
  const webgpu = backendWithKind('webgpu');
  const webgl2 = backendWithKind('webgl2');
  const selected = await selectRendererBackend('auto', {
    createWebGPU: async () => webgpu,
    createWebGL2: () => webgl2,
  });
  expect(selected.backend).toBe(webgpu);
  expect(selected.selection).toMatchObject({
    requested: 'auto',
    selected: 'webgpu',
    fallback: false,
  });
});

it('falls back to WebGL2 when auto WebGPU initialization rejects', async () => {
  const webgl2 = backendWithKind('webgl2');
  const selected = await selectRendererBackend('auto', {
    createWebGPU: async () => {
      throw Object.assign(new Error('adapter unavailable'), {
        details: { reason: 'adapter-unavailable' },
      });
    },
    createWebGL2: () => webgl2,
  });
  expect(selected.backend).toBe(webgl2);
  expect(selected.selection).toMatchObject({
    requested: 'auto',
    selected: 'webgl2',
    fallback: true,
    fallbackReason: 'adapter-unavailable',
  });
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
