import type {
  ICEGeometryBounds,
  ICEMatrix4Tuple,
} from '@ice3/core';
import type {
  ICEPreparedAssetSnapshot,
  ICEPreparedGeometry,
  ICEPreparedMaterial,
  ICEPreparedMesh,
  ICEPreparedNode,
} from './ICEPreparedGLB.js';
import {
  record,
  records,
  validatePreparedProfile,
} from './ICEProfileValidator.js';

type JSONRecord = Record<string, unknown>;

export function readPreparedGLB(bytes: ArrayBuffer): ICEPreparedAssetSnapshot {
  const { json, binary, profile } = parseGLB(bytes);
  const accessors = records(json.accessors);
  const views = records(json.bufferViews);
  const sourceNodes = records(json.nodes);
  const sourceMeshes = records(json.meshes);
  const sourceMaterials = records(json.materials);
  const parents = new Array<number | null>(sourceNodes.length).fill(null);
  for (const [index, node] of sourceNodes.entries()) {
    for (const child of integers(node.children)) {
      if (child < 0 || child >= sourceNodes.length) {
        throw assetError('ICE3_ASSET_INVALID_GLB', 'node child index is invalid');
      }
      parents[child] = index;
    }
  }

  const nodes: ICEPreparedNode[] = sourceNodes.map((node, index) => {
    const id = record(record(node.extras)?.ice3)?.id;
    if (typeof id !== 'string') {
      throw assetError('ICE3_ASSET_INVALID_GLB', 'node identity is missing');
    }
    return {
      id,
      name: typeof node.name === 'string' ? node.name : id,
      parent: parents[index] ?? null,
      matrix: node.matrix as ICEMatrix4Tuple,
      visible: record(record(node.extras)?.ice3)?.visible !== false,
    };
  });

  const geometries: ICEPreparedGeometry[] = [];
  const materials: ICEPreparedMaterial[] = [];
  const meshes: ICEPreparedMesh[] = [];
  for (const [meshIndex, mesh] of sourceMeshes.entries()) {
    const meshId = record(record(mesh.extras)?.ice3)?.id;
    if (typeof meshId !== 'string') {
      throw assetError('ICE3_ASSET_INVALID_GLB', 'mesh identity is missing');
    }
    const primitives = records(mesh.primitives);
    const nodesForMesh = sourceNodes
      .map((node, index) => ({ node, index }))
      .filter((entry) => Number(entry.node.mesh) === meshIndex);
    for (const [primitiveIndex, primitive] of primitives.entries()) {
      if (Number(primitive.mode ?? 4) !== 4) continue;
      const positionIndex = Number(record(primitive.attributes)?.POSITION);
      const triangleIndex = Number(primitive.indices);
      const positions = readFloatAccessor(
        binary,
        views,
        accessors[positionIndex],
      );
      const colorAccessorIndex = record(primitive.attributes)?.COLOR_0;
      const colors = colorAccessorIndex === undefined
        ? undefined
        : readColorAccessor(
            binary,
            views,
            accessors[Number(colorAccessorIndex)],
            positions.length / 3,
          );
      const indices = readIndexAccessor(
        binary,
        views,
        accessors[triangleIndex],
      );
      validateIndexRange(indices, positions.length / 3);
      const edgePrimitive = primitives.find((candidate) => (
        Number(candidate.mode) === 1
        && Number(record(candidate.attributes)?.POSITION) === positionIndex
      ));
      const edgeIndices = edgePrimitive
        ? readIndexAccessor(binary, views, accessors[Number(edgePrimitive.indices)])
        : undefined;
      if (edgeIndices) validateIndexRange(edgeIndices, positions.length / 3);
      const baseMaterial = sourceMaterials[Number(primitive.material)];
      const edgeMaterial = edgePrimitive
        ? sourceMaterials[Number(edgePrimitive.material)]
        : undefined;
      const materialIndex = materials.length;
      materials.push({
        id: `${meshId}/material/${primitiveIndex}`,
        baseColor: materialColor(baseMaterial),
        ...(edgeMaterial ? { edgeColor: materialColor(edgeMaterial) } : {}),
      });
      const bounds = boundsFromAccessor(accessors[positionIndex]);
      const geometryIndex = geometries.length;
      geometries.push({
        id: `${meshId}/geometry/${primitiveIndex}`,
        positions,
        indices,
        ...(edgeIndices ? { edgeIndices } : {}),
        ...(colors ? { colors } : {}),
        bounds,
      });
      for (const entry of nodesForMesh) {
        meshes.push({
          id: `${meshId}/primitive/${primitiveIndex}/${entry.index}`,
          node: entry.index,
          geometry: geometryIndex,
          material: materialIndex,
        });
      }
    }
  }

  return {
    assetId: String(profile.assetId),
    bounds: boundsFromProfile(profile.bounds),
    stats: {
      nodeCount: Number(record(profile.stats)?.nodeCount ?? nodes.length),
      meshCount: Number(record(profile.stats)?.meshCount ?? sourceMeshes.length),
      triangleCount: Number(record(profile.stats)?.triangleCount ?? 0),
    },
    nodes,
    geometries,
    materials,
    meshes,
  };
}

