import { test } from 'node:test';
import { expect } from '../../../tests/assertions.ts';
import { ICEMatrix4 } from '@ice3/core';
import {
  ndcFromViewPosition,
  screenRadiusForWorldRadius,
  viewPositionFromNdc,
  type PerspectiveProjection,
} from '../src/WebGL2DepthMath.js';

function projection(near: number, far: number): PerspectiveProjection {
  const matrix = new ICEMatrix4().perspective(45, 16 / 9, near, far);
  return { elements: matrix.elements, near, far };
}

const NEAR = 0.1;
const FAR = 1000;

test('a fragment on the view axis lands at its own depth', () => {
  const p = projection(NEAR, FAR);
  const depth = 0.5;
  const [x, y, z] = viewPositionFromNdc(0, 0, depth, p);
  expect(x).toBeCloseTo(0, 4);
  expect(y).toBeCloseTo(0, 4);
  // 圆整回 NDC 应当回到同一个深度
  const [, , backZ] = ndcFromViewPosition([x, y, z], p);
  expect(backZ * 0.5 + 0.5).toBeCloseTo(depth, 4);
});

test('reconstruction inverts the projection for several depths', () => {
  const p = projection(NEAR, FAR);
  for (const depth of [0.2, 0.5, 0.9, 0.99]) {
    const [x, y, z] = viewPositionFromNdc(0.3, -0.4, depth, p);
    const [nx, ny, nz] = ndcFromViewPosition([x, y, z], p);
    expect(nx).toBeCloseTo(0.3, 3);
    expect(ny).toBeCloseTo(-0.4, 3);
    expect(nz * 0.5 + 0.5).toBeCloseTo(depth, 3);
  }
});

test('nearer fragments sit closer to the camera', () => {
  const p = projection(NEAR, FAR);
  const near = viewPositionFromNdc(0, 0, 0.3, p)[2];
  const far = viewPositionFromNdc(0, 0, 0.9, p)[2];
  // 视空间里相机看向 −Z，越近 z 越大（越接近 0）
  expect(near).toBeGreaterThan(far);
  expect(near).toBeLessThan(0);
});

test('a world radius covers fewer pixels far away', () => {
  const p = projection(NEAR, FAR);
  const close = screenRadiusForWorldRadius(1, 10, 900, p);
  const distant = screenRadiusForWorldRadius(1, 300, 900, p);
  expect(close).toBeGreaterThan(distant);
  // 距离放大 30 倍，像素半径应当缩小约 30 倍
  expect(close / distant).toBeCloseTo(30, 0);
});
