import { it } from 'node:test';
import { expect } from '../../../tests/assertions.ts';
import { FakeRendererBackend } from '@ice3/renderer';
import { ICE3 } from '../src/index';
import { createHost } from '../../../tests/test-dom.ts';

it('initAsync initializes an injected backend', async () => {
  const backend = new FakeRendererBackend();
  const engine = new ICE3({ backend });
  await engine.initAsync(createHost());
  expect(engine.getDiagnostics().backend.backend).toBe('fake');
  expect(engine.getDiagnostics().rendererSelection).toMatchObject({
    requested: 'custom',
    selected: 'fake',
    fallback: false,
  });
});

it('uses WebGL2 for the default and auto preference without WebGPU probing', async () => {
  const defaultEngine = new ICE3();
  const autoEngine = new ICE3({ renderer: 'auto' });

  expect(defaultEngine.getDiagnostics().rendererSelection).toMatchObject({
    requested: 'webgl2',
    selected: 'webgl2',
    fallback: false,
    experimental: false,
  });
  expect(autoEngine.getDiagnostics().rendererSelection).toMatchObject({
    requested: 'auto',
    selected: 'webgl2',
    fallback: false,
    experimental: false,
  });
});

it('requires initAsync only when WebGPU is explicitly requested', () => {
  expect(() => new ICE3({ renderer: 'webgpu' }).init(createHost()))
    .toThrowError(/ICE3_RENDERER_ASYNC_REQUIRED/);
});

it('rejects backend injection combined with renderer preference', () => {
  expect(() => new ICE3({
    backend: new FakeRendererBackend(),
    renderer: 'auto',
  })).toThrowError(/ICE3_RENDERER_CONFIG_INVALID/);
});
