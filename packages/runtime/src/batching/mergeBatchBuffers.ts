import type { ICEGeometryBounds } from '@ice3/core';
import type { ICEBatchWorkerSource } from './ICEBatchWorkerProtocol.js';

export interface ICEMergedBatchBuffer {
  readonly id: string;
  readonly materialKey: string;
  readonly positions: Float32Array;
  readonly indices: Uint32Array;
  readonly semanticIndices: Uint32Array;
  readonly semanticIds: readonly string[];
  readonly semanticNodeIds: readonly string[];
  readonly semanticSelectionIds: readonly string[];
  readonly bounds: ICEGeometryBounds;
  readonly triangleCount: number;
}

export interface ICEMergeBatchBuffersOptions {
  readonly maxTrianglesPerBatch?: number;
  readonly maxBytesPerBatch?: number;
}

interface Draft {
  readonly positions: number[];
  readonly indices: number[];
  readonly semanticIndices: number[];
  triangleCount: number;
  readonly min: [number, number, number];
  readonly max: [number, number, number];
}

interface PreparedSource {
  readonly input: ICEBatchWorkerSource;
  readonly positions: Float32Array;
  readonly indices: Uint32Array;
  readonly semanticIndices: Uint32Array;
  semanticRemap: Uint32Array;
}

const BYTES_PER_TRIANGLE = 28;

export function mergeBatchBuffers(
  inputs: readonly ICEBatchWorkerSource[],
  options: ICEMergeBatchBuffersOptions = {},
): readonly ICEMergedBatchBuffer[] {
  if (inputs.length === 0) return [];
  const maxTriangles = options.maxTrianglesPerBatch ?? 500_000;
  const maxBytes = options.maxBytesPerBatch ?? 32 * 1024 * 1024;
  if (
    !Number.isInteger(maxTriangles)
    || maxTriangles < 1
    || !Number.isInteger(maxBytes)
    || maxBytes < BYTES_PER_TRIANGLE
  ) {
    throw invalid('batch limits are invalid');
  }
  const materialKey = inputs[0]!.materialKey;
  if (!materialKey.trim()) throw invalid('material key is empty');
  const ids = new Set<string>();
  const sources: PreparedSource[] = inputs.map((input) => {
    validateSource(input, materialKey, ids);
    return {
      input,
      positions: new Float32Array(input.positions),
      indices: new Uint32Array(input.indices),
      semanticIndices: new Uint32Array(input.semanticIndices),
      semanticRemap: new Uint32Array(),
    };
  }).sort((left, right) => left.input.id.localeCompare(right.input.id, 'en'));
  const semanticIds: string[] = [];
  const semanticNodeIds: string[] = [];
  const semanticSelectionIds: string[] = [];
  const semanticBySelectionId = new Map<string, number>();
  for (const source of sources) {
    const remap = new Uint32Array(source.input.semanticSelectionIds.length);
    for (let index = 0; index < remap.length; index += 1) {
      const selectionId = source.input.semanticSelectionIds[index]!;
      let target = semanticBySelectionId.get(selectionId);
      if (target === undefined) {
        target = semanticIds.length;
        semanticBySelectionId.set(selectionId, target);
        semanticIds.push(source.input.semanticIds[index]!);
        semanticNodeIds.push(source.input.semanticNodeIds[index]!);
        semanticSelectionIds.push(selectionId);
      }
      remap[index] = target;
    }
    source.semanticRemap = remap;
  }

  const output: ICEMergedBatchBuffer[] = [];
  let draft = createDraft();
  for (const source of sources) {
    for (let offset = 0; offset < source.indices.length; offset += 3) {
      if (draft.triangleCount > 0 && (
        draft.triangleCount + 1 > maxTriangles
        || draft.triangleCount * BYTES_PER_TRIANGLE + BYTES_PER_TRIANGLE > maxBytes
      )) {
        output.push(finalize(
          draft,
          materialKey,
          output.length,
          semanticIds,
          semanticNodeIds,
          semanticSelectionIds,
        ));
        draft = createDraft();
      }
      for (let corner = offset; corner < offset + 3; corner += 1) {
        const vertex = source.indices[corner]!;
        const targetVertex = draft.positions.length / 3;
        draft.indices.push(targetVertex);
        const x = source.positions[vertex * 3]!;
        const y = source.positions[vertex * 3 + 1]!;
        const z = source.positions[vertex * 3 + 2]!;
        draft.positions.push(x, y, z);
        draft.semanticIndices.push(
          source.semanticRemap[source.semanticIndices[vertex]!]!,
        );
        extendBounds(draft, x, y, z);
      }
      draft.triangleCount += 1;
    }
  }
  if (draft.triangleCount > 0) {
    output.push(finalize(
      draft,
      materialKey,
      output.length,
      semanticIds,
      semanticNodeIds,
      semanticSelectionIds,
    ));
  }
  return output;
}

