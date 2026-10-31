import type {
  ICEPreparedAssetSnapshot,
  ICEPreparedStats,
  ICEPreviewGeometryPacket,
} from '@ice3/assets';
import {
  ICEBasicMaterial,
  ICEIndexedGeometry,
  ICEMesh,
  ICENode,
  ICEScene,
  type ICEGeometryBounds,
  type ICEGeometryBufferUpdate,
  type ICEMatrix4Tuple,
} from '@ice3/core';
import { ICERenderBatch } from './ICERenderBatch.js';

export interface ICEBuiltAsset {
  readonly scene: ICEScene;
  readonly bounds: ICEGeometryBounds;
  readonly stats: ICEPreparedStats;
}

export interface ICEBuiltPreviewPacket {
  readonly scene: ICEScene;
  readonly geometries: ReadonlyMap<string, ICEIndexedGeometry>;
  readonly geometryUpdates: ReadonlyMap<string, ICEGeometryBufferUpdate>;
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
      ...(geometry.semanticIndices
        ? { semanticIndices: geometry.semanticIndices }
        : {}),
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
    const node = snapshot.batching && geometry && material
      ? new ICERenderBatch({
          id: source.id,
          displayName: source.name,
          ...(source.metadata ? { metadata: source.metadata } : {}),
          matrix: source.matrix,
          geometry,
          material,
          semanticIds: snapshot.batching.semanticIds,
          semanticNodeIds: snapshot.batching.semanticNodeIds,
          semanticSelectionIds: snapshot.batching.semanticSelectionIds,
          materialKey: `${mesh!.material}`,
        })
      : geometry && material
        ? new ICEMesh({
          id: source.id,
          displayName: source.name,
          ...(source.metadata ? { metadata: source.metadata } : {}),
          selectionId: source.selectionId,
          matrix: source.matrix,
          geometry,
          material,
          })
        : new ICENode({
          id: source.id,
          displayName: source.name,
          ...(source.metadata ? { metadata: source.metadata } : {}),
          selectionId: source.selectionId,
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

export function buildPreviewPacketScene(
  packet: ICEPreviewGeometryPacket,
  previousGeometries: ReadonlyMap<string, ICEIndexedGeometry> = new Map(),
): ICEBuiltPreviewPacket {
  const geometries = new Map<string, ICEIndexedGeometry>();
  const geometryUpdates = new Map<string, ICEGeometryBufferUpdate>();
  for (const source of packet.geometries) {
    const previous = previousGeometries.get(source.geometryId);
    if (
      previous
      && previous.identity.topologyDigest === source.topologyDigest
      && previous.identity.attributeDigest === source.attributeDigest
    ) {
      geometries.set(source.geometryId, previous);
      continue;
    }
    const identity = Object.freeze({
      geometryId: source.geometryId,
      topologyDigest: source.topologyDigest,
      attributeDigest: source.attributeDigest,
    });
    const geometry = new ICEIndexedGeometry({
      id: source.residentGeometryId ?? source.geometryId,
      identity,
      positions: source.positions,
      indices: source.indices,
    });
    geometries.set(source.geometryId, geometry);
    const attributeRanges = source.ranges.filter(
      (range) => range.usage === 'vertex_attributes',
    );
    const attributeStart = Math.min(
      ...attributeRanges.map((range) => range.byteOffset),
    );
    geometryUpdates.set(source.geometryId, Object.freeze({
      positionRanges: Object.freeze(attributeRanges.map((range) => Object.freeze({
        byteOffset: range.byteOffset - attributeStart,
        byteLength: range.byteLength,
      }))),
    }));
  }

  const materials = new Map(
    packet.materials.map((material) => [
      material.materialId,
      new ICEBasicMaterial({
        color: colorHex(material.baseColor),
      }),
    ]),
  );
  const defaultMaterial = new ICEBasicMaterial({
    color: '#9aa6b2',
  });
  const scene = new ICEScene({ id: `packet:${packet.revision}:scene` });
  const nodes = new Map<string, ICENode>();
  for (const source of packet.nodes) {
    const geometry = source.geometryId
      ? geometries.get(source.geometryId)
      : undefined;
    const material = source.materialId
      ? materials.get(source.materialId) ?? defaultMaterial
      : defaultMaterial;
    const options = {
      id: source.nodeId,
      displayName: source.name,
      selectionId: source.nodeId,
      matrix: source.matrix as ICEMatrix4Tuple,
    };
    const node = geometry
      ? new ICEMesh({
        ...options,
        geometry,
        material,
      })
      : new ICENode(options);
    node.visible = source.visible;
    nodes.set(source.nodeId, node);
  }
  for (const source of packet.nodes) {
    const node = nodes.get(source.nodeId)!;
    const parent = source.parentId ? nodes.get(source.parentId) : undefined;
    if (source.parentId && !parent) {
      throw new Error(
        `ICE3_PREVIEW_PACKET_INVALID: parent node ${source.parentId} is missing`,
      );
    }
    (parent ?? scene).addChild(node);
  }
  return {
    scene,
    geometries,
    geometryUpdates,
  };
}

function colorHex(color: readonly [number, number, number, number]): string {
  const channel = (value: number): string => Math.round(
    Math.max(0, Math.min(1, value)) * 0xff,
  ).toString(16).padStart(2, '0');
  return `#${channel(color[0])}${channel(color[1])}${channel(color[2])}`;
}
