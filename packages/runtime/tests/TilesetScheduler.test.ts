import type { ICETilesetTile } from '@ice3/assets';
import { ICEPerspectiveCamera } from '@ice3/core';
import { test } from 'node:test';
import { expect } from '../../../tests/assertions.ts';
import { ICETilesetScheduler } from '../src/asset/ICETilesetScheduler';

const tile = (id: string, x: number): ICETilesetTile => ({
  id,
  bounds: { min: [x - 1, -1, -1], max: [x + 1, 1, 1] },
  contentUri: `${id}.glb`,
  children: [],
  geometricError: 0,
});

const tiles = [tile('near', 0), tile('middle', 100), tile('far', 200)];
const assetBounds = { min: [-1, -1, -1], max: [201, 1, 1] } as const;
const camera = (x: number) => new ICEPerspectiveCamera({
  id: 'camera',
  fov: 30,
  near: 0.1,
  far: 1000,
  position: [x, 0, 8],
  target: [x, 0, 0],
});
const scheduler = new ICETilesetScheduler({
  maxResidentTiles: 1,
  maxResidentBytes: 10,
  prefetchMarginRatio: 0.01,
  unloadMarginRatio: 0.05,
});

test('returns visible work first and excludes distant tiles from prefetch', () => {
  const result = scheduler.update({
    assetBounds,
    tiles,
    camera: camera(0),
    viewport: { x: 0, y: 0, width: 800, height: 800 },
    residentBytes: new Map(),
  });

  expect(result.visible.map((entry) => entry.id)).toEqual(['near']);
  expect(result.prefetch.map((entry) => entry.id)).toEqual([]);
  expect(result.ordered.map((entry) => entry.id)).toEqual(['near']);
  expect(result.retainIds.has('far')).toBe(false);
});

test('reports budget pressure without dropping visible tiles', () => {
  const result = scheduler.update({
    assetBounds,
    tiles,
    camera: new ICEPerspectiveCamera({
      id: 'wide',
      fov: 120,
      near: 0.1,
      far: 1000,
      position: [0, 0, 300],
      target: [0, 0, 0],
    }),
    viewport: { x: 0, y: 0, width: 800, height: 800 },
    residentBytes: new Map([
      ['near', 8],
      ['middle', 8],
    ]),
  });

  expect(result.budgetExceeded).toBe(true);
  expect(result.visible).toHaveLength(3);
  expect(result.ordered.map((entry) => entry.id).slice(0, 3)).toEqual([
    'near', 'middle', 'far',
  ]);
});

test('changes the visible set when the viewport aspect changes', () => {
  const wide = new ICEPerspectiveCamera({
    id: 'wide',
    fov: 120,
    near: 0.1,
    far: 1000,
    position: [0, 0, 300],
    target: [0, 0, 0],
  });
  const wideResult = scheduler.update({
    assetBounds,
    tiles,
    camera: wide,
    viewport: { x: 0, y: 0, width: 800, height: 800 },
    residentBytes: new Map(),
  });
  const narrowResult = scheduler.update({
    assetBounds,
    tiles,
    camera: wide,
    viewport: { x: 0, y: 0, width: 100, height: 800 },
    residentBytes: new Map(),
  });

  expect(wideResult.visible.map((entry) => entry.id)).toEqual([
    'near', 'middle', 'far',
  ]);
  expect(narrowResult.visible.map((entry) => entry.id)).toEqual(['near']);
});
