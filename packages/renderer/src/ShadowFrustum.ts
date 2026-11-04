//! 阴影视锥：按场景包围盒拟合方向光的正交投影。
//!
//! 早期实现把光照视锥写死成 860 米见方、960 米深。两个后果都很贵：
//! 2048 的深度图摊到 860 米是每纹素 0.42 米（薄墙的影子直接消失），
//! 而深度偏差 0.0015 在 960 米的跨度上等于 1.4 米，短影子被整段吃掉。
//! 视锥贴合场景后，偏差回到"厘米"量级，贴图分辨率也才有意义。

import { ICEMatrix4, ICEVector3 } from '@ice3/core';

export type ICEBounds = Readonly<{
  min: readonly [number, number, number];
  max: readonly [number, number, number];
}>;

/** 光源方向（与主着色器、阴影 pass 共用同一约定：指向"光传播"的方向）。 */
export const SHADOW_LIGHT_DIRECTION: readonly [number, number, number] = [-0.35, 0.85, 0.4];

/** 视锥四周留出的余量，按场景半径的比例给：贴太紧会让边缘的投影被裁掉。 */
const BOUNDS_PADDING = 0.08;

export type ICEShadowFrustum = Readonly<{
  /** 光照视图投影矩阵（列主序 16 元素）。 */
  matrix: Float32Array;
  /** 一个纹素在世界空间里的边长（米）：法线偏移量按它来算。 */
  texelWorld: number;
}>;

/**
 * 场景包围盒 → 光照视图投影矩阵（列主序 16 元素）。
 *
 * 传入 `null` 时退回一个覆盖 600 米场地的默认盒，避免直接抛错：
 * 阴影是可选效果，宁可保守覆盖也不要整帧失败。
 */
export function shadowFrustum(bounds: ICEBounds | null, mapSize = 2048): ICEShadowFrustum {
  const box = bounds ?? { min: [-50, -5, -50] as const, max: [650, 60, 650] as const };
  const centre: [number, number, number] = [
    (box.min[0] + box.max[0]) / 2,
    (box.min[1] + box.max[1]) / 2,
    (box.min[2] + box.max[2]) / 2,
  ];
  const radius = Math.max(
    1,
    0.5 * Math.hypot(
      box.max[0] - box.min[0],
      box.max[1] - box.min[1],
      box.max[2] - box.min[2],
    ),
  );
  const pad = radius * BOUNDS_PADDING;
  const direction = normalize(SHADOW_LIGHT_DIRECTION);
  const distance = radius * 2 + pad * 2;
  const eye: [number, number, number] = [
    centre[0] + direction[0] * distance,
    centre[1] + direction[1] * distance,
    centre[2] + direction[2] * distance,
  ];

  const view = new ICEMatrix4().lookAt(
    new ICEVector3(eye[0], eye[1], eye[2]),
    new ICEVector3(centre[0], centre[1], centre[2]),
    new ICEVector3(0, 1, 0),
  );

  // 把八个角投到视图空间，取紧贴的 x/y/z 范围——这就是视锥的真实尺寸。
  let minX = Infinity;
  let maxX = -Infinity;
  let minY = Infinity;
  let maxY = -Infinity;
  let minZ = Infinity;
  let maxZ = -Infinity;
  for (let corner = 0; corner < 8; corner += 1) {
    const point = new ICEVector3(
      corner & 1 ? box.max[0] : box.min[0],
      corner & 2 ? box.max[1] : box.min[1],
      corner & 4 ? box.max[2] : box.min[2],
    );
    const projected = view.transformPoint(point);
    minX = Math.min(minX, projected[0]);
    maxX = Math.max(maxX, projected[0]);
    minY = Math.min(minY, projected[1]);
    maxY = Math.max(maxY, projected[1]);
    // lookAt 的 z 轴指向相机后方，面前的点 z 为负；正交投影的 near/far 要取反。
    minZ = Math.min(minZ, projected[2]);
    maxZ = Math.max(maxZ, projected[2]);
  }

  const projection = orthographic(
    minX - pad,
    maxX + pad,
    minY - pad,
    maxY + pad,
    -maxZ - pad,
    -minZ + pad,
  );
  const width = (maxX - minX) + pad * 2;
  const height = (maxY - minY) + pad * 2;
  return {
    matrix: multiply(projection, view.elements),
    texelWorld: Math.max(width, height) / mapSize,
  };
}

function normalize(value: readonly [number, number, number]): [number, number, number] {
  const length = Math.hypot(value[0], value[1], value[2]) || 1;
  return [value[0] / length, value[1] / length, value[2] / length];
}

function orthographic(
  left: number,
  right: number,
  bottom: number,
  top: number,
  near: number,
  far: number,
): number[] {
  const lr = 1 / (left - right);
  const bt = 1 / (bottom - top);
  const nf = 1 / (near - far);
  return [
    -2 * lr, 0, 0, 0,
    0, -2 * bt, 0, 0,
    0, 0, 2 * nf, 0,
    (left + right) * lr, (top + bottom) * bt, (far + near) * nf, 1,
  ];
}

function multiply(
  a: readonly number[] | Float32Array,
  b: readonly number[] | Float32Array,
): Float32Array {
  const out = new Float32Array(16);
  for (let column = 0; column < 4; column += 1) {
    for (let row = 0; row < 4; row += 1) {
      let sum = 0;
      for (let k = 0; k < 4; k += 1) {
        sum += (a[k * 4 + row] ?? 0) * (b[column * 4 + k] ?? 0);
      }
      out[column * 4 + row] = sum;
    }
  }
  return out;
}