function validateSource(
  source: ICEBatchWorkerSource,
  materialKey: string,
  ids: Set<string>,
): void {
  if (
    !source.id
    || ids.has(source.id)
    || source.materialKey !== materialKey
  ) {
    throw invalid('source identity or material is invalid');
  }
  ids.add(source.id);
  if (
    source.positions.byteLength % 12 !== 0
    || source.indices.byteLength % 12 !== 0
    || source.semanticIndices.byteLength
      !== source.positions.byteLength / 3
    || source.semanticNodeIds.length !== source.semanticIds.length
    || source.semanticSelectionIds.length !== source.semanticIds.length
    || new Set(source.semanticSelectionIds).size
      !== source.semanticSelectionIds.length
  ) {
    throw invalid('source buffer lengths are invalid');
  }
  const positions = new Float32Array(source.positions);
  const indices = new Uint32Array(source.indices);
  const semanticIndices = new Uint32Array(source.semanticIndices);
  const vertexCount = positions.length / 3;
  for (let index = 0; index < indices.length; index += 1) {
    if (indices[index]! >= vertexCount) {
      throw invalid('source index is outside its positions');
    }
  }
  for (const semantic of semanticIndices) {
    if (semantic >= source.semanticIds.length) {
      throw invalid('source semantic index is outside its semantic table');
    }
  }
}

function createDraft(): Draft {
  return {
    positions: [],
    indices: [],
    semanticIndices: [],
    triangleCount: 0,
    min: [Infinity, Infinity, Infinity],
    max: [-Infinity, -Infinity, -Infinity],
  };
}

function finalize(
  draft: Draft,
  materialKey: string,
  index: number,
  semanticIds: readonly string[],
  semanticNodeIds: readonly string[],
  semanticSelectionIds: readonly string[],
): ICEMergedBatchBuffer {
  return {
    id: `adaptive:${materialKey}:${index}`,
    materialKey,
    positions: new Float32Array(draft.positions),
    indices: new Uint32Array(draft.indices),
    semanticIndices: new Uint32Array(draft.semanticIndices),
    semanticIds,
    semanticNodeIds,
    semanticSelectionIds,
    bounds: {
      min: [...draft.min],
      max: [...draft.max],
    },
    triangleCount: draft.triangleCount,
  };
}

function extendBounds(draft: Draft, x: number, y: number, z: number): void {
  draft.min[0] = Math.min(draft.min[0], x);
  draft.min[1] = Math.min(draft.min[1], y);
  draft.min[2] = Math.min(draft.min[2], z);
  draft.max[0] = Math.max(draft.max[0], x);
  draft.max[1] = Math.max(draft.max[1], y);
  draft.max[2] = Math.max(draft.max[2], z);
}

function invalid(message: string): Error {
  return new Error(`ICE3_RENDER_BATCH_WORKER_INVALID: ${message}`);
}
