import { expect, test } from 'node-test';
import type { ICETilesetTile } from '@ice3/assets';
import { ICEPerspectiveCamera } from '@ice3/core';
import { ICELodSelector } from '../src/asset/ICELodSelector';

const child = (
  id: string,
  minX: number,
  geometricError = 0,
): ICETilesetTile => ({
  id,
  bounds: { min: [minX, -1, -1], max: [minX + 2, 1, 1] },
  contentUri: `parts/${id}.glb`,
  geometricError,
  children: [],
});

const tree = (): ICETilesetTile => ({
  id: 'root',
  bounds: { min: [-1, -1, -1], max: [5, 1, 1] },
  contentUri: 'coarse/root.glb',
  geometricError: 10,
  children: [child('near', 0), child('far', 3)],
});

const camera = (z: number, targetX = 2) => new ICEPerspectiveCamera({
  id: 'camera',
  fov: 45,
  near: 0.1,
  far: 2000,
  position: [targetX, 0, z],
  target: [targetX, 0, 0],
});

const input = (
  z: number,
  width = 800,
  overrides: Partial<Parameters<ICELodSelector['select']>[0]> = {},
) => ({
  root: tree(),
  camera: camera(z),
  viewport: { x: 0, y: 0, width, height: 800 },
  residentIds: new Set<string>(),
  failedIds: new Set<string>(),
  maxScreenSpaceErrorPixels: 16,
  ...overrides,
});

const selector = new ICELodSelector();

test('selects parent coarse content at overview distance', () => {
  const result = selector.select(input(1000));

  expect(result.target.map((tile) => tile.id)).toEqual(['root']);
  expect(result.fallbackByTargetId.get('root')).toBeUndefined();
});

test('refines into visible children when screen-space error is high', () => {
  const result = selector.select(input(2));

  expect(result.target.map((tile) => tile.id)).toEqual(['near', 'far']);
  expect(result.fallbackByTargetId.get('near')).toBe('root');
  expect(result.fallbackByTargetId.get('far')).toBe('root');
});

test('changes the visible target when only viewport width changes', () => {
  const root = tree();
  root.children = [child('center', 1), child('lateral', 20)];
  root.bounds = { min: [-1, -1, -1], max: [22, 1, 1] };

  const wide = selector.select(input(100, 1200, {
    root,
    camera: camera(100),
  }));
  const narrow = selector.select(input(100, 120, {
    root,
    camera: camera(100),
  }));

  expect(wide.target.map((tile) => tile.id)).toContain('lateral');
  expect(narrow.target.map((tile) => tile.id)).not.toContain('lateral');
});

test('continues through an uncontented internal node with zero error', () => {
  const root: ICETilesetTile = {
    ...tree(),
    contentUri: undefined,
    geometricError: 0,
  };
  const result = selector.select(input(1000, 800, { root }));

  expect(result.target.map((tile) => tile.id)).toEqual(['near', 'far']);
});

test('falls back to ancestor content when a target has failed', () => {
  const result = selector.select(input(2, 800, {
    failedIds: new Set(['near']),
  }));

  expect(result.target.map((tile) => tile.id)).toEqual(['root', 'far']);
  expect(result.fallbackByTargetId.get('far')).toBe('root');
});

test('never refines content with zero geometric error', () => {
  const root = {
    ...tree(),
    geometricError: 0,
  };
  const result = selector.select(input(2, 800, { root }));

  expect(result.target.map((tile) => tile.id)).toEqual(['root']);
});
