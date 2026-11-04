import {
  ICEBasicMaterial,
  ICEBoxGeometry,
  type ICEGeometry,
  ICEIndexedGeometry,
  ICEMesh,
} from '@ice3/core';
import { test } from 'node:test';
import { expect } from '../../../tests/assertions.ts';
import { accumulateSceneBounds, geometryLocalBounds } from '../src/SceneBounds.js';
import type { ICEGeometryRenderable } from '../src/Renderables.js';

function renderable(
  id: string,
  geometry: ICEBoxGeometry | ICEIndexedGeometry,
  matrix?: readonly number[],
): ICEGeometryRenderable {
  const mesh = new ICEMesh({
    id,
    selectionId: `selection-${id}`,
    geometry,
    material: new ICEBasicMaterial({ color: '#8899aa' }),
    ...(matrix ? { matrix: [...matrix] } : {}),
  });
  return { id, mesh, worldMatrix: mesh.updateWorldMatrix().elements };
}

test('derives the local bounds of a box from its vertices', () => {
  const bounds = geometryLocalBounds(new ICEBoxGeometry({ width: 4, height: 2, depth: 6 }));
  expect(bounds).not.toBe(null);
  expect(bounds!.min[0]).toBeCloseTo(-2, 5);
  expect(bounds!.max[0]).toBeCloseTo(2, 5);
  expect(bounds!.min[1]).toBeCloseTo(-1, 5);
  expect(bounds!.max[2]).toBeCloseTo(3, 5);
});

test('accumulates world bounds across translated meshes', () => {
  const geometry = new ICEBoxGeometry({ width: 2, height: 2, depth: 2 });
  const renderables = [
    renderable('a', geometry),
    renderable('b', geometry, [
      1, 0, 0, 0,
      0, 1, 0, 0,
      0, 0, 1, 0,
      10, 0, 0, 1,
    ]),
  ];
  const bounds = accumulateSceneBounds(renderables);
  expect(bounds).not.toBe(null);
  // 两个 2×2×2 的盒子，一个在原点、一个沿 x 平移 10：整体从 -1 到 11。
  expect(bounds!.min[0]).toBeCloseTo(-1, 5);
  expect(bounds!.max[0]).toBeCloseTo(11, 5);
});

test('returns null for an empty scene instead of a degenerate box', () => {
  expect(accumulateSceneBounds([])).toBe(null);
});

test('ignores geometry without positions', () => {
  // 空顶点表在引擎里构造不出来（几何在构造期就校验），但渲染路径仍要防住
  // 这种输入：包围盒退化成 Infinity 会让整个阴影视锥失效。
  const empty = { positions: new Float32Array(0) } as unknown as ICEGeometry;
  expect(geometryLocalBounds(empty)).toBe(null);
  expect(accumulateSceneBounds([renderable('empty', empty as unknown as ICEIndexedGeometry)]))
    .toBe(null);
});
