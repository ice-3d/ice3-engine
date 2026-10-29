import type {
  ICEBasicMaterial,
  ICEGeometry,
} from '@ice3/core';
import type { ICEGeometryRenderable } from './Renderables.js';

export interface ICEInstanceBatch {
  readonly id: string;
  readonly geometry: ICEGeometry;
  readonly material: ICEBasicMaterial;
  readonly instanceMatrices: Float32Array;
  readonly semanticIds: readonly string[];
  readonly semanticIndices: Uint32Array;
  readonly meshIds: readonly string[];
  readonly materialKey: string;
}

export function collectInstanceBatches(
  renderables: readonly ICEGeometryRenderable[],
  output: ICEInstanceBatch[] = [],
): readonly ICEInstanceBatch[] {
  output.length = 0;
  const byGeometry = new Map<
    ICEGeometry,
    Map<ICEBasicMaterial, ICEGeometryRenderable[]>
  >();
  for (const renderable of renderables) {
    const byMaterial = byGeometry.get(renderable.mesh.geometry)
      ?? new Map<ICEBasicMaterial, ICEGeometryRenderable[]>();
    const group = byMaterial.get(renderable.mesh.material) ?? [];
    group.push(renderable);
    byMaterial.set(renderable.mesh.material, group);
    byGeometry.set(renderable.mesh.geometry, byMaterial);
  }
  for (const [geometry, byMaterial] of byGeometry) {
    for (const [material, group] of byMaterial) {
      if (group.length < 2) continue;
      const instanceMatrices = new Float32Array(group.length * 16);
      const semanticIndices = new Uint32Array(group.length);
      for (let index = 0; index < group.length; index += 1) {
        instanceMatrices.set(group[index]!.worldMatrix, index * 16);
        semanticIndices[index] = index;
      }
      output.push({
        id: `instance:${group[0]!.id}`,
        geometry,
        material,
        instanceMatrices,
        semanticIds: group.map((renderable) => renderable.mesh.selectionId),
        semanticIndices,
        meshIds: group.map((renderable) => renderable.id),
        materialKey: `${material.color}:${material.edgeColor ?? ''}`,
      });
    }
  }
  return output;
}