export async function verifyPreparedGLBIntegrity(
  bytes: ArrayBuffer,
): Promise<boolean> {
  const { binary, profile } = parseGLB(bytes);
  const digest = record(profile.contentDigest);
  if (
    digest?.algorithm !== 'sha256'
    || digest.covers !== 'binary-chunk'
    || typeof digest.value !== 'string'
  ) {
    return false;
  }
  const hashed = await crypto.subtle.digest('SHA-256', Uint8Array.from(binary));
  const value = [...new Uint8Array(hashed)]
    .map((part) => part.toString(16).padStart(2, '0'))
    .join('');
  return value === digest.value.toLowerCase();
}

function parseGLB(bytes: ArrayBuffer): ReturnType<typeof validatePreparedProfile> {
  const view = new DataView(bytes);
  if (
    bytes.byteLength < 12
    || view.getUint32(0, true) !== 0x46546c67
    || view.getUint16(4, true) !== 2
    || view.getUint32(8, true) !== bytes.byteLength
  ) {
    throw assetError('ICE3_ASSET_INVALID_GLB', 'GLB header is invalid');
  }
  let offset = 12;
  let index = 0;
  let json: JSONRecord | undefined;
  let binary: Uint8Array | undefined;
  while (offset < bytes.byteLength) {
    if (offset + 8 > bytes.byteLength) {
      throw assetError('ICE3_ASSET_INVALID_GLB', 'GLB chunk header is truncated');
    }
    const length = view.getUint32(offset, true);
    const type = view.getUint32(offset + 4, true);
    if (length % 4 !== 0 || offset + 8 + length > bytes.byteLength) {
      throw assetError('ICE3_ASSET_INVALID_GLB', 'GLB chunk length is invalid');
    }
    const chunk = new Uint8Array(bytes, offset + 8, length);
    if (index === 0) {
      if (type !== 0x4e4f534a) {
        throw assetError('ICE3_ASSET_INVALID_GLB', 'JSON chunk must be first');
      }
      let parsed: unknown;
      try {
        parsed = JSON.parse(
          new TextDecoder().decode(chunk).replace(/ +$/g, ''),
        );
      } catch {
        throw assetError('ICE3_ASSET_INVALID_GLB', 'JSON chunk is invalid');
      }
      if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
        throw assetError('ICE3_ASSET_INVALID_GLB', 'JSON root is invalid');
      }
      json = parsed as JSONRecord;
    } else if (type === 0x004e4942) {
      if (index !== 1 || binary) {
        throw assetError('ICE3_ASSET_INVALID_GLB', 'BIN chunk is invalid');
      }
      binary = chunk;
    }
    offset += 8 + length;
    index += 1;
  }
  if (!json || !binary) {
    throw assetError('ICE3_ASSET_INVALID_GLB', 'required chunks are missing');
  }
  return validatePreparedProfile(json, binary);
}

function readFloatAccessor(
  binary: Uint8Array,
  views: readonly JSONRecord[],
  accessor: JSONRecord | undefined,
): Float32Array {
  if (
    !accessor
    || accessor.componentType !== 5126
    || accessor.type !== 'VEC3'
  ) {
    throw assetError('ICE3_ASSET_ACCESSOR_INVALID', 'POSITION must be float VEC3');
  }
  const offset = accessorOffset(binary, views, accessor);
  const count = Number(accessor.count) * 3;
  return new Float32Array(binary.buffer, binary.byteOffset + offset, count);
}

