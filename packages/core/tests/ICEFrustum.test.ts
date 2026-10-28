import { test } from 'node:test';
import { expect } from '../../../tests/assertions.ts';
import { ICEFrustum } from '../src/culling/ICEFrustum';
import { ICEPerspectiveCamera } from '../src/camera/ICEPerspectiveCamera';

const frustum = (position = [0, 0, 5] as const) => (
  ICEFrustum.fromViewProjection(
    new ICEPerspectiveCamera({
      id: 'camera',
      fov: 60,
      near: 0.1,
      far: 100,
      position,
      target: [position[0], position[1], 0],
    }).getViewProjectionMatrix(1),
  )
);

test('keeps a bounds intersecting the camera frustum', () => {
  expect(frustum().intersectsBounds({
    min: [-1, -1, -1],
    max: [1, 1, 1],
  })).toBe(true);
});

test('rejects a bounds entirely behind the camera', () => {
  expect(frustum().intersectsBounds({
    min: [-1, -1, 7],
    max: [1, 1, 8],
  })).toBe(false);
});

test('rejects a distant lateral bounds but accepts it with a world-space margin', () => {
  const bounds = { min: [20, -1, -1], max: [21, 1, 1] } as const;
  expect(frustum().intersectsBounds(bounds, 0)).toBe(false);
  expect(frustum().intersectsBounds(bounds, 40)).toBe(true);
});

test('handles flat and point bounds deterministically', () => {
  expect(frustum().intersectsBounds({
    min: [0, 0, 0],
    max: [0, 0, 0],
  })).toBe(true);
  expect(frustum().intersectsBounds({
    min: [0, 0, 7],
    max: [0, 0, 7],
  })).toBe(false);
});
