//! 场景包围盒：给阴影视锥用。
//!
//! 引擎里没有现成的场景 bounds，而阴影视锥必须贴合实际内容——写死范围会让
//! 深度精度和贴图分辨率一起浪费（见 ShadowFrustum）。这里按"几何局部包围盒
//! 缓存 + 世界矩阵变换"累加，避免每帧扫描几十万个顶点。

import type { ICEGeometry } from '@ice3/core';
import type { ICEGeometryRenderable } from './Renderables.js';
import type { ICEBounds } from './ShadowFrustum.js';

type LocalBounds = Readonly<{
  min: readonly [number, number, number];
  max: readonly [number, number, number];
}>;

const localBoundsCache = new WeakMap<ICEGeometry, LocalBounds>();

/** 几何的局部包围盒：只在首次见到该几何时扫描一遍顶点。 */
export function geometryLocalBounds(geometry: ICEGeometry): LocalBounds | null {
  const cached = localBoundsCache.get(geometry);
  if (cached) return cached;
  const positions = geometry.positions;
  if (!positions || positions.length < 3) return null;
  let minX = Infinity;
  let minY = Infinity;
  let minZ = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  let maxZ = -Infinity;
  for (let index = 0; index + 2 < positions.length; index += 3) {
    const x = positions[index]!;
    const y = positions[index + 1]!;
    const z = positions[index + 2]!;
    if (x < minX) minX = x;
    if (y < minY) minY = y;
    if (z < minZ) minZ = z;
    if (x > maxX) maxX = x;
    if (y > maxY) maxY = y;
    if (z > maxZ) maxZ = z;
  }
  const bounds = { min: [minX, minY, minZ] as const, max: [maxX, maxY, maxZ] as const };
  localBoundsCache.set(geometry, bounds);
  return bounds;
}

/**
 * 累加所有可渲染网格的世界包围盒。返回 `null` 表示场景是空的，
 * 调用方应退回默认视锥而不是用空盒子去拟合（否则视锥退化成一条线）。
 */
export function accumulateSceneBounds(
  renderables: readonly ICEGeometryRenderable[],
): ICEBounds | null {
  let minX = Infinity;
  let minY = Infinity;
  let minZ = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  let maxZ = -Infinity;
  let seen = false;
  for (const renderable of renderables) {
    const local = geometryLocalBounds(renderable.mesh.geometry);
    if (!local) continue;
    const matrix = renderable.worldMatrix;
    for (let corner = 0; corner < 8; corner += 1) {
      const x = corner & 1 ? local.max[0] : local.min[0];
      const y = corner & 2 ? local.max[1] : local.min[1];
      const z = corner & 4 ? local.max[2] : local.min[2];
      const worldX = matrix[0]! * x + matrix[4]! * y + matrix[8]! * z + matrix[12]!;
      const worldY = matrix[1]! * x + matrix[5]! * y + matrix[9]! * z + matrix[13]!;
      const worldZ = matrix[2]! * x + matrix[6]! * y + matrix[10]! * z + matrix[14]!;
      if (worldX < minX) minX = worldX;
      if (worldY < minY) minY = worldY;
      if (worldZ < minZ) minZ = worldZ;
      if (worldX > maxX) maxX = worldX;
      if (worldY > maxY) maxY = worldY;
      if (worldZ > maxZ) maxZ = worldZ;
      seen = true;
    }
  }
  return seen ? { min: [minX, minY, minZ], max: [maxX, maxY, maxZ] } : null;
}
