import type {
  ICEPreparedAssetSnapshot,
  ICEPreparedStats,
} from '@ice3/assets';
import {
  ICEBasicMaterial,
  ICEIndexedGeometry,
  ICEMesh,
  ICENode,
  ICEScene,
  type ICEGeometryBounds,
} from '@ice3/core';

export interface ICEBuiltAsset {
  readonly scene: ICEScene;
  readonly bounds: ICEGeometryBounds;
  readonly stats: ICEPreparedStats;
}

export function buildAssetScene(
  snapshot: ICEPreparedAssetSnapshot,
): ICEBuiltAsset {
  const geometries = snapshot.geometries.map((geometry) => (
    new ICEIndexedGeometry({
      id: geometry.id,
      positions: geometry.positions,
      indices: geometry.indices,
      ...(geometry.edgeIndices ? { edgeIndices: geometry.edgeIndices } : {}),
      ...(geometry.colors ? { colors: geometry.colors } : {}),
    })
  ));
  const materials = snapshot.materials.map((material) => (
    new ICEBasicMaterial({
      color: material.baseColor,
      ...(material.edgeColor ? { edgeColor: material.edgeColor } : {}),
    })
  ));
  const meshesByNode = new Map<number, typeof snapshot.meshes[number][]>();
  for (const mesh of snapshot.meshes) {
    const entries = meshesByNode.get(mesh.node) ?? [];
    entries.push(mesh);
    meshesByNode.set(mesh.node, entries);
  }

  const scene = new ICEScene({ id: `${snapshot.assetId}:scene` });
  const nodes: ICENode[] = snapshot.nodes.map((source, index) => {
    const mesh = meshesByNode.get(index)?.[0];
    const geometry = mesh ? geometries[mesh.geometry] : undefined;
    const material = mesh ? materials[mesh.material] : undefined;
    const node = geometry && material
      ? new ICEMesh({
          id: source.id,
          displayName: source.name,
          selectionId: source.selectionId,
          matrix: source.matrix,
          geometry,
          material,
        })
      : new ICENode({
          id: source.id,
          displayName: source.name,
          matrix: source.matrix,
        });
    node.visible = source.visible;
    return node;
  });

  for (const [index, node] of nodes.entries()) {
    const source = snapshot.nodes[index]!;
    const parentIndex = snapshot.nodes[index]!.parent;
    if (parentIndex === null) {
      scene.addChild(node);
    } else {
      const parent = nodes[parentIndex];
      if (!parent) {
        throw new Error(`ICE3_ASSET_INVALID_GLB: parent node ${parentIndex} is missing`);
      }
      parent.addChild(node);
    }

    for (const mesh of meshesByNode.get(index)?.slice(1) ?? []) {
      const geometry = geometries[mesh.geometry];
      const material = materials[mesh.material];
      if (!geometry || !material) {
        throw new Error('ICE3_ASSET_INVALID_GLB: mesh references are invalid');
      }
      node.addChild(new ICEMesh({
        id: mesh.id,
        displayName: source.name,
        selectionId: source.selectionId,
        geometry,
        material,
      }));
    }
  }

  return {
    scene,
    bounds: snapshot.bounds,
    stats: snapshot.stats,
  };
}
