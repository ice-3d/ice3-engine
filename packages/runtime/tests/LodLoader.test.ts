import { readFileSync } from 'node:fs';
import { FakeRendererBackend } from '@ice3/renderer';
import { expect, it, vi } from 'node-test';
import {
  ICE3,
  ICEPerspectiveCamera,
} from '../src/index';
import { ICETilesetLoader } from '../src/asset/ICETilesetLoader';

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

const immediateFetch = () => vi.fn(async (input: RequestInfo | URL) => (
  new Response(fixture(relative(input)))
));

it('keeps coarse parent coverage until focused fine content commits', async () => {
  const engine = new ICE3({ backend: new FakeRendererBackend() });
  const lodCamera = camera();
  const fetch = vi.fn(async (input: RequestInfo | URL) => {
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
  await expect.poll(() => tileset.stats.lod.fineResident)
    .toBeGreaterThan(0);
  await expect.poll(() => tileset.stats.lod.coarseResident).toBe(0);
  await tileset.whenIdle();

  expect(tileset.stats.lod.coarseResident).toBe(0);
  expect(tileset.stats.lod.fineResident).toBeGreaterThan(0);
  expect(tileset.stats.lod.transitioning).toBe(0);
});

it('keeps parent coverage when focused fine content fails', async () => {
  const engine = new ICE3({ backend: new FakeRendererBackend() });
  const lodCamera = camera();
  const fetch = vi.fn(async (input: RequestInfo | URL) => {
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

  lodCamera.setPosition([0.5, 0, 2]).setTarget([0.5, 0, 0]);
  engine.trigger('AFTER_RENDER');
  await tileset.whenIdle();

  expect(
    tileset.scene.findByID('hierarchical-demo:tile:root/0')
      ?? tileset.scene.findByID('hierarchical-demo:tile:root'),
  ).toBeDefined();
  expect(tileset.stats.lod.fallback).toBeGreaterThan(0);
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
  await tileset.whenIdle();

  expect(tileset.stats.lod.transitioning).toBe(0);
  expect(tileset.scene.children).toHaveLength(0);
});
