import { FakeRendererBackend } from '@ice3/renderer';
import { it } from 'node:test';
import { expect } from '../../../tests/assertions.ts';
import * as mockApi from '../../../tests/test-mocks.ts';
import { ICE3 } from '../src/index';
import { ICEAssetLoader } from '../src/asset/ICEAssetLoader';
import {
  createBadDigestGLB,
  createMinimalPreparedGLB,
} from '../../assets/tests/createFixture';

const fixtureBytes = createMinimalPreparedGLB();

const createLoader = () => {
  const engine = new ICE3({ backend: new FakeRendererBackend() });
  const fetch = mockApi.fn(async () => new Response(fixtureBytes.slice(0)));
  return {
    engine,
    fetch,
    loader: new ICEAssetLoader(engine, { fetch }),
  };
};

it('shares decoded bytes across concurrent loads', async () => {
  const { fetch, loader } = createLoader();
  const [first, second] = await Promise.all([
    loader.load('/asset.glb'),
    loader.load('/asset.glb'),
  ]);

  expect(fetch).toHaveBeenCalledTimes(1);
  expect(first.scene).not.toBe(second.scene);
  expect(first.id).toBe('fixture');
});

it('exposes the declared asset contract on the handle', async () => {
  const { loader } = createLoader();
  const handle = await loader.load('/asset.glb');
  expect(handle.contract.status).toBe('active');
  expect(handle.contract.budget?.profile).toBe('interactive-desktop-v1');
});

it('emits a warning when loading a legacy asset', async () => {
  const engine = new ICE3({ backend: new FakeRendererBackend() });
  const diagnostics: string[] = [];
  engine.on<{ code: string }>('DIAGNOSTIC', (event) => {
    if (event.param) diagnostics.push(event.param.code);
  });
  const loader = new ICEAssetLoader(engine, {
    fetch: mockApi.fn(async () => new Response(
      createMinimalPreparedGLB({ contract: 'legacy' }),
    )),
  });
  await loader.load('/legacy.glb');
  expect(diagnostics).toContain('ICE3_ASSET_CONTRACT_MISSING');
});

it('emits the legacy warning once per cached asset URL', async () => {
  const engine = new ICE3({ backend: new FakeRendererBackend() });
  const diagnostics: string[] = [];
  engine.on<{ code: string }>('DIAGNOSTIC', (event) => {
    if (event.param) diagnostics.push(event.param.code);
  });
  const bytes = createMinimalPreparedGLB({ contract: 'legacy' });
  const loader = new ICEAssetLoader(engine, {
    fetch: mockApi.fn(async () => new Response(bytes.slice(0))),
  });

  await loader.load('/legacy.glb');
  await loader.load('/legacy.glb');

  expect(diagnostics.filter(
    (code) => code === 'ICE3_ASSET_CONTRACT_MISSING',
  )).toHaveLength(1);
});

it('aborts before scene instantiation', async () => {
  const { loader } = createLoader();
  const controller = new AbortController();
  controller.abort();

  await expect(loader.load('/asset.glb', { signal: controller.signal }))
    .rejects.toThrow(/ICE3_ASSET_ABORTED/);
});

it('disposes a handle idempotently', async () => {
  const { loader } = createLoader();
  const handle = await loader.load('/asset.glb');

  handle.dispose();
  handle.dispose();

  expect(handle.scene.children).toHaveLength(0);
});

it('does not share mutable scene instances through the URL cache', async () => {
  const { loader } = createLoader();
  const first = await loader.load('/asset.glb');
  const second = await loader.load('/asset.glb');
  first.scene.children[0]!.visible = false;

  expect(second.scene.children[0]!.visible).toBe(true);
});

it('verifies the BIN digest only when explicitly requested', async () => {
  const bytes = createBadDigestGLB();
  const engine = new ICE3({ backend: new FakeRendererBackend() });
  const defaultLoader = new ICEAssetLoader(engine, {
    fetch: mockApi.fn(async () => new Response(bytes.slice(0))),
  });
  const verifiedLoader = new ICEAssetLoader(engine, {
    fetch: mockApi.fn(async () => new Response(bytes.slice(0))),
    verifyIntegrity: true,
  });

  await expect(defaultLoader.load('/asset.glb')).resolves.toBeDefined();
  await expect(verifiedLoader.load('/asset.glb')).rejects.toThrow(
    /ICE3_ASSET_INTEGRITY_FAILED/,
  );
});

it('does not abort other callers when one shared request is cancelled', async () => {
  let release: ((response: Response) => void) | undefined;
  const fetch = mockApi.fn((
    _input: RequestInfo | URL,
    init?: RequestInit,
  ) => new Promise<Response>((resolve, reject) => {
    release = resolve;
    init?.signal?.addEventListener('abort', () => {
      reject(new DOMException('Aborted', 'AbortError'));
    });
  }));
  const engine = new ICE3({ backend: new FakeRendererBackend() });
  const loader = new ICEAssetLoader(engine, { fetch });
  const firstController = new AbortController();
  const first = loader.load('/asset.glb', { signal: firstController.signal });
  const second = loader.load('/asset.glb');

  firstController.abort();
  await expect(first).rejects.toThrow(/ICE3_ASSET_ABORTED/);
  release!(new Response(fixtureBytes.slice(0)));

  await expect(second).resolves.toBeDefined();
});

it('clears one cached URL without clearing another', async () => {
  const engine = new ICE3({ backend: new FakeRendererBackend() });
  const fetch = mockApi.fn(async () => new Response(fixtureBytes.slice(0)));
  const loader = new ICEAssetLoader(engine, { fetch });

  await loader.load('/first.glb');
  await loader.load('/second.glb');
  loader.clear('/first.glb');
  await loader.load('/first.glb');
  await loader.load('/second.glb');

  expect(fetch).toHaveBeenCalledTimes(3);
});
