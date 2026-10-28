import { readFileSync } from 'node:fs';
import { FakeRendererBackend } from '@ice3/renderer';
import { it } from 'node:test';
import { expect } from '../../../tests/assertions.ts';
import * as mockApi from '../../../tests/test-mocks.ts';
import {
  ICE3,
  ICEPerspectiveCamera,
} from '../src/index';
import {
  ICETilesetLoader,
  type ICETilesetEvent,
} from '../src/asset/ICETilesetLoader';

const fixture = (path: string): Uint8Array => readFileSync(
  new URL(`../../..//tests/fixtures/hierarchical-demo/${path}`, import.meta.url),
);

const relative = (input: RequestInfo | URL): string => {
  const url = new URL(String(input), 'https://example.test/hierarchical-demo/');
  return url.pathname.slice('/hierarchical-demo/'.length);
};

const camera = (focused = false) => new ICEPerspectiveCamera({
  id: 'lod-camera',
  fov: 45,
  near: 0.1,
  far: 1000,
  position: focused ? [0.5, 0, 2] : [15.5, 20, 60],
  target: focused ? [0.5, 0, 0] : [15.5, 0, 0],
});

const immediateFetch = () => mockApi.fn(async (input: RequestInfo | URL) => (
  new Response(fixture(relative(input)))
));

