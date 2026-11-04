import { test } from 'node:test';
import { expect } from '../../../tests/assertions.ts';
import { boxProjectedUv } from '../src/WebGL2Uv.js';

test('each face is projected on its own plane', () => {
  const position = [1, 2, 3] as const;
  expect(boxProjectedUv(position, [1, 0, 0])).toEqual([-3, 2]);
  expect(boxProjectedUv(position, [0, 1, 0])).toEqual([1, 3]);
  expect(boxProjectedUv(position, [0, 0, 1])).toEqual([1, 2]);
});

test('opposite faces are not mirrored', () => {
  const position = [1, 2, 3] as const;
  expect(boxProjectedUv(position, [-1, 0, 0])).toEqual([3, 2]);
  expect(boxProjectedUv(position, [0, -1, 0])).toEqual([1, -3]);
  expect(boxProjectedUv(position, [0, 0, -1])).toEqual([-1, 2]);
});

test('the dominant axis wins a tie', () => {
  expect(boxProjectedUv([1, 1, 1], [0.7, -0.7, 0.1])).toEqual([-1, 1]);
});

test('a degenerate normal falls back to the XY plane', () => {
  expect(boxProjectedUv([1, 1, 1], [0, 0, 0])).toEqual([1, 1]);
});

test('scale multiplies both axes independently', () => {
  expect(boxProjectedUv([1, 2, 3], [0, 1, 0], [2, 3])).toEqual([2, 9]);
});