function readIndexAccessor(
  binary: Uint8Array,
  views: readonly JSONRecord[],
  accessor: JSONRecord | undefined,
): Uint16Array | Uint32Array {
  if (
    !accessor
    || accessor.type !== 'SCALAR'
    || (accessor.componentType !== 5123 && accessor.componentType !== 5125)
  ) {
    throw assetError('ICE3_ASSET_ACCESSOR_INVALID', 'indices must be unsigned scalars');
  }
  const offset = accessorOffset(binary, views, accessor);
  const count = Number(accessor.count);
  return accessor.componentType === 5123
    ? new Uint16Array(binary.buffer, binary.byteOffset + offset, count)
    : new Uint32Array(binary.buffer, binary.byteOffset + offset, count);
}

function readColorAccessor(
  binary: Uint8Array,
  views: readonly JSONRecord[],
  accessor: JSONRecord | undefined,
  vertexCount: number,
): Float32Array {
  if (
    !accessor
    || accessor.componentType !== 5126
    || accessor.type !== 'VEC3'
    || Number(accessor.count) !== vertexCount
  ) {
    throw assetError(
      'ICE3_ASSET_ACCESSOR_INVALID',
      'COLOR_0 must be float VEC3 matching the position count',
    );
  }
  const offset = accessorOffset(binary, views, accessor);
  return new Float32Array(
    binary.buffer,
    binary.byteOffset + offset,
    vertexCount * 3,
  );
}

function accessorOffset(
  binary: Uint8Array,
  views: readonly JSONRecord[],
  accessor: JSONRecord,
): number {
  const view = views[Number(accessor.bufferView)];
  if (!view) {
    throw assetError('ICE3_ASSET_ACCESSOR_INVALID', 'bufferView is missing');
  }
  const offset = Number(view.byteOffset ?? 0) + Number(accessor.byteOffset ?? 0);
  const componentBytes = accessor.componentType === 5126
    ? 4
    : accessor.componentType === 5123
      ? 2
      : 4;
  const componentCount = accessor.type === 'VEC3' ? 3 : 1;
  const required = Number(accessor.count) * componentBytes * componentCount;
  if (
    !Number.isInteger(offset)
    || offset < 0
    || offset % componentBytes !== 0
    || required > Number(view.byteLength)
    || offset + required > binary.byteLength
  ) {
    throw assetError('ICE3_ASSET_ACCESSOR_INVALID', 'accessor exceeds its buffer');
  }
  return offset;
}

function validateIndexRange(
  indices: Uint16Array | Uint32Array,
  vertexCount: number,
): void {
  if (indices.some((index) => index >= vertexCount)) {
    throw assetError('ICE3_ASSET_ACCESSOR_INVALID', 'index exceeds vertex count');
  }
}

function boundsFromAccessor(accessor: JSONRecord | undefined): ICEGeometryBounds {
  const min = accessor?.min;
  const max = accessor?.max;
  if (!Array.isArray(min) || !Array.isArray(max) || min.length !== 3 || max.length !== 3) {
    throw assetError('ICE3_ASSET_ACCESSOR_INVALID', 'POSITION bounds are missing');
  }
  return {
    min: [Number(min[0]), Number(min[1]), Number(min[2])],
    max: [Number(max[0]), Number(max[1]), Number(max[2])],
  };
}

function boundsFromProfile(value: unknown): ICEGeometryBounds {
  const bounds = record(value);
  const min = bounds?.min;
  const max = bounds?.max;
  if (!Array.isArray(min) || !Array.isArray(max) || min.length !== 3 || max.length !== 3) {
    throw assetError('ICE3_ASSET_INVALID_GLB', 'profile bounds are invalid');
  }
  return {
    min: [Number(min[0]), Number(min[1]), Number(min[2])],
    max: [Number(max[0]), Number(max[1]), Number(max[2])],
  };
}

function materialColor(material: JSONRecord | undefined): string {
  if (!material) return '#808080';
  const color = record(material.pbrMetallicRoughness)?.baseColorFactor;
  if (!Array.isArray(color) || color.length < 3) return '#808080';
  return `#${color.slice(0, 3).map((value) => (
    Math.round(Math.min(1, Math.max(0, Number(value))) * 255)
      .toString(16)
      .padStart(2, '0')
  )).join('')}`;
}

function integers(value: unknown): number[] {
  return Array.isArray(value)
    ? value.filter((entry): entry is number => Number.isInteger(entry))
    : [];
}

function assetError(code: string, message: string): Error {
  return new Error(`${code}: ${message}`);
}
