import { readFileSync } from 'node:fs';
import { FakeRendererBackend } from '@ice3/renderer';
import { expect, it, vi } from 'node-test';
import {
  ICE3,
  ICEPerspectiveCamera,
} from '../src/index';
import { ICETilesetLoader } from '../src/asset/ICETilesetLoader';

const fixture = (path: string) => readFileSync(
  `tests/fixtures/spatial-demo/${path}`,
);

it('opens before all tiles finish and commits completed tiles progressively', async () => {
  const engine = new ICE3({ backend: new FakeRendererBackend() });
  const camera = new ICEPerspectiveCamera({
    id: 'camera',
    position: [0, 2, 8],
    target: [0, 0, 0],
  });
  const fetch = vi.fn(async (input: RequestInfo | URL) => {
    const url = String(input);
    if (url.endsWith('tileset.json')) {
      return new Response(fixture('tileset.json'));
    }
    const name = url.split('/').at(-1)!;
    if (name !== 'part-000.glb') {
      await new Promise((resolve) => setTimeout(resolve, 25));
    }
    return new Response(fixture(`parts/${name}`));
  });
  const loader = new ICETilesetLoader(engine, { fetch, camera });
  const tileset = await loader.open(
    'https://example.test/spatial-demo/tileset.json',
  );

  expect(Object.isFrozen(tileset.stats)).toBe(true);
  expect(tileset.stats.loaded).toBe(0);
  await tileset.whenReady();
  expect(tileset.stats.loaded).toBe(1);
  expect(tileset.stats.loaded).toBeLessThan(tileset.stats.total);
  await tileset.whenComplete();
  expect(tileset.stats.loaded).toBe(tileset.stats.total);
  expect(tileset.scene.children.length).toBeGreaterThan(0);
  tileset.dispose();
  expect(tileset.scene.children).toHaveLength(0);
});

it('keeps successful tiles after one tile fails', async () => {
  const engine = new ICE3({ backend: new FakeRendererBackend() });
  const fetch = vi.fn(async (input: RequestInfo | URL) => {
    const url = String(input);
    if (url.endsWith('tileset.json')) {
      return new Response(fixture('tileset.json'));
    }
    if (url.endsWith('part-001.glb')) {
      return new Response('broken', { status: 500 });
    }
    return new Response(fixture(`parts/${url.split('/').at(-1)!}`));
  });
  const tileset = await new ICETilesetLoader(engine, { fetch })
    .open('https://example.test/spatial-demo/tileset.json');

  await tileset.whenComplete();
  expect(tileset.stats.loaded).toBe(3);
  expect(tileset.stats.failed).toBe(1);
  expect(tileset.scene.children.length).toBeGreaterThan(0);
});

it('rejects duplicate node IDs from a later tile without removing earlier tiles', async () => {
  const engine = new ICE3({ backend: new FakeRendererBackend() });
  const fetch = vi.fn(async (input: RequestInfo | URL) => {
    const url = String(input);
    if (url.endsWith('tileset.json')) {
      return new Response(fixture('tileset.json'));
    }
    const name = url.endsWith('part-001.glb')
      ? 'part-000.glb'
      : url.split('/').at(-1)!;
    return new Response(fixture(`parts/${name}`));
  });
  const tileset = await new ICETilesetLoader(engine, { fetch })
    .open('https://example.test/spatial-demo/tileset.json');

  await tileset.whenComplete();
  expect(tileset.stats.loaded).toBe(3);
  expect(tileset.stats.failed).toBe(1);
  expect(tileset.scene.children.length).toBeGreaterThan(0);
});

it('starts no more than two tile requests before a response settles', async () => {
  const engine = new ICE3({ backend: new FakeRendererBackend() });
  let inFlight = 0;
  let maximumInFlight = 0;
  const fetch = vi.fn((
    input: RequestInfo | URL,
    init?: RequestInit,
  ) => new Promise<Response>((resolve, reject) => {
    const url = String(input);
    if (url.endsWith('tileset.json')) {
      resolve(new Response(fixture('tileset.json')));
      return;
    }
    inFlight += 1;
    maximumInFlight = Math.max(maximumInFlight, inFlight);
    init?.signal?.addEventListener('abort', () => {
      inFlight -= 1;
      reject(new DOMException('Aborted', 'AbortError'));
    });
  }));
  const tileset = await new ICETilesetLoader(engine, { fetch })
    .open('https://example.test/spatial-demo/tileset.json');

  await Promise.resolve();
  expect(inFlight).toBe(2);
  expect(maximumInFlight).toBe(2);
  tileset.dispose();
  await Promise.resolve();
  expect(inFlight).toBe(0);
});

it('aborts pending work and disposes its scene idempotently', async () => {
  const engine = new ICE3({ backend: new FakeRendererBackend() });
  const fetch = vi.fn((
    input: RequestInfo | URL,
    init?: RequestInit,
  ) => new Promise<Response>((resolve, reject) => {
    const url = String(input);
    if (url.endsWith('tileset.json')) {
      resolve(new Response(fixture('tileset.json')));
      return;
    }
    init?.signal?.addEventListener('abort', () => {
      reject(new DOMException('Aborted', 'AbortError'));
    });
  }));
  const tileset = await new ICETilesetLoader(engine, { fetch })
    .open('https://example.test/spatial-demo/tileset.json');

  tileset.dispose();
  tileset.dispose();
  expect(tileset.scene.children).toHaveLength(0);
  expect(tileset.stats.loading).toBe(0);
});

it('removes the caller abort listener when the handle is disposed', async () => {
  const engine = new ICE3({ backend: new FakeRendererBackend() });
  const fetch = vi.fn(async (input: RequestInfo | URL) => {
    const url = String(input);
    if (url.endsWith('tileset.json')) {
      return new Response(fixture('tileset.json'));
    }
    return new Response(fixture(`parts/${url.split('/').at(-1)!}`));
  });
  const controller = new AbortController();
  const remove = vi.spyOn(controller.signal, 'removeEventListener');
  const tileset = await new ICETilesetLoader(engine, { fetch }).open(
    'https://example.test/spatial-demo/tileset.json',
    { signal: controller.signal },
  );

  tileset.dispose();
  expect(remove).toHaveBeenCalledWith('abort', expect.any(Function));
});
