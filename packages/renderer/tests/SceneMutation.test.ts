// 场景改动是否真的进了渲染输入。
//
// 这一组用例的由来：外部工程报告「`setLocalMatrix` 在城市场景里无效」，并据此认定
// 逐帧动画不可行。实测是误判（实例化后 draw call 恒定，加上软件光栅器逐帧抖动，
// 把「画了」看成了「没画」）。但误判能站住脚，说明我们**没有一条测试锁住这条契约**：
// 改了矩阵、改了可见性、后加进来的网格，究竟有没有变成下一次绘制的输入。
//
// 这里全部在纯数据层断言，不碰图形 API：只要这几个用例在，同类误判就不会再发生；
// 像素是否正确属于 e2e 的职责，不在这里重复。
import { test } from 'node:test';
import { expect } from '../../../tests/assertions.ts';
import {
  ICEBasicMaterial,
  ICEBoxGeometry,
  ICEMesh,
  ICEScene,
  type ICEMatrix4Tuple,
} from '@ice3/core';
import { collectRenderables } from '../src/Renderables.js';
import { collectInstanceBatches } from '../src/InstanceBatch.js';

const translation = (
  x: number,
  y: number,
  z: number,
): ICEMatrix4Tuple => [
  1, 0, 0, 0,
  0, 1, 0, 0,
  0, 0, 1, 0,
  x, y, z, 1,
];

const sceneWithPlots = (
  count: number,
): readonly { readonly scene: ICEScene; readonly plots: readonly ICEMesh[] } => {
  const scene = new ICEScene({ id: 'city' });
  const geometry = new ICEBoxGeometry({ width: 1, height: 1, depth: 1 });
  const material = new ICEBasicMaterial({ color: '#3f6fb5' });
  const plots = Array.from({ length: count }, (_value, index) => new ICEMesh({
    id: `plot-${index}`,
    position: [index * 4, 0, 0],
    geometry,
    material,
  }));
  for (const plot of plots) scene.addChild(plot);
  return { scene, plots };
};

/** 每帧重建批次，正是渲染后端的做法；返回「网格 id → 平移列」的视图。 */
const positionsOf = (
  scene: ICEScene,
): ReadonlyMap<string, readonly [number, number, number]> => {
  const batches = collectInstanceBatches(collectRenderables(scene));
  const positions = new Map<string, readonly [number, number, number]>();
  for (const batch of batches) {
    for (let index = 0; index < batch.meshIds.length; index += 1) {
      const offset = index * 16;
      positions.set(batch.meshIds[index]!, [
        batch.instanceMatrices[offset + 12]!,
        batch.instanceMatrices[offset + 13]!,
        batch.instanceMatrices[offset + 14]!,
      ]);
    }
  }
  return positions;
};

test('setLocalMatrix reaches the instance matrices of the next frame', () => {
  const { scene, plots } = sceneWithPlots(3);

  expect(positionsOf(scene).get('plot-1')).toEqual([4, 0, 0]);

  plots[1]!.setLocalMatrix(translation(4, 30, 0));
  expect(positionsOf(scene).get('plot-1')).toEqual([4, 30, 0]);

  // 邻居不受影响：逐帧动画如果会串位，城市里就是整片建筑一起飞。
  expect(positionsOf(scene).get('plot-0')).toEqual([0, 0, 0]);
  expect(positionsOf(scene).get('plot-2')).toEqual([8, 0, 0]);

  // 清掉覆盖后回到 position 描述的位置，说明两条路径读的是同一份世界矩阵。
  plots[1]!.clearLocalMatrix();
  expect(positionsOf(scene).get('plot-1')).toEqual([4, 0, 0]);
});

test('a mesh added after the first frame joins the batch on the next one', () => {
  const { scene, plots } = sceneWithPlots(1);

  // 落单的网格走单体通道，不该被塞进实例批。
  expect(collectInstanceBatches(collectRenderables(scene))).toHaveLength(0);

  const existing = plots[0]!;
  scene.addChild(new ICEMesh({
    id: 'plot-1',
    position: [2, 0, 0],
    geometry: existing.geometry,
    material: existing.material,
  }));

  const batches = collectInstanceBatches(collectRenderables(scene));
  expect(batches).toHaveLength(1);
  expect(batches[0]!.meshIds).toEqual(['plot-0', 'plot-1']);
  expect(batches[0]!.instanceMatrices).toHaveLength(32);
  expect(batches[0]!.instanceMatrices[28]).toBe(2);
});

test('a hidden mesh drops out of the batch without disturbing its neighbours', () => {
  const { scene, plots } = sceneWithPlots(3);

  plots[1]!.visible = false;
  const batches = collectInstanceBatches(collectRenderables(scene));
  expect(batches).toHaveLength(1);
  expect(batches[0]!.meshIds).toEqual(['plot-0', 'plot-2']);
  expect(positionsOf(scene).get('plot-2')).toEqual([8, 0, 0]);

  plots[1]!.visible = true;
  expect(positionsOf(scene).get('plot-1')).toEqual([4, 0, 0]);
});

test('a lone mesh carries the same matrix through the standalone path', () => {
  const scene = new ICEScene({ id: 'city' });
  const mesh = new ICEMesh({
    id: 'unique',
    geometry: new ICEBoxGeometry({ width: 1, height: 2, depth: 1 }),
    material: new ICEBasicMaterial({ color: '#c46a3a' }),
  });
  scene.addChild(mesh);

  const read = (): readonly number[] => {
    const renderables = collectRenderables(scene);
    expect(renderables).toHaveLength(1);
    return [...renderables[0]!.worldMatrix];
  };

  expect(read()[12]).toBe(0);
  mesh.setLocalMatrix(translation(7, 1, -2));
  expect(read()[12]).toBe(7);
  expect(read()[13]).toBe(1);
  expect(read()[14]).toBe(-2);
});
