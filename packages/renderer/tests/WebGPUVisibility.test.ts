import { it } from 'node:test';
import { expect } from '../../../tests/assertions.ts';
import {
  createIndirectArguments,
  isAabbVisible,
} from '../src/WebGPUVisibility';

it('creates the WebGPU indexed-indirect argument layout', () => {
  expect([...createIndirectArguments(36, 12, 4)]).toEqual([
    36, 0, 12, 4, 0,
  ]);
});

it('rejects fractional indirect arguments', () => {
  expect(createIndirectArguments(36, 5.9, 0)).toBeUndefined();
});

it('distinguishes a box in front of the camera from one behind it', () => {
  const identity = [
    1, 0, 0, 0,
    0, 1, 0, 0,
    0, 0, 1, 0,
    0, 0, 0, 1,
  ];
  const bounds = { min: [-1, -1, -1] as const, max: [1, 1, 1] as const };
  const offscreen = [...identity];
  offscreen[12] = 100;
  const viewProjection = [
    1, 0, 0, 0,
    0, 1, 0, 0,
    0, 0, -1, -1,
    0, 0, -2, 0,
  ];
  expect(isAabbVisible(identity, bounds, viewProjection)).toBe(true);
  expect(isAabbVisible(offscreen, bounds, viewProjection)).toBe(false);
});

it('keeps an AABB that spans the whole frustum', () => {
  const identity = [
    1, 0, 0, 0,
    0, 1, 0, 0,
    0, 0, 1, 0,
    0, 0, 0, 1,
  ];
  expect(isAabbVisible(identity, {
    min: [-100, -100, -100],
    max: [100, 100, 100],
  }, identity)).toBe(true);
});