it('keeps coarse parent coverage until focused fine content commits', async () => {
  const engine = new ICE3({ backend: new FakeRendererBackend() });
  const lodCamera = camera();
  const fetch = mockApi.fn(async (input: RequestInfo | URL) => {
    const path = relative(input);
    if (path.startsWith('parts/')) {
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
    return new Response(fixture(path));
  });
  const tileset = await new ICETilesetLoader(engine, {
    fetch,
    camera: lodCamera,
    maxScreenSpaceErrorPixels: 0.01,
  }).open('https://example.test/hierarchical-demo/tileset.json');

  await tileset.whenReady();
  expect(tileset.scene.findByID('hierarchical-demo:tile:root')).toBeDefined();

  lodCamera.setPosition([0.5, 0, 2]).setTarget([0.5, 0, 0]);
  engine.trigger('AFTER_RENDER');
  await expect.poll(() => tileset.stats.lod.transitioning).toBeGreaterThan(0);
  await expect.poll(() => tileset.stats.lod.coarseResident).toBeGreaterThan(0);
  let idleSettled = false;
  const idle = tileset.whenIdle().then(() => {
    idleSettled = true;
  });
  await new Promise((resolve) => setTimeout(resolve, 20));
  expect(idleSettled).toBe(false);
  await expect.poll(() => tileset.stats.lod.fineResident)
    .toBeGreaterThan(0);
  await idle;

  expect(tileset.scene.findByID('hierarchical-demo:tile:root')?.visible)
    .toBe(false);
  expect(tileset.scene.children.some((node) => node.visible)).toBe(true);
  expect(tileset.stats.lod.fineResident).toBeGreaterThan(0);
  expect(tileset.stats.lod.transitioning).toBe(0);
});

it('does not expose overlapping ancestor and descendant levels', async () => {
  const engine = new ICE3({ backend: new FakeRendererBackend() });
  const lodCamera = camera();
  const fetch = mockApi.fn(async (input: RequestInfo | URL) => {
    const path = relative(input);
    if (path.startsWith('parts/')) {
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
    return new Response(fixture(path));
  });
  const tileset = await new ICETilesetLoader(engine, {
    fetch,
    camera: lodCamera,
    maxScreenSpaceErrorPixels: 0.000001,
  }).open('https://example.test/hierarchical-demo/tileset.json');
  await tileset.whenReady();

  const overlaps: string[][] = [];
  tileset.on<ICETilesetEvent>('TILESET_TILE_LOADED', () => {
    const visibleTileIds = tileset.scene.children
      .filter((node) => node.visible)
      .map((node) => node.id.slice('hierarchical-demo:tile:'.length));
    for (const ancestor of visibleTileIds) {
      for (const candidate of visibleTileIds) {
        if (candidate.startsWith(`${ancestor}/`)) {
          overlaps.push([ancestor, candidate]);
        }
      }
    }
  });

  lodCamera.setPosition([5.5, 0, 20]).setTarget([5.5, 0, 0]);
  engine.trigger('AFTER_RENDER');
  await tileset.whenIdle();

  expect(overlaps).toEqual([]);
});

it('keeps the current representation visible until coarse content commits', async () => {
  const engine = new ICE3({ backend: new FakeRendererBackend() });
  const lodCamera = camera(true);
  const tileset = await new ICETilesetLoader(engine, {
    fetch: immediateFetch(),
    camera: lodCamera,
    maxScreenSpaceErrorPixels: 0.01,
  }).open('https://example.test/hierarchical-demo/tileset.json');
  await tileset.whenReady();
  await expect.poll(() => tileset.stats.lod.fineResident)
    .toBeGreaterThan(0);
  await tileset.whenIdle();
  expect(tileset.scene.children.some((node) => node.visible)).toBe(true);

  lodCamera.setPosition([15.5, 0, 200]).setTarget([15.5, 0, 0]);
  engine.trigger('AFTER_RENDER');
  await new Promise((resolve) => setTimeout(resolve, 0));

  expect(tileset.scene.children.some((node) => node.visible)).toBe(true);
  await tileset.whenIdle();
  expect(tileset.stats.lod.coarseResident).toBeGreaterThan(0);
});

it('keeps the displayed LOD stable while the camera is moving', async () => {
  const engine = new ICE3({ backend: new FakeRendererBackend() });
  const lodCamera = camera();
  const tileset = await new ICETilesetLoader(engine, {
    fetch: immediateFetch(),
    camera: lodCamera,
    maxScreenSpaceErrorPixels: 0.01,
    lodSettleDelayMs: 80,
  }).open('https://example.test/hierarchical-demo/tileset.json');
  await tileset.whenReady();
  await tileset.whenIdle();
  const initialVisibleIds = tileset.scene.children
    .filter((node) => node.visible)
    .map((node) => node.id);
  expect(initialVisibleIds).toEqual(['hierarchical-demo:tile:root']);

  for (const x of [0.5, 1, 0.5, 0]) {
    lodCamera.setPosition([x, 0, 2]).setTarget([x, 0, 0]);
    engine.trigger('AFTER_RENDER');
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  expect(tileset.scene.children
    .filter((node) => node.visible)
    .map((node) => node.id)).toEqual(initialVisibleIds);

  await expect.poll(() => tileset.stats.lod.fineResident)
    .toBeGreaterThan(0);
  await tileset.whenIdle();
  expect(tileset.scene.children
    .filter((node) => node.visible)
    .map((node) => node.id)).not.toEqual(initialVisibleIds);
});

it('keeps the current complete coverage while the next LOD cut settles', async () => {
  const engine = new ICE3({ backend: new FakeRendererBackend() });
  const lodCamera = camera();
  const tileset = await new ICETilesetLoader(engine, {
    fetch: immediateFetch(),
    camera: lodCamera,
    maxScreenSpaceErrorPixels: 0.01,
    lodSettleDelayMs: 40,
  }).open('https://example.test/hierarchical-demo/tileset.json');
  await tileset.whenReady();
  await tileset.whenIdle();

  lodCamera.setPosition([0.5, 0, 2]).setTarget([0.5, 0, 0]);
  engine.trigger('AFTER_RENDER');
  await new Promise((resolve) => setTimeout(resolve, 100));
  await tileset.whenIdle();

  const fallback = tileset.scene.findByID('hierarchical-demo:tile:root');
  expect(fallback).toBeDefined();
  expect(fallback?.visible).toBe(false);
  const stableVisibleIds = tileset.scene.children
    .filter((node) => node.visible)
    .map((node) => node.id);

  lodCamera.setPosition([0, 0, 2]).setTarget([0, 0, 0]);
  engine.trigger('AFTER_RENDER');
  await new Promise((resolve) => setTimeout(resolve, 10));

  expect(tileset.scene.children
    .filter((node) => node.visible)
    .map((node) => node.id)).toEqual(stableVisibleIds);
});

it('shows each complete coarse branch instead of waiting for every leaf', async () => {
  const engine = new ICE3({ backend: new FakeRendererBackend() });
  const lodCamera = camera();
  lodCamera.setPosition([15.5, 0, 500]).setTarget([15.5, 0, 0]);
  let resolveGroup!: (response: Response) => void;
  let groupRequested = false;
  const fetch = mockApi.fn((input: RequestInfo | URL) => {
    const path = relative(input);
    if (path.startsWith('parts/')) {
      return new Promise<Response>(() => {});
    }
    if (path === 'coarse/group-root-0.glb') {
      groupRequested = true;
      return new Promise<Response>((resolve) => {
        resolveGroup = resolve;
      });
    }
    return Promise.resolve(new Response(fixture(path)));
  });
  const tileset = await new ICETilesetLoader(engine, {
    fetch,
    camera: lodCamera,
    maxScreenSpaceErrorPixels: 0.001,
    lodSettleDelayMs: 20,
  }).open('https://example.test/hierarchical-demo/tileset.json');
  await tileset.whenReady();
  await expect.poll(() => groupRequested).toBe(true);

  lodCamera.setPosition([5.5, 0, 20]).setTarget([5.5, 0, 0]);
  engine.trigger('AFTER_RENDER');
  resolveGroup(new Response(fixture('coarse/group-root-0.glb')));
  await expect.poll(() => tileset.tileState('root/0')).toBe('loaded');
  await new Promise((resolve) => setTimeout(resolve, 100));

  const visibleIds = tileset.scene.children
    .filter((node) => node.visible)
    .map((node) => node.id);
  expect(visibleIds).toEqual(['hierarchical-demo:tile:root/0']);
  tileset.dispose();
});

it('keeps parent coverage when focused fine content fails', async () => {
  const engine = new ICE3({ backend: new FakeRendererBackend() });
  const lodCamera = camera();
  const fetch = mockApi.fn(async (input: RequestInfo | URL) => {
    const path = relative(input);
    if (path === 'parts/part-000.glb') {
      return new Response('unavailable', { status: 500 });
    }
    return new Response(fixture(path));
  });
  const tileset = await new ICETilesetLoader(engine, {
    fetch,
    camera: lodCamera,
    maxScreenSpaceErrorPixels: 0.01,
  }).open('https://example.test/hierarchical-demo/tileset.json');
  await tileset.whenReady();
  let fallbackEvents = 0;
  tileset.on('TILESET_LOD_FALLBACK', () => {
    fallbackEvents += 1;
  });

  lodCamera.setPosition([0.5, 0, 2]).setTarget([0.5, 0, 0]);
  engine.trigger('AFTER_RENDER');
  await tileset.whenIdle();

  expect(
    tileset.scene.findByID('hierarchical-demo:tile:root/0')
      ?? tileset.scene.findByID('hierarchical-demo:tile:root'),
  ).toBeDefined();
  expect(tileset.stats.lod.fallback).toBeGreaterThan(0);
  expect(fallbackEvents).toBeGreaterThan(0);
});

it('discards stale refinement coverage when the camera leaves', async () => {
  const engine = new ICE3({ backend: new FakeRendererBackend() });
  const lodCamera = camera();
  const fetch = immediateFetch();
  const tileset = await new ICETilesetLoader(engine, {
    fetch,
    camera: lodCamera,
    maxScreenSpaceErrorPixels: 0.01,
  }).open('https://example.test/hierarchical-demo/tileset.json');
  await tileset.whenReady();

  lodCamera.setPosition([0.5, 0, 2]).setTarget([0.5, 0, 0]);
  engine.trigger('AFTER_RENDER');
  lodCamera.setPosition([1000, 0, 1000]).setTarget([1000, 0, 0]);
  engine.trigger('AFTER_RENDER');
  await new Promise((resolve) => setTimeout(resolve, 0));
  await tileset.whenIdle();

  expect(tileset.stats.lod.transitioning).toBe(0);
  expect(tileset.scene.children).toHaveLength(0);
});

it('preserves selection when coarse content is replaced by fine content', async () => {
  const engine = new ICE3({ backend: new FakeRendererBackend() });
  const lodCamera = camera();
  const tileset = await new ICETilesetLoader(engine, {
    fetch: immediateFetch(),
    camera: lodCamera,
    maxScreenSpaceErrorPixels: 0.01,
  }).open('https://example.test/hierarchical-demo/tileset.json');
  await tileset.whenReady();
  engine.setScene(tileset.scene).setSelection(['hierarchical-demo/node/0']);

  lodCamera.setPosition([0.5, 0, 2]).setTarget([0.5, 0, 0]);
  engine.trigger('AFTER_RENDER');
  await expect.poll(() => tileset.stats.lod.fineResident)
    .toBeGreaterThan(0);
  await tileset.whenIdle();

  expect(tileset.scene.findByID('hierarchical-demo:tile:root')?.visible)
    .toBe(false);
  expect(engine.getSelection()).toEqual(['hierarchical-demo/node/0']);
});

it('keeps coarse coverage and stops optional refinement at the budget', async () => {
  const engine = new ICE3({ backend: new FakeRendererBackend() });
  const lodCamera = camera();
  const tileset = await new ICETilesetLoader(engine, {
    fetch: immediateFetch(),
    camera: lodCamera,
    maxResidentTiles: 1,
    maxScreenSpaceErrorPixels: 0.01,
  }).open('https://example.test/hierarchical-demo/tileset.json');
  await tileset.whenReady();

  lodCamera.setPosition([0.5, 0, 2]).setTarget([0.5, 0, 0]);
  engine.trigger('AFTER_RENDER');
  await new Promise((resolve) => setTimeout(resolve, 20));

  expect(tileset.stats.lod.coarseResident).toBeGreaterThan(0);
  expect(tileset.stats.lod.fallback).toBeGreaterThan(0);
  expect(tileset.stats.lod.transitioning).toBe(0);
});

it('keeps whenIdle independent from delayed background prefetch', async () => {
  const engine = new ICE3({ backend: new FakeRendererBackend() });
  const delayed: Array<(response: Response) => void> = [];
  const fetch = mockApi.fn((input: RequestInfo | URL) => {
    const path = relative(input);
    if (path === 'coarse/group-root-0.glb' || path === 'coarse/group-root-1.glb') {
      return new Promise<Response>((resolve) => {
        delayed.push(resolve);
      });
    }
    return Promise.resolve(new Response(fixture(path)));
  });
  const tileset = await new ICETilesetLoader(engine, {
    fetch,
    camera: camera(),
  }).open('https://example.test/hierarchical-demo/tileset.json');

  await tileset.whenReady();
  await expect.poll(() => tileset.stats.loadingContents).toBeGreaterThan(0);
  const outcome = await Promise.race([
    tileset.whenIdle().then(() => 'idle' as const),
    new Promise<'timeout'>((resolve) => {
      setTimeout(() => resolve('timeout'), 100);
    }),
  ]);

  expect(outcome).toBe('idle');
  expect(tileset.stats.loadingContents).toBeGreaterThan(0);
  for (const resolve of delayed.splice(0)) {
    resolve(new Response(fixture('coarse/group-root-0.glb')));
  }
  tileset.dispose();
});

it('isolates prefetch failures from visible load failures', async () => {
  const engine = new ICE3({ backend: new FakeRendererBackend() });
  const failedEvents: string[] = [];
  const fetch = mockApi.fn(async (input: RequestInfo | URL) => {
    const path = relative(input);
    if (path === 'coarse/group-root-0.glb' || path === 'coarse/group-root-1.glb') {
      return new Response('unavailable', { status: 500 });
    }
    return new Response(fixture(path));
  });
  const tileset = await new ICETilesetLoader(engine, {
    fetch,
    camera: camera(),
  }).open('https://example.test/hierarchical-demo/tileset.json');
  tileset.on('TILESET_TILE_FAILED', (event) => {
    if (event.param) failedEvents.push(event.param);
  });

  await tileset.whenReady();
  await tileset.whenIdle();
  await expect.poll(() => tileset.stats.loadingContents).toBe(0);

  expect(tileset.stats.resident).toBeGreaterThan(0);
  expect(tileset.stats.failed).toBe(0);
  expect(failedEvents).toEqual([]);
});
