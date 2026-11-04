import { test } from 'node:test';
import { expect } from '../../../tests/assertions.ts';
import { shadowFrustum, SHADOW_LIGHT_DIRECTION } from '../src/ShadowFrustum.js';

/** 把世界坐标乘进矩阵，得到 NDC（透视除法对正交投影是恒等）。 */
function project(
  matrix: Float32Array,
  point: readonly [number, number, number],
): [number, number, number] {
  const [x, y, z] = point;
  return [
    matrix[0]! * x + matrix[4]! * y + matrix[8]! * z + matrix[12]!,
    matrix[1]! * x + matrix[5]! * y + matrix[9]! * z + matrix[13]!,
    matrix[2]! * x + matrix[6]! * y + matrix[10]! * z + matrix[14]!,
  ];
}

test('fits every corner of the scene bounds inside the light frustum', () => {
  const bounds = { min: [0, 0, 0] as const, max: [600, 40, 300] as const };
  const { matrix } = shadowFrustum(bounds);
  for (let corner = 0; corner < 8; corner += 1) {
    const point: [number, number, number] = [
      corner & 1 ? bounds.max[0] : bounds.min[0],
      corner & 2 ? bounds.max[1] : bounds.min[1],
      corner & 4 ? bounds.max[2] : bounds.min[2],
    ];
    const projected = project(matrix, point);
    // 落在外面的角会被裁掉，症状是"厂区一半没有影子"或影子被切一刀。
    expect(projected[0]).toBeGreaterThan(-1.01);
    expect(projected[0]).toBeLessThan(1.01);
    expect(projected[1]).toBeGreaterThan(-1.01);
    expect(projected[1]).toBeLessThan(1.01);
    expect(projected[2]).toBeGreaterThan(-1.01);
    expect(projected[2]).toBeLessThan(1.01);
  }
});

test('keeps the depth range tight instead of spanning a fixed 960 metres', () => {
  const bounds = { min: [-5, 0, -5] as const, max: [5, 6, 5] as const };
  const { matrix } = shadowFrustum(bounds);
  const centre = project(matrix, [0, 3, 0]);
  const top = project(matrix, [0, 6, 0]);
  // 阴影深度是线性的：整段跨度只有十几米，而不是旧实现的 960 米。
  // 跨度越小，同一个深度偏差换算成世界尺度就越小，短影子才留得住。
  const span = Math.abs(project(matrix, [0, 0, -13])[2] - project(matrix, [0, 0, 13])[2]);
  expect(span).toBeGreaterThan(1);
  expect(centre[2]).toBeGreaterThan(-1);
  expect(top[2]).toBeLessThan(centre[2]);
});

test('reports a texel size that follows the scene extent', () => {
  const small = shadowFrustum({ min: [0, 0, 0] as const, max: [10, 10, 10] as const });
  const large = shadowFrustum({ min: [0, 0, 0] as const, max: [600, 40, 300] as const });
  // 法线偏移按纹素换算：贴图分辨率固定时，场景越大纹素越粗。
  expect(small.texelWorld).toBeGreaterThan(0);
  expect(large.texelWorld).toBeGreaterThan(small.texelWorld * 10);
});

test('falls back to a wide default box when the scene is empty', () => {
  const { matrix, texelWorld } = shadowFrustum(null);
  const centre = project(matrix, [300, 0, 300]);
  expect(Number.isFinite(centre[0])).toBe(true);
  expect(Math.abs(centre[0])).toBeLessThan(1.01);
  expect(Math.abs(centre[1])).toBeLessThan(1.01);
  expect(texelWorld).toBeGreaterThan(0);
});

test('light direction points up and towards the shader sun', () => {
  // 着色器把 lightDirection 当作"指向光源"的向量（dot(normal, lightDirection) 为正才受光）。
  expect(SHADOW_LIGHT_DIRECTION[1]).toBeGreaterThan(0.5);
});
